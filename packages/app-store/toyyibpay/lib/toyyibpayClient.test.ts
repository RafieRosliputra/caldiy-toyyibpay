import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createToyyibpayBill,
  getToyyibpayBillTransactions,
  getToyyibpayCategoryDetails,
  verifyToyyibpayCallbackHash,
} from "./toyyibpayClient";

const account = { secretKey: "test-secret", categoryCode: "testcat", isSandbox: false };

function mockFetchOnce(body: string, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status, headers: { "Content-Type": "application/json" } }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * These responses are the real payloads returned by the live ToyyibPay API, which differ from the
 * documented shapes (object instead of array, `CategoryName` instead of `categoryName`).
 */
describe("getToyyibpayCategoryDetails", () => {
  it("reads the category from a bare object response with capitalised keys", async () => {
    mockFetchOnce(
      '{"CategoryName":"caldiy","categoryDescription":"payment caldiy bookings.johorstudio.cc","categoryStatus":"1"}'
    );

    await expect(
      getToyyibpayCategoryDetails({
        secretKey: account.secretKey,
        categoryCode: account.categoryCode,
        isSandbox: false,
      })
    ).resolves.toEqual({ categoryName: "caldiy", categoryStatus: "1" });
  });

  it("still reads the documented array response", async () => {
    mockFetchOnce('[{"categoryName":"Makanan","categoryStatus":"1"}]');

    await expect(
      getToyyibpayCategoryDetails({
        secretKey: account.secretKey,
        categoryCode: account.categoryCode,
        isSandbox: false,
      })
    ).resolves.toEqual({ categoryName: "Makanan", categoryStatus: "1" });
  });

  it("throws on an error response", async () => {
    mockFetchOnce('{"status":"error","msg":"categoryCode parameter is empty"}');

    await expect(
      getToyyibpayCategoryDetails({
        secretKey: account.secretKey,
        categoryCode: account.categoryCode,
        isSandbox: false,
      })
    ).rejects.toThrow(/categoryCode parameter is empty/);
  });
});

describe("createToyyibpayBill", () => {
  const input = {
    account,
    billName: "Consultation",
    billDescription: "Booking on 01 Jan 2026 10:00",
    billAmount: 5000,
    billReturnUrl: "https://example.com/api/integrations/toyyibpay/callback",
    billCallbackUrl: "https://example.com/api/integrations/toyyibpay/webhook",
    billExternalReferenceNo: "ref-1",
  };

  it("accepts the documented array response", async () => {
    mockFetchOnce('[{"BillCode":"gcbhict9"}]');
    await expect(createToyyibpayBill(input)).resolves.toEqual({
      billCode: "gcbhict9",
      paymentUrl: "https://toyyibpay.com/gcbhict9",
    });
  });

  it("accepts a bare object response", async () => {
    mockFetchOnce('{"BillCode":"gcbhict9"}');
    await expect(createToyyibpayBill(input)).resolves.toMatchObject({ billCode: "gcbhict9" });
  });

  it("throws when no bill code is returned", async () => {
    mockFetchOnce("[KEY-DID-NOT-EXIST]");
    await expect(createToyyibpayBill(input)).rejects.toThrow(/KEY-DID-NOT-EXIST/);
  });
});

describe("getToyyibpayBillTransactions", () => {
  it("normalises a single object response into an array", async () => {
    mockFetchOnce('{"billpaymentStatus":"1","billpaymentAmount":"50.00","billpaymentChannel":"FPX"}');

    const transactions = await getToyyibpayBillTransactions({ billCode: "gcbhict9", isSandbox: false });

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ billpaymentStatus: "1", billpaymentChannel: "FPX" });
  });

  it("keeps the documented array response", async () => {
    mockFetchOnce('[{"billpaymentStatus":"3"}]');
    const transactions = await getToyyibpayBillTransactions({ billCode: "gcbhict9", isSandbox: false });
    expect(transactions).toEqual([expect.objectContaining({ billpaymentStatus: "3" })]);
  });
});

describe("verifyToyyibpayCallbackHash", () => {
  it("accepts the hash computed by ToyyibPay", () => {
    // md5("secret" + "1" + "order-1" + "ref-1" + "ok")
    const valid = verifyToyyibpayCallbackHash({
      secretKey: "secret",
      status: "1",
      orderId: "order-1",
      refno: "ref-1",
      hash: "3b5cfc4e962d7d1269108581de3085ce",
    });

    expect(valid).toBe(true);
  });

  it("rejects a tampered payload", () => {
    expect(
      verifyToyyibpayCallbackHash({
        secretKey: "secret",
        status: "1",
        orderId: "order-2",
        refno: "ref-1",
        hash: "3b5cfc4e962d7d1269108581de3085ce",
      })
    ).toBe(false);
  });
});
