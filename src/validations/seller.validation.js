const { z } = require("zod");

const ID_PROOF_TYPES = ["PAN", "AADHAAR", "VOTER_ID", "DRIVING_LICENCE", "PASSPORT"];
const GST_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const ID_RULES = {
  PAN: [/^[A-Z]{5}\d{4}[A-Z]$/, "Invalid PAN number"],
  AADHAAR: [/^\d{12}$/, "Aadhaar number must be 12 digits"],
  VOTER_ID: [/^[A-Z]{3}\d{7}$/, "Invalid Voter ID number"],
  DRIVING_LICENCE: [/^[A-Z]{2}\d{2}[0-9A-Z]{9,13}$/, "Invalid driving licence number"],
  PASSPORT: [/^[A-Z]\d{7}$/, "Invalid passport number"],
};

const idParam = z.object({
  id: z.string().min(1),
});

const createSellerBody = z
  .object({
    shopName: z.string().trim().min(2).max(100),
    description: z.string().trim().max(1000).optional(),
    // Optional: an empty string means "not provided".
    gstNumber: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === "" || GST_REGEX.test(v), "Invalid GST number")
      .optional(),
    idProofType: z.enum(ID_PROOF_TYPES),
    idProofNumber: z
      .string({ message: "ID proof number is required" })
      .trim()
      .toUpperCase()
      .transform((v) => v.replace(/[\s-]/g, "")),
    addressLine1: z
      .string({ message: "Address is required" })
      .trim()
      .min(3, "Address is required")
      .max(200),
    addressLine2: z.string().trim().max(200).optional(),
    city: z.string({ message: "City is required" }).trim().min(2, "City is required").max(100),
    state: z.string({ message: "State is required" }).trim().min(2, "State is required").max(100),
    postalCode: z
      .string({ message: "PIN code is required" })
      .trim()
      .regex(/^[1-9]\d{5}$/, "Invalid PIN code"),
    country: z.string().trim().min(2).max(100).default("India"),
  })
  .superRefine((data, ctx) => {
    const rule = ID_RULES[data.idProofType];
    if (!rule) return;
    if (!rule[0].test(data.idProofNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: rule[1],
        path: ["idProofNumber"],
      });
    }
  });

const updateStatusBody = z
  .object({
    status: z.enum(["APPROVED", "REJECTED", "SUSPENDED"]),
    reason: z.string().trim().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "REJECTED" && !data.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reason is required when rejecting a seller",
        path: ["reason"],
      });
    }
  });

const listSellerQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]).optional(),
  search: z.string().trim().max(100).optional(),
});

// Backward-compatible status-only query
const listSellersQuery = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]).optional(),
});

module.exports = {
  idParam,
  createSellerBody,
  updateStatusBody,
  listSellerQuery,
  listSellersQuery,
};