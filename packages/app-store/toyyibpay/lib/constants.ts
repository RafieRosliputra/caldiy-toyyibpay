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
 * How long we hold a slot while the booker is paying. The ToyyibPay bill expires at the same time,
 * and the awaiting-payment email is scheduled with the same delay (`AWAITING_PAYMENT_EMAIL_DELAY_MINUTES`).
 */
export const DEFAULT_PAYMENT_HOLD_MINUTES = 15;
