const service = require('../services/addresses.service');

const list = async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.list(req.user.id) });
  } catch (e) { next(e); }
};

const getOne = async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.getOne(req.user.id, req.params.addressId) });
  } catch (e) { next(e); }
};

const create = async (req, res, next) => {
  try {
    res.status(201).json({ success: true, data: await service.create(req.user.id, req.body) });
  } catch (e) { next(e); }
};

const update = async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.update(req.user.id, req.params.addressId, req.body) });
  } catch (e) { next(e); }
};

const remove = async (req, res, next) => {
  try {
    await service.remove(req.user.id, req.params.addressId);
    res.status(204).send();
  } catch (e) { next(e); }
};

module.exports = { list, getOne, create, update, remove };