const asyncHandler = require("../utils/asyncHandler");
const service = require("../services/product.service");

const create = asyncHandler(async (req, res) => {
  const data = await service.createProduct(req.user, req.validated.body);
  res.status(201).json({ success: true, data });
});

const list = asyncHandler(async (req, res) => {
  const { items, pagination } = await service.listProducts(req.validated.query);
  res.json({ success: true, data: items, pagination });
});

const getOne = asyncHandler(async (req, res) => {
  const data = await service.getProductById(req.validated.params.id);
  res.json({ success: true, data });
});

const update = asyncHandler(async (req, res) => {
  const data = await service.updateProduct(
    req.user,
    req.validated.params.id,
    req.validated.body
  );
  res.json({ success: true, data });
});

const archive = asyncHandler(async (req, res) => {
  const data = await service.archiveProduct(req.user, req.validated.params.id);
  res.json({ success: true, data });
});

const listMine = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.listMyProducts(req.user) });
});

module.exports = { create, list, getOne, update, archive, listMine };