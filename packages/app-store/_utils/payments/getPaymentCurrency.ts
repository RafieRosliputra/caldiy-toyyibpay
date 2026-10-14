type AppDataLike = { enabled?: boolean; price?: number; currency?: string } | null | undefined;

/**
 * Resolves the currency a payment page should display.
 *
 * `getPaymentAppData()` deliberately prefers the event type's legacy `currency` column over the app's own
 * currency (see `getEventTypeAppData`). That column is often still the `"usd"` default, so a MYR ToyyibPay
 * event type would be rendered as dollars. Pages that show an amount should use this helper instead.
 *
 * `metadata` is typed loosely on purpose because callers pass a Prisma `JsonValue`.
 */
export function getPaymentCurrency(eventType: { currency?: string | null; metadata?: unknown }): string {
  const apps = (eventType.metadata as { apps?: Record<string, AppDataLike> } | null | undefined)?.apps;

  if (apps) {
    for (const app of Object.values(apps)) {
      const isPaidApp = Boolean(app?.enabled) && (app?.price ?? 0) > 0;
      if (isPaidApp && app?.currency) {
        return app.currency.toLowerCase();
      }
    }
  }

  return (eventType.currency || "usd").toLowerCase();
}
