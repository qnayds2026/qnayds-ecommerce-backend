const express = require("express");
const controller = require("./webhooks.controller");

const router = express.Router();

// IMPORTANT: this router must be mounted in server.js BEFORE `app.use(express.json())`.
// express.raw keeps req.body as a Buffer so the HMAC is computed on the exact bytes Razorpay signed.
router.post(
  "/razorpay",
  express.raw({ type: "application/json", limit: "1mb" }),
  controller.handleRazorpayWebhook
);

module.exports = router;