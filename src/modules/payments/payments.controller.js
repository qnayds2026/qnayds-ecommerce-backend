const paymentsService = require("./payments.service");

// Small wrapper so every handler sends { success, data } and forwards errors to errorHandler.
const handle = (fn, status = 200) => async (req, res, next) => {
  try {
    const data = await fn(req);
    res.status(status).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const createRazorpayOrder = handle(
  (req) => paymentsService.createRazorpayOrder(req.user, req.body),
  201
);

const verifyPayment = handle((req) =>
  paymentsService.verifyPayment(req.user, req.body)
);

const getPayment = handle((req) =>
  paymentsService.getPayment(req.user, req.params.paymentId)
);

const retryPayment = handle(
  (req) => paymentsService.retryPayment(req.user, req.params.paymentId),
  201
);

const collectCodPayment = handle((req) =>
  paymentsService.collectCodPayment(req.user, req.params.paymentId)
);


module.exports = {
  createRazorpayOrder,
  verifyPayment,
  getPayment,
  retryPayment,
  collectCodPayment,
};