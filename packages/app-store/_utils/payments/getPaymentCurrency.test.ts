import { describe, expect, it } from "vitest";
import { getPaymentCurrency } from "./getPaymentCurrency";

const toyyibpayMetadata = {
  apps: {
    toyyibpay: {
      enabled: true,
      price: 5000,
      currency: "myr",
      paymentOption: "ON_BOOKING",
    },
  },
};

describe("getPaymentCurrency", () => {
  it("prefers the enabled payment app's currency over the event type column", () => {
    // event type column still holds the "usd" database default
    expect(getPaymentCurrency({ currency: "usd", metadata: toyyibpayMetadata })).toBe("myr");
  });

  it("falls back to the event type currency when no payment app is enabled", () => {
    expect(getPaymentCurrency({ currency: "usd", metadata: {} })).toBe("usd");
    expect(getPaymentCurrency({ currency: "eur", metadata: null })).toBe("eur");
  });

  it("ignores payment apps that are not enabled or have no price", () => {
    expect(
      getPaymentCurrency({
        currency: "usd",
        metadata: { apps: { toyyibpay: { enabled: false, price: 5000, currency: "myr" } } },
      })
    ).toBe("usd");

    expect(
      getPaymentCurrency({
        currency: "usd",
        metadata: { apps: { toyyibpay: { enabled: true, price: 0, currency: "myr" } } },
      })
    ).toBe("usd");
  });
});
