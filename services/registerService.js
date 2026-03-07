/**
 * Register Service
 *
 * All registration business logic lives here.
 * No req/res — pure JS functions that throw AppError subclasses on failure.
 * The controller catches errors and passes them to next(err).
 */

import bcrypt from "bcrypt";
import { StreamClient } from "@stream-io/node-sdk";

import { getPool } from "../config/getPool.js";
import env from "../config/env.js";
import { NotFoundError, ConflictError } from "../errors/AppError.js";
import * as userRepo from "../repositories/userRepository.js";
import { syncUserToStream } from "../utils/syncUserToStream.js";
import * as emailService from "../config/systemMailer.js";

// ─────────────────────────────────────────────────────────────────────────────
// Validate Registration Code
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a registration code and returns the associated business metadata.
 * Throws NotFoundError if the code doesn't exist.
 *
 * @param {string} code
 * @returns {{ business_unit, role_name, company, batch_no }}
 */
export async function validateRegistrationCode(code) {
  const record = await userRepo.findRegistrationCode(code);
  if (!record) {
    throw new NotFoundError(
      "register_invalid_code",
      "api_errors.register.invalid_code",
    );
  }
  return record;
}

// ─────────────────────────────────────────────────────────────────────────────
// Register User
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full user registration — runs inside a DB transaction.
 *
 * Steps:
 *  1. Validate registration code
 *  2. Hash password
 *  3. Insert account + profile + visa (transaction)
 *  4. Grant default OFFICER roles if applicable
 *  5. Sync to Stream Chat
 *  6. Generate Stream token
 *  7. Commit transaction
 *  8. Send welcome email (non-blocking — won't roll back on failure)
 *
 * @param {object} data - Validated request body from registerValidator
 * @returns {{ user: object, streamToken: string }}
 */
export async function registerUser(data) {
  const {
    email,
    password,
    firstName,
    middleName,
    lastName,
    registrationCode,
    position,
    companyBranch,
    phoneNumber,
    visaType,
    visaExpiry,
    postalCode,
    streetAddress,
    city,
    state,
  } = data;

  // 1. Validate registration code (throws NotFoundError if invalid)
  const xref = await validateRegistrationCode(registrationCode);
  const { business_unit, role_name, company, batch_no } = xref;
  const userRole = (role_name || "USER").toUpperCase();

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 2. Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // 3a. Create account row — PG unique constraint throws 23505 on duplicate email
    const userId = await userRepo.createUserAccount(
      { email, passwordHash, businessUnit: business_unit },
      client,
    );

    // 3b. Create profile row
    await userRepo.createUserProfile(
      {
        userId,
        firstName,
        middleName,
        lastName,
        userType: userRole,
        position,
        company,
        companyBranch,
        phoneNumber,
        postalCode,
        streetAddress,
        city,
        state,
        batchNo: batch_no,
        businessUnit: business_unit,
      },
      client,
    );

    // 3c. Create visa info row
    await userRepo.createVisaInfo(
      {
        userId,
        visaType: visaType || "Standard Work Visa",
        visaExpiry:
          visaExpiry ||
          new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        businessUnit: business_unit,
      },
      client,
    );

    // 4. Grant default roles for OFFICER
    if (userRole === "OFFICER") {
      await userRepo.grantDefaultOfficerRoles(userId, client);
    }

    // 5. Sync to Stream Chat (inside transaction — rolls back if Stream fails)
    await syncUserToStream(userId, client);

    // 6. Generate Stream token
    const streamClient = new StreamClient(env.stream.apiKey, env.stream.apiSecret);
    const streamToken = streamClient.generateUserToken({
      user_id: String(userId),
      validity_period_hs: env.stream.tokenValidityHours,
    });

    await client.query("COMMIT");

    // 7. Send welcome email — fire-and-forget (never blocks the response)
    emailService
      .newRegistration(email, "Welcome to HoRenSo+", firstName, password, env.app.frontendUrl)
      .catch((err) => console.error("[RegisterService] Welcome email failed:", err));

    return {
      user: { id: userId, email, role: userRole },
      streamToken,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    // Re-throw — controller passes to errorHandler
    // PostgreSQL duplicate email (23505) is handled by errorHandler directly
    throw err;
  } finally {
    client.release();
  }
}
