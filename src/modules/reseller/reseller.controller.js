const resellerService = require("./reseller.service");

const createProfile = async (req, res, next) => {
  try {
    const data = await resellerService.createProfile(req.user, req.validated.body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const getProfile = async (req, res, next) => {
  try {
    const data = await resellerService.getProfile(req.user);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const data = await resellerService.updateProfile(req.user, req.validated.body);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const listProducts = async (req, res, next) => {
  try {
    const data = await resellerService.listProducts(req.user, req.validated.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const createShare = async (req, res, next) => {
  try {
    const { share, created } = await resellerService.createShare(
      req.user,
      req.validated.body
    );
    res.status(created ? 201 : 200).json({ success: true, data: share });
  } catch (err) {
    next(err);
  }
};

const listShares = async (req, res, next) => {
  try {
    const data = await resellerService.listShares(req.user, req.validated.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const quoteMargin = async (req, res, next) => {
  try {
    const data = await resellerService.quoteMargin(req.user, req.validated.body);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createProfile,
  getProfile,
  updateProfile,
  listProducts,
  createShare,
  listShares,
  quoteMargin,
};;