const service = require('../services/wishlist.service');

const list = async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.list(req.user.id) });
  } catch (e) { next(e); }
};

const add = async (req, res, next) => {
  try {
    res.status(201).json({ success: true, data: await service.add(req.user.id, req.params.productId) });
  } catch (e) { next(e); }
};

const remove = async (req, res, next) => {
  try {
    await service.remove(req.user.id, req.params.productId);
    res.status(204).send();
  } catch (e) { next(e); }
};

module.exports = { list, add, remove };