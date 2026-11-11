
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

// Admin: list sellers
const listSellers = asyncHandler(async (req, res) => {
  const data = await sellerService.listSellerProfiles(req.validated.query);

  res.status(200).json({
    success: true,
    data,
  });
});

// Admin: view seller details
const getSellerDetails = asyncHandler(async (req, res) => {
  const seller = await sellerService.getSellerProfileById(
    req.validated.params.id
  );

  res.status(200).json({
    success: true,
    data: seller,
  });
});

const updateSellerStatus = asyncHandler(async (req, res) => {
  const profile = await sellerService.updateSellerStatus(
    req.validated.params.id,
    req.validated.body.status,
    req.user.id,
    req.validated.body.reason
  );

  res.json({ success: true, data: profile });
});

module.exports = {
  createSeller,
  getMySeller,
  listSellers,
  getSellerDetails,
  updateSellerStatus,
};
