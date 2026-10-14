import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import type { NextApiRequest, NextApiResponse } from "next";
import qs from "qs";
import { toyyibpayPaymentDataSchema } from "../lib/toyyibpayPaymentDataSchema";

const log = logger.getSubLogger({ prefix: ["toyyibpay:return-url"] });

const WEBAPP_FALLBACK = "/";

/**
 * ToyyibPay `billReturnUrl` handler (browser redirect, GET).
 *
 * This is only used for the user experience: it sends the booker to the booking success page or back to the
 * booking page. The booking is confirmed by the server-to-server callback (`/webhook`) only.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const asString = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

  const billCode = asString(req.query.billcode);
  const orderId = asString(req.query.order_id);
  const statusId = asString(req.query.status_id);
  const reference = asString(req.query.ref);

  if (!billCode && !orderId && !reference) {
    return res.redirect(WEBAPP_FALLBACK);
  }

  const payment = await prisma.payment.findFirst({
    where: {
      OR: [
        ...(billCode ? [{ externalId: billCode }] : []),
        ...(orderId ? [{ uid: orderId }] : []),
        ...(reference ? [{ uid: reference }] : []),
      ],
    },
    select: {
      id: true,
      success: true,
      data: true,
      booking: {
        select: {
          uid: true,
          user: { select: { username: true } },
          eventType: { select: { slug: true } },
        },
      },
    },
  });

  if (!payment?.booking) {
    log.warn(`No ToyyibPay payment found for billcode=${billCode} order_id=${orderId} ref=${reference}`);
    return res.redirect(WEBAPP_FALLBACK);
  }

  const parsedData = toyyibpayPaymentDataSchema.safeParse(payment.data);

  if (payment.success || statusId === "1") {
    const query = qs.stringify({
      "flag.coep": false,
      isSuccessBookingPage: true,
      ...(parsedData.success ? { email: parsedData.data.bookerEmail } : {}),
      ...(payment.booking.eventType?.slug ? { eventTypeSlug: payment.booking.eventType.slug } : {}),
    });
    return res.redirect(`/booking/${payment.booking.uid}?${query}`);
  }

  // Payment failed or is still pending. The bill stays payable until it expires, so send the booker back to
  // the booking page instead of cancelling the booking here.
  const username = payment.booking.user?.username;
  const eventTypeSlug = payment.booking.eventType?.slug;
  if (username && eventTypeSlug) {
    return res.redirect(`/${username}/${eventTypeSlug}`);
  }

  return res.redirect(WEBAPP_FALLBACK);
}
