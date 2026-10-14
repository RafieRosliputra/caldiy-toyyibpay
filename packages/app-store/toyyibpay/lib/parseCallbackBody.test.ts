import { describe, expect, it } from "vitest";
import { parseCallbackBody } from "./parseCallbackBody";

const fields = {
  refno: "TP2610154786462789",
  status: "1",
  reason: "",
  billcode: "a28hbcrk",
  order_id: "33fde80d-c49b-488f-927f-297dfae6832b",
  amount: "2.00",
  transaction_time: "15-10-2026 04:50:54+08:00",
  hash: "0e1a0e0e0e0e0e0e0e0e0e0e0e0e0e0e",
};

/** This is the shape ToyyibPay actually sends (their PHP examples make cURL post multipart/form-data). */
const multipartBody = [
  "--b0undary",
  'Content-Disposition: form-data; name="refno"',
  "",
  fields.refno,
  "--b0undary",
  'Content-Disposition: form-data; name="status"',
  "",
  fields.status,
  "--b0undary",
  'Content-Disposition: form-data; name="reason"',
  "",
  "",
  "--b0undary",
  'Content-Disposition: form-data; name="billcode"',
  "",
  fields.billcode,
  "--b0undary",
  'Content-Disposition: form-data; name="order_id"',
  "",
  fields.order_id,
  "--b0undary",
  'Content-Disposition: form-data; name="amount"',
  "",
  fields.amount,
  "--b0undary",
  'Content-Disposition: form-data; name="transaction_time"',
  "",
  fields.transaction_time,
  "--b0undary",
  'Content-Disposition: form-data; name="hash"',
  "",
  fields.hash,
  "--b0undary--",
  "",
].join("\r\n");

describe("parseCallbackBody", () => {
  it("decodes the multipart/form-data callback ToyyibPay actually sends", () => {
    const parsed = parseCallbackBody(multipartBody, 'multipart/form-data; boundary="b0undary"');

    expect(parsed).toMatchObject({
      refno: fields.refno,
      status: "1",
      billcode: "a28hbcrk",
      order_id: fields.order_id,
      amount: "2.00",
      hash: fields.hash,
    });
  });

  it("decodes an unquoted boundary and keeps an empty field", () => {
    const parsed = parseCallbackBody(multipartBody, "multipart/form-data; boundary=b0undary");

    expect(parsed.reason).toBe("");
    expect(parsed.billcode).toBe("a28hbcrk");
  });

  it("still decodes x-www-form-urlencoded callbacks", () => {
    const parsed = parseCallbackBody(
      new URLSearchParams(fields).toString(),
      "application/x-www-form-urlencoded"
    );

    expect(parsed).toMatchObject({ status: "1", billcode: "a28hbcrk", order_id: fields.order_id });
  });

  it("still decodes JSON callbacks", () => {
    const parsed = parseCallbackBody(JSON.stringify({ ...fields, amount: 2 }), "application/json");

    expect(parsed).toMatchObject({ status: "1", amount: "2" });
  });

  it("returns nothing when a multipart body has no boundary", () => {
    expect(parseCallbackBody(multipartBody, "multipart/form-data")).toEqual({});
  });
});
