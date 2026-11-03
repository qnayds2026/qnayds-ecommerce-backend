# Razorpay webhook: setup notes

## 1. Mount order in `server.js` (critical)

Add the require near the other route imports, and mount the route BEFORE `express.json()`:

    const webhookRoutes = require("./src/modules/webhooks/webhooks.routes");

    // MUST come before express.json(), otherwise the raw body is lost and signatures never match.
    app.use("/api/v1/webhooks", webhookRoutes);

    app.use(express.json());

The route has no auth middleware: Razorpay is not a logged-in user, the signature is the authentication.

## 2. Env variable names

| Name | Notes |
| --- | --- |
| `RAZORPAY_KEY_ID` | public, may be sent to the frontend |
| `RAZORPAY_KEY_SECRET` | backend only |
| `RAZORPAY_WEBHOOK_SECRET` | backend only; same value as the secret set in the Razorpay dashboard |

## 3. Register in the Razorpay dashboard (Test Mode)

Settings > Webhooks > Add new webhook
- URL: `https://<public-url>/api/v1/webhooks/razorpay` (use ngrok / Cloudflare Tunnel locally)
- Secret: same value as `RAZORPAY_WEBHOOK_SECRET`
- Events: `payment.authorized`, `payment.captured`, `payment.failed`, `refund.created`,
  `refund.processed`, `refund.failed`, `order.paid`

## 4. Schema

Proposed tables (`payments`, `payment_refunds`, `webhook_events`) are in
`prisma/proposed/payments_webhooks.sql`. Submitted to the Team Lead for review; no migration was run from this branch.

## 5. Behaviour

- Signature is verified on the raw body with `crypto.timingSafeEqual`; invalid signature returns 400.
- Duplicate `X-Razorpay-Event-Id` returns 200 `DUPLICATE`; nothing is applied twice.
- Event row, payment update and order hook run in one DB transaction; any error returns 500 and Razorpay retries.
- Webhook before frontend verify is safe: both use `src/modules/payments/payment-state.js`, so the first one wins and the second is a no-op.
- Amount or currency mismatch: payment is not confirmed and is flagged `requiresReview`.
- Unknown gateway order returns 200 `IGNORED_UNKNOWN_ORDER`.
  The Razorpay order must be saved to the DB right after it is created.
- A CAPTURED payment is never downgraded by a late authorized or failed event.

## 6. Test checklist (Razorpay Test Mode)

- [ ] valid captured event: payment CAPTURED, order hook called once
- [ ] invalid signature: 400, DB untouched
- [ ] same event id twice: second returns DUPLICATE
- [ ] webhook arrives before frontend verify, then verify: no double action
- [ ] payment.failed then payment.captured on the same order: CAPTURED, failure history kept
- [ ] amount mismatch: flagged, not captured
- [ ] refund.created then refund.processed: REFUNDED; refund.failed returns to CAPTURED
- [ ] unknown order id: 200 ignored

Unit tests: `npx jest tests/webhooks.signature.test.js`