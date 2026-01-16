import jwt from "jsonwebtoken";

const auth = (req, res, next) => {
  const token = req.header("x-app-identity");

  if (!token) {
    return res.status(401).json({ msg: "No token, authorization denied" });
  }

  try {
    // 1. CHECK THIS VARIABLE NAME!
    // Make sure your backend .env file has "SECRET_TOKEN=..." (without REACT_APP_)
    // or ensure you use the exact same name defined in your .env
    const secret =
      process.env.SECRET_TOKEN || process.env.REACT_APP_SECRET_TOKEN;

    if (!secret) {
      throw new Error("Missing JWT Secret in environment variables");
    }

    jwt.verify(token, secret, (error, decoded) => {
      if (error) {
        // This is the 401 the frontend is waiting for
        return res.status(401).json({ msg: "Token is not valid" });
      }

      req.user = {
        id: decoded.user_id,
        business_unit: decoded.business_unit,
      };
      next();
    });
  } catch (err) {
    // If the secret is missing, code lands here and returns 500
    console.error("Middleware System Error:", err.message);
    res.status(500).json({ msg: "Server Error" });
  }
};

export default auth;
