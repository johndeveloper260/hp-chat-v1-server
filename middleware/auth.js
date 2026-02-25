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
      };

      // Check if the account is still active on every request.
      // This ensures deactivated users are kicked out immediately.
      try {
        const { rows } = await getPool().query(
          "SELECT is_active FROM v4.user_account_tbl WHERE id = $1",
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
