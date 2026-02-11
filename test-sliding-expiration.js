/**
 * Testing Script for Sliding Expiration
 *
 * This script helps you test the sliding expiration feature
 * by creating tokens with different expiration times.
 *
 * USAGE:
 * 1. Run: node test-sliding-expiration.js
 * 2. Copy one of the generated tokens
 * 3. Use it in a request to test the middleware
 */

import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const SECRET_TOKEN = process.env.SECRET_TOKEN?.trim();

if (!SECRET_TOKEN) {
  console.error("❌ SECRET_TOKEN not found in .env file");
  process.exit(1);
}

// Sample payload (use your actual user data)
const samplePayload = {
  id: "test-user-123",
  user_type: "admin",
  business_unit: "HQ",
  company: "sample-company-uuid",
  company_name: "Test Company",
  batch_no: "2024-01",
  preferred_language: "en",
};

console.log("\n🧪 JWT Token Test Suite for Sliding Expiration\n");
console.log("=" .repeat(60));

// Test 1: Token with 25 days remaining (should NOT refresh)
const token25Days = jwt.sign(samplePayload, SECRET_TOKEN, {
  expiresIn: "25d",
});
const decoded25Days = jwt.decode(token25Days);
const expires25Days = new Date(decoded25Days.exp * 1000);

console.log("\n1️⃣  Token with 25 days expiration (Should NOT refresh)");
console.log("-".repeat(60));
console.log("Token:", token25Days.substring(0, 50) + "...");
console.log("Expires:", expires25Days.toLocaleString());
console.log("Expected Behavior: ✅ No refresh (more than 7 days left)");

// Test 2: Token with 5 days remaining (should refresh)
const token5Days = jwt.sign(samplePayload, SECRET_TOKEN, {
  expiresIn: "5d",
});
const decoded5Days = jwt.decode(token5Days);
const expires5Days = new Date(decoded5Days.exp * 1000);

console.log("\n2️⃣  Token with 5 days expiration (Should REFRESH)");
console.log("-".repeat(60));
console.log("Token:", token5Days.substring(0, 50) + "...");
console.log("Expires:", expires5Days.toLocaleString());
console.log("Expected Behavior: 🔄 Token will be refreshed");

// Test 3: Token with 1 hour remaining (should refresh)
const token1Hour = jwt.sign(samplePayload, SECRET_TOKEN, {
  expiresIn: "1h",
});
const decoded1Hour = jwt.decode(token1Hour);
const expires1Hour = new Date(decoded1Hour.exp * 1000);

console.log("\n3️⃣  Token with 1 hour expiration (Should REFRESH)");
console.log("-".repeat(60));
console.log("Token:", token1Hour.substring(0, 50) + "...");
console.log("Expires:", expires1Hour.toLocaleString());
console.log("Expected Behavior: 🔄 Token will be refreshed");

// Test 4: Expired token (should be rejected)
const expiredToken = jwt.sign(samplePayload, SECRET_TOKEN, {
  expiresIn: "-1h", // Expired 1 hour ago
});
const decodedExpired = jwt.decode(expiredToken);
const expiresExpired = new Date(decodedExpired.exp * 1000);

console.log("\n4️⃣  Expired token (Should be REJECTED)");
console.log("-".repeat(60));
console.log("Token:", expiredToken.substring(0, 50) + "...");
console.log("Expires:", expiresExpired.toLocaleString());
console.log("Expected Behavior: ❌ 401 Unauthorized");

console.log("\n" + "=".repeat(60));
console.log("\n🧪 How to Test:\n");
console.log("1. Start your server: npm start");
console.log("2. Use curl or Postman to make a request with one of the tokens:");
console.log("\n   curl -H \"x-app-identity: <TOKEN>\" http://localhost:8010/profile/me -v\n");
console.log("3. Check the response headers for 'X-Refresh-Token'");
console.log("4. For tokens that should refresh (2 & 3), you should see:");
console.log("   < X-Refresh-Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...\n");
console.log("5. Check server console for: '🔄 Token refreshed for user: test-user-123'\n");

console.log("=" .repeat(60));
console.log("\n✅ Test tokens generated successfully!\n");

// Export tokens for easy copying
console.log("📋 Copy these for testing:\n");
console.log("Token 5 days (SHOULD REFRESH):");
console.log(token5Days);
console.log("\nToken 25 days (should NOT refresh):");
console.log(token25Days);
console.log();
