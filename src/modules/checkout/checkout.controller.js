const checkoutService = require("./checkout.service");

const checkout = async (req, res, next) => {
  try {
    const data = await checkoutService.checkout(
      req.user,
      req.body,
      req.get("Idempotency-Key")
    );
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

module.exports = { checkout };