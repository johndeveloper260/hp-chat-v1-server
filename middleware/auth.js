import jwt from "jsonwebtoken";

const auth = (req, res, next) => {
  // 1. Get the token
  const token = req.header("x-app-identity");

  // 2. Log exactly what the server sees (Check Heroku Logs)
  console.log("--- AUTH ATTEMPT ---");
  console.log(
    "Token Received:",
    token ? "YES (starts with " + token.substring(0, 10) + ")" : "NO"
  );
  console.log("Secret length in Middleware:", process.env.SECRET_TOKEN?.length);

  if (!token) {
    return res.status(401).json({ msg: "No token, authorization denied" });
  }

  try {
    const decoded = jwt.verify(token, process.env.SECRET_TOKEN.trim());
    req.user = decoded;
    next();
  } catch (err) {
    console.error("JWT Verify Error:", err.message);
    res.status(401).json({ msg: "Token is not valid" });
  }
};
export default auth;
