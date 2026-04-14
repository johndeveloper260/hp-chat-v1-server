/**
 * Task Controller
 *
 * Thin HTTP adapters for task CRUD, sub-tasks, and user search.
 */
import * as taskService from "../services/taskService.js";

// ─── Parent Tasks ─────────────────────────────────────────────────────────────

// GET /tasks
export const listTasks = async (req, res, next) => {
  try {
    const { id: userId, business_unit: bu, userType } = req.user;
    const { column_id, team_id, category, assignee_id, board } = req.query;
    const tasks = await taskService.listTasks({
      bu,
      filters: {
        column_id,
        team_id,
        category,
        assignee_id,
        personalOnly: board === "personal",
      },
      userId,
      userType,
    });
    res.json(tasks);
  } catch (err) {
    next(err);
  }
};

// GET /tasks/:id
export const getTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { id: userId, business_unit: bu, userType } = req.user;
    const task = await taskService.getTask({ id, bu, userId, userType });
    res.json(task);
  } catch (err) {
    next(err);
  }
};

// POST /tasks
export const createTask = async (req, res, next) => {
  try {
    const { id: userId, business_unit: bu } = req.user;
    const task = await taskService.createTask({ body: req.body, userId, bu });
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
};

// PATCH /tasks/:id
export const updateTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { id: userId, business_unit: bu, userType } = req.user;
    const task = await taskService.updateTask({ id, body: req.body, userId, bu, userType });
    res.json(task);
  } catch (err) {
    next(err);
  }
};

// PATCH /tasks/:id/move
export const moveTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { id: userId, business_unit: bu, userType } = req.user;
    const task = await taskService.moveTask({ id, body: req.body, userId, bu, userType });
    res.json(task);
  } catch (err) {
    next(err);
  }
};

// DELETE /tasks/:id
export const deleteTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { id: userId, business_unit: bu } = req.user;
    await taskService.deleteTask({ id, userId, bu });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// ─── Sub-tasks ────────────────────────────────────────────────────────────────

// POST /tasks/:id/subtasks
export const createSubtask = async (req, res, next) => {
  try {
    const { id: parentId } = req.params;
    const { id: userId, business_unit: bu, userType } = req.user;
    const subtask = await taskService.createSubtask({ parentId, body: req.body, userId, bu, userType });
    res.status(201).json(subtask);
  } catch (err) {
    next(err);
  }
};

// GET /tasks/:id/subtasks
export const listSubtasks = async (req, res, next) => {
  try {
    const { id: parentId } = req.params;
    const { id: userId, business_unit: bu, userType } = req.user;
    const subtasks = await taskService.listSubtasks({ parentId, bu, userId, userType });
    res.json(subtasks);
  } catch (err) {
    next(err);
  }
};

// GET /tasks/my-subtasks
export const getMySubtasks = async (req, res, next) => {
  try {
    const { id: userId, business_unit: bu } = req.user;
    const subtasks = await taskService.getMySubtasks({ userId, bu });
    res.json(subtasks);
  } catch (err) {
    next(err);
  }
};

// PATCH /tasks/:id/complete
export const completeSubtask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { id: userId, business_unit: bu, userType } = req.user;
    const subtask = await taskService.completeSubtask({ id, userId, bu, userType });
    res.json(subtask);
  } catch (err) {
    next(err);
  }
};

// ─── User search ──────────────────────────────────────────────────────────────

// GET /tasks/users/search
export const searchTaskUsers = async (req, res, next) => {
  try {
    const { business_unit: bu, userType } = req.user;
    const { user_type, country, sending_org, company, batch_no, search } = req.query;
    const users = await taskService.searchTaskUsers({
      bu,
      userType,
      filters: { user_type, country, sending_org, company, batch_no, search },
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
};
