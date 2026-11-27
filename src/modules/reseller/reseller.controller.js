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

module.exports = { createProfile, getProfile, updateProfile };