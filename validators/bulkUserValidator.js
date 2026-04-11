/**
 * Bulk User Import Validator (Zod)
 *
 * Validates a single CSV row before it is processed by the service.
 * Date fields are optional strings — format is validated in the service
 * via parseDate() which returns null for any invalid/blank value.
 */
import { z } from "zod";

// ── Helpers ────────────────────────────────────────────────────────────────────

const optStr = (max, label) =>
  z.string().max(max, `${label} exceeds ${max} characters`).optional();

const reqStr = (label, max = 500) =>
  z.string().trim()
    .min(1,   `${label} is required`)
    .max(max,  `${label} exceeds ${max} characters`);

// ── Schema ─────────────────────────────────────────────────────────────────────

export const bulkImportRowSchema = z.object({
  // ── Linkage key (required) ────────────────────────────────────────────────
  user_id: z.string().uuid({ message: "user_id must be a valid UUID" }),

  // ── Profile fields ────────────────────────────────────────────────────────
  last_name:                 reqStr("Last Name",          100),
  first_name:                optStr(100, "First Name"),
  middle_name:               optStr(100, "Middle Name"),
  sending_org:               reqStr("Sending Organization", 50),
  batch_no:                  reqStr("Batch Number",        50),
  position:                  optStr(100, "Position"),
  company_joining_date:      optStr(20,  "Company Joining Date"),
  city:                      optStr(100, "City"),
  country:                   reqStr("Country",             10),
  state_province:            optStr(100, "State / Province"),
  street_address:            optStr(255, "Street Address"),
  postal_code:               optStr(20,  "Postal Code"),
  birthdate:                 reqStr("Date of Birth",       20),
  gender:                    reqStr("Gender",              10),
  phone_number:              optStr(30,  "Phone Number"),
  emergency_contact_name:    optStr(150, "Emergency Contact Name"),
  emergency_contact_number:  optStr(30,  "Emergency Contact Number"),
  emergency_email:           z.string().max(255, "Emergency Email exceeds 255 characters")
                               .email("Emergency Email is not a valid email address")
                               .optional()
                               .or(z.literal("")),
  emergency_contact_address: optStr(255, "Emergency Contact Address"),

  // ── Visa fields ───────────────────────────────────────────────────────────
  visa_type:                 reqStr("Visa Type",          50),
  visa_number:               reqStr("Visa Number",        50),
  visa_issue_date:           optStr(20,  "Visa Issue Date"),
  visa_expiry_date:          reqStr("Visa Expiry Date",   20),
  passport_no:               reqStr("Passport Number",    30),
  passport_name:             reqStr("Passport Name",      150),
  passport_expiry:           reqStr("Passport Expiry Date", 20),
  passport_issuing_country:  optStr(50,  "Passport Issuing Country"),
  issuing_authority:         optStr(150, "Issuing Authority"),
  joining_date:              optStr(20,  "Employment Start Date"),
  assignment_start_date:     optStr(20,  "Employment End Date"),
}).passthrough(); // allow extra/unknown keys without error
