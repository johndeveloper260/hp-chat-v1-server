/**
 * Assessment Validators
 */
import { z } from "zod";

const questionSchema = z.object({
  question_order: z.number().int().min(1),
  question_type: z.enum(["multiple_choice", "text", "true_false"]),
  prompt: z.string().min(1),
  options: z.array(z.string()).optional().nullable(),
  correct_answer: z.string().min(1, "correct_answer is required"),
  points: z.number().int().min(1).default(1),
});

export const createAssessmentSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  passing_score: z.number().int().min(0).max(100).default(70),
  time_limit_seconds: z.number().int().positive().optional().nullable(),
  allow_retake: z.boolean().default(true),
  audience_mode: z.enum(["all", "filtered"]).default("all"),
  audience_country: z.array(z.string()).optional().nullable(),
  audience_company: z.array(z.string().uuid()).optional().nullable(),
  audience_batch: z.array(z.string()).optional().nullable(),
  audience_visa_type: z.array(z.string()).optional().nullable(),
  questions: z.array(questionSchema).min(1),
});

export const updateAssessmentSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  passing_score: z.number().int().min(0).max(100).optional(),
  time_limit_seconds: z.number().int().positive().optional().nullable(),
  allow_retake: z.boolean().optional(),
  audience_mode: z.enum(["all", "filtered"]).optional(),
  audience_country: z.array(z.string()).optional().nullable(),
  audience_company: z.array(z.string().uuid()).optional().nullable(),
  audience_batch: z.array(z.string()).optional().nullable(),
  audience_visa_type: z.array(z.string()).optional().nullable(),
  questions: z.array(questionSchema).min(1).optional(),
});

export const importQuestionsSchema = z.object({
  questions: z.array(questionSchema).min(1),
});

export const autoSaveSchema = z.object({
  answers: z.record(z.string().uuid(), z.string()),
  current_question_index: z.number().int().min(0).optional(),
});

export const submitAttemptSchema = z.object({
  answers: z.record(z.string().uuid(), z.string()),
});
