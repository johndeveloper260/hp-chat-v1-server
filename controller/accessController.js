/**
 * Access Controller
 *
 * Responsibilities: parse request → call service → send response.
 * No SQL, no business logic. All errors propagate via next(err).
 */
import * as accessService from "../services/accessService.js";
import { getApiMessage } from "../utils/notificationTranslations.js";

const lang = (req) => req.user?.preferred_language || "en";

// ─────────────────────────────────────────────────────────────────────────────

export const getUsers = async (req, res, next) => {
  try {
    const { search = "" } = req.query;
    const result = await accessService.getUsers(search);
    res.json(result);
  } catch (err) { next(err); }
};

export const getAllRoleDefinitions = async (req, res, next) => {
  try {
    const result = await accessService.getAllRoleDefinitions();
    res.json(result);
  } catch (err) { next(err); }
};

export const getUserRoles = async (req, res, next) => {
  try {
    const result = await accessService.getUserRoles(req.params.userId);
    res.json(result);
  } catch (err) { next(err); }
};

export const assignRole = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { role_name } = req.body;
    await accessService.assignRole(userId, role_name, req.user.id);
    res.json({
      success: true,
      message: getApiMessage("access_role_assigned", lang(req), { role: role_name }),
    });
  } catch (err) { next(err); }
};

export const revokeRole = async (req, res, next) => {
  try {
    const { userId, roleName } = req.params;
    await accessService.revokeRole(userId, roleName);
    res.json({
      success: true,
      message: getApiMessage("access_role_revoked", lang(req), { role: roleName }),
    });
  } catch (err) { next(err); }
};

export const replaceUserRoles = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { roles } = req.body;
    await accessService.replaceUserRoles(userId, roles, req.user.id);
    res.json({
      success: true,
      message: getApiMessage("access_roles_updated", lang(req)),
    });
  } catch (err) { next(err); }
};
