const express = require("express");
const controller = require("../controllers/users.controller");
const authenticate = require("../middilewares/authenticate");
const validate = require("../middilewares/validate");
const { updateProfileSchema } = require("../validations/users.validation");

const router = express.Router();

// authenticate runs first, so a missing token gets 401 before any validation (400).
router.patch("/me", authenticate, validate({ body: updateProfileSchema }), controller.updateMe);

module.exports = router;