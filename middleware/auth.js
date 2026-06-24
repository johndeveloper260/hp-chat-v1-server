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

      // Identity fields used for authorization/filtering must come from the
      // database. JWT claims can be up to 30 days old after a company transfer.
      try {
        const { rows } = await getPool().query(
          `WITH account AS (
             UPDATE v4.user_account_tbl
             SET last_seen = CASE
               WHEN last_seen IS NULL OR last_seen < NOW() - INTERVAL '5 minutes'
               THEN NOW()
               ELSE last_seen
             END
             WHERE id = $1::uuid
             RETURNING id, business_unit, is_active, preferred_language
           )
           SELECT
             account.id,
             account.business_unit,
             account.is_active,
             account.preferred_language,
             COALESCE(p.user_type, CASE WHEN su.id IS NOT NULL THEN 'souser' END) AS user_type,
             p.company,
             su.country AS souser_country,
             su.sending_org AS souser_sending_org,
             su.primary_bu AS souser_primary_bu,
             sba.announcements_read AS souser_announcements_read,
             sba.announcements_write AS souser_announcements_write
           FROM account
           LEFT JOIN v4.user_profile_tbl p ON p.user_id = account.id
           LEFT JOIN v4.souser_tbl su ON su.id = account.id
           LEFT JOIN v4.souser_bu_access_tbl sba
             ON sba.souser_id = account.id
            AND sba.business_unit = account.business_unit
            AND sba.revoked_at IS NULL`,
          [decoded.id],
        );
        const currentUser = rows[0];
        if (!currentUser || currentUser.is_active === false) {
          return res.status(401).json({ msg: "Account has been deactivated", error_code: "api_errors.auth.account_deactivated" });
        }

        req.user = {
          id: String(currentUser.id),
          business_unit: currentUser.business_unit,
          userType: currentUser.user_type,
          company: currentUser.company,
          preferred_language: currentUser.preferred_language || "en",
          roles: decoded.roles ?? [],
          souser_country: currentUser.souser_country ?? null,
          souser_sending_org: currentUser.souser_sending_org ?? null,
          souser_primary_bu: currentUser.souser_primary_bu ?? null,
          souser_announcements_read: currentUser.souser_announcements_read ?? false,
          souser_announcements_write: currentUser.souser_announcements_write ?? false,
        };
      } catch (dbErr) {
        console.error("Auth active-check DB error:", dbErr.message);
        return res.status(503).json({ msg: "Unable to verify current account identity" });
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
