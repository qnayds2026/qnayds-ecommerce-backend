const service = require('../services/cart.service');

// req.user.id comes from the authenticate middleware. Ownership is never read from body/params.
const getCart = async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.getCart(req.user.id) });
  } catch (e) { next(e); }
};

const addItem = async (req, res, next) => {
  try {
    res.status(201).json({ success: true, data: await service.addItem(req.user.id, req.body) });
  } catch (e) { next(e); }
};

const updateItem = async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.updateItem(req.user.id, req.params.itemId, req.body) });
  } catch (e) { next(e); }
};

const removeItem = async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.removeItem(req.user.id, req.params.itemId) });
  } catch (e) { next(e); }
};

const clearCart = async (req, res, next) => {
  try {
    await service.clearCart(req.user.id);
    res.status(204).send();
  } catch (e) { next(e); }
};

module.exports = { getCart, addItem, updateItem, removeItem, clearCart };