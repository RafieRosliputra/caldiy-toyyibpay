import { describe, expect, it } from "vitest";
import { getPaymentAppData } from "./getPaymentAppData";

/**
 * `/payment/[uid]` used to render with hardcoded empty props (`metadata: null`), which made
 * `getPaymentAppData()` throw while parsing the metadata and surfaced as the generic
 * "It's not you, it's us" error page for every paid booking.
 */
describe("getPaymentAppData", () => {
  it("does not throw when metadata is an empty object (the fallback the payment page now uses)", () => {
    const result = getPaymentAppData({ price: 0, currency: "usd", metadata: {} });

    expect(result.enabled).toBe(false);
    expect(result.appId).toBeNull();
  });

  it("tolerates a null metadata object, so pages may pass empty metadata", () => {
    expect(() => getPaymentAppData({ price: 0, currency: "usd", metadata: null })).not.toThrow();
  });

  it("reads the ToyyibPay price from the event type metadata", () => {
    const result = getPaymentAppData({
      price: 0,
      currency: "usd",
      metadata: {
        apps: {
          toyyibpay: {
            enabled: true,
            price: 5000,
            currency: "myr",
            paymentOption: "ON_BOOKING",
          },
        },
      },
    });

    expect(result).toMatchObject({
      enabled: true,
      appId: "toyyibpay",
      price: 5000,
    });
  });

  it("returns the event type's currency column, not the app currency (see getPaymentCurrency)", () => {
    const result = getPaymentAppData({
      price: 0,
      currency: "usd",
      metadata: {
        apps: {
          toyyibpay: {
            enabled: true,
            price: 5000,
            currency: "myr",
            paymentOption: "ON_BOOKING",
          },
        },
      },
    });

    expect(result.currency).toBe("usd");
  });
});
