import z from "zod";

/**
 * Shape of `Payment.data` for ToyyibPay payments.
 * `externalId` holds the ToyyibPay bill code, `uid` is the payment reference (billExternalReferenceNo).
 */
export const toyyibpayPaymentDataSchema = z.object({
  billCode: z.string(),
  paymentUrl: z.string(),
  returnUrl: z.string().optional(),
  callbackUrl: z.string().optional(),
  isSandbox: z.boolean(),
  billExpiryDate: z.string().optional(),
  bookingUid: z.string(),
  eventTypeSlug: z.string().nullable().optional(),
  bookingUserName: z.string().nullable().optional(),
  bookerName: z.string().nullable().optional(),
  bookerEmail: z.string(),
  bookerPhoneNumber: z.string().nullable().optional(),
  isPaid: z.boolean().optional(),
  /** Set by the expiration cron when the bill was deactivated and the held slot was released. */
  expired: z.boolean().optional(),
});

export type ToyyibpayPaymentData = z.infer<typeof toyyibpayPaymentDataSchema>;
