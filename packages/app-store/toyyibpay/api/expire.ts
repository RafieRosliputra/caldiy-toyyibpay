import process from "node:process";
import { handlePaymentSuccess } from "@calcom/app-store/_utils/payments/handlePaymentSuccess";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import { distributedTracing } from "@calcom/lib/tracing/factory";
import prisma from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import appConfig from "../config.json";
import { DEFAULT_PAYMENT_HOLD_MINUTES } from "../lib/constants";
import { deactivateToyyibpayBill, getToyyibpayBillTransactions } from "../lib/toyyibpayClient";
import { toyyibpayCredentialKeysSchema } from "../lib/toyyibpayCredentialKeysSchema";
import { toyyibpayPaymentDataSchema } from "../lib/toyyibpayPaymentDataSchema";

const log = logger.getSubLogger({ prefix: ["toyyibpay:expire"] });

const MAX_PAYMENTS_PER_RUN = 25;

/**
 * Cron endpoint (call with `Authorization: Bearer ${CRON_SECRET}`) that releases slots held by abandoned
 * ToyyibPay payments:
 *
 * 1. Finds unpaid ToyyibPay payments whose booking is still PENDING and older than the hold window.
 * 2. Double checks the bill with `getBillTransactions` in case the callback was lost - if the booker did pay,
 *    the booking is confirmed instead.
 * 3. Otherwise deactivates the bill (`inactiveBill`) so it can no longer be paid and cancels the booking,
 *    which releases the slot.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const holdMinutes =
    Number(process.env.AWAITING_PAYMENT_EMAIL_DELAY_MINUTES) || DEFAULT_PAYMENT_HOLD_MINUTES;
  const cutoff = new Date(Date.now() - holdMinutes * 60_000);

  const payments = await prisma.payment.findMany({
    where: {
      appId: appConfig.slug,
      success: false,
      booking: { status: "PENDING", createdAt: { lt: cutoff } },
    },
    select: {
      id: true,
      externalId: true,
      bookingId: true,
      data: true,
      booking: {
        select: {
          userId: true,
          eventType: { select: { teamId: true } },
        },
      },
    },
    take: MAX_PAYMENTS_PER_RUN,
  });

  let recovered = 0;
  let expired = 0;

  for (const payment of payments) {
    const parsedData = toyyibpayPaymentDataSchema.safeParse(payment.data);
    const isSandbox = parsedData.success ? parsedData.data.isSandbox : true;

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
    const account = parsedKeys.success
      ? isSandbox
        ? parsedKeys.data.sandbox
        : parsedKeys.data.prod
      : undefined;

    if (account?.secretKey) {
      try {
        const transactions = await getToyyibpayBillTransactions({
          billCode: payment.externalId,
          isSandbox,
        });

        if (transactions.some((transaction) => transaction.billpaymentStatus === "1")) {
          log.info(`ToyyibPay payment ${payment.id} was paid but not confirmed, confirming it now`);
          await handlePaymentSuccess({
            paymentId: payment.id,
            bookingId: payment.bookingId,
            appSlug: appConfig.slug,
            traceContext: distributedTracing.createTrace("toyyibpay_expire_recovery", {
              meta: { paymentId: payment.id, bookingId: payment.bookingId },
            }),
          });
          recovered++;
          continue;
        }
      } catch (error) {
        log.warn(`Could not check ToyyibPay bill ${payment.externalId}: ${safeStringify(error)}`);
      }

      try {
        await deactivateToyyibpayBill({
          secretKey: account.secretKey,
          billCode: payment.externalId,
          isSandbox,
        });
      } catch (error) {
        log.warn(`Could not deactivate ToyyibPay bill ${payment.externalId}: ${safeStringify(error)}`);
      }
    }

    await prisma.booking.update({
      where: { id: payment.bookingId },
      data: { status: "CANCELLED" },
    });

    if (parsedData.success) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          data: { ...parsedData.data, expired: true } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    log.info(`Released slot for booking ${payment.bookingId} (ToyyibPay payment ${payment.id} expired)`);
    expired++;
  }

  return res.status(200).json({ success: true, checked: payments.length, expired, recovered });
}
