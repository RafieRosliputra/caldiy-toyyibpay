import { createHash, timingSafeEqual } from "node:crypto";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type z from "zod";
import { TOYYIBPAY_API_PRODUCTION, TOYYIBPAY_API_SANDBOX } from "./constants";
import type { toyyibpayCredentialKeysSchema } from "./toyyibpayCredentialKeysSchema";

type ToyyibpayCredentials = z.infer<typeof toyyibpayCredentialKeysSchema>;

export interface ToyyibpayAccount {
  secretKey: string;
  categoryCode: string;
  isSandbox: boolean;
}

export interface CreateToyyibpayBillInput {
  account: ToyyibpayAccount;
  billName: string;
  billDescription: string;
  /** Amount in cents (sen). e.g. RM10.50 => 1050 */
  billAmount: number;
  billReturnUrl: string;
  billCallbackUrl: string;
  billExternalReferenceNo: string;
  billTo?: string | null;
  billEmail?: string | null;
  billPhone?: string | null;
  /** 0 = FPX, 1 = Credit Card, 2 = Both */
  billPaymentChannel?: string;
  enableDuitNowQR?: boolean;
  /** ToyyibPay local time format: "dd-MM-yyyy HH:mm:ss" (Asia/Kuala_Lumpur) */
  billExpiryDate?: string;
  billChargeToCustomer?: boolean;
}

export interface ToyyibpayBillTransaction {
  billpaymentStatus?: string;
  billpaymentChannel?: string;
  billpaymentAmount?: string;
  billpaymentInvoiceNo?: string;
  billExternalReferenceNo?: string;
}

export function getToyyibpayBaseUrl(isSandbox: boolean): string {
  return isSandbox ? TOYYIBPAY_API_SANDBOX : TOYYIBPAY_API_PRODUCTION;
}

export function resolveToyyibpayAccount(credentials: ToyyibpayCredentials): ToyyibpayAccount {
  const environment = credentials.isSandbox ? "sandbox" : "production";
  const account = credentials.isSandbox ? credentials.sandbox : credentials.prod;
  if (!account?.secretKey || !account?.categoryCode) {
    throw new ErrorWithCode(
      ErrorCode.PaymentCreationFailure,
      `ToyyibPay ${environment} credentials (secret key and category code) are not configured`
    );
  }
  return {
    secretKey: account.secretKey,
    categoryCode: account.categoryCode,
    isSandbox: credentials.isSandbox,
  };
}

/**
 * ToyyibPay only accepts alphanumeric characters, spaces and underscores for bill name/description.
 */
export function sanitizeToyyibpayBillText(value: string, maxLength: number): string {
  const sanitized = value
    .replace(/[^A-Za-z0-9 _]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
  return sanitized.length > 0 ? sanitized : "Cal.com Booking";
}

/**
 * ToyyibPay expects the expiry in Malaysian local time: "17-12-2020 17:00:00".
 */
export function formatToyyibpayExpiryDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.day}-${parts.month}-${parts.year} ${hour}:${parts.minute}:${parts.second}`;
}

/**
 * ToyyibPay callback hash: md5(userSecretKey + status + order_id + refno + "ok").
 * Must be validated before treating a payment as successful.
 */
export function verifyToyyibpayCallbackHash({
  secretKey,
  status,
  orderId,
  refno,
  hash,
}: {
  secretKey: string;
  status: string;
  orderId: string;
  refno: string;
  hash: string;
}): boolean {
  const expected = createHash("md5")
    .update(`${secretKey}${status}${orderId}${refno}ok`, "utf-8")
    .digest("hex");
  const received = hash.trim().toLowerCase();
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf-8"), Buffer.from(received, "utf-8"));
}

async function callToyyibpayApi(
  baseUrl: string,
  endpoint: string,
  data: Record<string, string>
): Promise<string> {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data).toString(),
    signal: AbortSignal.timeout(20_000),
  });

  const body = await response.text();
  if (!response.ok && !body) {
    throw new ErrorWithCode(
      ErrorCode.PaymentCreationFailure,
      `ToyyibPay ${endpoint} failed with HTTP ${response.status}`
    );
  }
  return body;
}

function parseToyyibpayResponse<T>(endpoint: string, body: string): T {
  const trimmed = body.trim();
  try {
    const parsed = JSON.parse(trimmed) as T | { status?: string; msg?: string; message?: string };
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "status" in parsed &&
      parsed.status === "error"
    ) {
      // Some endpoints answer with `msg`, others (e.g. checkDuitNowQRStatus) with `message`.
      const parsedError = parsed as { msg?: string; message?: string };
      throw new ErrorWithCode(
        ErrorCode.PaymentCreationFailure,
        `ToyyibPay ${endpoint} error: ${parsedError.msg ?? parsedError.message ?? "unknown error"}`
      );
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof ErrorWithCode) throw error;
    // ToyyibPay returns plain text codes such as [KEY-DID-NOT-EXIST] / [CATEGORY-NOT-MATCH] for account errors
    throw new ErrorWithCode(
      ErrorCode.PaymentCreationFailure,
      `ToyyibPay ${endpoint} returned an unexpected response: ${trimmed.slice(0, 300)}`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * ToyyibPay is inconsistent about response shapes: the docs show arrays (`[{...}]`) while the live API
 * sometimes returns a bare object (`{...}`). This picks the first usable object from either shape.
 */
function firstRecord(parsed: unknown): Record<string, unknown> | null {
  if (Array.isArray(parsed)) {
    const first = parsed.find((entry) => isRecord(entry));
    return isRecord(first) ? first : null;
  }
  return isRecord(parsed) ? parsed : null;
}

/** Field names also vary in casing (`BillCode` vs `billcode`, `CategoryName` vs `categoryName`). */
function pickField(source: Record<string, unknown>, fieldName: string): string | undefined {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = normalize(fieldName);
  for (const [key, value] of Object.entries(source)) {
    if (normalize(key) !== target) continue;
    if (value === null || value === undefined) return undefined;
    return String(value);
  }
  return undefined;
}

export async function createToyyibpayBill({
  account,
  billName,
  billDescription,
  billAmount,
  billReturnUrl,
  billCallbackUrl,
  billExternalReferenceNo,
  billTo,
  billEmail,
  billPhone,
  billPaymentChannel = "2",
  enableDuitNowQR,
  billExpiryDate,
  billChargeToCustomer,
}: CreateToyyibpayBillInput): Promise<{ billCode: string; paymentUrl: string }> {
  const baseUrl = getToyyibpayBaseUrl(account.isSandbox);
  const hasPayerInfo = Boolean(billTo && billEmail && billPhone);

  const data: Record<string, string> = {
    userSecretKey: account.secretKey,
    categoryCode: account.categoryCode,
    billName: sanitizeToyyibpayBillText(billName, 30),
    billDescription: sanitizeToyyibpayBillText(billDescription, 100),
    billPriceSetting: "1",
    billPayorInfo: hasPayerInfo ? "1" : "0",
    billAmount: String(billAmount),
    billReturnUrl,
    billCallbackUrl,
    billExternalReferenceNo,
    billPaymentChannel,
    billSplitPayment: "0",
  };

  if (hasPayerInfo) {
    data.billTo = billTo as string;
    data.billEmail = billEmail as string;
    data.billPhone = billPhone as string;
  }

  if (billExpiryDate) data.billExpiryDate = billExpiryDate;
  if (typeof billChargeToCustomer === "boolean") {
    data.billChargeToCustomer = billChargeToCustomer ? "0" : "1";
  }
  if (enableDuitNowQR) {
    data.enableDuitNowQR = "1";
    data.chargeDuitNowQR = "0";
  }

  const body = await callToyyibpayApi(baseUrl, "/index.php/api/createBill", data);
  const parsed = parseToyyibpayResponse<unknown>("/index.php/api/createBill", body);
  const record = firstRecord(parsed);
  const billCode = record ? pickField(record, "BillCode") : undefined;

  if (!billCode) {
    throw new ErrorWithCode(
      ErrorCode.PaymentCreationFailure,
      `ToyyibPay did not return a bill code: ${body.slice(0, 300)}`
    );
  }

  return { billCode, paymentUrl: `${baseUrl}/${billCode}` };
}

export async function getToyyibpayCategoryDetails({
  secretKey,
  categoryCode,
  isSandbox,
}: {
  secretKey: string;
  categoryCode: string;
  isSandbox: boolean;
}): Promise<{ categoryName?: string; categoryStatus?: string } | null> {
  const baseUrl = getToyyibpayBaseUrl(isSandbox);
  const body = await callToyyibpayApi(baseUrl, "/index.php/api/getCategoryDetails", {
    userSecretKey: secretKey,
    categoryCode,
  });
  const parsed = parseToyyibpayResponse<unknown>("/index.php/api/getCategoryDetails", body);
  const record = firstRecord(parsed);

  if (!record) return null;

  const categoryName = pickField(record, "categoryName");
  const categoryStatus = pickField(record, "categoryStatus");

  if (!categoryName && categoryStatus === undefined) return null;

  return { categoryName, categoryStatus };
}

export async function getToyyibpayBillTransactions({
  billCode,
  isSandbox,
}: {
  billCode: string;
  isSandbox: boolean;
}): Promise<ToyyibpayBillTransaction[]> {
  const baseUrl = getToyyibpayBaseUrl(isSandbox);
  const body = await callToyyibpayApi(baseUrl, "/index.php/api/getBillTransactions", { billCode });
  const parsed = parseToyyibpayResponse<unknown>("/index.php/api/getBillTransactions", body);
  const records = Array.isArray(parsed) ? parsed.filter(isRecord) : isRecord(parsed) ? [parsed] : [];

  // Normalise the field casing once here so callers can rely on `billpaymentStatus` etc.
  return records.map((record) => ({
    billpaymentStatus: pickField(record, "billpaymentStatus"),
    billpaymentChannel: pickField(record, "billpaymentChannel"),
    billpaymentAmount: pickField(record, "billpaymentAmount"),
    billpaymentInvoiceNo: pickField(record, "billpaymentInvoiceNo"),
    billExternalReferenceNo: pickField(record, "billExternalReferenceNo"),
  }));
}

export async function deactivateToyyibpayBill({
  secretKey,
  billCode,
  isSandbox,
}: {
  secretKey: string;
  billCode: string;
  isSandbox: boolean;
}): Promise<{ status: string; result: string }> {
  const baseUrl = getToyyibpayBaseUrl(isSandbox);
  const body = await callToyyibpayApi(baseUrl, "/index.php/api/inactiveBill", { secretKey, billCode });

  try {
    const parsed = parseToyyibpayResponse<unknown>("/index.php/api/inactiveBill", body);
    const record = firstRecord(parsed);
    return {
      status: (record && pickField(record, "status")) ?? "unknown",
      result: (record && pickField(record, "result")) ?? body.trim(),
    };
  } catch (error) {
    // Some responses are plain text, e.g. "Bill has pending transaction process"
    return {
      status: "unknown",
      result: body.trim() || (error instanceof Error ? error.message : "unknown"),
    };
  }
}

export async function isToyyibpayDuitNowQRActivated({
  secretKey,
  isSandbox,
}: {
  secretKey: string;
  isSandbox: boolean;
}): Promise<boolean> {
  const baseUrl = getToyyibpayBaseUrl(isSandbox);
  const body = await callToyyibpayApi(baseUrl, "/index.php/api/checkDuitNowQRStatus", {
    userSecretKey: secretKey,
  });
  const parsed = parseToyyibpayResponse<{ status?: string; duitnowqr_activated?: boolean; message?: string }>(
    "/index.php/api/checkDuitNowQRStatus",
    body
  );
  if (parsed?.status === "error") {
    throw new ErrorWithCode(
      ErrorCode.PaymentCreationFailure,
      parsed.message ?? "Invalid ToyyibPay secret key"
    );
  }
  return Boolean(parsed?.duitnowqr_activated);
}

export function normalizeToyyibpayPhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 12) return null;
  return digits;
}
