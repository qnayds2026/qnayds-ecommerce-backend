const asyncHandler = require("../utils/asyncHandler");
const service = require("../services/variant.service");

const create = asyncHandler(async (req, res) => {
  const data = await service.createVariant(
    req.user,
    req.validated.params.productId,
    req.validated.body
  );
  res.status(201).json({ success: true, data });
});

const update = asyncHandler(async (req, res) => {
  const data = await service.updateVariant(
    req.user,
    req.validated.params.id,
    req.validated.body
  );
  res.json({ success: true, data });
});

module.exports = { create, update };