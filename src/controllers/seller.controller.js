const asyncHandler = require("../utils/asyncHandler");
const sellerService = require("../services/seller.service");

const createSeller = asyncHandler(async (req, res) => {
  const profile = await sellerService.createSellerProfile(
    req.user.id,
    req.validated.body
  );
  res.status(201).json({ success: true, data: profile });
});

const getMySeller = asyncHandler(async (req, res) => {
  const profile = await sellerService.getMySellerProfile(req.user.id);
  res.json({ success: true, data: profile });
});

const updateSellerStatus = asyncHandler(async (req, res) => {
  const profile = await sellerService.updateSellerStatus(
    req.validated.params.id,
    req.validated.body.status
  );
  res.json({ success: true, data: profile });
});

module.exports = { createSeller, getMySeller, updateSellerStatus };