const jwt = require("jsonwebtoken");

module.exports = function (req, res, next) {
  // 1. Get token from header
  const token = req.header("x-app-identity");

  // 2. Check if no token
  if (!token) {
    return res.status(401).json({ msg: "No token, authorization denied" });
  }

  // 3. Verify token
  try {
    jwt.verify(token, process.env.REACT_APP_SECRET_TOKEN, (error, decoded) => {
      if (error) {
        console.log("JWT Verification Failed:", error.message);
        return res.status(401).json({ msg: "Token is not valid" });
      }

      // 3. Attach the full data to req.user
      req.user = {
        id: decoded.user_id,
        business_unit: decoded.business_unit,
      };

      console.log("User Authenticated:", req.user.id);

      // 6. Move to the next middleware/controller
      next();
    });
  } catch (err) {
    console.error("Middleware System Error:", err.message);
    res.status(500).json({ msg: "Server Error" });
  }
};
