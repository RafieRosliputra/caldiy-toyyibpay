import process from "node:process";
export const TOYYIBPAY_API_PRODUCTION = process.env.TOYYIBPAY_API_PRODUCTION || "https://toyyibpay.com";
export const TOYYIBPAY_API_SANDBOX = process.env.TOYYIBPAY_API_SANDBOX || "https://dev.toyyibpay.com";

/**
 * ToyyibPay only settles in Malaysian Ringgit. billAmount is always sent in cents (sen).
 */
export const TOYYIBPAY_SUPPORTED_CURRENCY = "MYR";

/**
 * ToyyibPay's `billPaymentChannel` values.
 * 0 = FPX (online banking), 1 = Credit Card, 2 = Both
 */
export const TOYYIBPAY_PAYMENT_CHANNELS = {
  FPX: "0",
  CREDIT_CARD: "1",
  FPX_AND_CREDIT_CARD: "2",
} as const;

/**
 * How long we hold a slot while the booker is paying.
 *
 * `AWAITING_PAYMENT_EMAIL_DELAY_MINUTES` (default 15) is when the reminder email is sent, while
 * `AWAITING_PAYMENT_EXPIRE_MINUTES` (default 30) is when the slot is released and the bill is deactivated.
 * The hold must be longer than the reminder, otherwise the reminder arrives exactly as the slot is freed.
 */
export const DEFAULT_PAYMENT_REMINDER_MINUTES = 5;
export const DEFAULT_PAYMENT_HOLD_MINUTES = 15;

export function getPaymentReminderMinutes(): number {
  return Number(process.env.AWAITING_PAYMENT_EMAIL_DELAY_MINUTES) || DEFAULT_PAYMENT_REMINDER_MINUTES;
}

export function getPaymentHoldMinutes(): number {
  return Number(process.env.AWAITING_PAYMENT_EXPIRE_MINUTES) || DEFAULT_PAYMENT_HOLD_MINUTES;
}

/** ToyyibPay rejects bills of RM1.00 or less ("billAmount should more than 1.00"). */
export const TOYYIBPAY_MIN_BILL_AMOUNT_SEN = 100;
