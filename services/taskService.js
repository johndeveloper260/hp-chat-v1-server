/**
 * Task Service
 *
 * Business logic for HoRenSo tasks and sub-tasks.
 *
 * Access control:
 *   - listTasks: regular users see tasks they created/are assigned to/are team members of;
 *                OFFICER and ADMIN see all tasks in BU.
 *   - getTask: creator, assignee, team member, or OFFICER/ADMIN.
 *   - createTask: any authenticated user.
 *   - createSubtask: OFFICER/ADMIN only.
 *   - updateTask: creator or assignee (or OFFICER/ADMIN).
 *   - moveTask: any user with access to the task.
 *   - deleteTask: creator only.
 *   - completeSubtask: only the assigned user (or OFFICER/ADMIN to reset).
 */
import { getPool } from "../config/getPool.js";
import * as taskRepo from "../repositories/taskRepository.js";
import * as notifRepo from "../repositories/notificationRepository.js";
import { sendNotificationToUser } from "./notificationService.js";
import { formatNotification } from "../utils/notificationTranslations.js";
import { NotFoundError, ForbiddenError } from "../errors/AppError.js";
import { deleteFromS3 } from "../utils/s3Client.js";

const isPrivileged = (userType) =>
  ["OFFICER", "ADMIN"].includes((userType || "").toUpperCase());

// ─── Helpers ───────────────────────────────────────────────────────────────────

const getUserLanguage = async (userId, bu) => {
  const { rows } = await getPool().query(
    `SELECT language FROM v4.user_account_tbl WHERE id = $1 AND business_unit = $2`,
    [userId, bu],
  );
  return rows[0]?.language ?? "en";
};

// ─── List (Kanban board — parent tasks only) ──────────────────────────────────

export const listTasks = async ({ bu, filters, userId, userType }) => {
  const userOnly = !isPrivileged(userType);
  return taskRepo.findTasks(bu, { ...filters, userOnly, userId });
};

// ─── Get single task ──────────────────────────────────────────────────────────

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

// ─── Create parent task ───────────────────────────────────────────────────────

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

    return taskRepo.findTaskById(task.id, bu);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// ─── Create sub-task ──────────────────────────────────────────────────────────

export const createSubtask = async ({ parentId, body, userId, bu, userType }) => {
  if (!isPrivileged(userType)) {
    throw new ForbiddenError("only_officers_can_create_subtasks");
  }

  const parent = await taskRepo.findTaskById(parentId, bu);
  if (!parent) throw new NotFoundError("task_not_found");

  const { assignee_ids, ...taskData } = body;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const subtask = await taskRepo.insertTask(
      {
        ...taskData,
        created_by: userId,
        business_unit: bu,
        parent_task_id: parentId,
        column_id: null,
        team_id: parent.team_id ?? null,
        col_order: 0,
      },
      client,
    );

    await taskRepo.insertTaskAssignees(subtask.id, assignee_ids, client);

    await client.query("COMMIT");

    // Notify assignees (best-effort, outside transaction)
    setImmediate(() => _notifySubtaskAssigned(assignee_ids, subtask, parent, bu));

    return taskRepo.findTaskById(subtask.id, bu);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

const _notifySubtaskAssigned = async (assigneeIds, subtask, parent, bu) => {
  for (const uid of assigneeIds) {
    try {
      const lang  = await getUserLanguage(uid, bu);
      const title = formatNotification("subtask_assigned_title", lang);
      const body  = formatNotification("subtask_assigned_body", lang, { title: subtask.title });

      await notifRepo.insertNotificationHistory(uid, title, body, "tasks", subtask.id, bu);
      await sendNotificationToUser(uid, title, body, {
        type: "tasks",
        taskId: subtask.id,
        parentTaskId: parent.id,
        parentTaskTitle: parent.title,
      }, bu);
    } catch (err) {
      console.error(`Subtask assign notification failed for user ${uid}:`, err);
    }
  }
};

// ─── List sub-tasks for a parent ──────────────────────────────────────────────

export const listSubtasks = async ({ parentId, bu, userId, userType }) => {
  const parent = await taskRepo.findTaskById(parentId, bu);
  if (!parent) throw new NotFoundError("task_not_found");

  if (!isPrivileged(userType)) {
    const relation = await taskRepo.isUserRelatedToTask(parentId, userId);
    if (!relation || (!relation.is_creator && !relation.is_assignee && !relation.is_team_member)) {
      throw new ForbiddenError("cannot_access_task");
    }
  }

  return taskRepo.findSubtasksByParent(parentId, bu);
};

// ─── My sub-tasks (for RN App members) ───────────────────────────────────────

export const getMySubtasks = async ({ userId, bu }) => {
  return taskRepo.findMySubtasks(userId, bu);
};

// ─── User search for assignee picker (officer only) ──────────────────────────

export const searchTaskUsers = async ({ bu, filters, userType }) => {
  if (!isPrivileged(userType)) {
    throw new ForbiddenError("only_officers_can_search_users");
  }
  return taskRepo.searchTaskUsers(bu, filters);
};

// ─── Complete / uncomplete sub-task ──────────────────────────────────────────

export const completeSubtask = async ({ id, userId, bu, userType }) => {
  const subtask = await taskRepo.findTaskById(id, bu);
  if (!subtask) throw new NotFoundError("task_not_found");
  if (!subtask.parent_task_id) throw new ForbiddenError("not_a_subtask");

  if (!isPrivileged(userType)) {
    const relation = await taskRepo.isUserRelatedToTask(id, userId);
    if (!relation?.is_assignee) {
      throw new ForbiddenError("only_assignee_can_complete");
    }
  }

  const updated = await taskRepo.completeSubtask(id, userId, bu);
  if (!updated) throw new NotFoundError("task_not_found");

  if (updated.completed_at) {
    setImmediate(() => _notifySubtaskCompletion(updated, userId, bu));
  }

  return taskRepo.findTaskById(id, bu);
};

const _notifySubtaskCompletion = async (updated, completerId, bu) => {
  try {
    const parentId = updated.parent_task_id;
    const parent   = await taskRepo.findTaskById(parentId, bu);
    if (!parent) return;

    const { rows: userRows } = await getPool().query(
      `SELECT first_name, last_name FROM v4.user_profile_tbl WHERE user_id = $1`,
      [completerId],
    );
    const completerName = userRows[0]
      ? `${userRows[0].first_name} ${userRows[0].last_name}`
      : "Someone";

    const creatorId = parent.created_by;
    const lang      = await getUserLanguage(creatorId, bu);

    const title = formatNotification("subtask_completed_title", lang);
    const body  = formatNotification("subtask_completed_body", lang, {
      name:  completerName,
      title: updated.title,
    });

    await notifRepo.insertNotificationHistory(creatorId, title, body, "tasks", parentId, bu);
    await sendNotificationToUser(creatorId, title, body, {
      type: "tasks",
      taskId: updated.id,
      parentTaskId: parentId,
    }, bu);

    // Check if all subtasks are now complete
    const progress = await taskRepo.getParentProgress(parentId, bu);
    if (progress.total > 0 && progress.completed === progress.total) {
      const allDoneTitle = formatNotification("all_subtasks_done_title", lang);
      const allDoneBody  = formatNotification("all_subtasks_done_body", lang, {
        title: parent.title,
      });
      await notifRepo.insertNotificationHistory(creatorId, allDoneTitle, allDoneBody, "tasks", parentId, bu);
      await sendNotificationToUser(creatorId, allDoneTitle, allDoneBody, {
        type: "tasks",
        parentTaskId: parentId,
        allDone: true,
      }, bu);
    }
  } catch (err) {
    console.error("Subtask completion notification failed:", err);
  }
};

// ─── Update ───────────────────────────────────────────────────────────────────

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

// ─── Move ─────────────────────────────────────────────────────────────────────

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

// ─── Delete ───────────────────────────────────────────────────────────────────

export const deleteTask = async ({ id, userId, bu }) => {
  const task = await taskRepo.findTaskById(id, bu);
  if (!task) throw new NotFoundError("task_not_found");

  if (String(task.created_by) !== String(userId)) {
    throw new ForbiddenError("cannot_delete_task");
  }

  const pool = getPool();

  // Collect S3 keys before the transaction — S3 deletes can't be rolled back,
  // so we gather the keys first and delete from S3 only after a successful commit.
  const { rows: subtaskAttRows } = await pool.query(
    `SELECT sa.s3_key
     FROM v4.shared_attachments sa
     WHERE sa.relation_type = 'subtask'
       AND sa.relation_id IN (
         SELECT t.id::text FROM v4.tasks t WHERE t.parent_task_id = $1::uuid
       )`,
    [id],
  );
  const { rows: taskAttRows } = await pool.query(
    `SELECT s3_key FROM v4.shared_attachments
     WHERE relation_type = 'task' AND relation_id = $1::text`,
    [id],
  );
  const s3Keys = [...subtaskAttRows, ...taskAttRows].map((r) => r.s3_key);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Subtask cascade ──────────────────────────────────────────────────────
    await client.query(
      `DELETE FROM v4.task_assignees
       WHERE task_id IN (SELECT id FROM v4.tasks WHERE parent_task_id = $1::uuid)`,
      [id],
    );
    await client.query(
      `DELETE FROM v4.shared_comments
       WHERE relation_type = 'subtask'
         AND relation_id IN (SELECT row_id FROM v4.tasks WHERE parent_task_id = $1::uuid)`,
      [id],
    );
    await client.query(
      `DELETE FROM v4.shared_attachments
       WHERE relation_type = 'subtask'
         AND relation_id IN (SELECT id::text FROM v4.tasks WHERE parent_task_id = $1::uuid)`,
      [id],
    );
    await client.query(
      `DELETE FROM v4.tasks WHERE parent_task_id = $1::uuid`,
      [id],
    );

    // ── Parent task cascade ──────────────────────────────────────────────────
    await taskRepo.deleteTaskAssignees(id, client);
    await client.query(
      `DELETE FROM v4.shared_comments
       WHERE relation_type = 'task' AND relation_id = $1`,
      [task.row_id],
    );
    await client.query(
      `DELETE FROM v4.shared_attachments
       WHERE relation_type = 'task' AND relation_id = $1::text`,
      [id],
    );
    await taskRepo.deleteTask(id, bu, client);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Delete S3 files after commit — best-effort, log failures without throwing
  if (s3Keys.length > 0) {
    const results = await Promise.allSettled(s3Keys.map((key) => deleteFromS3(key)));
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`Failed to delete S3 key ${s3Keys[i]}:`, r.reason);
      }
    });
  }
};
