/**
 * Chat Template Controller
 *
 * Responsibilities: parse request → call service → send response.
 * No SQL, no business logic. All errors propagate via next(err).
 */
import * as service from "../services/chatTemplateService.js";

// ─────────────────────────────────────────────────────────────────────────────

export const getActiveTemplates = async (req, res, next) => {
  try {
    const result = await service.getActiveTemplates(req.user.business_unit);
    res.json(result);
  } catch (err) { next(err); }
};

export const getAllTemplates = async (req, res, next) => {
  try {
    const result = await service.getAllTemplates(req.user.business_unit);
    res.json(result);
  } catch (err) { next(err); }
};

export const createTemplate = async (req, res, next) => {
  try {
    const result = await service.createTemplate(
      req.body,
      req.user.business_unit,
      req.user.id,
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
};

export const updateTemplate = async (req, res, next) => {
  try {
    const result = await service.updateTemplate(
      req.params.id,
      req.user.business_unit,
      req.body,
      req.user.id,
    );
    res.json(result);
  } catch (err) { next(err); }
};

export const deleteTemplate = async (req, res, next) => {
  try {
    await service.deleteTemplate(req.params.id, req.user.business_unit);
    res.json({ success: true });
  } catch (err) { next(err); }
};

export const reorderTemplates = async (req, res, next) => {
  try {
    await service.reorderTemplates(req.body.updates, req.user.business_unit);
    res.json({ success: true });
  } catch (err) { next(err); }
};
