import { afterEach, describe, expect, it, vi } from "vitest";
import { getPaymentHoldMinutes, getPaymentReminderMinutes } from "./constants";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("payment hold and reminder timing", () => {
  it("holds the slot for 15 minutes and reminds the booker at 5 minutes", () => {
    expect(getPaymentHoldMinutes()).toBe(15);
    expect(getPaymentReminderMinutes()).toBe(5);
  });

  it("honours the environment overrides", () => {
    vi.stubEnv("AWAITING_PAYMENT_EXPIRE_MINUTES", "45");
    vi.stubEnv("AWAITING_PAYMENT_EMAIL_DELAY_MINUTES", "10");

    expect(getPaymentHoldMinutes()).toBe(45);
    expect(getPaymentReminderMinutes()).toBe(10);
  });

  it("falls back to the defaults when the values are empty or invalid", () => {
    vi.stubEnv("AWAITING_PAYMENT_EXPIRE_MINUTES", "");
    vi.stubEnv("AWAITING_PAYMENT_EMAIL_DELAY_MINUTES", "not-a-number");

    expect(getPaymentHoldMinutes()).toBe(15);
    expect(getPaymentReminderMinutes()).toBe(5);
  });
});
