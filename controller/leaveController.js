/**
 * Leave Controller — thin HTTP adapter
 *
 * S3 presigned-URL resolution, email dispatch, and on-behalf logic
 * all live in leaveService. This controller only wires req/res.
 */
import * as leaveService from "../services/leaveService.js";

export const deleteLeaveTemplate = async (req, res, next) => {
  try {
    await leaveService.deleteLeaveTemplate(req.params.templateId);
    res.status(200).json({ message: "Template deleted" });
  } catch (err) { next(err); }
};

export const saveLeaveTemplate = async (req, res, next) => {
  try {
    const data = await leaveService.saveLeaveTemplate(req.user.id, req.user, req.body);
    res.status(200).json(data);
  } catch (err) { next(err); }
};

export const getCompanyTemplates = async (req, res, next) => {
  try {
    const rows = await leaveService.getCompanyTemplates(req.user, req.query);
    res.status(200).json(rows);
  } catch (err) { next(err); }
};

export const getLeaveTemplate = async (req, res, next) => {
  try {
    const template = await leaveService.getLeaveTemplate(req.user, req.query);
    res.status(200).json(template);
  } catch (err) { next(err); }
};

export const submitLeave = async (req, res, next) => {
  try {
    const submission = await leaveService.submitLeave(req.user, req.body);
    res.status(201).json({ message: "Leave submitted successfully", submission });
  } catch (err) { next(err); }
};

export const getCompanySubmissions = async (req, res, next) => {
  try {
    const rows = await leaveService.getCompanySubmissions(req.user, req.query);
    res.status(200).json(rows);
  } catch (err) { next(err); }
};

export const getMySubmissions = async (req, res, next) => {
  try {
    const rows = await leaveService.getMySubmissions(req.user.id);
    res.status(200).json(rows);
  } catch (err) { next(err); }
};
