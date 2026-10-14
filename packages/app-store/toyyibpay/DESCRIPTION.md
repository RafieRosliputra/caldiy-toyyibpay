---
items:
  - icon.svg
---

ToyyibPay is a Malaysian payment gateway that supports **FPX online banking** (all major Malaysian banks),
**credit/debit cards** and **DuitNow QR**.

This app charges the booker when they confirm a booking:

1. When a booker selects a paid event type, Cal.diy creates a ToyyibPay **bill** for the booking and redirects the
   booker to the ToyyibPay payment page (`https://toyyibpay.com/<billCode>`).
2. ToyyibPay sends a server-to-server **callback** to `/api/integrations/toyyibpay/webhook`.
3. Cal.diy verifies the MD5 hash (`md5(userSecretKey + status + order_id + refno + "ok")`) before confirming the
   booking. Invalid hashes are rejected.
4. Until the payment succeeds, the booking stays pending and is released/expired automatically.

### Settings

- **Secret Key** - your ToyyibPay *User Secret Key* (toyyibPay Dashboard → Profile → User Secret Key).
- **Category Code** - the category that the bills belong to. Create one from
  Dashboard → Category, or with the `createCategory` API.
- **Sandbox mode** - uses `dev.toyyibpay.com` together with your sandbox credentials. Use this for testing.
- **DuitNow QR** - only enable if DuitNow QR is activated on your ToyyibPay account, otherwise bill creation fails.
