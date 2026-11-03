# Checkout & Payment API

All endpoints except the webhook require a logged-in **CUSTOMER** (`Authorization` as in the auth module).
Success responses use `{ "success": true, "data": ... }`. Errors go through the shared `errorHandler`.
Amounts are calculated on the server. The client never sends a total.

## 1. POST /api/v1/checkout

Creates the order from the saved cart + address, then starts a Razorpay payment attempt.
Rate limited (`sensitiveLimiter`).

Headers: `Idempotency-Key` (same key returns the same order and reuses the open attempt)

Body (extra fields are rejected):

```json
{ "addressId": "<saved address id>" }
```

Response `201`:

```json
{
  "success": true,
  "data": {
    "order": { "id": "", "orderNumber": "", "status": "PENDING_PAYMENT", "totalAmount": "", "currency": "INR" },
    "payment": {
      "paymentId": "", "keyId": "", "gatewayOrderId": "",
      "amount": 49900, "currency": "INR", "status": "CREATED"
    }
  }
}
```

- `payment.amount` is in paise. `keyId` is the public Razorpay Key ID.
- If the order is already paid/cancelled (duplicate request), `payment` is `null`.
- Razorpay not configured: fails before any stock is reserved.

## 2. POST /api/v1/payments/razorpay/order

Creates (or reuses the open) payment attempt for an existing order. Rate limited. Response `201`: same `payment` object as above.

Body:

```json
{ "orderId": "<order id>" }
```

| Status | When |
| --- | --- |
| 404 | Order not found, or it belongs to another user |
| 409 | Order is not `PENDING_PAYMENT`, or 5 attempts already used |
| 400 | Order amount below the Razorpay minimum (1 INR) |

## 3. POST /api/v1/payments/razorpay/verify

Verifies the signature, then confirms with Razorpay server-to-server before changing any state.
The webhook stays the source of truth. Rate limited. Response `200`: public payment fields.

Body:

```json
{
  "razorpay_order_id": "",
  "razorpay_payment_id": "",
  "razorpay_signature": ""
}
```

| Status | When |
| --- | --- |
| 404 | Payment not found, or it belongs to another user |
| 400 | Invalid signature, or the payment belongs to a different Razorpay order |

## 4. GET /api/v1/payments/:paymentId

Own payment status only. Response `200` fields: `id, orderId, status, amount, currency, gatewayOrderId, gatewayPaymentId, failureReason, createdAt, capturedAt, failedAt`.
Someone else's payment returns `404`.

## 5. POST /api/v1/payments/:paymentId/retry

Creates a **new** attempt for a `FAILED` payment. Old attempts are never changed. Rate limited.
Response `201`: same `payment` object as above.

| Status | When |
| --- | --- |
| 404 | Payment/order not found, or not yours |
| 409 | Payment is not `FAILED`, or 5 attempts already used |

## 6. POST /api/v1/webhooks/razorpay

No login. The `X-Razorpay-Signature` header is verified on the raw body. Details: `src/modules/webhooks/WEBHOOKS.md`.

| Response | When |
| --- | --- |
| 400 | Invalid signature |
| 200 `DUPLICATE` | Same `X-Razorpay-Event-Id` seen before |
| 200 `IGNORED_UNKNOWN_ORDER` | Gateway order not in our DB |
| 500 | Processing error (transaction rolled back, Razorpay retries) |

## Payment states

`CREATED, PENDING, AUTHORIZED, CAPTURED, FAILED, REFUND_PENDING, REFUNDED`.
Rules live in `src/modules/payments/payment-state.js`. `CAPTURED` is never downgraded by a late authorized/failed event.

## Cash on Delivery (COD)

`POST /api/v1/checkout` accepts an optional `paymentMethod`: `ONLINE` (default) or `COD`.
Any other value returns `400`. Extra fields such as client totals are still rejected.

Request:

{ "addressId": "xxx", "paymentMethod": "COD" }

- `ONLINE` (or no `paymentMethod`): unchanged. A Razorpay order is created and the response has `keyId` and `gatewayOrderId`.
- `COD`: no Razorpay call and no Razorpay keys needed. One `Payment` row is created with `method = COD` and `status = PENDING`. The response `payment` has `paymentId`, `method`, `amount`, `currency`, `status`. It has no `keyId` and no `gatewayOrderId`, so the frontend must not open Razorpay Checkout (check `payment.method === "COD"`).
- Calling checkout again for the same order reuses the existing COD payment row.
- `POST /payments/razorpay/order` on a COD order returns `409`.
- Not included yet: marking cash as collected (`PENDING` to `CAPTURED`), COD order status, stock release for undelivered COD orders. These need Team Lead / Teammate 2 decisions.
- COD was not in the original task brief. Scope confirmation from Team Lead is pending.

## Environment variables (names only)

`RAZORPAY_KEY_ID` (public), `RAZORPAY_KEY_SECRET` (backend only), `RAZORPAY_WEBHOOK_SECRET` (backend only).
Real values go in `.env` only, never committed.

## Schema

Models `Payment`, `PaymentRefund`, `WebhookEvent` are in `prisma/schema.prisma` for Team Lead review. COD adds the `PaymentMethod` enum (`ONLINE`, `COD`), `Payment.method` (default `ONLINE`), and makes `Payment.gatewayOrderId` optional. No migration has been created or applied from this branch; it waits for the migration history fix.

## Test evidence

- `npx jest`: 14 suites, 176 tests pass (mocked DB and gateway). Includes 8 COD tests.
- COD is unit-tested only. Not run against a real DB yet.
- Covered: valid/invalid signature, duplicate webhook event, webhook before verify, amount and currency mismatch, late event no downgrade, retry keeps history, max attempts, unauthorized payment/order lookup.
- Razorpay Test Mode end-to-end run: to be added.