/**
 * Visa List Service
 *
 * No req/res — throws AppError subclasses on failure.
 */
import * as visaListRepo from "../repositories/visaListRepository.js";
import { syncVisaTypeMembersToStream } from "../utils/syncUserToStream.js";
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

  // visa_type_descr is denormalized onto the Stream record of every user holding
  // this code. Fire-and-forget for the same reason as the company rename.
  syncVisaTypeMembersToStream(rows[0].code, businessUnit).catch((e) =>
    console.error(`Stream fan-out after visa descr edit (${rows[0].code}) failed:`, e),
  );

  return rows[0];
};

export const deleteVisaList = async (id, businessUnit) => {
  const countRes = await visaListRepo.countUsersWithVisaTypeById(id, businessUnit);
  if (parseInt(countRes.rows[0].count, 10) > 0) {
    throw new ConflictError("visa_list_has_users", "visa_list_has_users");
  }
  const { rowCount } = await visaListRepo.deleteVisaListById(id, businessUnit);
  if (rowCount === 0) throw new NotFoundError("visa_list_not_found");
};
