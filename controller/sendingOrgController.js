/**
 * Sending Org Controller
 *
 * Responsibilities: parse request → call service → send response.
 * No SQL, no business logic. All errors propagate via next(err).
 */
import * as sendingOrgService from "../services/sendingOrgService.js";

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
