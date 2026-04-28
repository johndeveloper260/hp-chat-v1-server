/**
 * Assessment Controller — thin HTTP adapter.
 */
import * as service from "../services/assessmentService.js";

export const listAssessments = async (req, res, next) => {
  try {
    const data = await service.listAssessments(req.user.id, req.user.business_unit, req.user.userType);
    res.status(200).json(data);
  } catch (err) { next(err); }
};

export const getAssessment = async (req, res, next) => {
  try {
    const isOfficer = ["OFFICER", "ADMIN"].includes((req.user.userType || "").toUpperCase());
    // Officers (coordinators/admins) get full data including correct_answer for the builder.
    // Learners get a sanitized DTO: no correct_answer, split attempt fields.
    const data = isOfficer
      ? await service.getAssessment(req.params.id, req.user.business_unit)
      : await service.getAssessmentForUser(req.params.id, req.user.id, req.user.business_unit);
    res.status(200).json(data);
  } catch (err) { next(err); }
};

export const createAssessment = async (req, res, next) => {
  try {
    const data = await service.createAssessment(req.user.id, req.user.business_unit, req.body);
    res.status(201).json(data);
  } catch (err) { next(err); }
};

export const updateAssessment = async (req, res, next) => {
  try {
    const data = await service.updateAssessment(req.params.id, req.user.id, req.user.business_unit, req.body);
    res.status(200).json(data);
  } catch (err) { next(err); }
};

export const deleteAssessment = async (req, res, next) => {
  try {
    await service.deleteAssessment(req.params.id, req.user.business_unit);
    res.status(200).json({ message: "Assessment deleted." });
  } catch (err) { next(err); }
};

export const togglePublish = async (req, res, next) => {
  try {
    const data = await service.togglePublish(req.params.id, req.user.business_unit);
    res.status(200).json(data);
  } catch (err) { next(err); }
};

export const importQuestions = async (req, res, next) => {
  try {
    const data = await service.importQuestions(req.params.id, req.user.business_unit, req.body.questions);
    res.status(200).json(data);
  } catch (err) { next(err); }
};

export const getResults = async (req, res, next) => {
  try {
    const filters = {
      country: req.query.country || null,
      company: req.query.company || null,
      batch: req.query.batch || null,
      visa_type: req.query.visa_type || null,
    };
    const data = await service.getResults(req.params.id, req.user.business_unit, filters);
    res.status(200).json(data);
  } catch (err) { next(err); }
};

export const startAttempt = async (req, res, next) => {
  try {
    const force = req.query.force === "true";
    const data = await service.startAttempt(req.params.id, req.user.id, req.user.business_unit, req.user.userType, force);
    res.status(201).json(data);
  } catch (err) { next(err); }
};

export const autoSave = async (req, res, next) => {
  try {
    const data = await service.autoSave(req.params.attemptId, req.user.id, req.body);
    res.status(200).json(data);
  } catch (err) { next(err); }
};

export const submitAttempt = async (req, res, next) => {
  try {
    const data = await service.submitAttempt(req.params.attemptId, req.user.id, req.body);
    res.status(200).json(data);
  } catch (err) { next(err); }
};

export const getMyHistory = async (req, res, next) => {
  try {
    const data = await service.getMyHistory(req.user.id, req.user.business_unit);
    res.status(200).json(data);
  } catch (err) { next(err); }
};
