const { z } = require("zod");

// Only addressId comes from the client. Totals, prices and items are
// always calculated on the server, so any extra field is rejected.
const checkoutBody = z
  .object({
    addressId: z
      .string({ required_error: "addressId is required" })
      .trim()
      .min(1, "addressId is required"),
  })
  .strict();

module.exports = { checkoutBody };