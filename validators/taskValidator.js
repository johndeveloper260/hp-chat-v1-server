import { z } from "zod";

// ─── Columns ───────────────────────────────────────────────────────────────────

export const createColumnSchema = z.object({
  label:     z.string().min(1).max(100),
  color:     z.string().min(1).max(50),
  col_order: z.coerce.number().int().min(0).optional().default(0),
});

export const updateColumnSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  color: z.string().min(1).max(50).optional(),
}).refine((data) => data.label !== undefined || data.color !== undefined, {
  message: "At least one of label or color is required",
});

export const reorderColumnsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

// ─── Teams ─────────────────────────────────────────────────────────────────────

export const createTeamSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
});

export const updateTeamSchema = z.object({
  name:        z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
}).refine((data) => data.name !== undefined || data.description !== undefined, {
  message: "At least one of name or description is required",
});

export const addMemberSchema = z.object({
  user_id: z.string().uuid(),
});

// ─── Tasks ─────────────────────────────────────────────────────────────────────

export const createTaskSchema = z.object({
  title:             z.string().min(1).max(500),
  description:       z.string().max(5000).optional().nullable(),
  category:          z.string().max(100).optional().nullable(),
  column_id:         z.string().uuid().optional().nullable(),
  deadline:          z.coerce.date().optional().nullable(),
  remind_at:         z.coerce.date().optional().nullable(),
  assignee_ids:      z.array(z.string().uuid()).optional().default([]),
  team_id:           z.string().uuid().optional().nullable(),
  col_order:         z.coerce.number().int().min(0).optional().default(0),
  source_message_id: z.string().max(255).optional().nullable(),
  source_channel_id: z.string().max(255).optional().nullable(),
});

export const updateTaskSchema = z.object({
  title:        z.string().min(1).max(500).optional(),
  description:  z.string().max(5000).optional().nullable(),
  category:     z.string().max(100).optional().nullable(),
  column_id:    z.string().uuid().optional().nullable(),
  deadline:     z.coerce.date().optional().nullable(),
  remind_at:    z.coerce.date().optional().nullable(),
  assignee_ids: z.array(z.string().uuid()).optional(),
  team_id:      z.string().uuid().optional().nullable(),
  col_order:    z.coerce.number().int().min(0).optional(),
});

export const moveTaskSchema = z.object({
  column_id: z.string().uuid().optional().nullable(),
  col_order: z.coerce.number().int().min(0).default(0),
});

// ─── Sub-tasks ─────────────────────────────────────────────────────────────────

export const createSubtaskSchema = z.object({
  title:        z.string().min(1).max(500),
  description:  z.string().max(5000).optional().nullable(),
  deadline:     z.coerce.date().optional().nullable(),
  assignee_ids: z.array(z.string().uuid()).min(1, "At least one assignee is required"),
});
