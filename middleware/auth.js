// auth.js
import jwt from "jsonwebtoken";

const auth = (req, res, next) => {
  const token = req.header("x-app-identity");

  if (!token) {
    return res.status(401).json({ msg: "No token, authorization denied" });
  }

  try {
    // 1. Get the secret and handle potential undefined/spaces
    const rawSecret = process.env.REACT_APP_SECRET_TOKEN;

    if (!rawSecret) {
      console.error("❌ CRITICAL: JWT Secret is missing in .env");
      return res.status(500).json({ msg: "Server Configuration Error" });
    }

    // 2. Use .trim() to match the loginController exactly
    const secret = rawSecret.trim();

    jwt.verify(token, secret, (error, decoded) => {
      if (error) {
        console.log("❌ JWT Verify Error:", error.message);
        return res.status(401).json({ msg: "Token is not valid" });
      }

      req.user = {
        id: decoded.user_id,
        business_unit: decoded.business_unit,
      };

      next();
    });
  } catch (err) {
    console.error("❌ Middleware Error:", err.message);
    res.status(500).json({ msg: "Server Error" });
  }
};

export default auth;
