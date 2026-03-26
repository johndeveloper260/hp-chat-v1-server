/**
 * Visa List Controller
 *
 * Responsibilities: parse request → call service → send response.
 * No SQL, no business logic. All errors propagate via next(err).
 */
import * as visaListService from "../services/visaListService.js";
import { getApiMessage } from "../utils/notificationTranslations.js";

const lang = (req) => req.user?.preferred_language || "en";

export const getVisaListAll = async (req, res, next) => {
  try {
    const result = await visaListService.getVisaListAll(req.user.business_unit);
    res.json(result);
  } catch (err) { next(err); }
};

export const createVisaList = async (req, res, next) => {
  try {
    const record = await visaListService.createVisaList(req.body, req.user.business_unit);
    res.status(201).json({
      message: getApiMessage("visa_list_created", lang(req)),
      record,
    });
  } catch (err) { next(err); }
};

export const updateVisaList = async (req, res, next) => {
  try {
    const record = await visaListService.updateVisaList(
      req.params.id,
      req.user.business_unit,
      req.body,
    );
    res.json({ message: getApiMessage("visa_list_updated", lang(req)), record });
  } catch (err) { next(err); }
};

export const deleteVisaList = async (req, res, next) => {
  try {
    await visaListService.deleteVisaList(req.params.id, req.user.business_unit);
    res.json({ success: true, message: getApiMessage("visa_list_deleted", lang(req)) });
  } catch (err) { next(err); }
};
