const { verifyWebhookSignature } = require("./razorpay.signature");
const { razorpayEnvelopeSchema } = require("./webhooks.validation");
const webhooksService = require("./webhooks.service");

async function handleRazorpayWebhook(req, res) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhook] RAZORPAY_WEBHOOK_SECRET is not configured");
    return res.status(500).json({ success: false, message: "Webhook is not configured" });
  }

  // 1. Authenticate: signature over the raw bytes (req.body is a Buffer here).
  const signature = req.get("x-razorpay-signature");
  if (!verifyWebhookSignature(req.body, signature, secret)) {
    return res.status(400).json({ success: false, message: "Invalid signature" });
  }

  // 2. Idempotency key comes from the header, not the body.
  const eventId = req.get("x-razorpay-event-id");
  if (!eventId) {
    return res.status(400).json({ success: false, message: "Missing event id" });
  }

  // 3. Parse + validate the envelope (only after the signature has been verified).
  let json;
  try {
    json = JSON.parse(req.body.toString("utf8"));
  } catch (_) {
    return res.status(400).json({ success: false, message: "Invalid JSON" });
  }
  const parsed = razorpayEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid payload" });
  }

  // 4. Process. A 5xx makes Razorpay retry later; the DB transaction guarantees nothing is half-applied.
  try {
    const outcome = await webhooksService.processEvent({ eventId, event: parsed.data });
    return res.status(200).json({ success: true, status: outcome });
  } catch (err) {
    // Log only safe identifiers: never the body, headers or secrets.
    console.error("[webhook] processing failed", {
      eventId,
      event: parsed.data.event,
      error: err.message,
    });
    return res.status(500).json({ success: false, message: "Webhook processing failed" });
  }
}

module.exports = { handleRazorpayWebhook };