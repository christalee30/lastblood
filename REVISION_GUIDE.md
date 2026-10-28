# MBDMS Revision Guide

This guide applies to the branch `revised-mbdms-supabase`. It is a student prototype and must use fictional data only; it is not an official Philippine Red Cross system.

## What has been revised

- Fixed the donation workflow so `donation_records` uses `participation_id`, matching `schema.sql`.
- Fixed activity reports to count donations through `activity_donors` and `participation_id`.
- Removed the reset API endpoint because the schema does not define the `reset_demo_data()` function.
- Aligned donor validation with the schema: sex, contact number, and address can be blank; the accepted sex values match the database.
- Restricted Donation Staff to donor basics for participations that have an Accepted screening outcome. The route does not return their address, contact number, birthdate, or consent details.
- Restricted Donation Staff's participation list to accepted participations, while the server still checks the screening result before saving a donation.
- Added date validation, keyboard-focus styles, and a Refresh action with clearer loading-error messages.

## Part 1 — Use GitHub safely

1. Open the repository: https://github.com/christalee30/lastblood
2. Open the branch selector near the top-left above the file list and select **`revised-mbdms-supabase`**.
3. Review `app.js`, `schema.sql`, and this guide on that branch.
4. Do not merge the branch into `main` yet. Keep the original `main` branch available as a fallback.
5. When testing passes, review the pull request for this branch and merge it into `main`.

## Part 2 — Back up and update Supabase

**Back up first.** In Supabase, make a database backup or export any fictional records that need to be retained.

### If the database only has the new seven tables already

Run the current `schema.sql` in Supabase Dashboard → SQL Editor → New query. It uses `CREATE TABLE IF NOT EXISTS`, so it creates missing tables, but it does not alter a pre-existing table whose columns do not match the new design.

### If the database previously used the old `activities`, `donors`, `screenings`, and `donations` tables

1. Open `upgrade_existing_schema.sql` from this branch.
2. Copy all its SQL into Supabase Dashboard → SQL Editor → New query, then click **Run**.
3. Confirm it finished successfully. It renames incompatible old tables to `legacy_activities`, `legacy_donors`, `legacy_screenings`, and `legacy_donations`; it does not delete their rows.
4. Open `schema.sql`, copy it into a new SQL Editor query, and click **Run**.
5. In Table Editor, confirm all seven current tables exist: `staff_profiles`, `donors`, `mbd_activities`, `activity_staff_assignments`, `activity_donors`, `screening_records`, and `donation_records`.

The legacy tables are preserved for reference. The script does not automatically transfer old records to the new structure because the old model does not contain all fields and links required by the revised workflow. Review and migrate only fictional records that you actually need.

Do **not** manually drop tables or add a `screening_id` column to `donation_records`. The revised model links donations using `participation_id`.

## Part 3 — Check Render environment variables

In Render → your service → Environment, confirm these are present and all belong to the same Supabase project:

- `SUPABASE_URL` — project URL, e.g. `https://YOUR_PROJECT_REF.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY` — publishable/anon key for browser sign-in
- `SUPABASE_SERVICE_ROLE_KEY` — service-role/secret key for backend database operations only

Never paste `SUPABASE_SERVICE_ROLE_KEY` into `app.js`, browser JavaScript, a public issue, or a GitHub file. The browser should receive only the project URL and publishable key. If a service-role key has ever been committed publicly, rotate it in Supabase immediately.

The current app starts with `node app.js`. After the branch is merged, check Render's deployment settings and confirm it deploys from `main); do not assume it has deployed before Render reports a successful deploy.

## Part 4 — Create a staff login

1. In Supabase Authentication, create a user for a test staff member.
2. Copy that user's Auth UUID.
3. Sign in to MBDMS using that account only after an administrator has created the corresponding `staff_profiles` row with the same UUID and an active status.
4. Test with fictional records only.

The server checks the Supabase token and loads the role from `staff_profiles`. A profile missing from the table or marked inactive should be denied.

## Part 5 — Test workflow in this order

1. **Activity:** create a planned activity with a valid date, start time, end time, and location.
2. **Donor:** register a fictional donor. Leave optional fields blank once to verify that they are truly optional.
3. **Participation:** add the donor to the activity. Try adding the same donor twice to confirm duplicate protection.
4. **Screening:** sign in as Medical Personnel and record an outcome. A Deferred outcome must have a reason. The application stores the decision; it does not determine medical eligibility.
5. **Donation:** sign in as Donation Staff. A donation without an Accepted screening must be rejected. For a Completed donation, volume must be a whole number above zero; the bag serial number must be unique.
6. **Privacy:** as Donation Staff, confirm there is no full Donor Records page and the donor API response only includes basic details for accepted participations. Contact number, address, birthdate, and consent details must not appear in that response.
7. **Roles:** try each role and confirm restricted actions return a 403 response from the server, not just a hidden button.
8. **Reports:** check totals against the records you entered.
9. **Failures:** try signing out and reopening the app, then verify API calls without a session are rejected.
10. **Render logs:** check for `Supabase connection OK.` and look for database/schema errors after deployment.

## Important limitations

- This is a prototype, not a production medical records system. Do not enter real donor personal or health information.
- Row Level Security is enabled in the SQL schema. The app uses a server-side service-role key, which bypasses RLS; therefore the Express authentication and role guards are critical and must be tested.
- Database table constraints provide important checks, but eligibility must be determined by qualified medical personnel under applicable procedures.
- The legacy migration renames old tables; it preserves old rows but does not automatically convert them to the revised model.
