# ToyyibPay for Cal.diy

ToyyibPay payment app for Cal.diy. It lets you charge for bookings in Malaysia with **FPX online banking**,
**credit/debit cards** and **DuitNow QR**.

## How it works

```
Booker picks a slot on a paid event type
        │
        ▼
Cal.diy `PaymentService.create()` → ToyyibPay POST /index.php/api/createBill
        │                                   (billAmount in sen, billExpiryDate = now + hold)
        ▼
Payment row stored (externalId = billCode, uid = billExternalReferenceNo)
        │
        ▼
/booking/[uid] → /payment/[uid] → redirect to https://toyyibpay.com/<billCode>
        │
        ├── Browser comes back → /api/integrations/toyyibpay/callback  (GET, UX only)
        │
        └── ToyyibPay server →  /api/integrations/toyyibpay/webhook    (POST, source of truth)
                                   md5(secretKey + status + order_id + refno + "ok")
                                   status 1 → handlePaymentSuccess() → booking ACCEPTED, paid = true
                                   status 3 → booking CANCELLED
```

Booking is only confirmed from the verified webhook. The return URL never marks a booking as paid.

## Files

| Path | Purpose |
| --- | --- |
| `lib/PaymentService.ts` | `BuildPaymentService()` factory, creates the bill, stores the payment, schedules the awaiting-payment task |
| `lib/toyyibpayClient.ts` | ToyyibPay API client (`createBill`, `getBillTransactions`, `inactiveBill`, `getCategoryDetails`, `checkDuitNowQRStatus`) + MD5 hash verification |
| `lib/toyyibpayCredentialKeysSchema.ts` | Credentials shape: `{ prod, sandbox, isSandbox, enableDuitNowQR, paymentChannel }` |
| `api/add.ts` | Installs the credential and redirects to the setup page |
| `api/validate.ts` | Validates secret key + category code before saving |
| `api/callback.ts` | `billReturnUrl` handler (redirects the browser) |
| `api/webhook.ts` | `billCallbackUrl` handler (hash verified, confirms/cancels the booking) |

## Configuration

Credentials are stored per user/team, not in env. The only optional env overrides are:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TOYYIBPAY_API_PRODUCTION` | `https://toyyibpay.com` | Production API base URL |
| `TOYYIBPAY_API_SANDBOX` | `https://dev.toyyibpay.com` | Sandbox API base URL |
| `AWAITING_PAYMENT_EMAIL_DELAY_MINUTES` | `5` | Minutes after booking when the "awaiting payment" reminder is sent |
| `AWAITING_PAYMENT_EXPIRE_MINUTES` | `15` | How long the slot is held and the bill stays payable |

## Behaviour notes

- **MYR only.** ToyyibPay settles in Malaysian Ringgit, so the event type price must be in MYR.
- **Minimum amount.** ToyyibPay rejects amounts of RM1.00 or less; the app refuses the booking before calling the
  API when the price is too low.
- **Slot hold.** The slot is held for `AWAITING_PAYMENT_EXPIRE_MINUTES` (default 15) and the bill expires at the
  same time. The reminder email is sent earlier (`AWAITING_PAYMENT_EMAIL_DELAY_MINUTES`, default 5) so it is still
  actionable. When the hold elapses, `/api/integrations/toyyibpay/expire` deactivates the bill and cancels the
  booking, freeing the slot.
- **No refund API.** ToyyibPay has no refund endpoint; `refund()` throws and asks you to deactivate the bill
  (`inactiveBill`) and refund manually from the ToyyibPay dashboard.
- **DuitNow QR** has to be activated on the ToyyibPay account before it can be enabled here, otherwise
  `createBill` fails.
- **Callback URL must be public HTTPS.** ToyyibPay cannot reach `localhost`. Use a tunnel or the sandbox.

## Local development

```bash
# start the app
corepack yarn dx          # or: docker compose up

# regenerate app-store registries after changing config.json / adding components
corepack yarn workspace @calcom/app-store-cli generate

# type check
corepack yarn workspace @calcom/app-store type-check
```

Expose your local instance to ToyyibPay (sandbox) with a tunnel, e.g. `cloudflared tunnel --url http://localhost:3000`,
and set `NEXT_PUBLIC_WEBAPP_URL` to the tunnel URL so the generated `billCallbackUrl` is reachable.
