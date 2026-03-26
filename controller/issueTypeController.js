/**
 * Issue Type Controller
 *
 * Responsibilities: parse request → call service → send response.
 * No SQL, no business logic. All errors propagate via next(err).
 */
import * as issueTypeService from "../services/issueTypeService.js";
import { getApiMessage } from "../utils/notificationTranslations.js";

const lang = (req) => req.user?.preferred_language || "en";

export const getIssueTypeList = async (req, res, next) => {
  try {
    const result = await issueTypeService.getIssueTypeList(req.user.business_unit);
    res.json(result);
  } catch (err) { next(err); }
};

export const createIssueType = async (req, res, next) => {
  try {
    const record = await issueTypeService.createIssueType(req.body, req.user.business_unit, req.user.id);
    res.status(201).json({ message: getApiMessage("issue_type_created", lang(req)), record });
  } catch (err) { next(err); }
};

export const updateIssueType = async (req, res, next) => {
  try {
    const record = await issueTypeService.updateIssueType(
      req.params.code,
      req.user.business_unit,
      req.body,
      req.user.id,
    );
    res.json({ message: getApiMessage("issue_type_updated", lang(req)), record });
  } catch (err) { next(err); }
};

export const deleteIssueType = async (req, res, next) => {
  try {
    await issueTypeService.deleteIssueType(req.params.code, req.user.business_unit);
    res.json({ success: true, message: getApiMessage("issue_type_deleted", lang(req)) });
  } catch (err) { next(err); }
};
