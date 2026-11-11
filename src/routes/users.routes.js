const express = require("express");
const controller = require("../controllers/users.controller");
const authenticate = require("../middilewares/authenticate");
const authorize = require("../middilewares/authorize");
const validate = require("../middilewares/validate");
const validateRequest = require("../middilewares/validateRequest");
const {
  updateProfileSchema,
  listUsersQuery,
} = require("../validations/users.validation");

const router = express.Router();

// authenticate runs first, so a missing token gets 401 before any validation (400).
router.patch("/me", authenticate, validate({ body: updateProfileSchema }), controller.updateMe);

// Admin only: list users (?page=1&limit=10&role=SELLER&search=henna)
router.get(
  "/",
  authenticate,
  authorize("ADMIN"),
  validateRequest({ query: listUsersQuery }),
  controller.listUsers
);

module.exports = router;