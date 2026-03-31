-- Migration: Add coordinators column to company_tbl
-- Stores an array of officer/admin user UUIDs who coordinate the company.

ALTER TABLE v4.company_tbl
  ADD COLUMN IF NOT EXISTS coordinators uuid[];
