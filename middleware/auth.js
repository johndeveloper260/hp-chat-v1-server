// auth.js (Backend Middleware)
import jwt from "jsonwebtoken";

const auth = (req, res, next) => {
  const token = req.header("x-app-identity");

  if (!token) {
    return res.status(401).json({ msg: "No token, authorization denied" });
  }

  try {
    // 1. Get the secret from environment
    const rawSecret = process.env.SECRET_TOKEN;

    // 2. CRITICAL: Match the loginController's .trim() exactly
    // If the secret is missing, use a fallback string to prevent "invalid signature"
    // and instead throw a clear configuration error.
    if (!rawSecret) {
      console.error("❌ BACKEND ERROR: SECRET_TOKEN is not defined in .env");
      return res.status(500).json({ msg: "Server Configuration Error" });
    }

    const secret = rawSecret.trim();

    // Inside the auth function, before jwt.verify
    console.log("VERIFYING SECRET:", rawSecret?.length, "chars");

    jwt.verify(token, secret, (error, decoded) => {
      if (error) {
        // If you see "invalid signature" here, the keys definitely don't match
        console.log(
          `❌ JWT Error: ${error.message} (Secret Length: ${secret.length})`
        );
        return res.status(401).json({ msg: "Token is not valid" });
      }

      req.user = {
        id: decoded.user_id,
        business_unit: decoded.business_unit,
      };
      next();
    });
  } catch (err) {
    res.status(500).json({ msg: "Server Error" });
  }
};

export default auth;
