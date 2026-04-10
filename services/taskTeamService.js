/**
 * Task Team Service
 *
 * Business logic for HoRenSo task teams and membership.
 */
import * as teamRepo from "../repositories/taskTeamRepository.js";
import * as columnRepo from "../repositories/taskColumnRepository.js";
import { NotFoundError, ForbiddenError } from "../errors/AppError.js";

// ─── List ──────────────────────────────────────────────────────────────────────

export const listTeams = async (bu) => {
  return teamRepo.findTeamsByBU(bu);
};

// ─── Get single team ───────────────────────────────────────────────────────────

export const getTeam = async ({ id, bu }) => {
  const team = await teamRepo.findTeamById(id, bu);
  if (!team) throw new NotFoundError("team_not_found");
  return team;
};

// ─── Create ────────────────────────────────────────────────────────────────────

export const createTeam = async ({ name, description, bu, userId }) => {
  const team = await teamRepo.insertTeam({
    name,
    description: description ?? null,
    business_unit: bu,
    created_by: userId,
  });
  // Seed default Kanban columns for the new team
  await columnRepo.insertDefaultColumns("team", team.id, bu);
  return team;
};

// ─── Update ────────────────────────────────────────────────────────────────────

export const updateTeam = async ({ id, data, bu, userId, userType }) => {
  const existing = await teamRepo.findTeamById(id, bu);
  if (!existing) throw new NotFoundError("team_not_found");

  const isPrivileged = ["OFFICER", "ADMIN"].includes((userType || "").toUpperCase());
  if (!isPrivileged && String(existing.created_by) !== String(userId)) {
    throw new ForbiddenError("permission_denied");
  }

  const updated = await teamRepo.updateTeam(id, data, bu);
  if (!updated) return existing;
  return updated;
};

// ─── Delete ────────────────────────────────────────────────────────────────────

export const deleteTeam = async ({ id, bu, userId, userType }) => {
  const existing = await teamRepo.findTeamById(id, bu);
  if (!existing) throw new NotFoundError("team_not_found");

  const isPrivileged = ["OFFICER", "ADMIN"].includes((userType || "").toUpperCase());
  if (!isPrivileged && String(existing.created_by) !== String(userId)) {
    throw new ForbiddenError("permission_denied");
  }

  await teamRepo.deleteTeam(id, bu);
};

// ─── Members ───────────────────────────────────────────────────────────────────

export const addMember = async ({ teamId, userId, bu }) => {
  const team = await teamRepo.findTeamById(teamId, bu);
  if (!team) throw new NotFoundError("team_not_found");

  const result = await teamRepo.addMember(teamId, userId);
  return result;
};

export const removeMember = async ({ teamId, userId, bu }) => {
  const team = await teamRepo.findTeamById(teamId, bu);
  if (!team) throw new NotFoundError("team_not_found");

  await teamRepo.removeMember(teamId, userId);
};
