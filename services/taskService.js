/**
 * Task Service
 *
 * Business logic for HoRenSo tasks.
 * Access control:
 *   - listTasks: regular users see tasks they created/are assigned to/are team members of;
 *                OFFICER and ADMIN see all tasks in BU.
 *   - getTask: creator, assignee, team member, or OFFICER/ADMIN.
 *   - createTask: any authenticated user.
 *   - updateTask: creator or assignee (or OFFICER/ADMIN).
 *   - moveTask: any user with access to the task.
 *   - deleteTask: creator only.
 */
import { getPool } from "../config/getPool.js";
import * as taskRepo from "../repositories/taskRepository.js";
import { NotFoundError, ForbiddenError } from "../errors/AppError.js";

const isPrivileged = (userType) =>
  ["OFFICER", "ADMIN"].includes((userType || "").toUpperCase());

// ─── List ──────────────────────────────────────────────────────────────────────

export const listTasks = async ({ bu, filters, userId, userType }) => {
  const userOnly = !isPrivileged(userType);
  return taskRepo.findTasks(bu, { ...filters, userOnly, userId });
};

// ─── Get single ────────────────────────────────────────────────────────────────

export const getTask = async ({ id, bu, userId, userType }) => {
  const task = await taskRepo.findTaskById(id, bu);
  if (!task) throw new NotFoundError("task_not_found");

  if (isPrivileged(userType)) return task;

  const relation = await taskRepo.isUserRelatedToTask(id, userId);
  if (!relation || (!relation.is_creator && !relation.is_assignee && !relation.is_team_member)) {
    throw new ForbiddenError("cannot_access_task");
  }

  return task;
};

// ─── Create ────────────────────────────────────────────────────────────────────

export const createTask = async ({ body, userId, bu }) => {
  const { assignee_ids = [], ...taskData } = body;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const task = await taskRepo.insertTask(
      { ...taskData, created_by: userId, business_unit: bu },
      client,
    );

    if (assignee_ids.length > 0) {
      await taskRepo.insertTaskAssignees(task.id, assignee_ids, client);
    }

    await client.query("COMMIT");

    // Return task with full assignee details
    return taskRepo.findTaskById(task.id, bu);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// ─── Update ────────────────────────────────────────────────────────────────────

export const updateTask = async ({ id, body, userId, bu, userType }) => {
  const task = await taskRepo.findTaskById(id, bu);
  if (!task) throw new NotFoundError("task_not_found");

  if (!isPrivileged(userType)) {
    const relation = await taskRepo.isUserRelatedToTask(id, userId);
    if (!relation || (!relation.is_creator && !relation.is_assignee)) {
      throw new ForbiddenError("cannot_update_task");
    }
  }

  const { assignee_ids, ...taskData } = body;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const updatableFields = ["title", "description", "category", "column_id",
                             "deadline", "remind_at", "team_id", "col_order"];
    const fieldsToPatch = {};
    for (const key of updatableFields) {
      if (key in taskData) fieldsToPatch[key] = taskData[key];
    }

    if (Object.keys(fieldsToPatch).length > 0) {
      await taskRepo.updateTask(id, fieldsToPatch, bu, client);
    }

    if (assignee_ids !== undefined) {
      await taskRepo.deleteTaskAssignees(id, client);
      if (assignee_ids.length > 0) {
        await taskRepo.insertTaskAssignees(id, assignee_ids, client);
      }
    }

    await client.query("COMMIT");

    return taskRepo.findTaskById(id, bu);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// ─── Move ──────────────────────────────────────────────────────────────────────

export const moveTask = async ({ id, body, userId, bu, userType }) => {
  const task = await taskRepo.findTaskById(id, bu);
  if (!task) throw new NotFoundError("task_not_found");

  if (!isPrivileged(userType)) {
    const relation = await taskRepo.isUserRelatedToTask(id, userId);
    if (!relation || (!relation.is_creator && !relation.is_assignee && !relation.is_team_member)) {
      throw new ForbiddenError("cannot_access_task");
    }
  }

  const { column_id, col_order } = body;
  const updated = await taskRepo.moveTask(id, column_id, col_order, bu);
  if (!updated) throw new NotFoundError("task_not_found");

  return taskRepo.findTaskById(id, bu);
};

// ─── Delete ────────────────────────────────────────────────────────────────────

export const deleteTask = async ({ id, userId, bu }) => {
  const task = await taskRepo.findTaskById(id, bu);
  if (!task) throw new NotFoundError("task_not_found");

  if (String(task.created_by) !== String(userId)) {
    throw new ForbiddenError("cannot_delete_task");
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    // Cascade: remove assignees, then delete task
    await taskRepo.deleteTaskAssignees(id, client);
    await taskRepo.deleteTask(id, bu, client);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
