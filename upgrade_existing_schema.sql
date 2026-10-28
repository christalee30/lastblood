-- MBDMS upgrade helper for databases that used the OLD four-table design.
-- This script DOES NOT DROP TABLES OR DELETE DATA. It renames legacy tables so
-- the revised seven-table schema can be created alongside preserved old records.
--
-- Run this file first in Supabase SQL Editor, then run schema.sql.
-- If legacy_* tables already exist while the corresponding old tables still exist,
-- this script stops rather than overwriting anything.

DO $$
BEGIN
  -- Old activity table was named public.activities.
  IF to_regclass('public.activities') IS NOT NULL THEN
    IF to_regclass('public.legacy_activities') IS NOT NULL THEN
      RAISE EXCEPTION 'Both public.activities and public.legacy_activities exist. Review them manually before continuing.';
    END IF;
    ALTER TABLE public.activities RENAME TO legacy_activities;
  END IF;

  -- Old donors table used id/first/last and did not have donor_id or consent fields.
  IF to_regclass('public.donors') IS NOT NULL AND (
    NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'donors' AND column_name = 'donor_id'
    )
    OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'donors' AND column_name = 'first_name'
    )
    OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'donors' AND column_name = 'consent_recorded_at'
    )
  ) THEN
    IF to_regclass('public.legacy_donors') IS NOT NULL THEN
      RAISE EXCEPTION 'Both the old-format public.donors and public.legacy_donors exist. Review them manually before continuing.';
    END IF;
    ALTER TABLE public.donors RENAME TO legacy_donors;
  END IF;

  -- The old screening and donation tables used different columns/relationships.
  IF to_regclass('public.screenings') IS NOT NULL THEN
    IF to_regclass('public.legacy_screenings') IS NOT NULL THEN
      RAISE EXCEPTION 'Both public.screenings and public.legacy_screenings exist. Review them manually before continuing.';
    END IF;
    ALTER TABLE public.screenings RENAME TO legacy_screenings;
  END IF;

  IF to_regclass('public.donations') IS NOT NULL THEN
    IF to_regclass('public.legacy_donations') IS NOT NULL THEN
      RAISE EXCEPTION 'Both public.donations and public.legacy_donations exist. Review them manually before continuing.';
    END IF;
    ALTER TABLE public.donations RENAME TO legacy_donations;
  END IF;
END $$;

-- Next step: run schema.sql to create the revised seven-table model.
-- The old records remain in legacy_* tables for reference and manual migration.
