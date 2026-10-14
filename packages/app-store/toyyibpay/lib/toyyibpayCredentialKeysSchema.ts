import z from "zod";

const toyyibpayAccountSchema = z.object({
  secretKey: z.string().min(1),
  categoryCode: z.string().min(1),
});

/**
 * Credentials are stored per user/team in `Credential.key`, so a single instance can hold
 * both production and sandbox credentials and switch between them.
 */
export const toyyibpayCredentialKeysSchema = z.object({
  prod: toyyibpayAccountSchema.optional(),
  sandbox: toyyibpayAccountSchema.optional(),
  isSandbox: z.boolean(),
  /** ToyyibPay DuitNow QR must be activated on the account before it can be used, otherwise createBill fails. */
  enableDuitNowQR: z.boolean().optional().default(false),
  /** 0 = FPX, 1 = Credit Card, 2 = Both */
  paymentChannel: z.enum(["0", "1", "2"]).optional().default("2"),
});

export type ToyyibpayCredentials = z.infer<typeof toyyibpayCredentialKeysSchema>;
