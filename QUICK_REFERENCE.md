# Sliding Expiration - Quick Reference

## 🎯 What It Does
Automatically refreshes JWT tokens for active users, preventing logouts during use.

---

## 🔧 Backend (Already Done!)

### Middleware Applied
```javascript
// server.js
import slidingExpiration from "./middleware/slidingExpiration.js";
app.use(slidingExpiration);
```

### Logic
- Token expires < 7 days → Refresh
- Token expires > 7 days → No action
- Token expired → Rejected by auth middleware

### Response Header
```
X-Refresh-Token: <new-jwt-token>
```

---

## 💻 Web UI Implementation

### 1. Axios Interceptor
```javascript
api.interceptors.response.use(
  (response) => {
    const newToken = response.headers["x-refresh-token"];

    if (newToken) {
      localStorage.setItem("authToken", newToken);
      window.dispatchEvent(
        new CustomEvent("token-refreshed", { detail: { token: newToken } })
      );
    }

    return response;
  }
);
```

### 2. AuthContext
```javascript
useEffect(() => {
  const handleTokenRefresh = (event) => {
    setAuthToken(event.detail.token);
  };

  window.addEventListener("token-refreshed", handleTokenRefresh);
  return () => window.removeEventListener("token-refreshed", handleTokenRefresh);
}, []);
```

---

## 📱 Mobile App Implementation

### 1. Install Package
```bash
npm install @react-native-async-storage/async-storage
```

### 2. Axios Interceptor
```javascript
mobileApi.interceptors.response.use(
  async (response) => {
    const newToken = response.headers["x-refresh-token"];

    if (newToken) {
      await AsyncStorage.setItem("authToken", newToken);
      global.updateAuthToken?.(newToken);
    }

    return response;
  }
);
```

### 3. AuthContext
```javascript
useEffect(() => {
  global.updateAuthToken = setAuthToken;
}, []);
```

---

## 🧪 Testing

### Generate Test Tokens
```bash
node test-sliding-expiration.js
```

### Test with Curl
```bash
curl -H "x-app-identity: <TOKEN>" \
     http://localhost:8010/profile/me \
     -v
```

### Check for Header
```
< X-Refresh-Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 🔍 Debugging

### Backend Logs
```
🔄 Token refreshed for user: <user-id>
```

### Frontend Logs (Web)
```
🔄 New token received from server. Updating...
✅ AuthContext updated with refreshed token
```

### Frontend Logs (Mobile)
```
🔄 New token received from server. Updating AsyncStorage...
✅ Token updated successfully
```

---

## ⚙️ Configuration

### Change Refresh Window (default: 7 days)
```javascript
// middleware/slidingExpiration.js
const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60; // Change this
```

### Change Token Expiration (default: 30 days)
```javascript
// loginController.js & slidingExpiration.js
jwt.sign(payload, SECRET_TOKEN, {
  expiresIn: "30d", // Change this
});
```

---

## ❓ FAQ

**Q: Will this work for both web and mobile?**
A: Yes! The backend is platform-agnostic.

**Q: What if the token has 10 days left?**
A: No refresh happens (more than 7 days remaining).

**Q: What if the token is already expired?**
A: The auth middleware rejects it with 401, user redirects to login.

**Q: Do I need to change my existing API calls?**
A: No! The interceptor handles everything automatically.

**Q: What about security?**
A: Only valid tokens are refreshed. Use HTTPS in production.

---

## 📚 Full Documentation

- 📄 `SLIDING_EXPIRATION_GUIDE.md` - Complete guide
- 🌐 `frontend-example-axios-interceptor.js` - Web UI example
- 📱 `frontend-example-mobile-app.js` - Mobile app example
- 🔄 `PLATFORM_COMPARISON.md` - Web vs Mobile comparison

---

## ✅ Checklist

### Backend
- [x] Middleware created
- [x] Applied in server.js
- [x] CORS configured with exposedHeaders

### Frontend (Web)
- [ ] Axios interceptor added
- [ ] localStorage updated on refresh
- [ ] AuthContext listening for events
- [ ] 401 handling redirects to login

### Frontend (Mobile)
- [ ] AsyncStorage installed
- [ ] Axios interceptor added (async)
- [ ] AsyncStorage updated on refresh
- [ ] AuthContext updated
- [ ] 401 handling navigates to login

### Testing
- [ ] Generate test tokens
- [ ] Test with curl
- [ ] Verify X-Refresh-Token header
- [ ] Test in browser/app
- [ ] Check console logs

---

## 🚀 Deployment

1. Test in development
2. Deploy backend to staging
3. Deploy frontend to staging
4. Test end-to-end
5. Monitor logs for 24 hours
6. Deploy to production

---

## 🆘 Support

**Issue: Token not refreshing**
- Check server.js has middleware
- Check token has < 7 days remaining
- Check CORS exposedHeaders

**Issue: 401 errors**
- Token is expired (not refreshable)
- Check SECRET_TOKEN matches
- Verify token format

**Issue: Frontend not updating**
- Check event listener is set up
- Check localStorage/AsyncStorage is updating
- Verify header name is correct (case-insensitive)

---

Made with ❤️ for seamless authentication
