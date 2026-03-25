/**
 * Sending Org Controller
 *
 * Responsibilities: parse request → call service → send response.
 * No SQL, no business logic. All errors propagate via next(err).
 */
import * as sendingOrgService from "../services/sendingOrgService.js";
import { getApiMessage } from "../utils/notificationTranslations.js";

const lang = (req) => req.user?.preferred_language || "en";

// ── Dropdown (existing) ────────────────────────────────────────────────────────

export const getSendingOrgDropdown = async (req, res, next) => {
  try {
    const result = await sendingOrgService.getSendingOrgs(
      req.query.country_origin,
      req.user.business_unit,
    );
    res.json(result);
  } catch (err) { next(err); }
};

export const getVisaDropdown = async (req, res, next) => {
  try {
    const result = await sendingOrgService.getVisaList(
      req.query.lang || "en",
      req.user.business_unit,
    );
    res.json(result);
  } catch (err) { next(err); }
};

// ── CRUD ──────────────────────────────────────────────────────────────────────

export const getSendingOrgList = async (req, res, next) => {
  try {
    const result = await sendingOrgService.getSendingOrgList(req.user.business_unit);
    res.json(result);
  } catch (err) { next(err); }
};

export const createSendingOrg = async (req, res, next) => {
  try {
    const record = await sendingOrgService.createSendingOrg(req.body, req.user.business_unit);
    res.status(201).json({
      message: getApiMessage("sending_org_created", lang(req)),
      record,
    });
  } catch (err) { next(err); }
};

export const updateSendingOrg = async (req, res, next) => {
  try {
    const record = await sendingOrgService.updateSendingOrg(
      req.params.code,
      req.user.business_unit,
      req.body,
    );
    res.json({ message: getApiMessage("sending_org_updated", lang(req)), record });
  } catch (err) { next(err); }
};

export const deleteSendingOrg = async (req, res, next) => {
  try {
    await sendingOrgService.deleteSendingOrg(req.params.code, req.user.business_unit);
    res.json({ success: true, message: getApiMessage("sending_org_deleted", lang(req)) });
  } catch (err) { next(err); }
};
