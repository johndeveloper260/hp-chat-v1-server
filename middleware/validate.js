/**
 * Zod Validation Middleware Factory
 *
 * Wraps a Zod schema into an Express middleware.
 * On success: attaches the parsed (coerced) data back to req.body.
 * On failure: calls next(err) with a ZodError — caught by errorHandler.js.
 *
 * Usage in a route file:
 *   import { validate } from "../middleware/validate.js";
 *   import { registerSchema } from "../validators/registerValidator.js";
 *
 *   router.post("/registerUser", validate(registerSchema), registerController.registerUser);
 *
 * @param {import("zod").ZodSchema} schema
 * @param {"body"|"query"|"params"} [source="body"]
 */
export const validate = (schema, source = "body") => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    // Pass the ZodError to errorHandler — it knows how to format it
    return next(result.error);
  }
  // Replace raw input with the safely coerced / stripped Zod output
  req[source] = result.data;
  next();
};
