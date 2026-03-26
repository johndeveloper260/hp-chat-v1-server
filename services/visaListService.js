/**
 * Visa List Service
 *
 * No req/res — throws AppError subclasses on failure.
 */
import * as visaListRepo from "../repositories/visaListRepository.js";
import { NotFoundError, ConflictError } from "../errors/AppError.js";

export const getVisaListAll = async (businessUnit) => {
  const { rows } = await visaListRepo.findAllByBU(businessUnit);
  return rows;
};

export const createVisaList = async (data, businessUnit) => {
  const existing = await visaListRepo.countByCode(data.code, businessUnit);
  if (parseInt(existing.rows[0].count, 10) > 0) {
    throw new ConflictError("visa_list_code_exists");
  }
  const { rows } = await visaListRepo.insertVisaList({ ...data, businessUnit });
  return rows[0];
};

export const updateVisaList = async (id, businessUnit, data) => {
  const { rows } = await visaListRepo.updateVisaListById(id, businessUnit, data);
  if (!rows[0]) throw new NotFoundError("visa_list_not_found");
  return rows[0];
};

export const deleteVisaList = async (id, businessUnit) => {
  const { rowCount } = await visaListRepo.deleteVisaListById(id, businessUnit);
  if (rowCount === 0) throw new NotFoundError("visa_list_not_found");
};
