/**
 * Sending Organisation Service
 *
 * Thin wrapper — passes parameters straight to the repository
 * and returns plain arrays to the controller.
 */
import * as sendingOrgRepo from "../repositories/sendingOrgRepository.js";

export const getSendingOrgs = async (countryOrigin, businessUnit) => {
  const { rows } = await sendingOrgRepo.findSendingOrgs(countryOrigin, businessUnit);
  return rows;
};

export const getVisaList = async (lang, businessUnit) => {
  const { rows } = await sendingOrgRepo.findVisaList(lang, businessUnit);
  return rows;
};
