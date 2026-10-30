const ApiError = require("../utils/ApiError");

// Usage: validate({ body: schema, query: schema, params: schema })
const validate = (schemas) => (req, res, next) => {
  const validated = {};

  for (const key of ["params", "query", "body"]) {
    if (!schemas[key]) continue;

    const result = schemas[key].safeParse(req[key]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      return next(ApiError.badRequest("Validation failed", details));
    }
    validated[key] = result.data;
  }

  // req.query chilappol read-only aanu (Express 5), athukondu separate-aayi vekkunnu
  req.validated = validated;
  next();
};

module.exports = validate;