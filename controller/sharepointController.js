/**
 * Sharepoint Controller
 *
 * Thin HTTP adapters — parse req → call service → send res → next(err).
 * All business logic lives in services/sharepointService.js.
 *
 * The old controller constructed its own S3Client — replaced by the
 * shared singleton in utils/s3Client.js via the service layer.
 */
import * as spService from "../services/sharepointService.js";

// ─── Folders ──────────────────────────────────────────────────────────────────

export const getFolders = async (req, res, next) => {
  try {
    const { userType, company: userCompany, business_unit: businessUnit } = req.user;
    const { parent_id } = req.query;
    const result = await spService.getFolders({ userType, userCompany, businessUnit, parent_id });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const createFolder = async (req, res, next) => {
  try {
    const { name, parent_id, company_ids } = req.body;
    const { id: userId, userType, business_unit: businessUnit } = req.user;
    const folder = await spService.createFolder({ name, parent_id, company_ids, userId, userType, businessUnit });
    res.status(201).json(folder);
  } catch (err) {
    next(err);
  }
};

export const updateFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, company_ids } = req.body;
    const { userType, business_unit: businessUnit } = req.user;
    const folder = await spService.updateFolder({ id, name, company_ids, userType, businessUnit });
    res.json(folder);
  } catch (err) {
    next(err);
  }
};

export const deleteFolder = async (req, res, next) => {
  try {
    const result = await spService.deleteFolder({
      id:           req.params.id,
      userType:     req.user.userType,
      businessUnit: req.user.business_unit,
    });
    res.json({ message: "Folder deleted successfully", ...result });
  } catch (err) {
    next(err);
  }
};

// ─── Files ────────────────────────────────────────────────────────────────────

export const generateUploadUrl = async (req, res, next) => {
  try {
    const { fileName, fileType, folderId } = req.body;
    const result = await spService.generateUploadUrl({
      fileName, fileType, folderId,
      businessUnit: req.user.business_unit,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const confirmFileUpload = async (req, res, next) => {
  try {
    const { folder_id, display_name, s3_key, s3_bucket, file_type, file_size } = req.body;
    const { id: userId, business_unit: businessUnit } = req.user;
    const file = await spService.confirmFileUpload({
      folder_id, display_name, s3_key, s3_bucket,
      file_type, file_size, userId, businessUnit,
    });
    res.status(201).json(file);
  } catch (err) {
    next(err);
  }
};

export const getFileViewUrl = async (req, res, next) => {
  try {
    const url = await spService.getFileViewUrl({
      id:           req.params.id,
      businessUnit: req.user.business_unit,
    });
    res.json({ url });
  } catch (err) {
    next(err);
  }
};

export const deleteFile = async (req, res, next) => {
  try {
    await spService.deleteFile({
      id:           req.params.id,
      userType:     req.user.userType,
      businessUnit: req.user.business_unit,
    });
    res.json({ message: "File deleted successfully" });
  } catch (err) {
    next(err);
  }
};

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

export const getBreadcrumb = async (req, res, next) => {
  try {
    const result = await spService.getBreadcrumb({
      folderId:     req.params.folderId,
      businessUnit: req.user.business_unit,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};
