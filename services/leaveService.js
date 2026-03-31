/**
 * Leave Service
 *
 * Business logic for leave_template_tbl and leave_submission_tbl,
 * including the S3-presigned-URL resolution and email dispatch that
 * happens after a submission is saved.
 */
import * as leaveRepo              from "../repositories/leaveRepository.js";
import { getUserLanguage }          from "../utils/getUserLanguage.js";
import { getPresignedUrl }          from "../utils/s3Client.js";
import { leaveApplicationAlert }    from "../config/systemMailer.js";
import env                          from "../config/env.js";
import { ForbiddenError, NotFoundError } from "../errors/AppError.js";
import { createNotification }        from "./notificationService.js";
import { findCoordinatorsByCompany } from "../repositories/notificationRepository.js";

const OFFICER_TYPES = ["officer", "admin"];

// ── Template management ───────────────────────────────────────────────────────

export const saveLeaveTemplate = async (userId, requestor, body) => {
  const {
    config,
    fields,
    company_id,
    title,
    description,
    template_id,
    category,
    is_published,
  } = body;

  const business_unit = requestor.business_unit;
  const company       = company_id || requestor.company;

  const configJSON =
    typeof config === "string" ? config : JSON.stringify(config);
  const fieldsJSON =
    typeof fields === "string" ? fields : JSON.stringify(fields);

  const row = await leaveRepo.upsertLeaveTemplate(template_id, userId, {
    configJSON,
    fieldsJSON,
    company,
    business_unit,
    title,
    description,
    category,
    is_published,
  });

  if (!row) throw new NotFoundError("leave_template_not_found", "api_errors.leave.no_template");
  return row;
};

export const deleteLeaveTemplate = async (templateId) => {
  const row = await leaveRepo.softDeleteLeaveTemplate(templateId);
  if (!row) throw new NotFoundError("leave_template_not_found", "api_errors.leave.no_template");
};

export const getCompanyTemplates = async (requestor, queryParams) => {
  const business_unit = requestor.business_unit;
  const company       = queryParams.company_id || requestor.company;
  const isOfficer     = OFFICER_TYPES.includes((requestor.userType || "").toLowerCase());
  return leaveRepo.findCompanyTemplates(company, business_unit, !isOfficer);
};

export const getLeaveTemplate = async (requestor, queryParams) => {
  const business_unit = requestor.business_unit;
  const template_id   = queryParams.template_id;
  const company       = queryParams.company_id || requestor.company;

  const row = await leaveRepo.findLeaveTemplate({ templateId: template_id, company, businessUnit: business_unit });
  if (!row) {
    throw new NotFoundError("no_leave_template", "api_errors.leave.no_template");
  }
  return row;
};

// ── Submissions ───────────────────────────────────────────────────────────────

export const submitLeave = async (requestor, body) => {
  const { templateId, answers, targetUserId } = body;
  const isOfficer = OFFICER_TYPES.includes((requestor.userType || "").toLowerCase());

  // Default submitter context
  let userId      = requestor.id;
  let business_unit = requestor.business_unit;
  let company     = requestor.company;

  // On-behalf — officers only
  if (targetUserId) {
    if (!isOfficer) {
      throw new ForbiddenError(
        "officer_only_behalf",
        "api_errors.leave.officer_only_behalf",
      );
    }
    const target = await leaveRepo.findTargetUser(targetUserId);
    if (!target) {
      throw new NotFoundError(
        "target_user_not_found",
        "api_errors.leave.target_user_not_found",
      );
    }
    userId        = target.user_id;
    company       = target.company;
    business_unit = target.business_unit;
  }

  const answersJSON =
    typeof answers === "string" ? answers : JSON.stringify(answers);

  // 1. Persist submission
  const submission = await leaveRepo.insertSubmission({
    templateId,
    userId,
    company,
    businessUnit: business_unit,
    answersJSON,
  });

  // 2. Fire-and-forget email dispatch (never fail the HTTP response)
  _dispatchLeaveEmail({ templateId, userId, company, business_unit, answers }).catch(
    (err) => console.error("Leave email dispatch error:", err),
  );

  // 3. Fire-and-forget push notification to company coordinators
  _dispatchLeavePush({ templateId, userId, company, business_unit, submission }).catch(
    (err) => console.error("Leave push dispatch error:", err),
  );

  return submission;
};

/** Internal: fetch template config, resolve S3 file links, send email. */
async function _dispatchLeaveEmail({ templateId, userId, company, business_unit, answers }) {
  const template = await leaveRepo.findTemplateConfig(templateId);
  if (!template) return;

  const emails = template.config?.notificationEmails || [];
  if (emails.length === 0) return;

  const [companyName, buName, applicantName] = await Promise.all([
    leaveRepo.findCompanyName(company),
    leaveRepo.findBuName(business_unit),
    leaveRepo.findApplicantName(userId),
  ]);

  const fields = template.fields || [];
  const fieldMap = fields.reduce((acc, f) => { acc[f.id] = f; return acc; }, {});

  const answersData = await Promise.all(
    Object.keys(answers).map(async (key) => {
      const field    = fieldMap[key];
      const label    = field?.label || key;
      const rawValue = answers[key];

      if (field?.type === "file" && rawValue && rawValue !== "__pending__") {
        try {
          const att = await leaveRepo.findAttachmentForEmail(rawValue);
          if (att) {
            const signedUrl = await getPresignedUrl(att.s3_bucket, att.s3_key, 604800);
            const fileName  = att.display_name || att.s3_key.split("/").pop() || "attachment";
            return {
              question: label,
              answer:   `<a href="${signedUrl}" target="_blank" style="color:#0275d8;">${fileName}</a>`,
              isHtml:   true,
            };
          }
        } catch (fileErr) {
          console.error("Failed to resolve file attachment for email:", fileErr.message);
        }
        return { question: label, answer: "File attached (view in portal)", isHtml: false };
      }

      return { question: label, answer: rawValue || "N/A", isHtml: false };
    }),
  );

  const homeurl    = env.app.nodeEnv === "production"
    ? "https://app.horensoplus.com"
    : "http://localhost:5173";
  const emailTitle = template.title || `新しい申請: ${applicantName}`;

  for (const email of emails) {
    await leaveApplicationAlert(
      email,
      emailTitle,
      applicantName,
      companyName,
      answersData,
      homeurl,
      buName,
      template.title,
    );
  }
}

/** Internal: send push notifications to company coordinators on leave submission. */
async function _dispatchLeavePush({ templateId, userId, company, business_unit, submission }) {
  const coordinatorIds = await findCoordinatorsByCompany(company, business_unit);
  if (coordinatorIds.length === 0) return;

  const [applicantName, companyName, template] = await Promise.all([
    leaveRepo.findApplicantName(userId),
    leaveRepo.findCompanyName(company),
    leaveRepo.findTemplateConfig(templateId),
  ]);

  const formTitle = template?.title || "Leave Form";

  await Promise.all(
    coordinatorIds.map((recipientId) =>
      createNotification({
        userId: recipientId,
        titleKey: "leave_submitted",
        bodyKey: "leave_submitted_body",
        bodyParams: { name: applicantName, company: companyName, title: formTitle },
        data: {
          type: "leave",
          rowId: submission.submission_id,
          screen: "Leave",
          params: { submissionId: submission.submission_id },
        },
      }),
    ),
  );
}

export const getCompanySubmissions = async (requestor, queryParams) => {
  const lang       = await getUserLanguage(requestor.id);
  const company_id = queryParams.company_id || null;
  const start_date = queryParams.start_date  || null;
  const end_date   = queryParams.end_date    || null;
  return leaveRepo.findCompanySubmissions(
    requestor.business_unit,
    company_id,
    start_date,
    end_date,
    lang,
  );
};

export const getMySubmissions = async (userId) => {
  const lang = await getUserLanguage(userId);
  return leaveRepo.findMySubmissions(userId, lang);
};
