import jwt from "jsonwebtoken";

const auth = (req, res, next) => {
  // 1. Get token from header
  const token = req.header("x-app-identity");

  // Log what we received (Don't keep this in production!)
  // console.log("🔍 Middleware Received Token:", token ? "Yes" : "No");

  // 2. Check if no token
  if (!token) {
    console.log("❌ Auth Failed: No token provided in header 'x-app-identity'");
    return res.status(401).json({ msg: "No token, authorization denied" });
  }

  // 3. Verify token
  try {
    // ENSURE THIS MATCHES YOUR LOGIN FILE EXACTLY
    const secret = process.env.REACT_APP_SECRET_TOKEN;

    // Debug the secret (Print first 3 chars only for safety)
    // console.log("🗝️ Using Secret starting with:", secret ? secret.substring(0, 3) : "UNDEFINED");

    if (!secret) {
      console.error(
        "❌ CRITICAL: No Secret Token found in environment variables!"
      );
      return res.status(500).json({ msg: "Server Configuration Error" });
    }

    jwt.verify(token, secret, (error, decoded) => {
      if (error) {
        console.log("❌ JWT Verify Error:", error.message);
        // Common errors: "jwt malformed", "invalid signature", "jwt expired"
        return res.status(401).json({ msg: "Token is not valid" });
      }

      // If successful:
      req.user = {
        id: decoded.user_id,
        business_unit: decoded.business_unit,
      };
      next();
    });
  } catch (err) {
    console.error("❌ Middleware System Error:", err.message);
    res.status(500).json({ msg: "Server Error" });
  }
};

export default auth;
