# Sliding Expiration Implementation Guide

## Overview
This implementation ensures users stay logged in while actively using the app by automatically refreshing JWT tokens that are about to expire.

---

## Backend Implementation

### 1. Middleware: `slidingExpiration.js`
**Location:** `/middleware/slidingExpiration.js`

**Logic:**
- Intercepts every request
- Checks if the JWT is valid and will expire **within 7 days**
- If yes, generates a new token with a fresh **30-day expiration**
- Sends the new token in the `X-Refresh-Token` header

**Key Features:**
- ✅ Non-blocking: If token refresh fails, the request continues
- ✅ Secure: Only refreshes valid tokens
- ✅ Efficient: Doesn't refresh tokens with more than 7 days remaining

### 2. Server Configuration
**Location:** `/server.js`

**Changes:**
1. Import the middleware
2. Add `exposedHeaders: ["X-Refresh-Token"]` to CORS config
3. Apply middleware globally before routes

```javascript
// server.js
import slidingExpiration from "./middleware/slidingExpiration.js";

app.use(cors(corsOptions)); // with exposedHeaders
app.use(slidingExpiration); // before routes
```

---

## Frontend Implementation

### 1. Axios Interceptor
**File:** `axiosConfig.js` or `api.js`

**Response Interceptor:**
```javascript
api.interceptors.response.use(
  (response) => {
    const refreshedToken = response.headers["x-refresh-token"];

    if (refreshedToken) {
      // Update localStorage
      localStorage.setItem("authToken", refreshedToken);

      // Notify AuthContext
      window.dispatchEvent(
        new CustomEvent("token-refreshed", { detail: { token: refreshedToken } })
      );
    }

    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("authToken");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);
```

### 2. AuthContext Integration
**File:** `AuthContext.jsx`

**Listen for Token Refresh:**
```javascript
useEffect(() => {
  const handleTokenRefresh = (event) => {
    const newToken = event.detail.token;
    setAuthToken(newToken);
  };

  window.addEventListener("token-refreshed", handleTokenRefresh);

  return () => {
    window.removeEventListener("token-refreshed", handleTokenRefresh);
  };
}, []);
```

---

## How It Works

### Scenario 1: Token is Fresh (More than 7 days remaining)
1. User makes a request
2. Middleware checks expiration
3. Token has 20 days left → **No refresh needed**
4. Request proceeds normally

### Scenario 2: Token is Expiring Soon (Less than 7 days remaining)
1. User makes a request
2. Middleware detects token has 5 days left
3. Middleware generates a new token with 30 days expiration
4. New token sent in `X-Refresh-Token` header
5. Frontend Axios interceptor detects the header
6. Frontend updates localStorage and AuthContext
7. User continues without interruption

### Scenario 3: Token is Expired
1. User makes a request
2. Auth middleware (`auth.js`) rejects the request with 401
3. Frontend redirects user to login

---

## Configuration

### Adjust Refresh Window (Default: 7 days)
In `slidingExpiration.js`, change:
```javascript
const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60; // Change this value
```

Examples:
- 3 days: `3 * 24 * 60 * 60`
- 1 day: `1 * 24 * 60 * 60`
- 12 hours: `12 * 60 * 60`

### Adjust Token Expiration (Default: 30 days)
In both `loginController.js` and `slidingExpiration.js`, change:
```javascript
jwt.sign(payload, process.env.SECRET_TOKEN, {
  expiresIn: "30d", // Change this value
});
```

---

## Testing

### 1. Test Token Refresh
**Method 1: Manually Create Expiring Token**
In `loginController.js`, temporarily change:
```javascript
const token = jwt.sign(payload, process.env.SECRET_TOKEN, {
  expiresIn: "6d", // Less than 7 days
});
```

**Method 2: Check Response Headers**
```bash
curl -H "x-app-identity: YOUR_TOKEN" http://localhost:8010/profile/me -v
```

Look for:
```
< X-Refresh-Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 2. Test Frontend Integration
Open browser DevTools → Network tab → Check response headers for any API call

---

## Security Considerations

✅ **Good:**
- Only valid tokens are refreshed
- Expired tokens are rejected
- Sliding window prevents unnecessary refreshes

⚠️ **Best Practices:**
- Use HTTPS in production
- Keep `SECRET_TOKEN` secret and strong
- Consider adding refresh token rotation for extra security
- Monitor failed token refresh attempts

---

## Troubleshooting

### Issue: Frontend doesn't receive `X-Refresh-Token`
**Solution:** Check CORS `exposedHeaders` in `server.js`:
```javascript
exposedHeaders: ["X-Refresh-Token"]
```

### Issue: Token keeps refreshing on every request
**Solution:** Check that the 7-day window is correct and tokens have proper expiration

### Issue: User gets logged out despite activity
**Solution:** Verify Axios interceptor is properly updating localStorage and AuthContext

---

## Migration Checklist

- [ ] Deploy backend changes to staging
- [ ] Test middleware with existing tokens
- [ ] Deploy frontend changes to staging
- [ ] Verify Axios interceptor works
- [ ] Test AuthContext updates
- [ ] Monitor logs for token refresh events
- [ ] Deploy to production
- [ ] Monitor production logs for 24 hours

---

## Files Changed/Created

### Backend
- ✅ **Created:** `middleware/slidingExpiration.js`
- ✅ **Modified:** `server.js`

### Frontend (Reference)
- 📄 **Example:** `frontend-example-axios-interceptor.js`

---

## Summary

This implementation provides:
- ✅ Automatic token refresh
- ✅ No user interruption
- ✅ Seamless experience
- ✅ No database calls needed
- ✅ Minimal performance overhead

Users can now stay logged in indefinitely as long as they remain active!
