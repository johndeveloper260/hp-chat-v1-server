/**
 * App Support Validators (Zod)
 */
import { z } from "zod";

const STATUSES   = ["NEW", "TRIAGED", "IN_PROGRESS", "WAITING_ON_USER", "RESOLVED", "CLOSED"];
const SEVERITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];
const CATEGORIES = [
  "LOGIN_ACCESS", "CHAT", "NOTIFICATIONS", "UPLOAD",
  "PERFORMANCE", "DATA_DISPLAY", "PERMISSION", "FORM_SUBMISSION", "OTHER",
];

export const createAppSupportSchema = z.object({
  title:        z.string().min(1, "Title is required"),
  description:  z.string().optional().nullable(),
  category:     z.enum(CATEGORIES).optional().nullable(),
  severity:     z.enum(SEVERITIES).optional().default("NORMAL"),
  source_page:  z.string().optional().nullable(),
  browser_info: z.string().optional().nullable(),
  app_version:  z.string().optional().nullable(),
  company_id:   z.string().optional().nullable(),
});

export const updateAppSupportSchema = z.object({
  // User-editable fields
  title:        z.string().min(1).optional(),
  description:  z.string().optional().nullable(),
  category:     z.enum(CATEGORIES).optional().nullable(),
  severity:     z.enum(SEVERITIES).optional(),
  source_page:  z.string().optional().nullable(),
  browser_info: z.string().optional().nullable(),
  app_version:  z.string().optional().nullable(),
  // Support/admin-only workflow fields (validated but access-controlled in controller)
  status:       z.enum(STATUSES).optional(),
  assigned_to:  z.string().uuid().optional().nullable(),
  resolution:   z.string().optional().nullable(),
  closed_at:    z.string().optional().nullable(),
});
