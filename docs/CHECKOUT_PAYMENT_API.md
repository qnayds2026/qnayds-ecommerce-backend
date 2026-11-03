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

## Environment variables (names only)

`RAZORPAY_KEY_ID` (public), `RAZORPAY_KEY_SECRET` (backend only), `RAZORPAY_WEBHOOK_SECRET` (backend only).
Real values go in `.env` only, never committed.

## Schema

Tables `payments`, `payment_refunds`, `webhook_events` are proposed in `prisma/proposed/payments_webhooks.sql` for Team Lead review. No migration was run from this branch.

## Test evidence

- `npx jest`: 13 suites, 168 tests pass.
- Covered: valid/invalid signature, duplicate webhook event, webhook before verify, amount and currency mismatch, late event no downgrade, retry keeps history, max attempts, unauthorized payment/order lookup.
- Razorpay Test Mode end-to-end run: to be added.