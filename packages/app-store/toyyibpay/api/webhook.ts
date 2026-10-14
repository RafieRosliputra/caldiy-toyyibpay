import { handlePaymentSuccess } from "@calcom/app-store/_utils/payments/handlePaymentSuccess";
import { IS_PRODUCTION } from "@calcom/lib/constants";
import { HttpError } from "@calcom/lib/http-error";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import { getServerErrorFromUnknown } from "@calcom/lib/server/getServerErrorFromUnknown";
import { distributedTracing } from "@calcom/lib/tracing/factory";
import prisma from "@calcom/prisma";
import type { NextApiRequest, NextApiResponse } from "next";
import appConfig from "../config.json";
import { parseCallbackBody } from "../lib/parseCallbackBody";
import { verifyToyyibpayCallbackHash } from "../lib/toyyibpayClient";
import { toyyibpayCredentialKeysSchema } from "../lib/toyyibpayCredentialKeysSchema";
import { toyyibpayPaymentDataSchema } from "../lib/toyyibpayPaymentDataSchema";

const log = logger.getSubLogger({ prefix: ["toyyibpay:webhook"] });

async function readRawBody(req: NextApiRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The callback arrives as multipart/form-data, so the body must stay unparsed for us to decode it.
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * ToyyibPay `billCallbackUrl` handler (server-to-server POST).
 *
 * Payload: refno, status (1 = success, 2 = pending, 3 = fail), reason, billcode, order_id, amount,
 * transaction_time, hash. The hash MUST be verified before the booking is confirmed:
 *   md5(userSecretKey + status + order_id + refno + "ok")
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      throw new HttpError({ statusCode: 405, message: "Method Not Allowed" });
    }

    const contentType = String(req.headers["content-type"] ?? "");
    const rawBody = await readRawBody(req);
    const parsedBody = parseCallbackBody(rawBody, contentType);
    // Merge so the handler also works if something upstream already parsed the body.
    const body: Record<string, unknown> = { ...(isPlainObject(req.body) ? req.body : {}), ...parsedBody };
    const asString = (value: unknown) => (value === undefined || value === null ? "" : String(value));

    const refno = asString(body.refno);
    const status = asString(body.status);
    const orderId = asString(body.order_id);
    const billCode = asString(body.billcode);
    const amount = asString(body.amount);
    const hash = asString(body.hash);

    if (!orderId && !billCode) {
      log.error(
        `ToyyibPay callback without order_id/billcode (content-type="${contentType}", fields=[${Object.keys(
          body
        ).join(",")}], rawLength=${rawBody.length})`
      );
      throw new HttpError({ statusCode: 400, message: "Missing order_id/billcode" });
    }
    if (!hash) {
      throw new HttpError({ statusCode: 400, message: "Missing hash" });
    }

    const payment = await prisma.payment.findFirst({
      where: {
        OR: [...(orderId ? [{ uid: orderId }] : []), ...(billCode ? [{ externalId: billCode }] : [])],
      },
      select: {
        id: true,
        amount: true,
        bookingId: true,
        success: true,
        data: true,
        booking: {
          select: {
            userId: true,
            status: true,
            eventType: { select: { teamId: true } },
          },
        },
      },
    });

    if (!payment) {
      log.warn(`ToyyibPay callback for unknown payment (order_id=${orderId}, billcode=${billCode})`);
      return res.status(200).json({ message: "Payment not found" });
    }

    const credential = await prisma.credential.findFirst({
      where: {
        type: appConfig.type,
        ...(payment.booking?.eventType?.teamId
          ? { teamId: payment.booking.eventType.teamId }
          : { userId: payment.booking?.userId ?? undefined }),
      },
      select: { key: true },
    });

    const parsedKeys = toyyibpayCredentialKeysSchema.safeParse(credential?.key);
    if (!parsedKeys.success) {
      log.error(`ToyyibPay credentials missing for payment ${payment.id}`);
      return res.status(200).json({ message: "Credentials not found" });
    }

    const parsedData = toyyibpayPaymentDataSchema.safeParse(payment.data);
    const isSandbox = parsedData.success ? parsedData.data.isSandbox : parsedKeys.data.isSandbox;
    const account = isSandbox ? parsedKeys.data.sandbox : parsedKeys.data.prod;

    if (!account?.secretKey) {
      log.error(
        `ToyyibPay ${isSandbox ? "sandbox" : "production"} secret key missing for payment ${payment.id}`
      );
      return res.status(200).json({ message: "Credentials not found" });
    }

    if (!verifyToyyibpayCallbackHash({ secretKey: account.secretKey, status, orderId, refno, hash })) {
      log.error(`Invalid ToyyibPay callback hash for payment ${payment.id} (order_id=${orderId})`);
      throw new HttpError({ statusCode: 400, message: "Invalid hash" });
    }

    // Guard against a callback for a smaller amount than the booking price (allow 1 sen tolerance).
    const paidAmount = amount ? Math.round(Number.parseFloat(amount) * 100) : null;
    if (paidAmount !== null && !Number.isNaN(paidAmount) && paidAmount + 1 < payment.amount) {
      log.error(
        `ToyyibPay amount mismatch for payment ${payment.id}: paid ${paidAmount} sen, expected ${payment.amount} sen`
      );
      throw new HttpError({ statusCode: 400, message: "Amount mismatch" });
    }

    if (payment.success) {
      return res.status(200).json({ message: "Already processed" });
    }

    // A cancelled booking must never be revived by a late payment: the booking was cancelled by the host,
    // or by the expiration job (`/api/integrations/toyyibpay/expire`) which also deactivates the bill.
    if (payment.booking?.status === "CANCELLED") {
      log.warn(`ToyyibPay payment ${payment.id} received for a cancelled booking, ignoring`);
      return res.status(200).json({ message: "Booking is cancelled" });
    }

    if (status !== "1") {
      if (status === "3") {
        log.info(`ToyyibPay payment ${payment.id} failed (${asString(body.reason)}), cancelling booking`);
        await prisma.booking.update({
          where: { id: payment.bookingId },
          data: { status: "CANCELLED" },
        });
      }
      return res.status(200).json({ message: `Payment status ${status}` });
    }

    const traceContext = distributedTracing.createTrace("toyyibpay_webhook", {
      meta: { paymentId: payment.id, bookingId: payment.bookingId },
    });

    await handlePaymentSuccess({
      paymentId: payment.id,
      bookingId: payment.bookingId,
      appSlug: appConfig.slug,
      traceContext,
    });

    return res.status(200).json({ message: "OK" });
  } catch (error) {
    const err = getServerErrorFromUnknown(error);
    log.error(`ToyyibPay webhook error: ${safeStringify(error)}`);
    const statusCode = error instanceof HttpError ? error.statusCode : 200;
    const causeStack = err.cause instanceof Error ? err.cause.stack : undefined;
    return res.status(statusCode).json({
      message: err.message,
      stack: IS_PRODUCTION ? undefined : causeStack,
    });
  }
}
