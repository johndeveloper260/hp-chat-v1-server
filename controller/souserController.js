import * as souserService from "../services/souserService.js";

export const deleteSouser = async (req, res, next) => {
  try {
    await souserService.deleteSouser(req.params.id);
    res.json({ message: "SO User deleted." });
  } catch (err) {
    next(err);
  }
};

export const getSousers = async (req, res, next) => {
  try {
    const result = await souserService.getSousers(req.user.business_unit);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const getSouserById = async (req, res, next) => {
  try {
    const result = await souserService.getSouserById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const createSouser = async (req, res, next) => {
  try {
    const record = await souserService.createSouser(req.body, req.user);
    res.status(201).json({ message: "SO User created successfully.", record });
  } catch (err) {
    next(err);
  }
};

export const updateSouser = async (req, res, next) => {
  try {
    const record = await souserService.updateSouser(req.params.id, req.body);
    res.json({ message: "SO User updated.", record });
  } catch (err) {
    next(err);
  }
};

export const toggleSouserActive = async (req, res, next) => {
  try {
    const record = await souserService.toggleSouserActive(req.params.id, req.user.id);
    res.json({ message: "Status updated.", record });
  } catch (err) {
    next(err);
  }
};

export const grantBuAccess = async (req, res, next) => {
  try {
    await souserService.grantBuAccess(req.params.id, req.body.business_unit, req.user.id);
    res.json({ message: "BU access granted." });
  } catch (err) {
    next(err);
  }
};

export const revokeBuAccess = async (req, res, next) => {
  try {
    await souserService.revokeBuAccess(req.params.id, req.params.bu, req.user.id);
    res.json({ message: "BU access revoked." });
  } catch (err) {
    next(err);
  }
};

export const updateBuAccessPermissions = async (req, res, next) => {
  try {
    const { announcements_read, announcements_write } = req.body;
    await souserService.updateBuAccessPermissions(req.params.id, req.params.bu, announcements_read, announcements_write);
    res.json({ message: "Permissions updated." });
  } catch (err) {
    next(err);
  }
};
