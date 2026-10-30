const asyncHandler = require("../utils/asyncHandler");
const service = require("../services/image.service");

const add = asyncHandler(async (req, res) => {
  const data = await service.addImage(
    req.user,
    req.validated.params.productId,
    req.validated.body
  );
  res.status(201).json({ success: true, data });
});

const update = asyncHandler(async (req, res) => {
  const data = await service.updateImage(
    req.user,
    req.validated.params.id,
    req.validated.body
  );
  res.json({ success: true, data });
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteImage(req.user, req.validated.params.id);
  res.status(204).send();
});

module.exports = { add, update, remove };