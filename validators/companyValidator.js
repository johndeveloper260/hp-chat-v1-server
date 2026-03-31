/**
 * Company Validators (Zod)
 */
import { z } from "zod";

const companyBodySchema = z.object({
  company_name: z.any(),                              // JSONB: {"en":"…","ja":"…"}
  website_url:   z.string().url().optional().nullable(),
  is_active:     z.boolean().optional(),
  ticketing:     z.boolean().optional(),
  flight_tracker: z.boolean().optional(),
  company_form:  z.boolean().optional(),
  sort_order:    z.number().optional(),
  coordinators:  z.array(z.string().uuid()).optional().nullable(),
});

// ── POST /company/create ──────────────────────────────────────────────────────
export const createCompanySchema = companyBodySchema.required({ company_name: true });

// ── PUT /company/update/:id ───────────────────────────────────────────────────
export const updateCompanySchema = companyBodySchema;
