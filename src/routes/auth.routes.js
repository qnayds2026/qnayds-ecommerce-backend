const express = require("express");
const controller = require("../controllers/auth.controller");
const validate = require("../middilewares/validate");
const authenticate = require("../middilewares/authenticate");
const verifyOrigin = require("../middilewares/verifyOrigin");
const { registerSchema, loginSchema } = require("../validations/auth.validation");

const router = express.Router();

router.post("/register", validate({ body: registerSchema }), controller.register);
router.post("/login", verifyOrigin, validate({ body: loginSchema }), controller.login);
router.post("/refresh", verifyOrigin, controller.refresh);
router.post("/logout", verifyOrigin, controller.logout);
router.get("/me", authenticate, controller.me);

module.exports = router;