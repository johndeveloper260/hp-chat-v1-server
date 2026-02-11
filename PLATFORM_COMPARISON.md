# Platform Comparison: Web UI vs Mobile App

## Overview
The sliding expiration implementation works identically for both platforms. The only differences are in storage and event handling.

---

## Side-by-Side Comparison

| Feature | Web UI | Mobile App |
|---------|--------|------------|
| **HTTP Client** | Axios | Axios |
| **Token Storage** | `localStorage` | `AsyncStorage` |
| **Token Header** | `x-app-identity` or `Authorization` | `x-app-identity` or `Authorization` |
| **Response Header** | `X-Refresh-Token` | `X-Refresh-Token` |
| **Event System** | `window.dispatchEvent` | `EventEmitter` or global function |
| **Context Update** | React Context (web) | React Context (React Native) |

---

## Key Differences

### 1. Storage

**Web UI:**
```javascript
// Synchronous
localStorage.setItem("authToken", token);
const token = localStorage.getItem("authToken");
```

**Mobile App:**
```javascript
// Asynchronous
await AsyncStorage.setItem("authToken", token);
const token = await AsyncStorage.getItem("authToken");
```

### 2. Event Handling

**Web UI:**
```javascript
// Custom DOM event
window.dispatchEvent(
  new CustomEvent("token-refreshed", { detail: { token: newToken } })
);

// Listen
window.addEventListener("token-refreshed", handleRefresh);
```

**Mobile App:**
```javascript
// EventEmitter
import { EventEmitter } from "events";
const emitter = new EventEmitter();

emitter.emit("token-refreshed", newToken);
emitter.on("token-refreshed", handleRefresh);
```

### 3. Navigation on Logout

**Web UI:**
```javascript
// Direct redirect
window.location.href = "/login";
```

**Mobile App:**
```javascript
// Navigation library (React Navigation)
global.navigationRef?.navigate("Login");
```

---

## Backend (Same for Both)

The middleware works **identically** for both platforms:

```javascript
// middleware/slidingExpiration.js

// ✅ Reads from BOTH header formats
let token = req.header("x-app-identity");
if (!token) {
  const authHeader = req.header("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }
}

// ✅ Returns new token in response header
res.setHeader("X-Refresh-Token", newToken);
```

**Why it works:**
- Mobile apps and web UIs both send HTTP requests
- Both can read/write HTTP headers
- The middleware doesn't care about the client type

---

## Implementation Checklist

### Web UI ✅
- [ ] Create `axiosConfig.js` with interceptors
- [ ] Use `localStorage` for token storage
- [ ] Use `window.dispatchEvent` for events
- [ ] Update `AuthContext` with event listener
- [ ] Handle 401 with `window.location.href`

### Mobile App 📱
- [ ] Install `@react-native-async-storage/async-storage`
- [ ] Create `mobileApi.js` with interceptors
- [ ] Use `AsyncStorage` for token storage (async)
- [ ] Use `EventEmitter` or global function for events
- [ ] Update `AuthContext` with event listener
- [ ] Handle 401 with navigation library

---

## Example Requests

### Web UI Request
```javascript
// Using Axios
const response = await api.get("/profile/me");

// Request headers:
// x-app-identity: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

// Response headers:
// X-Refresh-Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (if refreshed)
```

### Mobile App Request
```javascript
// Using Axios (same!)
const response = await mobileApi.get("/profile/me");

// Request headers:
// x-app-identity: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

// Response headers:
// X-Refresh-Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (if refreshed)
```

**Identical HTTP communication!** 🎯

---

## Testing Both Platforms

### Web UI Testing
```bash
# Start dev server
npm run dev

# Check browser DevTools → Network tab
# Look for X-Refresh-Token in response headers
```

### Mobile App Testing
```bash
# For Expo
expo start

# For React Native
npx react-native run-ios
# or
npx react-native run-android

# Check console logs for:
# "🔄 New token received from server. Updating AsyncStorage..."
```

---

## Common Issues & Solutions

### Issue: Web UI works, mobile doesn't

**Possible Causes:**
1. AsyncStorage not installed
2. Forgot `await` when reading/writing AsyncStorage
3. Event emitter not set up

**Solution:**
```bash
npm install @react-native-async-storage/async-storage
```

### Issue: Mobile works, web doesn't

**Possible Causes:**
1. CORS not configured properly
2. `exposedHeaders` missing in CORS config
3. Using async code with localStorage (should be sync)

**Solution:**
```javascript
// server.js
exposedHeaders: ["X-Refresh-Token"]
```

### Issue: Neither platform refreshes token

**Possible Causes:**
1. Middleware not applied in `server.js`
2. Token has more than 7 days remaining
3. Header name case-sensitive issue

**Solution:**
```javascript
// Check server.js
app.use(slidingExpiration); // Before routes!

// Check response headers (case-insensitive in HTTP)
console.log(response.headers["x-refresh-token"]);
```

---

## Performance Considerations

### Web UI
- ✅ Synchronous storage (fast)
- ✅ Lightweight event system
- ⚠️ Limited by browser storage (5-10MB)

### Mobile App
- ⚠️ Asynchronous storage (slightly slower)
- ✅ Unlimited storage (device-dependent)
- ✅ Persists across app restarts

**Recommendation:** Both are performant enough. The async overhead in mobile is negligible (1-5ms).

---

## Security Comparison

### Web UI
- ✅ `localStorage` is domain-scoped
- ⚠️ Vulnerable to XSS attacks
- ⚠️ Accessible via browser DevTools

### Mobile App
- ✅ `AsyncStorage` is sandboxed per app
- ✅ Not accessible from browser
- ✅ Better isolation from XSS

**Best Practice (Both):**
- Use HTTPS
- Implement CSRF protection
- Consider using HttpOnly cookies for web (requires backend changes)

---

## Summary

| Aspect | Web UI | Mobile App | Winner |
|--------|--------|------------|--------|
| Setup Complexity | ⭐⭐⭐⭐⭐ Simple | ⭐⭐⭐⭐ Slightly complex | Web |
| Performance | ⭐⭐⭐⭐⭐ Fast | ⭐⭐⭐⭐ Fast | Tie |
| Security | ⭐⭐⭐ Good | ⭐⭐⭐⭐ Better | Mobile |
| User Experience | ⭐⭐⭐⭐⭐ Seamless | ⭐⭐⭐⭐⭐ Seamless | Tie |

**Both platforms get the same great user experience!** 🎉

---

## Quick Start

### Web UI
```bash
# 1. Copy frontend-example-axios-interceptor.js
# 2. Adapt to your project structure
# 3. Test with browser DevTools
```

### Mobile App
```bash
# 1. Install AsyncStorage
npm install @react-native-async-storage/async-storage

# 2. Copy frontend-example-mobile-app.js
# 3. Adapt to your project structure
# 4. Test with console logs
```

---

## Files to Reference

- 📄 `frontend-example-axios-interceptor.js` - Web UI implementation
- 📱 `frontend-example-mobile-app.js` - Mobile app implementation
- 🔧 `middleware/slidingExpiration.js` - Backend (works for both!)
- 📚 `SLIDING_EXPIRATION_GUIDE.md` - Detailed guide

**The backend is platform-agnostic. Write once, use everywhere!** ✨
