import jwt from "jsonwebtoken";

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
    jwt.verify(token, process.env.SECRET_TOKEN, (error, decoded) => {
      if (error) {
        console.log("JWT Verification Failed:", error.message);
        return res.status(401).json({ msg: "Token is not valid" });
      }

      req.user = {
        id: decoded.id,
        business_unit: decoded.business_unit,
        userType: decoded.user_type,
        company: decoded.company,
      };

      console.log("✅ User Authenticated:", req.user.id);
      next();
    });
  } catch (err) {
    console.error("Middleware System Error:", err.message);
    res.status(500).json({ msg: "Server Error" });
  }
};

export default auth;
