import crypto from "crypto";
import bcrypt from "bcrypt";
import { StreamChat } from "stream-chat";
import * as souserRepo from "../repositories/souserRepository.js";
import { ConflictError, NotFoundError } from "../errors/AppError.js";
import * as mailer from "../config/systemMailer.js";
import env from "../config/env.js";

const streamClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

const syncBuListToStream = async (souserId) => {
  const { rows } = await souserRepo.findActiveBuList(souserId);
  await streamClient.partialUpdateUser({
    id: souserId,
    set: { bu_access: rows.map((r) => r.business_unit) },
  });
};

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
  const { rows: [account] } = await souserRepo.insertUserAccount(data.email, officer.business_unit);
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

  // 5. Generate temp password, activate account, send welcome email
  const tempPassword = crypto.randomBytes(4).toString("hex");
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  await souserRepo.setPasswordHash(souserId, passwordHash);

  // 6. Sync to GetStream
  try {
    const buList = [officer.business_unit, ...(data.additional_bus || [])];
    await streamClient.upsertUser({
      id:            souserId,
      name:          `${data.first_name} ${data.last_name}`.trim(),
      email:         data.email.toLowerCase().trim(),
      business_unit: officer.business_unit,
      sending_org:   data.sending_org,
      user_type:     "souser",
      bu_access:     [...new Set(buList)],
    });
  } catch (streamErr) {
    console.error("souserService.createSouser: Stream upsert failed", streamErr);
  }

  await mailer.souserActivation(
    data.email,
    "Your Sending Organisation User Account",
    `${data.first_name} ${data.last_name}`,
    tempPassword,
    env.app.frontendUrl,
  );

  return getSouserById(souserId);
};

export const updateSouser = async (id, data) => {
  const { rows } = await souserRepo.updateSouserById(id, data);
  if (!rows[0]) throw new NotFoundError("souser_not_found");
  const updated = rows[0];
  try {
    await streamClient.partialUpdateUser({
      id,
      set: {
        name: updated.display_name || `${updated.first_name} ${updated.last_name}`.trim(),
      },
    });
  } catch (streamErr) {
    console.error("souserService.updateSouser: Stream update failed", streamErr);
  }
  return updated;
};

export const toggleSouserActive = async (id, updatedBy) => {
  const { rows } = await souserRepo.toggleActive(id, updatedBy);
  if (!rows[0]) throw new NotFoundError("souser_not_found");
  return rows[0];
};

export const grantBuAccess = async (souserId, businessUnit, grantedBy) => {
  await souserRepo.insertBuAccess(souserId, businessUnit, grantedBy);
  try {
    await syncBuListToStream(souserId);
  } catch (streamErr) {
    console.error("souserService.grantBuAccess: Stream sync failed", streamErr);
  }
};

export const revokeBuAccess = async (souserId, businessUnit, revokedBy) => {
  await souserRepo.revokeBuAccess(souserId, businessUnit, revokedBy);
  try {
    await syncBuListToStream(souserId);
  } catch (streamErr) {
    console.error("souserService.revokeBuAccess: Stream sync failed", streamErr);
  }
};

export const deleteSouser = async (id) => {
  const { rows } = await souserRepo.findById(id);
  if (!rows[0]) throw new NotFoundError("souser_not_found");
  await souserRepo.deleteSouser(id);
  try {
    await streamClient.deleteUser(id, { mark_messages_deleted: false, hard: false });
  } catch (streamErr) {
    console.error("souserService.deleteSouser: Stream delete failed", streamErr);
  }
};

export const updateBuAccessPermissions = async (souserId, businessUnit, announcements_read, announcements_write) => {
  await souserRepo.updateBuAccessPermissions(souserId, businessUnit, announcements_read, announcements_write);
};
