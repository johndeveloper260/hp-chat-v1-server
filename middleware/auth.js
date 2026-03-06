import jwt from "jsonwebtoken";
import { getPool } from "../config/getPool.js";

const auth = (req, res, next) => {
  // ✅ FIXED: Support both header formats
  let token = req.header("x-app-identity");

  // If not found, try Authorization header (for mobile apps)
  if (!token) {
    const authHeader = req.header("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }
  }

  if (!token) {
    return res.status(401).json({ msg: "No token, authorization denied" });
  }

  try {
    jwt.verify(token, process.env.SECRET_TOKEN, async (error, decoded) => {
      if (error) {
        console.log("JWT Verification Failed:", error.message);
        return res.status(401).json({ msg: "Token is not valid" });
      }

      req.user = {
        id: decoded.id,
        business_unit: decoded.business_unit,
        userType: decoded.user_type,
        company: decoded.company,
        preferred_language: decoded.preferred_language || "en",
        roles: decoded.roles ?? [],
      };

      // Check is_active and update last_seen in a single query.
      // last_seen is throttled: only written if >5 min since last update,
      // preventing excessive DB writes on rapid API calls.
      try {
        const { rows } = await getPool().query(
          `UPDATE v4.user_account_tbl
           SET last_seen = CASE
             WHEN last_seen IS NULL OR last_seen < NOW() - INTERVAL '5 minutes'
             THEN NOW()
             ELSE last_seen
           END
           WHERE id = $1
           RETURNING is_active`,
          [req.user.id],
        );
        if (!rows[0] || rows[0].is_active === false) {
          return res.status(401).json({ msg: "Account has been deactivated", error_code: "api_errors.auth.account_deactivated" });
        }
      } catch (dbErr) {
        // Fail open on DB error — let the request proceed rather than
        // blocking all users if the DB has a transient issue.
        console.error("Auth active-check DB error:", dbErr.message);
      }

      console.log("✅ User Authenticated:", req.user.id);
      next();
    });
  } catch (err) {
    console.error("Middleware System Error:", err.message);
    res.status(500).json({ msg: "Server Error" });
  }
};

export default auth;
