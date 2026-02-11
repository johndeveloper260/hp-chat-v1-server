import jwt from "jsonwebtoken";

/**
 * Sliding Expiration Middleware
 *
 * Intercepts every request and checks if the JWT is:
 * 1. Valid
 * 2. Expiring within 7 days
 *
 * If both conditions are met, generates a new token with a fresh 30-day expiration
 * and sends it back via the X-Refresh-Token header.
 */
const slidingExpiration = (req, res, next) => {
  // Extract token from headers
  let token = req.header("x-app-identity");

  // If not found, try Authorization header (for mobile apps)
  if (!token) {
    const authHeader = req.header("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }
  }

  // If no token is present, skip sliding expiration logic
  // (Let the auth middleware handle authentication)
  if (!token) {
    return next();
  }

  try {
    // Decode the token WITHOUT verification to check expiration
    const decoded = jwt.decode(token);

    if (!decoded || !decoded.exp) {
      return next();
    }

    // Calculate time remaining until expiration
    const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
    const expiresAt = decoded.exp; // Expiration time in seconds
    const timeRemaining = expiresAt - currentTime; // Seconds remaining

    const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60; // 604,800 seconds

    // If token is valid and will expire in less than 7 days
    if (timeRemaining > 0 && timeRemaining < SEVEN_DAYS_IN_SECONDS) {
      // Verify the token is actually valid before issuing a new one
      jwt.verify(token, process.env.SECRET_TOKEN, (error, verified) => {
        if (error) {
          // Token is invalid, don't refresh
          return next();
        }

        // Generate a new token with fresh 30-day expiration
        const newPayload = {
          id: verified.id,
          user_type: verified.user_type,
          business_unit: verified.business_unit,
          company: verified.company,
          company_name: verified.company_name,
          batch_no: verified.batch_no,
          preferred_language: verified.preferred_language || "en",
        };

        const newToken = jwt.sign(newPayload, process.env.SECRET_TOKEN.trim(), {
          expiresIn: "30d",
        });

        // Send the new token in a custom header
        res.setHeader("X-Refresh-Token", newToken);

        console.log(`🔄 Token refreshed for user: ${verified.id}`);
        next();
      });
    } else {
      // Token is either expired or has more than 7 days remaining
      next();
    }
  } catch (err) {
    // If any error occurs during sliding expiration, just proceed
    console.error("Sliding Expiration Error:", err.message);
    next();
  }
};

export default slidingExpiration;
