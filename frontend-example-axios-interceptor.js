/**
 * Frontend Axios Interceptor for Sliding Expiration
 *
 * This example shows how to:
 * 1. Detect the X-Refresh-Token header in API responses
 * 2. Automatically update localStorage with the new token
 * 3. Update AuthContext with the refreshed token
 *
 * INSTALLATION:
 * Place this code in your Axios configuration file (e.g., src/api/axiosConfig.js)
 */

import axios from "axios";

// Create an Axios instance
const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "http://localhost:8010",
  headers: {
    "Content-Type": "application/json",
  },
});

/**
 * Request Interceptor
 * Attaches the JWT token to every request
 */
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("authToken");

    if (token) {
      // Use x-app-identity header (matches your backend)
      config.headers["x-app-identity"] = token;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response Interceptor
 * Checks for X-Refresh-Token header and updates the token automatically
 */
api.interceptors.response.use(
  (response) => {
    // Check if the response contains a refreshed token
    const refreshedToken = response.headers["x-refresh-token"];

    if (refreshedToken) {
      console.log("🔄 New token received from server. Updating...");

      // Update localStorage
      localStorage.setItem("authToken", refreshedToken);

      // Dispatch a custom event to notify AuthContext
      window.dispatchEvent(
        new CustomEvent("token-refreshed", { detail: { token: refreshedToken } })
      );
    }

    return response;
  },
  (error) => {
    // Handle 401 errors (token expired or invalid)
    if (error.response && error.response.status === 401) {
      console.error("❌ Authentication failed. Redirecting to login...");

      // Clear the invalid token
      localStorage.removeItem("authToken");

      // Redirect to login page
      window.location.href = "/login";
    }

    return Promise.reject(error);
  }
);

export default api;


/**
 * ===========================================
 * EXAMPLE: AuthContext Setup
 * ===========================================
 *
 * In your AuthContext (e.g., src/context/AuthContext.jsx)
 */

import React, { createContext, useState, useEffect } from "react";

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [authToken, setAuthToken] = useState(localStorage.getItem("authToken"));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem("user")));

  // Listen for token refresh events from Axios interceptor
  useEffect(() => {
    const handleTokenRefresh = (event) => {
      const newToken = event.detail.token;
      console.log("✅ AuthContext updated with refreshed token");
      setAuthToken(newToken);
    };

    window.addEventListener("token-refreshed", handleTokenRefresh);

    return () => {
      window.removeEventListener("token-refreshed", handleTokenRefresh);
    };
  }, []);

  const login = (token, userData) => {
    localStorage.setItem("authToken", token);
    localStorage.setItem("user", JSON.stringify(userData));
    setAuthToken(token);
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("user");
    setAuthToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ authToken, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};


/**
 * ===========================================
 * EXAMPLE: Usage in Components
 * ===========================================
 */

import React, { useEffect, useState } from "react";
import api from "./api/axiosConfig";

const Dashboard = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // The interceptor will automatically:
        // 1. Send the token in x-app-identity header
        // 2. Check for X-Refresh-Token in the response
        // 3. Update localStorage and AuthContext if token is refreshed
        const response = await api.get("/profile/me");
        setData(response.data);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    fetchData();
  }, []);

  return (
    <div>
      <h1>Dashboard</h1>
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
};

export default Dashboard;


/**
 * ===========================================
 * ALTERNATIVE: React Context with useReducer
 * ===========================================
 *
 * For more complex state management
 */

import React, { createContext, useReducer, useEffect } from "react";

const initialState = {
  authToken: localStorage.getItem("authToken"),
  user: JSON.parse(localStorage.getItem("user")),
};

const authReducer = (state, action) => {
  switch (action.type) {
    case "LOGIN":
      localStorage.setItem("authToken", action.payload.token);
      localStorage.setItem("user", JSON.stringify(action.payload.user));
      return {
        authToken: action.payload.token,
        user: action.payload.user,
      };

    case "LOGOUT":
      localStorage.removeItem("authToken");
      localStorage.removeItem("user");
      return {
        authToken: null,
        user: null,
      };

    case "REFRESH_TOKEN":
      localStorage.setItem("authToken", action.payload.token);
      return {
        ...state,
        authToken: action.payload.token,
      };

    default:
      return state;
  }
};

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    const handleTokenRefresh = (event) => {
      dispatch({ type: "REFRESH_TOKEN", payload: { token: event.detail.token } });
    };

    window.addEventListener("token-refreshed", handleTokenRefresh);

    return () => {
      window.removeEventListener("token-refreshed", handleTokenRefresh);
    };
  }, []);

  const login = (token, user) => {
    dispatch({ type: "LOGIN", payload: { token, user } });
  };

  const logout = () => {
    dispatch({ type: "LOGOUT" });
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
