/**
 * requireRole.js
 *
 * Middleware factory that enforces module-level role-based access.
 *
 * Role strings follow the pattern:  <module>_<level>
 *   e.g.  announcements_read   announcements_write
 *         inquiries_read        inquiries_write
 *         leave_read            leave_write
 *         flight_read           flight_write
 *         visa_read             visa_write
 *         profile_read          profile_write
 *         company_read          company_write
 *         sharepoint_read       sharepoint_write
 *
 * Strategy A (backward-compatible opt-in restriction):
 *   - ADMIN                   → always pass (full access)
 *   - OFFICER + no roles      → always pass (full access, existing officers unaffected)
 *   - OFFICER + roles present → must hold the required role
 *   - USER                    → always blocked (self-service only)
 *
 * Write role satisfies a read requirement for the same module.
 * e.g.  requireRole("announcements_read") passes for a user with "announcements_write"
 */

const FULL_ACCESS_TYPES = ["OFFICER", "ADMIN"];

/**
 * requireRole("announcements_write")
 * requireRole("inquiries_read")
 */
export const requireRole = (requiredRole) => {
  return (req, res, next) => {
    const userType = (req.user?.userType || "").toUpperCase();
    const userRoles = req.user?.roles ?? [];

    // ADMIN: always pass
    if (userType === "ADMIN") return next();

    // Non-officer (USER): always blocked on officer routes
    if (!FULL_ACCESS_TYPES.includes(userType)) {
      return res.status(403).json({
        error: "Forbidden",
        message: "You do not have permission to access this resource.",
      });
    }

    // OFFICER with NO roles assigned → full access (backward compat)
    if (userRoles.length === 0) return next();

    // OFFICER with roles → check specific role
    const parts = requiredRole.split("_");          // ["announcements", "write"]
    const level  = parts[parts.length - 1];          // "write" or "read"
    const module = parts.slice(0, -1).join("_");     // "announcements"

    const hasExact = userRoles.includes(requiredRole);
    // write role satisfies a read requirement for the same module
    const hasWrite = level === "read" && userRoles.includes(`${module}_write`);

    if (hasExact || hasWrite) return next();

    return res.status(403).json({
      error: "Insufficient permissions",
      required: requiredRole,
      message: `This action requires the '${requiredRole}' role.`,
    });
  };
};

/**
 * requireOfficer()
 * Simple gate: user must be OFFICER or ADMIN. No module check.
 * Use for role management endpoints themselves.
 */
export const requireOfficer = (req, res, next) => {
  const userType = (req.user?.userType || "").toUpperCase();
  if (!FULL_ACCESS_TYPES.includes(userType)) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Officer or Admin access required.",
    });
  }
  next();
};
