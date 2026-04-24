/**
 * Task Column Controller
 *
 * Thin HTTP adapters for Kanban column management.
 *
 * Owner context is derived from JWT + query params:
 *   ?owner_type=user               → personal columns (owner_id = jwt user id)
 *   ?owner_type=team&owner_id=UUID → team columns
 *
 * Defaults to owner_type=user when the param is absent.
 */
import * as columnService from "../services/taskColumnService.js";
import * as teamRepo from "../repositories/taskTeamRepository.js";
import { ForbiddenError } from "../errors/AppError.js";

const extractOwner = (req) => {
  const ownerType = req.query.owner_type ?? "user";
  const ownerId   = ownerType === "user" ? String(req.user.id) : req.query.owner_id;
  return { ownerType, ownerId };
};

const assertTeamMember = async (teamId, userId) => {
  const isMember = await teamRepo.isTeamMember(teamId, String(userId));
  if (!isMember) throw new ForbiddenError("not_a_team_member");
};

// GET /tasks/columns
export const listColumns = async (req, res, next) => {
  try {
    const { id: userId, business_unit: bu } = req.user;
    const { ownerType, ownerId } = extractOwner(req);
    if (ownerType === "team") await assertTeamMember(ownerId, userId);
    const columns = await columnService.listColumns({ ownerType, ownerId, bu });
    res.json(columns);
  } catch (err) {
    next(err);
  }
};

// POST /tasks/columns
export const createColumn = async (req, res, next) => {
  try {
    const { id: userId, business_unit: bu } = req.user;
    const { ownerType, ownerId } = extractOwner(req);
    if (ownerType === "team") await assertTeamMember(ownerId, userId);
    const { label, color, col_order } = req.body;
    const column = await columnService.createColumn({
      label, color, col_order, bu, ownerType, ownerId,
    });
    res.status(201).json(column);
  } catch (err) {
    next(err);
  }
};

// PATCH /tasks/columns/:id
export const updateColumn = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { id: userId, business_unit: bu } = req.user;
    const { ownerType, ownerId } = extractOwner(req);
    if (ownerType === "team") await assertTeamMember(ownerId, userId);
    const column = await columnService.updateColumn({
      id, data: req.body, ownerType, ownerId, bu,
    });
    res.json(column);
  } catch (err) {
    next(err);
  }
};

// PATCH /tasks/columns/reorder
export const reorderColumns = async (req, res, next) => {
  try {
    const { id: userId, business_unit: bu } = req.user;
    const { ownerType, ownerId } = extractOwner(req);
    if (ownerType === "team") await assertTeamMember(ownerId, userId);
    const { ids } = req.body;
    const columns = await columnService.reorderColumns({ ids, ownerType, ownerId, bu });
    res.json(columns);
  } catch (err) {
    next(err);
  }
};

// DELETE /tasks/columns/:id
export const deleteColumn = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { id: userId, business_unit: bu } = req.user;
    const { ownerType, ownerId } = extractOwner(req);
    if (ownerType === "team") await assertTeamMember(ownerId, userId);
    await columnService.deleteColumn({ id, ownerType, ownerId, bu });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
