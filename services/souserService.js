import * as souserRepo from "../repositories/souserRepository.js";
import { ConflictError, NotFoundError } from "../errors/AppError.js";

export const getSousers = async (businessUnit) => {
  const { rows } = await souserRepo.findAllByBU(businessUnit);
  return rows;
};

export const getSouserById = async (id) => {
  const { rows } = await souserRepo.findById(id);
  if (!rows[0]) throw new NotFoundError("souser_not_found");
  return rows[0];
};

export const createSouser = async (data, officer) => {
  // Guard: email must be unique
  const existing = await souserRepo.countByEmail(data.email);
  if (parseInt(existing.rows[0].count, 10) > 0) {
    throw new ConflictError("souser_email_exists");
  }

  // 1. Create auth account (inactive until activation)
  const { rows: [account] } = await souserRepo.insertUserAccount(data.email);
  const souserId = account.id;

  // 2. Create souser profile — primary_bu inherited from officer
  await souserRepo.insertSouser({
    id:                 souserId,
    sending_org:        data.sending_org,
    first_name:         data.first_name,
    last_name:          data.last_name,
    display_name:       data.display_name,
    country:            data.country,
    position_title:     data.position_title,
    primary_bu:         officer.business_unit,
    created_by_officer: officer.id,
  });

  // 3. Grant primary BU access automatically
  await souserRepo.insertBuAccess(souserId, officer.business_unit, officer.id);

  // 4. Grant any additional BUs the officer selected
  if (data.additional_bus?.length) {
    await Promise.all(
      data.additional_bus.map((bu) => souserRepo.insertBuAccess(souserId, bu, officer.id)),
    );
  }

  return getSouserById(souserId);
};

export const updateSouser = async (id, data) => {
  const { rows } = await souserRepo.updateSouserById(id, data);
  if (!rows[0]) throw new NotFoundError("souser_not_found");
  return rows[0];
};

export const toggleSouserActive = async (id, updatedBy) => {
  const { rows } = await souserRepo.toggleActive(id, updatedBy);
  if (!rows[0]) throw new NotFoundError("souser_not_found");
  return rows[0];
};

export const grantBuAccess = async (souserId, businessUnit, grantedBy) => {
  await souserRepo.insertBuAccess(souserId, businessUnit, grantedBy);
};

export const revokeBuAccess = async (souserId, businessUnit, revokedBy) => {
  await souserRepo.revokeBuAccess(souserId, businessUnit, revokedBy);
};
