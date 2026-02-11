/**
 * Mobile App (React Native) - Sliding Expiration Implementation
 *
 * Works with:
 * - React Native
 * - Expo
 * - iOS/Android apps
 *
 * Uses AsyncStorage instead of localStorage
 */

import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Create Axios instance for mobile
const mobileApi = axios.create({
  baseURL: "https://your-api-domain.com", // or http://localhost:8010 for development
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 10000, // 10 seconds
});

/**
 * Request Interceptor - Attach JWT to requests
 */
mobileApi.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem("authToken");

      if (token) {
        // Use x-app-identity header (or Authorization Bearer)
        config.headers["x-app-identity"] = token;
        // Alternative: config.headers["Authorization"] = `Bearer ${token}`;
      }
    } catch (error) {
      console.error("Error reading token from AsyncStorage:", error);
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response Interceptor - Handle token refresh
 */
mobileApi.interceptors.response.use(
  async (response) => {
    // Check for refreshed token in response headers
    const refreshedToken = response.headers["x-refresh-token"];

    if (refreshedToken) {
      console.log("🔄 New token received from server. Updating AsyncStorage...");

      try {
        // Update AsyncStorage
        await AsyncStorage.setItem("authToken", refreshedToken);

        // If you're using React Context, dispatch an event
        // You can use EventEmitter or React Context directly
        global.tokenRefreshEvent?.emit("token-refreshed", refreshedToken);

        console.log("✅ Token updated successfully");
      } catch (error) {
        console.error("❌ Error saving refreshed token:", error);
      }
    }

    return response;
  },
  async (error) => {
    // Handle 401 errors (expired or invalid token)
    if (error.response && error.response.status === 401) {
      console.error("❌ Authentication failed. Logging out...");

      try {
        // Clear invalid token
        await AsyncStorage.removeItem("authToken");
        await AsyncStorage.removeItem("user");

        // Navigate to login screen
        // This depends on your navigation library (React Navigation, etc.)
        global.navigationRef?.navigate("Login");
      } catch (err) {
        console.error("Error during logout:", err);
      }
    }

    return Promise.reject(error);
  }
);

export default mobileApi;


/**
 * ===========================================
 * OPTION 1: AuthContext with React Context
 * ===========================================
 */

import React, { createContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { EventEmitter } from "events";

// Create global event emitter for token refresh
global.tokenRefreshEvent = new EventEmitter();

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [authToken, setAuthToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load token on app start
  useEffect(() => {
    const loadAuth = async () => {
      try {
        const token = await AsyncStorage.getItem("authToken");
        const userData = await AsyncStorage.getItem("user");

        if (token) setAuthToken(token);
        if (userData) setUser(JSON.parse(userData));
      } catch (error) {
        console.error("Error loading auth data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadAuth();
  }, []);

  // Listen for token refresh events
  useEffect(() => {
    const handleTokenRefresh = (newToken) => {
      console.log("✅ AuthContext updated with refreshed token");
      setAuthToken(newToken);
    };

    global.tokenRefreshEvent.on("token-refreshed", handleTokenRefresh);

    return () => {
      global.tokenRefreshEvent.off("token-refreshed", handleTokenRefresh);
    };
  }, []);

  const login = async (token, userData) => {
    try {
      await AsyncStorage.setItem("authToken", token);
      await AsyncStorage.setItem("user", JSON.stringify(userData));
      setAuthToken(token);
      setUser(userData);
    } catch (error) {
      console.error("Error saving auth data:", error);
    }
  };

  const logout = async () => {
    try {
      await AsyncStorage.removeItem("authToken");
      await AsyncStorage.removeItem("user");
      setAuthToken(null);
      setUser(null);
    } catch (error) {
      console.error("Error clearing auth data:", error);
    }
  };

  return (
    <AuthContext.Provider value={{ authToken, user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};


/**
 * ===========================================
 * OPTION 2: Using React Native's EventEmitter
 * ===========================================
 */

import { NativeEventEmitter, NativeModules } from "react-native";

// Create a simple event emitter
class TokenEventEmitter extends EventEmitter {}
const tokenEvents = new TokenEventEmitter();

// In your Axios interceptor:
mobileApi.interceptors.response.use(
  async (response) => {
    const refreshedToken = response.headers["x-refresh-token"];

    if (refreshedToken) {
      await AsyncStorage.setItem("authToken", refreshedToken);
      tokenEvents.emit("tokenRefreshed", refreshedToken);
    }

    return response;
  },
  (error) => Promise.reject(error)
);

// In your AuthContext or component:
useEffect(() => {
  const subscription = tokenEvents.addListener("tokenRefreshed", (newToken) => {
    setAuthToken(newToken);
  });

  return () => subscription.remove();
}, []);


/**
 * ===========================================
 * OPTION 3: Direct Context Update (Simpler)
 * ===========================================
 */

import React, { createContext, useState, useEffect, useRef } from "react";

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [authToken, setAuthToken] = useState(null);
  const [user, setUser] = useState(null);

  // Store the setAuthToken function globally
  useEffect(() => {
    global.updateAuthToken = setAuthToken;
  }, []);

  const login = async (token, userData) => {
    await AsyncStorage.setItem("authToken", token);
    await AsyncStorage.setItem("user", JSON.stringify(userData));
    setAuthToken(token);
    setUser(userData);
  };

  const logout = async () => {
    await AsyncStorage.removeItem("authToken");
    await AsyncStorage.removeItem("user");
    setAuthToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ authToken, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// In your Axios interceptor:
mobileApi.interceptors.response.use(
  async (response) => {
    const refreshedToken = response.headers["x-refresh-token"];

    if (refreshedToken) {
      await AsyncStorage.setItem("authToken", refreshedToken);

      // Update context directly
      if (global.updateAuthToken) {
        global.updateAuthToken(refreshedToken);
      }
    }

    return response;
  }
);


/**
 * ===========================================
 * USAGE EXAMPLE: Login Screen
 * ===========================================
 */

import React, { useContext, useState } from "react";
import { View, TextInput, Button, Alert } from "react-native";
import mobileApi from "./api/mobileApi";
import { AuthContext } from "./context/AuthContext";

const LoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login } = useContext(AuthContext);

  const handleLogin = async () => {
    try {
      const response = await mobileApi.post("/login", { email, password });

      const { token, user } = response.data;

      // Save token and user data
      await login(token, user);

      // Navigate to main app
      navigation.navigate("Home");
    } catch (error) {
      Alert.alert("Login Failed", error.response?.data?.error || "An error occurred");
    }
  };

  return (
    <View>
      <TextInput
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
      />
      <TextInput
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Button title="Login" onPress={handleLogin} />
    </View>
  );
};


/**
 * ===========================================
 * USAGE EXAMPLE: Protected Screen
 * ===========================================
 */

import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import mobileApi from "./api/mobileApi";

const ProfileScreen = () => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        // The interceptor automatically:
        // 1. Adds the token to the request
        // 2. Checks for X-Refresh-Token in the response
        // 3. Updates AsyncStorage and AuthContext if refreshed
        const response = await mobileApi.get("/profile/me");
        setProfile(response.data);
      } catch (error) {
        console.error("Error fetching profile:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  if (loading) return <ActivityIndicator />;

  return (
    <View>
      <Text>Name: {profile?.firstName} {profile?.lastName}</Text>
      <Text>Email: {profile?.email}</Text>
    </View>
  );
};


/**
 * ===========================================
 * SETUP: Navigation Reference (for logout redirect)
 * ===========================================
 */

// In your App.js or main navigation file:
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useRef } from "react";

const Stack = createNativeStackNavigator();

export default function App() {
  const navigationRef = useRef();

  // Make navigation available globally for logout redirect
  global.navigationRef = navigationRef.current;

  return (
    <NavigationContainer ref={navigationRef}>
      <AuthProvider>
        <Stack.Navigator>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
        </Stack.Navigator>
      </AuthProvider>
    </NavigationContainer>
  );
}


/**
 * ===========================================
 * PACKAGE INSTALLATION
 * ===========================================
 */

/*
npm install @react-native-async-storage/async-storage
npm install axios

OR for Expo:
expo install @react-native-async-storage/async-storage
expo install axios
*/
