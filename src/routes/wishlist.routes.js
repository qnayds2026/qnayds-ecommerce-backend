const express = require('express');
const authenticate = require('../middilewares/authenticate');
const validate = require('../middilewares/validate');
const c = require('../controllers/wishlist.controller');
const { productParamsSchema } = require('../validations/wishlist.validation');

const router = express.Router();
router.use(authenticate);

router.get('/', c.list);
router.post('/:productId', validate({ params: productParamsSchema }), c.add);
router.delete('/:productId', validate({ params: productParamsSchema }), c.remove);

module.exports = router;