// auth.js (Backend Middleware)
import jwt from "jsonwebtoken";

const auth = (req, res, next) => {
  const token = req.header("x-app-identity");

  // 1. Force use of SECRET_TOKEN and trim it
  const secret = process.env.SECRET_TOKEN?.trim();

  if (!secret) {
    console.error("❌ CRITICAL ERROR: SECRET_TOKEN is UNDEFINED in Heroku!");
    return res.status(500).json({ msg: "Server Configuration Error" });
  }

  jwt.verify(token, secret, (error, decoded) => {
    if (error) {
      // This will tell us EXACTLY what the server is seeing
      console.log(`❌ JWT Error: ${error.message}`);
      console.log(
        `DEBUG: Secret used starts with: ${secret.substring(
          0,
          3
        )}... and length is: ${secret.length}`
      );
      return res.status(401).json({ msg: "Token is not valid" });
    }
    req.user = { id: decoded.user_id, business_unit: decoded.business_unit };
    next();
  });
};

export default auth;
