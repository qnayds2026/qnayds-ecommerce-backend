const { z } = require("zod");

// Email is trimmed and lower-cased so "A@x.com" and "a@x.com" are the same account.
const email = z
  .string({ required_error: "Email is required" })
  .trim()
  .toLowerCase()
  .email("Invalid email address")
  .max(254, "Email is too long");

// bcrypt only uses the first 72 bytes, so longer passwords are rejected.
const newPassword = z
  .string({ required_error: "Password is required" })
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");

// NOTE: `role` is intentionally NOT part of this schema. Unknown keys are
// stripped by Zod, and the service always creates the account as CUSTOMER.
const registerSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty").max(100).optional(),
  email,
  password: newPassword,
});

// Login does not enforce password rules, so a wrong password and a
// badly-formed one both end up as the same generic 401 later.
const loginSchema = z.object({
  email,
  password: z.string({ required_error: "Password is required" }).min(1).max(200),
});

module.exports = {
  registerSchema,
  loginSchema,
};