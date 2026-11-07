const returnsService = require("./returns.service");
const refundService = require("./returns.refund.service");

const createReturn = async (req, res, next) => {
  try {
    const data = await returnsService.createReturn(req.user, req.validated.body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const listMyReturns = async (req, res, next) => {
  try {
    const data = await returnsService.listMyReturns(req.user, req.validated.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const getMyReturn = async (req, res, next) => {
  try {
    const data = await returnsService.getMyReturn(req.user, req.validated.params.returnId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const cancelReturn = async (req, res, next) => {
  try {
    const data = await returnsService.cancelReturn(
      req.user,
      req.validated.params.returnId,
      req.validated.body.note
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const listSellerReturns = async (req, res, next) => {
  try {
    const data = await returnsService.listSellerReturns(req.user, req.validated.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const listAdminReturns = async (req, res, next) => {
  try {
    const data = await returnsService.listAdminReturns(req.validated.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// Used by both the seller and the admin routes (the role comes from req.user).
const approveReturn = async (req, res, next) => {
  try {
    const data = await returnsService.approveReturn(
      req.user,
      req.validated.params.returnId,
      req.validated.body.note
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const rejectReturn = async (req, res, next) => {
  try {
    const data = await returnsService.rejectReturn(
      req.user,
      req.validated.params.returnId,
      req.validated.body.note
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const refundReturn = async (req, res, next) => {
  try {
    const data = await refundService.refundReturn(
      req.user,
      req.validated.params.returnId,
      req.validated.body.note
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};
const addShipment = async (req, res, next) => {
  try {
    const data = await returnsService.addShipment(
      req.user,
      req.validated.params.returnId,
      req.validated.body
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// Used by both the seller and the admin routes.
const markReceived = async (req, res, next) => {
  try {
    const data = await returnsService.markReceived(
      req.user,
      req.validated.params.returnId,
      req.validated.body.note
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createReturn,
  listMyReturns,
  getMyReturn,
  cancelReturn,
  addShipment,
  listSellerReturns,
  listAdminReturns,
  approveReturn,
  rejectReturn,
  markReceived,
  refundReturn,
};