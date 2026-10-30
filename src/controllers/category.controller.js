const asyncHandler = require("../utils/asyncHandler");
const service = require("../services/category.service");

const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.listActiveCategories() });
});

const create = asyncHandler(async (req, res) => {
  const data = await service.createCategory(req.validated.body);
  res.status(201).json({ success: true, data });
});

const update = asyncHandler(async (req, res) => {
  const data = await service.updateCategory(
    req.validated.params.id,
    req.validated.body
  );
  res.json({ success: true, data });
});

module.exports = { list, create, update };