/**
 * Access Service
 *
 * All role-assignment business logic.
 * No req/res — throws AppError subclasses on failure.
 */
import { getPool } from "../config/getPool.js";
import * as accessRepo from "../repositories/accessRepository.js";
import {
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from "../errors/AppError.js";

// ─────────────────────────────────────────────────────────────────────────────
// Internal guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifies that the target user exists, is user_type = OFFICER,
 * and belongs to the same business unit as the requesting officer.
 * Accepts an optional transaction client so it can run inside a BEGIN/COMMIT block.
 */
const assertTargetIsOfficerInBU = async (userId, officerBU, client) => {
  const { rows } = await accessRepo.findUserTypeById(userId, client);
  if (rows.length === 0) {
    throw new NotFoundError("user_not_found");
  }
  if ((rows[0].user_type || "").toUpperCase() !== "OFFICER") {
    throw new UnprocessableError(
      "access_officer_only",
      "api_errors.access.officer_only",
    );
  }
  if (rows[0].business_unit !== officerBU) {
    throw new ForbiddenError();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

export const getUsers = async (search = "", businessUnit) => {
  const { rows } = await accessRepo.findOfficerUsers(search, businessUnit);
  return { users: rows };
};

export const getAllRoleDefinitions = async () => {
  const { rows } = await accessRepo.findAllRoleDefinitions();
  return { roles: rows };
};

export const getUserRoles = async (userId, officerBU) => {
  await assertTargetIsOfficerInBU(userId, officerBU);
  const { rows } = await accessRepo.findUserRolesList(userId);
  return { roles: rows };
};

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export const assignRole = async (userId, roleName, grantedBy, officerBU) => {
  await assertTargetIsOfficerInBU(userId, officerBU);
  await accessRepo.insertUserRole(userId, roleName, grantedBy);
};

export const revokeRole = async (userId, roleName, officerBU) => {
  await assertTargetIsOfficerInBU(userId, officerBU);
  await accessRepo.deleteUserRole(userId, roleName);
};

/**
 * Atomic full replacement — DELETE all current roles then INSERT the new set.
 * Runs inside a single PostgreSQL transaction.
 */
export const replaceUserRoles = async (userId, roles, grantedBy, officerBU) => {
  if (!Array.isArray(roles)) {
    throw new ValidationError(
      "access_roles_must_be_array",
      "api_errors.access.roles_must_be_array",
    );
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertTargetIsOfficerInBU(userId, officerBU, client);
    await accessRepo.deleteAllUserRoles(userId, client);
    for (const roleName of roles) {
      await accessRepo.insertUserRole(userId, roleName, grantedBy, client);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
