const express = require('express');
const authenticate = require('../middilewares/authenticate');
const authorize = require('../middilewares/authorize');
const validate = require('../middilewares/validate');
const c = require('../controllers/cart.controller');
const { addItemSchema, updateItemSchema, itemParamsSchema } = require('../validations/cart.validation');

const router = express.Router();
router.use(authenticate);
router.use(authorize('CUSTOMER'));
router.get('/', c.getCart);
router.post('/items', validate({ body: addItemSchema }), c.addItem);
router.patch('/items/:itemId', validate({ params: itemParamsSchema, body: updateItemSchema }), c.updateItem);
router.delete('/items/:itemId', validate({ params: itemParamsSchema }), c.removeItem);
router.delete('/', c.clearCart);

module.exports = router;