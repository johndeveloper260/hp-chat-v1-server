// auth.js (Backend Middleware)
import jwt from "jsonwebtoken";
// backend/middleware/auth.js

const auth = (req, res, next) => {
  const token = req.header("x-app-identity");
  const secret = process.env.SECRET_TOKEN;

  if (!token) return res.status(401).json({ msg: "No token" });

  try {
    const decoded = jwt.verify(token, secret);
    req.user = { id: decoded.user_id, business_unit: decoded.business_unit };
    next();
  } catch (err) {
    console.log("Verify failed with secret length:", secret?.length);
    res.status(401).json({ msg: "Token is not valid" });
  }
};

export default auth;
