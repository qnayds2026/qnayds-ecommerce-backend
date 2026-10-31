const express = require('express');
const authenticate = require('../middilewares/authenticate');
const authorize = require('../middilewares/authorize');
const validate = require('../middilewares/validate');
const c = require('../controllers/addresses.controller');
const { createAddressSchema, updateAddressSchema, addressParamsSchema } = require('../validations/addresses.validation');

const router = express.Router();
router.use(authenticate);
router.use(authorize('CUSTOMER'));
router.get('/', c.list);
router.post('/', validate({ body: createAddressSchema }), c.create);
router.get('/:addressId', validate({ params: addressParamsSchema }), c.getOne);
router.patch('/:addressId', validate({ params: addressParamsSchema, body: updateAddressSchema }), c.update);
router.delete('/:addressId', validate({ params: addressParamsSchema }), c.remove);

module.exports = router;