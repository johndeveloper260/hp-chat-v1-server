/**
 * Task Team Controller
 *
 * Thin HTTP adapters for team management.
 */
import * as teamService from "../services/taskTeamService.js";

// GET /tasks/teams
export const listTeams = async (req, res, next) => {
  try {
    const { business_unit: bu } = req.user;
    const teams = await teamService.listTeams(bu);
    res.json(teams);
  } catch (err) {
    next(err);
  }
};

// GET /tasks/teams/:id
export const getTeam = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { business_unit: bu } = req.user;
    const team = await teamService.getTeam({ id, bu });
    res.json(team);
  } catch (err) {
    next(err);
  }
};

// POST /tasks/teams
export const createTeam = async (req, res, next) => {
  try {
    const { id: userId, business_unit: bu } = req.user;
    const { name, description } = req.body;
    const team = await teamService.createTeam({ name, description, bu, userId });
    res.status(201).json(team);
  } catch (err) {
    next(err);
  }
};

// PATCH /tasks/teams/:id
export const updateTeam = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { id: userId, business_unit: bu, userType } = req.user;
    const team = await teamService.updateTeam({ id, data: req.body, bu, userId, userType });
    res.json(team);
  } catch (err) {
    next(err);
  }
};

// DELETE /tasks/teams/:id
export const deleteTeam = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { id: userId, business_unit: bu, userType } = req.user;
    await teamService.deleteTeam({ id, bu, userId, userType });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// POST /tasks/teams/:id/members
export const addMember = async (req, res, next) => {
  try {
    const { id: teamId } = req.params;
    const { business_unit: bu } = req.user;
    const { user_id } = req.body;
    const result = await teamService.addMember({ teamId, userId: user_id, bu });
    res.status(201).json(result ?? { success: true });
  } catch (err) {
    next(err);
  }
};

// DELETE /tasks/teams/:id/members/:userId
export const removeMember = async (req, res, next) => {
  try {
    const { id: teamId, userId } = req.params;
    const { business_unit: bu } = req.user;
    await teamService.removeMember({ teamId, userId, bu });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
