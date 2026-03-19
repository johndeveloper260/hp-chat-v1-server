import { z } from "zod";

const returnHomeBodySchema = z.object({
  flight_date:        z.string().optional().nullable(),
  return_date:        z.string().optional().nullable(),
  route_origin:       z.string().optional().nullable(),
  route_destination:  z.string().optional().nullable(),
  ticket_type:        z.string().optional().nullable(),
  return_type:        z.number().optional().nullable(),
  lumpsum_applying:   z.boolean().optional(),
  details:            z.string().optional().nullable(),
  tio_jo:             z.string().optional().nullable(),
  is_resignation:     z.boolean().optional(),
  is_paid_leave:      z.boolean().optional(),
  status:             z.string().optional().nullable(),
  user_id:            z.string().optional().nullable(),
  resign_date:        z.string().optional().nullable(),
  leave_days:         z.number().optional().nullable(),
  mode_of_payment:    z.string().optional().nullable(),
  payment_amount:     z.number().optional().nullable(),
  currency:           z.string().optional(),
  payment_settled:    z.boolean().optional(),
});

export const createReturnHomeSchema = returnHomeBodySchema;
export const updateReturnHomeSchema = returnHomeBodySchema;

export const approveReturnHomeSchema = z.object({
  status:            z.enum(["Approved", "Rejected"]),
  approver_remarks:  z.string().optional().nullable(),
});

// User-initiated status-only patch (e.g. retract submission → Draft,
// or submit for approval → Pending). Does NOT touch any other column.
export const patchReturnHomeStatusSchema = z.object({
  status: z.enum(["Draft", "Pending"]),
});
