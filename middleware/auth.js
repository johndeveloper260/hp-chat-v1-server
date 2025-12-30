const jwt = require("jsonwebtoken");
const { log } = require("node:console");

module.exports = function (req, res, next) {
  // Get token from header
  const token = req.header("x-auth-token");

  console.log("RAW HEADER:", token);
  console.log("LENGTH:", token ? token.length : 0);

  // Check if no token
  if (!token) {
    return res.status(401).json({ msg: "No token, authorization denied" });
  }

  // Verify token
  try {
    jwt.verify(token, process.env.REACT_APP_SECRET_TOKEN, (error, decoded) => {
      if (error) {
        return res.status(401).json({ msg: "Token is not valid" });
      } else {
        req.user = {
          id: decoded.user_id,
          business_unit: decoded.business_unit,
        };
        console.log(req.user);

        next();
      }
    });
  } catch (err) {
    console.error("Something wrong with auth middleware");
    res.status(500).json({ msg: "Server Error" });
  }
};
