/**
 * `handlePaymentSuccess()` from `@calcom/app-store/_utils/payments/handlePaymentSuccess` signals success by
 * **throwing** an `HttpError` whose `statusCode` is 200. Callers that treat any throw as a failure would
 * wrongly consider a confirmed payment as broken (and, in the expiration job, could cancel a paid booking).
 */
export function isPaymentSuccessSignal(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { statusCode?: unknown }).statusCode === 200
  );
}
