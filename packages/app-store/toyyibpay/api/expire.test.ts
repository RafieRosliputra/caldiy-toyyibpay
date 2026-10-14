/**
 * @vitest-environment node
 */

import process from "node:process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./expire";

const mocks = vi.hoisted(() => ({
  bookingUpdate: vi.fn().mockResolvedValue({}),
  paymentUpdate: vi.fn().mockResolvedValue({}),
  paymentFindMany: vi.fn(),
  credentialFindFirst: vi.fn(),
  getBillTransactions: vi.fn(),
  deactivateBill: vi.fn().mockResolvedValue({ status: "success", result: "ok" }),
  handlePaymentSuccess: vi.fn(),
}));

const {
  bookingUpdate,
  paymentUpdate,
  paymentFindMany,
  credentialFindFirst,
  getBillTransactions,
  deactivateBill,
  handlePaymentSuccess,
} = mocks;

vi.mock("@calcom/prisma", () => ({
  default: {
    payment: { findMany: mocks.paymentFindMany, update: mocks.paymentUpdate },
    credential: { findFirst: mocks.credentialFindFirst },
    booking: { update: mocks.bookingUpdate },
  },
}));

vi.mock("../lib/toyyibpayClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/toyyibpayClient")>();
  return {
    ...actual,
    getToyyibpayBillTransactions: mocks.getBillTransactions,
    deactivateToyyibpayBill: mocks.deactivateBill,
  };
});

vi.mock("@calcom/app-store/_utils/payments/handlePaymentSuccess", () => ({
  handlePaymentSuccess: mocks.handlePaymentSuccess,
}));

vi.mock("@calcom/lib/tracing/factory", () => ({
  distributedTracing: { createTrace: vi.fn().mockReturnValue({}) },
}));

const paidBookingPayment = {
  id: 4,
  externalId: "a28hbcrk",
  bookingId: 9,
  success: false,
  data: {
    billCode: "a28hbcrk",
    paymentUrl: "https://toyyibpay.com/a28hbcrk",
    isSandbox: false,
    bookingUid: "uid-9",
    bookerEmail: "booker@example.com",
  },
  booking: { userId: 1, eventType: { teamId: null } },
};

function createRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  paymentFindMany.mockResolvedValue([paidBookingPayment]);
  credentialFindFirst.mockResolvedValue({
    key: { isSandbox: false, prod: { secretKey: "test-secret", categoryCode: "testcat" } },
  });
});

describe("ToyyibPay expiration job", () => {
  it("recovers a bill that was paid, even though handlePaymentSuccess signals success by throwing", async () => {
    getBillTransactions.mockResolvedValue([{ billpaymentStatus: "1" }]);
    // This is how cal.diy's handlePaymentSuccess reports success
    handlePaymentSuccess.mockRejectedValue({
      statusCode: 200,
      message: "Booking with id '9' was paid and confirmed.",
    });

    const res = createRes();
    await handler({ headers: { authorization: "Bearer test-cron-secret" } } as never, res as never);

    expect(handlePaymentSuccess).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ recovered: 1, expired: 0 }));
    expect(bookingUpdate).not.toHaveBeenCalled();
    expect(deactivateBill).not.toHaveBeenCalled();
  });

  it("never cancels the booking when recovery fails for a real reason", async () => {
    getBillTransactions.mockResolvedValue([{ billpaymentStatus: "1" }]);
    handlePaymentSuccess.mockRejectedValue(new Error("smtp down"));

    const res = createRes();
    await handler({ headers: { authorization: "Bearer test-cron-secret" } } as never, res as never);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ recovered: 0, expired: 0 }));
    expect(bookingUpdate).not.toHaveBeenCalled();
    expect(deactivateBill).not.toHaveBeenCalled();
  });

  it("cancels the booking only when ToyyibPay confirms the bill is unpaid", async () => {
    getBillTransactions.mockResolvedValue([]);

    const res = createRes();
    await handler({ headers: { authorization: "Bearer test-cron-secret" } } as never, res as never);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ expired: 1, recovered: 0 }));
    expect(deactivateBill).toHaveBeenCalledTimes(1);
    expect(bookingUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "CANCELLED" } }));
  });

  it("keeps the booking when the bill cannot be verified (a paid bill must never be cancelled)", async () => {
    getBillTransactions.mockRejectedValue(new Error("ToyyibPay unreachable"));

    const res = createRes();
    await handler({ headers: { authorization: "Bearer test-cron-secret" } } as never, res as never);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ expired: 0, recovered: 0 }));
    expect(bookingUpdate).not.toHaveBeenCalled();
    expect(deactivateBill).not.toHaveBeenCalled();
  });

  it("rejects requests without the cron secret", async () => {
    const res = createRes();
    await handler({ headers: {} } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(paymentFindMany).not.toHaveBeenCalled();
  });
});
