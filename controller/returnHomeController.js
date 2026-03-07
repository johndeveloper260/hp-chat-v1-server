/**
 * Return Home Controller — thin HTTP adapter
 *
 * The previous cross-controller import of deleteFromS3 from
 * attachmentController is resolved by returnHomeService importing it from
 * utils/s3Client.js directly. This controller has no cross-module dependencies
 * beyond its own service.
 */
import * as returnHomeService from "../services/returnHomeService.js";

export const searchReturnHome = async (req, res, next) => {
  try {
    const rows = await returnHomeService.searchReturnHome(req.user, req.query);
    res.json(rows);
  } catch (err) { next(err); }
};

export const createReturnHome = async (req, res, next) => {
  try {
    const row = await returnHomeService.createReturnHome(
      req.body,
      req.user.id,
      req.user.business_unit,
    );
    res.status(201).json(row);
  } catch (err) { next(err); }
};

export const getReturnHomeById = async (req, res, next) => {
  try {
    const lang = req.user.preferred_language || "en";
    const data = await returnHomeService.getReturnHomeById(
      req.params.id,
      req.user.business_unit,
      lang,
    );
    res.json(data);
  } catch (err) { next(err); }
};

export const updateReturnHome = async (req, res, next) => {
  try {
    const data = await returnHomeService.updateReturnHome(
      req.params.id,
      req.body,
      req.user.id,
      req.user.business_unit,
    );
    res.json(data);
  } catch (err) { next(err); }
};

export const approveReturnHome = async (req, res, next) => {
  try {
    await returnHomeService.approveReturnHome(req.params.id, req.body, req.user);
    res.json({ success: true, message: `Application ${req.body.status} successfully` });
  } catch (err) { next(err); }
};

export const deleteReturnHome = async (req, res, next) => {
  try {
    await returnHomeService.deleteReturnHome(req.params.id, req.user.business_unit);
    res.json({
      success: true,
      message: "Return home record and all related data deleted successfully",
    });
  } catch (err) { next(err); }
};
