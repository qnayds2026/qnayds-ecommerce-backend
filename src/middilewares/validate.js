// Zod validation wrapper.
//
// Usage in routes:
//   router.post("/register", validate({ body: registerSchema }), controller.register);
//
// Parsed (and normalized) values are available as req.validated.body / .query /
// .params. req.body is also replaced with the parsed body for convenience.
// Query and params are not reassigned on req because newer Express versions
// make req.query read-only.

const validate = (schemas = {}) => (req, res, next) => {
  const validated = {};
  const errors = [];

  for (const key of ["body", "query", "params"]) {
    const schema = schemas[key];
    if (!schema) continue;

    const result = schema.safeParse(req[key] ?? {});

    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          location: key,
          path: issue.path.join("."),
          message: issue.message,
        });
      }
    } else {
      validated[key] = result.data;
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ message: "Validation failed", errors });
  }

  req.validated = validated;
  if (validated.body) req.body = validated.body;

  return next();
};

module.exports = validate;