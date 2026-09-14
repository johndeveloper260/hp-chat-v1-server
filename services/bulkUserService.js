/**
 * Bulk User Service
 *
 * Handles CSV export of all user + visa data for a business unit,
 * and CSV import with per-user atomic transactions (profile + visa).
 *
 * Import strategy:
 *   - user_id is the immutable linkage key; email is display-only (ignored on write)
 *   - Each user is wrapped in its own BEGIN/COMMIT so a single failure never
 *     cancels other rows
 *   - Returns { succeeded: [user_id, …], failed: [{ user_id, reason }, …] }
 */
import { getPool }          from "../config/getPool.js";
import * as bulkUserRepo    from "../repositories/bulkUserRepository.js";
import * as profileRepo     from "../repositories/profileRepository.js";
import * as companyRepo     from "../repositories/companyRepository.js";
import { bulkImportRowSchema } from "../validators/bulkUserValidator.js";
import { bulkCreateRowSchema } from "../validators/bulkUserValidator.js";
import { syncUserToStream, createStreamUser } from "../utils/syncUserToStream.js";
import * as userRepo from "../repositories/userRepository.js";
import { normalizeLoginId } from "../config/constants.js";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { classifyBulkRow, registerTempLoginId } from "../utils/bulkUserCreate.js";
import { formatDate, parseDate, toCsv, parseCsv } from "../utils/csv.js";

// ── Hardcoded reference sets (same as frontend COUNTRY_OPTIONS / GENDER_OPTIONS)
const VALID_COUNTRY_CODES = new Set(["JP","PH","VN","ID","MM","KH","TH","CN","NP","IN","BD","LK"]);
const VALID_GENDERS       = new Set(["MALE","FEMALE"]);

// ── Column definitions ────────────────────────────────────────────────────────
// Single source of truth: order, CSV header label, and internal field name.

const COLUMNS = [
  { en: "User ID (Do Not Change)",        ja: "ユーザーID（変更不可）",       field: "user_id" },
  { en: "Temporary Login ID (New Users Only)", ja: "仮ログインID（新規ユーザーのみ）", field: "temp_login_id" },
  { en: "Last Name",                      ja: "姓",                           field: "last_name" },
  { en: "First Name",                     ja: "名",                           field: "first_name" },
  { en: "Middle Name",                    ja: "ミドルネーム",                  field: "middle_name" },
  { en: "Sending Organization",           ja: "送出機関",                      field: "sending_org" },
  { en: "Company Code",                   ja: "企業コード",                   field: "company_code" },
  { en: "Batch Number",                   ja: "バッチ番号",                    field: "batch_no" },
  { en: "Position",                       ja: "役職",                         field: "position" },
  { en: "Company Joining Date",           ja: "入社日",                       field: "company_joining_date",      isDate: true },
  { en: "Visa Type",                      ja: "ビザ種別",                      field: "visa_type" },
  { en: "Visa Number",                    ja: "ビザ番号",                      field: "visa_number" },
  { en: "Visa Issue Date",                ja: "ビザ発行日",                    field: "visa_issue_date",           isDate: true },
  { en: "Visa Expiry Date",               ja: "ビザ有効期限",                  field: "visa_expiry_date",          isDate: true },
  { en: "Passport Number",               ja: "パスポート番号",                 field: "passport_no" },
  { en: "Passport Name",                  ja: "パスポート氏名",                field: "passport_name" },
  { en: "Passport Expiry Date",           ja: "パスポート有効期限",            field: "passport_expiry",           isDate: true },
  { en: "Passport Issuing Country",       ja: "パスポート発行国",              field: "passport_issuing_country" },
  { en: "Issuing Authority",              ja: "発行機関",                      field: "issuing_authority" },
  { en: "Employment Start Date",          ja: "雇用開始日",                    field: "joining_date",              isDate: true },
  { en: "Employment End Date",            ja: "雇用終了日",                    field: "assignment_start_date",     isDate: true },
  { en: "City",                           ja: "市区町村",                      field: "city" },
  { en: "Country",                        ja: "国",                           field: "country" },
  { en: "State / Province",              ja: "都道府県",                      field: "state_province" },
  { en: "Street Address",                 ja: "番地・建物名",                  field: "street_address" },
  { en: "Postal Code",                    ja: "郵便番号",                      field: "postal_code" },
  { en: "Date of Birth",                  ja: "生年月日",                      field: "birthdate",                 isDate: true },
  { en: "Gender",                         ja: "性別",                         field: "gender" },
  { en: "Phone Number",                   ja: "電話番号",                      field: "phone_number" },
  { en: "Emergency Contact Name",         ja: "緊急連絡先氏名",                field: "emergency_contact_name" },
  { en: "Emergency Contact Number",       ja: "緊急連絡先電話番号",            field: "emergency_contact_number" },
  { en: "Emergency Email",                ja: "緊急連絡先メール",              field: "emergency_email" },
  { en: "Emergency Contact Address",      ja: "緊急連絡先住所",               field: "emergency_contact_address" },
];

/** Returns the display header for a column given the requested locale. */
const getHeader = (col, lang) => (lang === "ja" ? col.ja : col.en);

// Fields that belong to user_profile_tbl (not visa, not linkage)
// NOTE: company_code is handled separately — it's resolved to a UUID before storing as "company"
const PROFILE_FIELDS = new Set([
  "last_name", "first_name", "middle_name", "sending_org",
  "batch_no", "position", "company_joining_date",
  "city", "country", "state_province", "street_address", "postal_code",
  "birthdate", "gender", "phone_number",
  "emergency_contact_name", "emergency_contact_number",
  "emergency_email", "emergency_contact_address",
]);

// Fields that belong to user_visa_info_tbl
const VISA_FIELDS = new Set([
  "visa_type", "visa_number", "visa_issue_date", "visa_expiry_date",
  "passport_no", "passport_name", "passport_expiry", "passport_issuing_country",
  "issuing_authority", "joining_date", "assignment_start_date",
]);

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * Builds and returns a complete CSV string for users in the BU.
 * @param {string} businessUnit
 * @param {{ country?: string[], sending_org?: string, company?: string[], batch_no?: string }} filters
 * @param {string} [lang] - locale code (e.g. "ja"); defaults to English headers
 */
export const exportUsersCsv = async (businessUnit, filters = {}, lang = "en") => {
  const rows = await bulkUserRepo.getUsersForExport(businessUnit, filters);

  const header = COLUMNS.map((c) => getHeader(c, lang));

  const dataRows = rows.map((row) =>
    COLUMNS.map((col) => {
      const val = row[col.field];
      return col.isDate ? formatDate(val) : (val ?? "");
    }),
  );

  return toCsv([header, ...dataRows]);
};

// ── Import ────────────────────────────────────────────────────────────────────

/**
 * Core row-processing logic (no logging concerns).
 * Called by startImportJob in the background.
 *
 * @param {Buffer} fileBuffer
 * @param {string} officerBU
 * @returns {{ succeeded: object[], failed: object[] }}
 */
const _processRows = async (fileBuffer, officerBU) => {
  const text = fileBuffer.toString("utf-8").replace(/^\uFEFF/, ""); // strip UTF-8 BOM
  const rawRows = parseCsv(text);

  if (rawRows.length === 0) {
    return { succeeded: [], failed: [] };
  }

  // Build header → field lookup (all languages)
  const headerToField = {};
  COLUMNS.forEach((c) => {
    headerToField[c.en] = c.field;
    headerToField[c.ja] = c.field;
  });

  // Pre-load valid code sets once
  const { sendingOrgCodes, visaTypeCodes, companyCodes: validCompanyCodes } =
    await bulkUserRepo.loadReferenceCodes(officerBU);

  const succeeded = [];
  const failed    = [];
  const seenTempLoginIds = new Set();

  for (let i = 0; i < rawRows.length; i++) {
    const rowNumber = i + 2; // row 1 is header

    const row = {};
    for (const [header, val] of Object.entries(rawRows[i])) {
      const field = headerToField[header.trim()] ?? header.trim();
      row[field] = typeof val === "string" ? val.trim() : val;
    }

    const name   = [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "—";
    const logCtx = { row: rowNumber, user_id: row.user_id || "(missing)", name };

    const rowAction = classifyBulkRow(row);
    if (rowAction === "missing") {
      failed.push({ ...logCtx, reason: "Either User ID or Temporary Login ID is required" });
      continue;
    }
    if (rowAction === "conflict") {
      failed.push({ ...logCtx, reason: "Temporary Login ID must be empty for existing users" });
      continue;
    }

    if (rowAction === "create") {
      if (!registerTempLoginId(seenTempLoginIds, row.temp_login_id)) {
        failed.push({ ...logCtx, temp_login_id: row.temp_login_id, reason: "Duplicate Temporary Login ID in file" });
        continue;
      }
      const parsedCreate = bulkCreateRowSchema.safeParse(row);
      if (!parsedCreate.success) {
        failed.push({ ...logCtx, temp_login_id: row.temp_login_id, reason: parsedCreate.error.issues.map((issue) => issue.message).join("; ") });
        continue;
      }
      const data = parsedCreate.data;
      if (!validCompanyCodes.has(data.company_code)) {
        failed.push({ ...logCtx, temp_login_id: data.temp_login_id, reason: `Company code "${data.company_code}" not found in your business unit` });
        continue;
      }
      if (!sendingOrgCodes.has(data.sending_org)) {
        failed.push({ ...logCtx, temp_login_id: data.temp_login_id, reason: `Sending Organization code "${data.sending_org}" is not recognised` });
        continue;
      }
      if (!VALID_COUNTRY_CODES.has(data.country.toUpperCase())) {
        failed.push({ ...logCtx, temp_login_id: data.temp_login_id, reason: `Country code "${data.country}" is not recognised` });
        continue;
      }
      if (data.gender && !VALID_GENDERS.has(data.gender.toUpperCase())) {
        failed.push({ ...logCtx, temp_login_id: data.temp_login_id, reason: `Gender "${data.gender}" is invalid — accepted values: MALE, FEMALE` });
        continue;
      }
      if (data.visa_type && !visaTypeCodes.has(data.visa_type)) {
        failed.push({ ...logCtx, temp_login_id: data.temp_login_id, reason: `Visa Type code "${data.visa_type}" is not recognised` });
        continue;
      }
      const companyLookup = await companyRepo.findByCompanyCode(data.company_code, officerBU);
      const companyId = companyLookup.rows[0]?.company_id;
      if (!companyId) {
        failed.push({ ...logCtx, temp_login_id: data.temp_login_id, reason: `Company code "${data.company_code}" not found in your business unit` });
        continue;
      }
      const tempPassword = crypto.randomBytes(4).toString("hex");
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const userId = await userRepo.createUserAccount({
          email: normalizeLoginId(data.temp_login_id), passwordHash: await bcrypt.hash(tempPassword, 10),
          businessUnit: officerBU, emailPending: true,
        }, client);
        await userRepo.createUserProfile({
          userId, firstName: data.first_name, middleName: data.middle_name, lastName: data.last_name,
          userType: "USER", position: data.position, company: companyId, batchNo: data.batch_no,
          businessUnit: officerBU, phoneNumber: data.phone_number, postalCode: data.postal_code,
          streetAddress: data.street_address, city: data.city, state: data.state_province,
        }, client);
        const profileFields = {};
        const visaFields = {};
        for (const col of COLUMNS) {
          if (["user_id", "temp_login_id", "company_code"].includes(col.field)) continue;
          const raw = data[col.field] ?? "";
          const value = col.isDate ? parseDate(raw) : (String(raw).trim() || null);
          if (PROFILE_FIELDS.has(col.field)) profileFields[col.field] = value;
          if (VISA_FIELDS.has(col.field)) visaFields[col.field] = value;
        }
        profileFields.company = companyId;
        profileFields.country = data.country.toUpperCase();
        if (data.gender) profileFields.gender = data.gender.toUpperCase();
        await bulkUserRepo.bulkUpdateProfile(userId, profileFields, officerBU, client);
        const defaultExpiry = new Date(); defaultExpiry.setFullYear(defaultExpiry.getFullYear() + 1);
        await userRepo.createVisaInfo({ userId, visaType: data.visa_type || "Standard Work Visa", visaExpiry: parseDate(data.visa_expiry_date) || defaultExpiry, businessUnit: officerBU }, client);
        await bulkUserRepo.bulkUpdateVisa(userId, { ...visaFields, visa_type: data.visa_type || "Standard Work Visa", visa_expiry_date: parseDate(data.visa_expiry_date) || defaultExpiry }, client);
        await createStreamUser(userId, client);
        await client.query("COMMIT");
        succeeded.push({ ...logCtx, user_id: userId, action: "created", temp_login_id: data.temp_login_id, temp_password: tempPassword });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        failed.push({ ...logCtx, temp_login_id: data.temp_login_id, reason: err.code === "23505" ? "Temporary Login ID already in use" : err.message });
      } finally { client.release(); }
      continue;
    }

    // ── 1. Schema validation ──────────────────────────────────────────────
    const parsed = bulkImportRowSchema.safeParse(row);
    if (!parsed.success) {
      const reason = parsed.error.issues.map((i) => i.message).join("; ");
      failed.push({ ...logCtx, reason });
      continue;
    }

    const { user_id } = parsed.data;
    logCtx.user_id = user_id;

    // ── 2. BU membership check ────────────────────────────────────────────
    let member;
    try {
      member = await profileRepo.findUserInBU(user_id, officerBU);
    } catch {
      failed.push({ ...logCtx, reason: "Database error during BU check" });
      continue;
    }
    if (!member) {
      failed.push({ ...logCtx, reason: "User not found in your business unit" });
      continue;
    }

    // ── 3. Map to profile / visa fields ───────────────────────────────────
    const profileFields = {};
    const visaFields    = {};

    for (const col of COLUMNS) {
      const { field, isDate } = col;
      if (field === "user_id" || field === "company_code") continue;

      const rawVal = row[field] ?? "";
      const val    = isDate ? parseDate(rawVal) : (rawVal.trim() || null);

      if (PROFILE_FIELDS.has(field)) profileFields[field] = val;
      if (VISA_FIELDS.has(field))    visaFields[field]    = val;
    }

    // ── 3a. Resolve company_code → UUID ───────────────────────────────────
    const companyCodeRaw = (row.company_code ?? "").trim();
    if (!companyCodeRaw) {
      failed.push({ ...logCtx, reason: "Company Code is required" });
      continue;
    }
    if (!validCompanyCodes.has(companyCodeRaw)) {
      failed.push({ ...logCtx, reason: `Company code "${companyCodeRaw}" not found in your business unit` });
      continue;
    }
    try {
      const companyLookup = await companyRepo.findByCompanyCode(companyCodeRaw, officerBU);
      if (!companyLookup.rows.length) {
        failed.push({ ...logCtx, reason: `Company code "${companyCodeRaw}" not found in your business unit` });
        continue;
      }
      profileFields.company = companyLookup.rows[0].company_id;
    } catch {
      failed.push({ ...logCtx, reason: "Database error during company code lookup" });
      continue;
    }

    // ── 3b. Reference code validation ────────────────────────────────────
    const sendingOrgRaw = (row.sending_org ?? "").trim();
    if (sendingOrgRaw && !sendingOrgCodes.has(sendingOrgRaw)) {
      failed.push({ ...logCtx, reason: `Sending Organization code "${sendingOrgRaw}" is not recognised` });
      continue;
    }

    const visaTypeRaw = (row.visa_type ?? "").trim();
    if (visaTypeRaw && !visaTypeCodes.has(visaTypeRaw)) {
      failed.push({ ...logCtx, reason: `Visa Type code "${visaTypeRaw}" is not recognised` });
      continue;
    }

    const genderRaw   = (row.gender ?? "").trim();
    const genderUpper = genderRaw.toUpperCase();
    if (genderRaw && !VALID_GENDERS.has(genderUpper)) {
      failed.push({ ...logCtx, reason: `Gender "${genderRaw}" is invalid — accepted values: MALE, FEMALE` });
      continue;
    }
    if (genderRaw) profileFields.gender = genderUpper;

    const countryRaw = (row.country ?? "").trim();
    if (countryRaw && !VALID_COUNTRY_CODES.has(countryRaw.toUpperCase())) {
      failed.push({ ...logCtx, reason: `Country code "${countryRaw}" is not recognised` });
      continue;
    }
    if (countryRaw) profileFields.country = countryRaw.toUpperCase();

    // ── 4. Atomic transaction ─────────────────────────────────────────────
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await bulkUserRepo.bulkUpdateProfile(user_id, profileFields, officerBU, client);
      await bulkUserRepo.bulkUpdateVisa(user_id, visaFields, client);
      await client.query("COMMIT");
      succeeded.push({ ...logCtx, action: "updated" });

    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      failed.push({ ...logCtx, reason: err.message ?? "Update failed" });
      continue;
    } finally {
      client.release();
    }

    // Release the committed connection before sync borrows from the same pool.
    // A Stream failure must not change the successful database import result.
    try {
      await syncUserToStream(user_id);
    } catch (e) {
      console.error(`Stream sync after bulk import of ${user_id} failed:`, e);
    }
  }

  return { succeeded, failed };
};

/**
 * Starts a bulk import as a background job.
 *
 * 1. Purges upload logs older than 90 days for the BU (cascade deletes rows).
 * 2. Creates a "processing" log record immediately and returns its id.
 * 3. Fires _processRows() without awaiting it — the HTTP response is sent
 *    before the CSV rows are processed, so the user can navigate away.
 * 4. When processing finishes the log record is updated with the final counts
 *    and status, and all row-level results are persisted.
 *
 * @param {Buffer} fileBuffer
 * @param {string} officerBU
 * @param {string|null} officerId
 * @param {string|null} fileName
 * @returns {{ logId: number }}
 */
export const startImportJob = async (fileBuffer, officerBU, officerId = null, fileName = null) => {
  // Purge logs older than 90 days (rows cascade-delete automatically)
  await getPool()
    .query(
      `DELETE FROM v4.bulk_upload_log
        WHERE business_unit = $1
          AND uploaded_at < NOW() - INTERVAL '90 days'`,
      [officerBU],
    )
    .catch((err) => console.warn("[startImportJob] Purge failed (non-fatal):", err.message));

  // Create the placeholder log record immediately
  const logId = await bulkUserRepo.insertUploadLog({
    business_unit: officerBU,
    uploaded_by:   officerId,
    file_name:     fileName,
    total_rows:    0,
    success_count: 0,
    error_count:   0,
    status:        "processing",
  });

  // Fire-and-forget: do NOT await this IIFE
  (async () => {
    try {
      const { succeeded, failed } = await _processRows(fileBuffer, officerBU);

      const status =
        failed.length === 0    ? "completed" :
        succeeded.length === 0 ? "failed"    : "partial";

      await bulkUserRepo.updateUploadLog(logId, {
        total_rows:    succeeded.length + failed.length,
        success_count: succeeded.length,
        error_count:   failed.length,
        status,
      });

      const logRows = [
        ...succeeded.map((r) => ({
          row_number: r.row, user_id: r.user_id, full_name: r.name,
          status: "success", error_detail: null, action: r.action,
          temp_login_id: r.temp_login_id, temp_password: r.temp_password,
        })),
        ...failed.map((r) => ({
          row_number: r.row, user_id: r.user_id, full_name: r.name,
          status: "error", error_detail: r.reason, action: r.action,
          temp_login_id: r.temp_login_id, temp_password: null,
        })),
      ];
      await bulkUserRepo.insertUploadLogRows(logId, logRows);
    } catch (err) {
      console.error("[startImportJob] Background processing error:", err);
      await bulkUserRepo
        .updateUploadLog(logId, { total_rows: 0, success_count: 0, error_count: 0, status: "failed" })
        .catch(() => {});
    }
  })();

  return { logId };
};

/**
 * Parses and imports a CSV buffer.
 *
 * Each entry in succeeded/failed includes the 1-based row number and the
 * email + name taken directly from the CSV row, so the officer can identify
 * exactly which spreadsheet row succeeded or failed — no UUID hunting needed.
 *
 * @param {Buffer} fileBuffer
 * @param {string} officerBU
 * @param {string|null} officerId
 * @param {string|null} fileName
 * Kept for reference; the HTTP layer now calls startImportJob instead.
 */
export const importUsersCsv = async (fileBuffer, officerBU, officerId = null, fileName = null) => {
  return _processRows(fileBuffer, officerBU);
};

// ── Reference codes (for client-side pre-check) ───────────────────────────────

/**
 * Returns valid code sets for the BU so the frontend can pre-validate without
 * an upload round-trip.
 */
export const getReferenceCodes = async (businessUnit) => {
  const { sendingOrgCodes, visaTypeCodes, companyCodes } =
    await bulkUserRepo.loadReferenceCodes(businessUnit);
  return {
    sendingOrgs:  [...sendingOrgCodes],
    visaTypes:    [...visaTypeCodes],
    companyCodes: [...companyCodes],
  };
};

// ── Upload history ────────────────────────────────────────────────────────────

export const getUploadHistory = async (businessUnit) => {
  return bulkUserRepo.getUploadLogs(businessUnit);
};

export const getUploadHistoryDetail = async (uploadId, businessUnit) => {
  return bulkUserRepo.getUploadLogRows(uploadId, businessUnit);
};

export const exportUploadResultsCsv = async (uploadId, businessUnit, lang = "en") => {
  const rows = await bulkUserRepo.getUploadLogRows(uploadId, businessUnit);
  const headers = lang === "ja"
    ? ["行", "処理", "仮ログインID", "氏名", "ユーザーID", "仮パスワード", "ステータス", "エラー"]
    : ["Row", "Action", "Temporary Login ID", "Full Name", "User ID", "Temporary Password", "Status", "Error"];
  return toCsv([headers, ...rows.map((r) => [r.row_number, r.action, r.temp_login_id, r.full_name, r.user_id, r.temp_password, r.status, r.error_detail])]);
};

// New-user rows never carry a User ID, so the template omits that column
// rather than shipping one that must always be left blank. The importer maps
// columns by header, so a file without it parses as create rows.
export const getNewUserTemplateCsv = (lang = "en") =>
  toCsv([COLUMNS.filter((column) => column.field !== "user_id").map((column) => getHeader(column, lang))]);
