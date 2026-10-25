/**
 * MBDMS - BLOOD DRIVE MANAGER
 * Single-file server application (Express.js + Supabase JavaScript Client)
 * Designed for deployment on Render + Supabase Database.
 *
 * FICTIONAL DATA ONLY - student prototype, not an official Philippine Red Cross system.
 *
 * Files in this project:  app.js  (this file)  |  package.json  |  schema.sql (run in Supabase)
 * Environment variables:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (set on Render / in a local .env)
 * Never put the service-role key in this file or in GitHub.
 */

try { require('dotenv').config(); } catch (e) { /* dotenv is optional on Render */ }
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

// ==========================================
// ENVIRONMENT & SYSTEM INITIALIZATION
// ==========================================

const PORT = Number(process.env.PORT) || 3000;

// Clean spaces, surrounding quotes, and trailing Supabase paths.
const clean = (v) =>
  String(v || '').trim().replace(/^["']|["']$/g, '').trim();

const SUPABASE_URL = clean(process.env.SUPABASE_URL)
  .replace(/\/rest\/v1\/?$/, '')
  .replace(/\/+$/, '');

const SUPABASE_SERVICE_ROLE_KEY = clean(
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const missing = [];

if (!SUPABASE_URL) missing.push('SUPABASE_URL');
if (!SUPABASE_SERVICE_ROLE_KEY) {
  missing.push('SUPABASE_SERVICE_ROLE_KEY');
}

if (missing.length) {
  console.error(
    `Missing environment variable(s): ${missing.join(', ')}. Set them in Render (Environment tab) or in a local .env file.`
  );
  process.exit(1);
}

if (!/^https?:\/\//.test(SUPABASE_URL)) {
  console.error(
    `SUPABASE_URL must start with https:// (got "${SUPABASE_URL}").`
  );
  process.exit(1);
}

// Service-role key: server-side only, never exposed to the browser.
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const app = express();
app.use(express.json({ limit: '100kb' }));

// ==========================================
// HELPERS
// ==========================================
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const text = (value) => String(value ?? '').trim();

const isIsoDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value));

const isPositiveInt = (n) =>
  Number.isInteger(n) && n > 0;

// Wraps async handlers so errors reach the central error handler.
const handler = (fn) =>
  (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

const PRIMARY_KEYS = {
  staff_profiles: 'id',
  donors: 'donor_id',
  mbd_activities: 'activity_id',
  activity_staff_assignments: 'assignment_id',
  activity_donors: 'participation_id',
  screening_records: 'screening_id',
  donation_records: 'donation_id'
};

async function rowExists(table, id) {
  const primaryKey = PRIMARY_KEYS[table];

  if (!primaryKey) {
    throw new Error(`Unknown table: ${table}`);
  }

  const { count, error } = await db
    .from(table)
    .select(primaryKey, { count: 'exact', head: true })
    .eq(primaryKey, id);

  if (error) throw error;
  return count > 0;
}

async function countRows(table, narrow) {
  const primaryKey = PRIMARY_KEYS[table];

  if (!primaryKey) {
    throw new Error(`Unknown table: ${table}`);
  }

  let query = db
    .from(table)
    .select(primaryKey, { count: 'exact', head: true });

  if (narrow) query = narrow(query);

  const { count, error } = await query;

  if (error) throw error;
  return count;
}

async function listAll(table) {
  const primaryKey = PRIMARY_KEYS[table];

  if (!primaryKey) {
    throw new Error(`Unknown table: ${table}`);
  }

  const { data, error } = await db
    .from(table)
    .select('*')
    .order(primaryKey);

  if (error) throw error;
  return data;
}

// Turns a raw Supabase/network error into a plain-English hint for the server log.
function explainDbError(err) {
  const code = err && err.code;
  const msg = (err && err.message) || '';
  if (code === '42501' || /permission denied/i.test(msg))
    return 'Permission denied: tables exist but service_role has no GRANTs. Re-run schema.sql in the Supabase SQL Editor.';
  if (code === 'PGRST205' || code === '42P01' || /schema cache|does not exist/i.test(msg))
    return 'Tables not found: run schema.sql in the Supabase SQL Editor.';
  if (code === 'PGRST301' || /invalid api key|jwt/i.test(msg))
    return 'Key rejected: use the service_role / secret key (not the anon key) from the SAME project as SUPABASE_URL.';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(msg + (err.cause ? err.cause.code : '')))
    return 'Cannot reach SUPABASE_URL: check it is https://<ref>.supabase.co and that the project is not paused.';
  return null;
}

async function checkConnection() {
  const { error } = await db
  .from('mbd_activities')
  .select('activity_id', { head: true, count: 'exact' })
  .limit(1);

  if (error) {
    console.error('Supabase connection check FAILED:', error.message || error);
    const hint = explainDbError(error);
    if (hint) console.error('  Hint:', hint);
  } else {
    console.log('Supabase connection OK.');
  }
}

// ==========================================
// FRONTEND (served from this file: page, stylesheet, script)
// ==========================================
const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mobile Blood Donation Management System</title>
    <link rel="stylesheet" href="styles.css">
</head>
 
<body>
 
<!-- LOGIN -->
<div class="login-view" id="login-view">
    <form class="login-card" id="login-form">
        <div class="brand-symbol">+</div>
        <h1>MBDMS</h1>
        <p class="muted">Mobile Blood Donation Management System<br>Staff sign in</p>
        <div class="notice error hidden" id="login-error"></div>
        <div class="field">
            <label for="login-email">Email</label>
            <input id="login-email" type="email" autocomplete="username" required>
        </div>
        <div class="field">
            <label for="login-password">Password</label>
            <input id="login-password" type="password" autocomplete="current-password" required>
        </div>
        <button class="button" type="submit" id="login-submit">Sign In</button>
        <p class="muted small-text">Accounts are created by an administrator. There is no public sign-up.</p>
    </form>
</div>
 
<div class="layout hidden" id="app-view">
 
    <!-- SIDEBAR -->
    <aside class="sidebar">
        <div class="brand">
            <div class="brand-symbol">+</div>
            <div>
                <h2>MBDMS</h2>
                <p>Mobile Blood Donation Management System</p>
            </div>
        </div>
 
        <p class="nav-title">MAIN MENU</p>
        <nav class="nav-links" id="nav-links"></nav>
 
        <div class="sidebar-note">
            <strong id="side-role">Staff Portal</strong><br>
            You only see the pages and actions your role allows.
        </div>
    </aside>
 
    <!-- MAIN -->
    <main class="main">
        <header class="topbar">
            <div>
                <h1 id="page-title">Dashboard</h1>
                <p>Mobile Blood Donation Management System</p>
            </div>
            <div class="staff-info">
                <div class="avatar" id="staff-avatar">--</div>
                <div class="staff-label">
                    <strong id="staff-name">Staff</strong>
                    <p class="muted" id="staff-role">Role</p>
                </div>
                <button class="button secondary small" data-action="logout">Sign Out</button>
            </div>
        </header>
 
        <div class="content">
            <div class="notice">
                <strong>Prototype notice:</strong> Student project. Use fictional records only.
                Not an official Philippine Red Cross system.
            </div>
            <div class="notice error hidden" id="error-box"></div>
            <div class="notice success hidden" id="success-box"></div>
 
            <!-- DASHBOARD -->
            <section class="page" id="dashboard">
                <div class="welcome">
                    <div>
                        <h2 id="welcome-title">Welcome to MBDMS</h2>
                        <p id="welcome-text">Manage activities, donors, screening and donations.</p>
                    </div>
                    <div class="welcome-icon">♥</div>
                </div>
 
                <div class="section-heading"><h2>System Overview</h2></div>
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-top"><span class="stat-label">MBD Activities</span><span class="stat-icon">▣</span></div>
                        <div class="stat-number" id="activity-count">0</div>
                        <p class="stat-description">Recorded activities</p>
                    </div>
                    <div class="stat-card">
                        <div class="stat-top"><span class="stat-label">Registered Donors</span><span class="stat-icon">♙</span></div>
                        <div class="stat-number" id="donor-count">0</div>
                        <p class="stat-description">Donor records</p>
                    </div>
                    <div class="stat-card">
                        <div class="stat-top"><span class="stat-label">Screening Records</span><span class="stat-icon">✓</span></div>
                        <div class="stat-number" id="screening-count">0</div>
                        <p class="stat-description">Recorded screenings</p>
                    </div>
                    <div class="stat-card">
                        <div class="stat-top"><span class="stat-label">Completed Donations</span><span class="stat-icon">♥</span></div>
                        <div class="stat-number" id="donation-count">0</div>
                        <p class="stat-description">Recorded completions</p>
                    </div>
                </div>
 
                <div class="panel">
                    <div class="panel-header">
                        <h2>Upcoming Activities</h2>
                        <button class="button small" data-goto="activities">View Activities</button>
                    </div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Activity</th><th>Date</th><th>Time</th><th>Location</th><th>Status</th></tr></thead>
                            <tbody id="dashboard-activities"></tbody>
                        </table>
                    </div>
                </div>
            </section>
 
            <!-- ACTIVITIES -->
            <section class="page hidden" id="activities">
                <div class="section-heading">
                    <h2>Mobile Blood Donation Activities</h2>
                    <button class="button" data-new="activity" id="btn-new-activity">+ Add Activity</button>
                </div>
 
                <div class="panel hidden" id="activity-form">
                    <div class="panel-header"><h2 id="activity-form-title">Create Activity</h2></div>
                    <form id="new-activity">
                        <input type="hidden" id="activity-id">
                        <div class="form-grid">
                            <div class="field full">
                                <label for="activity-name">Activity Name</label>
                                <input id="activity-name" required>
                            </div>
                            <div class="field full">
                                <label for="activity-location">Location (venue name and address)</label>
                                <input id="activity-location" required>
                            </div>
                            <div class="field">
                                <label for="activity-date">Date</label>
                                <input id="activity-date" type="date" required>
                            </div>
                            <div class="field">
                                <label for="activity-status">Status</label>
                                <select id="activity-status" required>
                                    <option value="planned">Planned</option>
                                    <option value="ongoing">Ongoing</option>
                                    <option value="completed">Completed</option>
                                    <option value="cancelled">Cancelled</option>
                                </select>
                            </div>
                            <div class="field">
                                <label for="activity-start">Start Time</label>
                                <input id="activity-start" type="time" required>
                            </div>
                            <div class="field">
                                <label for="activity-end">End Time</label>
                                <input id="activity-end" type="time" required>
                            </div>
                        </div>
                        <div class="form-actions">
                            <button class="button" type="submit">Save Activity</button>
                            <button class="button secondary" type="button" data-close="activity">Cancel</button>
                        </div>
                    </form>
                </div>
 
                <div class="panel">
                    <div class="panel-header">
                        <h2>Activity List</h2>
                        <input class="search" id="activity-search" placeholder="Search activities...">
                    </div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Activity</th><th>Date</th><th>Time</th><th>Location</th><th>Status</th><th>Participants</th><th>Actions</th></tr></thead>
                            <tbody id="activity-table"></tbody>
                        </table>
                    </div>
                </div>
 
                <div class="panel hidden" id="activity-detail"></div>
            </section>
 
            <!-- DONORS -->
            <section class="page hidden" id="donors">
                <div class="section-heading">
                    <h2>Donor Records</h2>
                    <button class="button" data-new="donor" id="btn-new-donor">+ Register Donor</button>
                </div>
 
                <div class="panel hidden" id="donor-form">
                    <div class="panel-header"><h2 id="donor-form-title">Register New Donor</h2></div>
                    <form id="new-donor">
                        <input type="hidden" id="donor-id">
                        <div class="form-grid">
                            <div class="field">
                                <label for="first-name">First Name</label>
                                <input id="first-name" required>
                            </div>
                            <div class="field">
                                <label for="middle-name">Middle Name (optional)</label>
                                <input id="middle-name">
                            </div>
                            <div class="field">
                                <label for="last-name">Last Name</label>
                                <input id="last-name" required>
                            </div>
                            <div class="field">
                                <label for="birthdate">Birthdate</label>
                                <input id="birthdate" type="date" required>
                            </div>
                            <div class="field">
                                <label for="sex">Sex (optional)</label>
                                <select id="sex">
                                    <option value="">Not stated</option>
                                    <option value="female">Female</option>
                                    <option value="male">Male</option>
                                    <option value="other">Other</option>
                                    <option value="prefer_not_to_say">Prefer not to say</option>
                                </select>
                            </div>
                            <div class="field">
                                <label for="blood-type">Blood Type (optional, as stated by donor)</label>
                                <select id="blood-type">
                                    <option value="">Not known</option>
                                    <option>A+</option><option>A-</option>
                                    <option>B+</option><option>B-</option>
                                    <option>AB+</option><option>AB-</option>
                                    <option>O+</option><option>O-</option>
                                </select>
                            </div>
                            <div class="field">
                                <label for="contact">Contact Number (optional, fictional)</label>
                                <input id="contact">
                            </div>
                            <div class="field">
                                <label for="donor-status">Donor Status</label>
                                <select id="donor-status">
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>
                            </div>
                            <div class="field full">
                                <label for="address">Address (optional)</label>
                                <input id="address">
                            </div>
                            <div class="field full check">
                                <label><input type="checkbox" id="consent-given"> Donor has given consent to donate and to the recording of their data</label>
                                <span class="muted small-text" id="consent-recorded-note"></span>
                            </div>
                            <div class="field full" id="join-activity-wrap">
                                <label for="join-activity">Also add to activity (optional, saved together in one step)</label>
                                <select id="join-activity"></select>
                            </div>
                        </div>
                        <div class="form-actions">
                            <button class="button" type="submit">Save Donor</button>
                            <button class="button secondary" type="button" data-close="donor">Cancel</button>
                        </div>
                    </form>
                </div>
 
                <div class="panel">
                    <div class="panel-header">
                        <h2>Registered Donors</h2>
                        <input class="search" id="donor-search" placeholder="Search donor name...">
                    </div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Donor ID</th><th>Full Name</th><th>Birthdate</th><th>Age</th><th>Sex</th><th>Blood Type</th><th>Contact</th><th>Consent</th><th>Status</th><th>Actions</th></tr></thead>
                            <tbody id="donor-table"></tbody>
                        </table>
                    </div>
                </div>
            </section>
 
            <!-- SCREENING -->
            <section class="page hidden" id="screening">
                <div class="section-heading">
                    <h2>Medical Screening Records</h2>
                    <button class="button" data-new="screening" id="btn-new-screening">+ Record Screening</button>
                </div>
 
                <div class="notice">
                    The outcome is chosen and recorded by authorized Medical Personnel.
                    This system stores the outcome; it does not decide medical eligibility.
                    Entered ranges only guard against typing mistakes. Diastolic must be lower than systolic.
                </div>
                <div class="notice hidden" id="screening-limited-note">
                    Donation Staff can see only who has an Accepted outcome. Measurements and notes are not shown.
                </div>
 
                <div class="panel hidden" id="screening-form">
                    <div class="panel-header"><h2 id="screening-form-title">Record Screening Outcome</h2></div>
                    <form id="new-screening">
                        <input type="hidden" id="screening-id">
                        <div class="form-grid">
                            <div class="field full">
                                <label for="screening-participation">Participation (donor and activity)</label>
                                <select id="screening-participation" required></select>
                            </div>
                            <div class="field">
                                <label for="systolic">Systolic BP (optional)</label>
                                <input id="systolic" type="number" min="50" max="300">
                            </div>
                            <div class="field">
                                <label for="diastolic">Diastolic BP (optional)</label>
                                <input id="diastolic" type="number" min="30" max="200">
                            </div>
                            <div class="field">
                                <label for="weight">Weight in kg (optional)</label>
                                <input id="weight" type="number" step="0.01" min="1" max="500">
                            </div>
                            <div class="field">
                                <label for="hemoglobin">Hemoglobin g/dL (optional)</label>
                                <input id="hemoglobin" type="number" step="0.01" min="1" max="30">
                            </div>
                            <div class="field">
                                <label for="screening-outcome">Outcome (as assessed by Medical Personnel)</label>
                                <select id="screening-outcome" required>
                                    <option value="accepted">Accepted</option>
                                    <option value="deferred">Deferred</option>
                                    <option value="rejected">Rejected</option>
                                </select>
                            </div>
                            <div class="field">
                                <label for="outcome-reason" id="outcome-reason-label">Reason</label>
                                <input id="outcome-reason">
                                <span class="muted small-text" id="outcome-reason-hint"></span>
                            </div>
                            <div class="field full">
                                <label for="screening-notes">Notes (optional)</label>
                                <input id="screening-notes">
                            </div>
                        </div>
                        <div class="form-actions">
                            <button class="button" type="submit">Save Screening</button>
                            <button class="button secondary" type="button" data-close="screening">Cancel</button>
                        </div>
                    </form>
                </div>
 
                <div class="panel">
                    <div class="panel-header"><h2>Screening History</h2></div>
                    <div class="table-wrap">
                        <table>
                            <thead id="screening-head"></thead>
                            <tbody id="screening-table"></tbody>
                        </table>
                    </div>
                </div>
            </section>
 
            <!-- DONATIONS -->
            <section class="page hidden" id="donations">
                <div class="section-heading">
                    <h2>Donation Records</h2>
                    <button class="button" data-new="donation" id="btn-new-donation">+ Record Donation</button>
                </div>
 
                <div class="notice">
                    A donation can be recorded only for a participation with an Accepted screening outcome.
                </div>
 
                <div class="panel hidden" id="donation-form">
                    <div class="panel-header"><h2 id="donation-form-title">Record Donation</h2></div>
                    <form id="new-donation">
                        <input type="hidden" id="donation-id">
                        <div class="form-grid">
                            <div class="field full">
                                <label for="donation-participation">Accepted participation (donor and activity)</label>
                                <select id="donation-participation" required></select>
                            </div>
                            <div class="field">
                                <label for="bag-serial">Bag Serial No.</label>
                                <input id="bag-serial" required>
                            </div>
                            <div class="field">
                                <label for="volume">Volume (ml) - required above 0 when Completed</label>
                                <input id="volume" type="number" min="0" max="1000">
                            </div>
                            <div class="field">
                                <label for="donation-status">Donation Status</label>
                                <select id="donation-status" required>
                                    <option value="completed">Completed</option>
                                    <option value="not_completed">Not completed</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-actions">
                            <button class="button" type="submit">Save Donation</button>
                            <button class="button secondary" type="button" data-close="donation">Cancel</button>
                        </div>
                    </form>
                </div>
 
                <div class="panel">
                    <div class="panel-header"><h2>Donation History</h2></div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Donation ID</th><th>Donor</th><th>Activity</th><th>Bag Serial</th><th>Volume</th><th>Status</th><th>Recorded By</th><th>Actions</th></tr></thead>
                            <tbody id="donation-table"></tbody>
                        </table>
                    </div>
                </div>
            </section>
 
            <!-- STAFF -->
            <section class="page hidden" id="staff">
                <div class="section-heading">
                    <h2>Staff Accounts</h2>
                    <button class="button" data-new="staff">+ Add Staff Profile</button>
                </div>
 
                <div class="notice">
                    Create the login (email and password) in the Supabase dashboard first.
                    Then paste that user's UUID here to give it a name and a role.
                    Passwords are never stored in this system's tables.
                </div>
 
                <div class="panel hidden" id="staff-form">
                    <div class="panel-header"><h2 id="staff-form-title">Add Staff Profile</h2></div>
                    <form id="new-staff">
                        <input type="hidden" id="staff-editing">
                        <div class="form-grid">
                            <div class="field full">
                                <label for="staff-uuid">Supabase Auth User ID (UUID)</label>
                                <input id="staff-uuid" required pattern="[0-9a-fA-F\\-]{36}">
                            </div>
                            <div class="field">
                                <label for="staff-fullname">Full Name</label>
                                <input id="staff-fullname" required>
                            </div>
                            <div class="field">
                                <label for="staff-role-select">Role</label>
                                <select id="staff-role-select" required></select>
                            </div>
                            <div class="field">
                                <label for="staff-account-status">Account Status</label>
                                <select id="staff-account-status">
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-actions">
                            <button class="button" type="submit">Save Staff Profile</button>
                            <button class="button secondary" type="button" data-close="staff">Cancel</button>
                        </div>
                    </form>
                </div>
 
                <div class="panel">
                    <div class="panel-header"><h2>Staff List</h2></div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
                            <tbody id="staff-table"></tbody>
                        </table>
                    </div>
                </div>
            </section>
 
            <!-- REPORTS -->
            <section class="page hidden" id="reports">
                <div class="section-heading">
                    <h2>MBD Reports</h2>
                    <button class="button" data-action="print">Print Report</button>
                </div>
 
                <div class="panel">
                    <div class="panel-header"><h2>Activity Summary</h2></div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Activity</th><th>Date</th><th>Status</th><th>Participants</th><th>Accepted</th><th>Deferred</th><th>Rejected</th><th>Completed Donations</th></tr></thead>
                            <tbody id="report-summary"></tbody>
                        </table>
                    </div>
                </div>
 
                <div class="panel">
                    <div class="panel-header"><h2>Staff Assignment List</h2></div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Activity</th><th>Date</th><th>Staff Member</th><th>Role</th></tr></thead>
                            <tbody id="report-staff"></tbody>
                        </table>
                    </div>
                </div>
 
                <div class="panel" id="report-history-panel">
                    <div class="panel-header"><h2>Donor Participation History</h2></div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Donor</th><th>Activity</th><th>Date</th><th>Attendance</th><th>Screening</th><th>Donation</th></tr></thead>
                            <tbody id="report-history"></tbody>
                        </table>
                    </div>
                </div>
            </section>
 
            <div class="footer">MBDMS Student Project Prototype | Fictional Data Only</div>
        </div>
    </main>
</div>
 
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="config.js"></script>
<script src="app.js"></script>
</body>
</html>
`;

const STYLES_CSS = `:root {
    --red: #c8102e;
    --dark-red: #a20d25;
    --light-red: #fff0f2;
    --white: #ffffff;
    --background: #f5f6f8;
    --text: #262b33;
    --muted: #747b87;
    --border: #e7e8ec;
    --green: #16804a;
}

* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

body {
    font-family: Arial, Helvetica, sans-serif;
    background: var(--background);
    color: var(--text);
}

button, input, select {
    font: inherit;
}

button {
    cursor: pointer;
}

.layout {
    display: flex;
    min-height: 100vh;
}

/* SIDEBAR */
.sidebar {
    width: 245px;
    background: var(--white);
    border-right: 1px solid var(--border);
    padding: 24px 16px;
    flex-shrink: 0;
}

.brand {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 8px 28px;
    border-bottom: 1px solid var(--border);
}

.brand-symbol {
    width: 44px;
    height: 44px;
    background: var(--red);
    color: white;
    display: grid;
    place-items: center;
    font-size: 29px;
    font-weight: bold;
    border-radius: 10px;
}

.brand h2 {
    color: var(--red);
    font-size: 17px;
}

.brand p {
    color: var(--muted);
    font-size: 11px;
    margin-top: 4px;
}

.nav-title {
    color: var(--muted);
    font-size: 11px;
    font-weight: bold;
    letter-spacing: 1px;
    margin: 26px 10px 12px;
}

.nav-link {
    width: 100%;
    border: 0;
    background: transparent;
    color: #515763;
    display: flex;
    gap: 12px;
    align-items: center;
    text-align: left;
    padding: 13px 12px;
    border-radius: 8px;
    margin-bottom: 5px;
    font-size: 14px;
}

.nav-link:hover,
.nav-link.active {
    background: var(--light-red);
    color: var(--red);
    font-weight: bold;
}

.nav-icon {
    width: 22px;
    text-align: center;
    font-size: 17px;
}

.sidebar-note {
    margin-top: 35px;
    padding: 14px;
    background: var(--light-red);
    border-radius: 10px;
    font-size: 12px;
    line-height: 1.6;
    color: #6e303b;
}

/* MAIN CONTENT */
.main {
    flex: 1;
    min-width: 0;
}

.topbar {
    background: var(--white);
    min-height: 78px;
    padding: 18px 30px;
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
}

.topbar h1 {
    font-size: 22px;
}

.topbar p {
    font-size: 12px;
    color: var(--muted);
    margin-top: 5px;
}

.staff-info {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
}

.avatar {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--light-red);
    color: var(--red);
    display: grid;
    place-items: center;
    font-weight: bold;
}

.content {
    padding: 28px 30px;
}

.welcome {
    background: var(--red);
    color: white;
    padding: 25px;
    border-radius: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
    margin-bottom: 24px;
}

.welcome h2 {
    font-size: 22px;
    margin-bottom: 8px;
}

.welcome p {
    font-size: 13px;
    line-height: 1.6;
    opacity: 0.95;
}

.welcome-icon {
    font-size: 52px;
}

.section-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
}

.section-heading h2 {
    font-size: 17px;
}

.stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
    margin-bottom: 28px;
}

.stat-card {
    background: white;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px;
}

.stat-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
}

.stat-label {
    color: var(--muted);
    font-size: 12px;
}

.stat-icon {
    width: 36px;
    height: 36px;
    border-radius: 9px;
    display: grid;
    place-items: center;
    background: var(--light-red);
    color: var(--red);
    font-size: 18px;
}

.stat-number {
    font-size: 28px;
    font-weight: bold;
    margin-top: 16px;
}

.stat-description {
    color: var(--muted);
    font-size: 11px;
    margin-top: 7px;
}

/* TABLES AND FORMS */
.panel {
    background: white;
    border: 1px solid var(--border);
    border-radius: 10px;
    margin-bottom: 22px;
    overflow: hidden;
}

.panel-header {
    padding: 18px 20px;
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
}

.panel-header h2 {
    font-size: 16px;
}

.table-wrap {
    width: 100%;
    overflow-x: auto;
}

table {
    width: 100%;
    border-collapse: collapse;
    white-space: nowrap;
}

th, td {
    padding: 15px 20px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    font-size: 13px;
}

th {
    color: var(--muted);
    background: #fafafa;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
}

tbody tr:last-child td {
    border-bottom: 0;
}

.badge {
    display: inline-block;
    padding: 5px 9px;
    border-radius: 20px;
    font-size: 11px;
    background: #eee;
}

.badge.red {
    background: var(--light-red);
    color: var(--red);
}

.badge.green {
    background: #e7f7ee;
    color: var(--green);
}

.badge.orange {
    background: #fff1dc;
    color: #925700;
}

.button {
    border: 0;
    background: var(--red);
    color: white;
    border-radius: 7px;
    padding: 10px 14px;
    font-size: 12px;
    font-weight: bold;
}

.button:hover {
    background: var(--dark-red);
}

.button.secondary {
    background: white;
    color: var(--red);
    border: 1px solid var(--red);
}

.button.small {
    padding: 7px 10px;
}

.search {
    width: 100%;
    max-width: 300px;
    border: 1px solid var(--border);
    padding: 10px 12px;
    border-radius: 7px;
    outline-color: var(--red);
}

.form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    padding: 20px;
}

.field {
    display: flex;
    flex-direction: column;
    gap: 7px;
}

.field.full {
    grid-column: 1 / -1;
}

.field label {
    font-size: 12px;
    font-weight: bold;
}

.field input, .field select {
    width: 100%;
    padding: 11px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: white;
}

.form-actions {
    padding: 0 20px 20px;
    display: flex;
    gap: 10px;
}

.notice {
    background: #fff8e8;
    color: #755214;
    padding: 13px 16px;
    border-radius: 8px;
    margin-bottom: 20px;
    font-size: 12px;
    line-height: 1.6;
}

.empty {
    padding: 28px;
    color: var(--muted);
    text-align: center;
}

.footer {
    color: var(--muted);
    text-align: center;
    font-size: 11px;
    padding: 10px 0 24px;
}

.hidden {
    display: none !important;
}

@media (max-width: 1050px) {
    .stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .sidebar {
        width: 210px;
    }
}

@media (max-width: 700px) {
    .layout {
        display: block;
    }

    .sidebar {
        width: 100%;
        padding: 14px;
        border-right: 0;
        border-bottom: 1px solid var(--border);
    }

    .brand {
        padding-bottom: 14px;
    }

    .nav-title, .sidebar-note {
        display: none;
    }

    .nav-links {
        display: flex;
        overflow-x: auto;
        gap: 5px;
        padding-top: 12px;
    }

    .nav-link {
        width: auto;
        flex-shrink: 0;
        margin: 0;
        padding: 10px;
    }

    .topbar {
        padding: 16px;
    }

    .topbar h1 {
        font-size: 18px;
    }

    .staff-label {
        display: none;
    }

    .content {
        padding: 18px 14px;
    }

    .welcome {
        padding: 20px;
    }

    .welcome h2 {
        font-size: 19px;
    }

    .welcome-icon {
        font-size: 34px;
    }

    .stats {
        gap: 10px;
    }

    .stat-card {
        padding: 14px;
    }

    .stat-number {
        font-size: 24px;
    }

    .form-grid {
        grid-template-columns: 1fr;
    }

    .field.full {
        grid-column: auto;
    }
}

/* Error notice (added for API errors) */
.notice.error {
    background: #fff0f2;
    color: #a20d25;
}

select {
    font: inherit;
}
`;

const CLIENT_JS = `const state = { activities: [], donors: [], screenings: [], donations: [] };

const titles = {
    dashboard: "Dashboard",
    activities: "MBD Activities",
    donors: "Donor Records",
    screening: "Medical Screening",
    donations: "Donation Records",
    reports: "Reports"
};

const $ = id => document.getElementById(id);

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
}

/* ---------- API ---------- */
async function api(url, options) {
    const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed.");
    return data;
}

function showError(message) {
    const box = $("error-box");
    box.textContent = message;
    box.classList.remove("hidden");
    clearTimeout(showError.timer);
    showError.timer = setTimeout(() => box.classList.add("hidden"), 5000);
}

async function loadAll() {
    try {
        const [activities, donors, screenings, donations] = await Promise.all([
            api("/api/activities"),
            api("/api/donors"),
            api("/api/screenings"),
            api("/api/donations")
        ]);
        Object.assign(state, { activities, donors, screenings, donations });
        renderAll();
    } catch (err) {
        showError("Could not load data: " + err.message);
    }
}

/* ---------- Helpers ---------- */
const donorName = id => {
    const d = state.donors.find(x => x.id === id);
    return d ? \`\${d.first} \${d.last}\` : "Unknown donor";
};
const activityName = id => {
    const a = state.activities.find(x => x.id === id);
    return a ? a.name : "Unknown activity";
};
const pad = (n, len = 3) => String(n).padStart(len, "0");

function statusBadge(status) {
    let color = "red";
    if (status === "Completed" || status === "Cleared") color = "green";
    else if (status === "Scheduled") color = "orange";
    return \`<span class="badge \${color}">\${escapeHTML(status)}</span>\`;
}

/* ---------- Navigation ---------- */
function showPage(pageId) {
    document.querySelectorAll(".page").forEach(p =>
        p.classList.toggle("hidden", p.id !== pageId));
    document.querySelectorAll(".nav-link").forEach(l =>
        l.classList.toggle("active", l.dataset.page === pageId));
    $("page-title").textContent = titles[pageId] || "MBDMS";
}

document.querySelectorAll(".nav-link").forEach(link =>
    link.addEventListener("click", () => showPage(link.dataset.page)));

document.querySelectorAll("[data-goto]").forEach(btn =>
    btn.addEventListener("click", () => showPage(btn.dataset.goto)));

document.querySelectorAll("[data-toggle]").forEach(btn =>
    btn.addEventListener("click", () =>
        $(btn.dataset.toggle).classList.toggle("hidden")));

/* ---------- Rendering ---------- */
function activityRow(item) {
    return \`
        <tr>
            <td>\${escapeHTML(item.name)}</td>
            <td>\${escapeHTML(item.date)}</td>
            <td>\${escapeHTML(item.venue)}</td>
            <td>\${statusBadge(item.status)}</td>
        </tr>\`;
}

function renderActivities() {
    const q = $("activity-search").value.toLowerCase();
    const filtered = state.activities.filter(i =>
        \`\${i.name} \${i.venue} \${i.date}\`.toLowerCase().includes(q));

    $("activity-table").innerHTML = filtered.length
        ? filtered.map(activityRow).join("")
        : \`<tr><td colspan="4" class="empty">No activities found.</td></tr>\`;

    $("dashboard-activities").innerHTML = state.activities.length
        ? state.activities.slice(0, 5).map(activityRow).join("")
        : \`<tr><td colspan="4" class="empty">No activities yet.</td></tr>\`;
}

function renderDonors() {
    const q = $("donor-search").value.toLowerCase();
    const filtered = state.donors.filter(d =>
        \`\${d.first} \${d.last} DON-\${pad(d.id)}\`.toLowerCase().includes(q));

    $("donor-table").innerHTML = filtered.length
        ? filtered.map(d => \`
            <tr>
                <td>DON-\${pad(d.id)}</td>
                <td>\${escapeHTML(d.first)} \${escapeHTML(d.last)}</td>
                <td>\${escapeHTML(d.birthdate)}</td>
                <td>\${escapeHTML(d.contact)}</td>
            </tr>\`).join("")
        : \`<tr><td colspan="4" class="empty">No donors found.</td></tr>\`;
}

function renderScreenings() {
    $("screening-table").innerHTML = state.screenings.length
        ? state.screenings.map(s => \`
            <tr>
                <td>SCR-\${pad(s.id)}</td>
                <td>\${escapeHTML(donorName(s.donorId))}</td>
                <td>\${escapeHTML(activityName(s.activityId))}</td>
                <td>\${statusBadge(s.outcome)}</td>
            </tr>\`).join("")
        : \`<tr><td colspan="4" class="empty">No screening records yet.</td></tr>\`;
}

function renderDonations() {
    $("donation-table").innerHTML = state.donations.length
        ? state.donations.map(d => \`
            <tr>
                <td>DONATION-\${pad(d.id)}</td>
                <td>\${escapeHTML(donorName(d.donorId))}</td>
                <td>\${escapeHTML(activityName(d.activityId))}</td>
                <td>\${statusBadge(d.status)}</td>
            </tr>\`).join("")
        : \`<tr><td colspan="4" class="empty">No donations recorded yet.</td></tr>\`;
}

function renderStats() {
    const completed = state.donations.filter(d => d.status === "Completed").length;
    const values = {
        "activity-count": state.activities.length,
        "donor-count": state.donors.length,
        "screening-count": state.screenings.length,
        "donation-count": completed,
        "report-activities": state.activities.length,
        "report-donors": state.donors.length,
        "report-screenings": state.screenings.length,
        "report-donations": completed
    };
    Object.entries(values).forEach(([id, v]) => ($(id).textContent = v));
}

function fillSelect(id, options) {
    const select = $(id);
    const previous = select.value;
    select.innerHTML = options.length
        ? options.map(o => \`<option value="\${o.value}">\${escapeHTML(o.label)}</option>\`).join("")
        : \`<option value="">No records available</option>\`;
    if (previous) select.value = previous;
}

function renderSelects() {
    const donorOptions = state.donors.map(d => ({
        value: d.id, label: \`DON-\${pad(d.id)} - \${d.first} \${d.last}\`
    }));
    const activityOptions = state.activities.map(a => ({
        value: a.id, label: \`\${a.name} (\${a.date})\`
    }));
    fillSelect("screening-donor", donorOptions);
    fillSelect("donation-donor", donorOptions);
    fillSelect("screening-activity", activityOptions);
    fillSelect("donation-activity", activityOptions);
}

function renderAll() {
    renderActivities();
    renderDonors();
    renderScreenings();
    renderDonations();
    renderStats();
    renderSelects();
}

/* ---------- Events ---------- */
$("activity-search").addEventListener("input", renderActivities);
$("donor-search").addEventListener("input", renderDonors);

async function submitForm(event, url, body, formId) {
    event.preventDefault();
    try {
        await api(url, { method: "POST", body: JSON.stringify(body) });
        event.target.reset();
        $(formId).classList.add("hidden");
        await loadAll();
    } catch (err) {
        showError(err.message);
    }
}

$("new-activity").addEventListener("submit", e =>
    submitForm(e, "/api/activities", {
        name: $("activity-name").value,
        date: $("activity-date").value,
        venue: $("activity-venue").value
    }, "activity-form"));

$("new-donor").addEventListener("submit", e =>
    submitForm(e, "/api/donors", {
        first: $("first-name").value,
        last: $("last-name").value,
        birthdate: $("birthdate").value,
        contact: $("contact").value
    }, "donor-form"));

$("new-screening").addEventListener("submit", e =>
    submitForm(e, "/api/screenings", {
        participationId: $("screening-participation").value,
        outcome: $("screening-outcome").value,
        outcomeReason: $("screening-reason").value,
        notes: $("screening-notes").value
    }, "screening-form"));

$("new-donation").addEventListener("submit", e =>
    submitForm(e, "/api/donations", {
        participationId: $("donation-participation").value,
        bagSerialNo: $("donation-bag-serial").value,
        volumeMl: $("donation-volume").value,
        donationStatus: $("donation-status").value
    }, "donation-form"));

$("reset-data").addEventListener("click", async () => {
    if (!confirm("Reset all data back to the original demo records?")) return;
    try {
        await api("/api/reset", { method: "POST" });
        await loadAll();
    } catch (err) {
        showError(err.message);
    }
});

loadAll();
`;

app.get('/', (req, res) => res.type('html').send(INDEX_HTML));
app.get('/styles.css', (req, res) => res.type('css').send(STYLES_CSS));
app.get('/app.js', (req, res) => res.type('js').send(CLIENT_JS));

// ==========================================
// API: ADMIN / HEALTH / SUMMARY / RESET
// ==========================================
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/summary', handler(async (req, res) => {
  const [activities, donors, screenings, donations] = await Promise.all([
    countRows('mbd_activities'),
    countRows('donors'),
    countRows('screening_records'),
    countRows('donation_records', (q) => q.eq('donation_status', 'completed'))
  ]);
  res.json({ activities, donors, screenings, donations });
}));

// Calls reset_demo_data() defined in schema.sql
app.post('/api/reset', handler(async (req, res) => {
  const { error } = await db.rpc('reset_demo_data');
  if (error) throw error;
  res.json({ ok: true });
}));

// ==========================================
// API: ACTIVITIES
// ==========================================
app.get('/api/activities', handler(async (req, res) => {
   res.json(await listAll('mbd_activities'));
 }));

 app.post('/api/activities', handler(async (req, res) => {
   const name = text(req.body.name);
   const date = text(req.body.date);
   const venue = text(req.body.venue);
   const startTime = text(req.body.startTime);
   const endTime = text(req.body.endTime);

   if (!name || !date || !venue || !startTime || !endTime) {
     throw new HttpError(
       400,
       'Name, date, venue, start time and end time are required.'
     );
   }

   if (!isIsoDate(date)) {
     throw new HttpError(400, 'Invalid date.');
   }

   const { data, error } = await db
     .from('mbd_activities')
     .insert({
       activity_name: name,
       location: venue,
       activity_date: date,
       start_time: startTime,
       end_time: endTime,
       activity_status: 'planned'
     })
     .select()
     .single();

   if (error) throw error;
   res.status(201).json(data);
 }));

// ==========================================
// API: DONORS PARTICIPATION
// ==========================================

 app.get('/api/participations', handler(async (req, res) => {
   res.json(await listAll('activity_donors'));
 }));

 app.post('/api/participations', handler(async (req, res) => {
   const donorId = Number(req.body.donorId);
   const activityId = Number(req.body.activityId);

   if (
     !Number.isSafeInteger(donorId) ||
     donorId <= 0 ||
     !(await rowExists('donors', donorId))
   ) {
     throw new HttpError(400, 'Unknown donor.');
   }

   if (
     !Number.isSafeInteger(activityId) ||
     activityId <= 0 ||
     !(await rowExists('mbd_activities', activityId))
   ) {
     throw new HttpError(400, 'Unknown activity.');
   }

   const { data, error } = await db
     .from('activity_donors')
     .insert({
       donor_id: donorId,
       activity_id: activityId,
       participation_status: 'registered'
     })
     .select()
     .single();

   if (error) {
     if (error.code === '23505') {
       throw new HttpError(
         400,
         'This donor is already registered for this activity.'
       );
     }
     throw error;
   }

   res.status(201).json(data);
 }));

// ==========================================
// API: SCREENINGS
// Outcomes are recorded by authorized personnel; this app never decides eligibility.
// ==========================================
const SCREENING_OUTCOMES = ['accepted', 'deferred', 'rejected'];

app.get('/api/screenings', handler(async (req, res) => {
  res.json(await listAll('screening_records'));
}));

app.post('/api/screenings', handler(async (req, res) => {
  const participationId = Number(req.body.participationId);
  const outcome = text(req.body.outcome);
  const outcomeReason = text(req.body.outcomeReason);
  const notes = text(req.body.notes);

  if (!Number.isSafeInteger(participationId) || participationId <= 0) {
    throw new HttpError(400, 'A valid participation ID is required.');
  }

  if (!(await rowExists('activity_donors', participationId))) {
    throw new HttpError(400, 'Unknown participation record.');
  }

  if (!SCREENING_OUTCOMES.includes(outcome)) {
    throw new HttpError(
      400,
      'Outcome must be accepted, deferred, or rejected.'
    );
  }

  if (outcome === 'deferred' && !outcomeReason) {
    throw new HttpError(
      400,
      'A reason is required for a deferred screening.'
    );
  }

  const screening = {
    participation_id: participationId,
    screening_outcome: outcome,
    outcome_reason: outcomeReason || null,
    notes: notes || null
  };

  const { data, error } = await db
    .from('screening_records')
    .insert(screening)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new HttpError(
        400,
        'A screening record already exists for this participation.'
      );
    }
    throw error;
  }

  res.status(201).json(data);
}));

// ==========================================
// API: DONATIONS
// ==========================================
const UNIQUE_VIOLATION = '23505';
const presentDonation = (r) => ({ id: r.id, donorId: r.donor_id, activityId: r.activity_id, status: r.status });

app.get('/api/donations', handler(async (req, res) => {
  res.json(await listAll('donation_records'));
}));

app.post('/api/donations', handler(async (req, res) => {
  const participationId = Number(req.body.participationId);
  const bagSerialNo = text(req.body.bagSerialNo);
  const volumeMl = Number(req.body.volumeMl);
  const donationStatus = text(req.body.donationStatus);

  if (!Number.isSafeInteger(participationId) || participationId <= 0) {
    throw new HttpError(400, 'A valid participation ID is required.');
  }

  if (!(await rowExists('activity_donors', participationId))) {
    throw new HttpError(400, 'Unknown participation record.');
  }

  if (!bagSerialNo) {
    throw new HttpError(400, 'Bag serial number is required.');
  }

  if (!['completed', 'not_completed'].includes(donationStatus)) {
    throw new HttpError(
      400,
      'Donation status must be completed or not_completed.'
    );
  }

  if (
    donationStatus === 'completed' &&
    (!Number.isFinite(volumeMl) || volumeMl <= 0)
  ) {
    throw new HttpError(
      400,
      'A completed donation requires a valid donation volume.'
    );
  }

  const { data: screening, error: screeningError } = await db
    .from('screening_records')
    .select('screening_outcome')
    .eq('participation_id', participationId)
    .maybeSingle();

  if (screeningError) throw screeningError;

  if (
    donationStatus === 'completed' &&
    (!screening || screening.screening_outcome !== 'accepted')
  ) {
    throw new HttpError(
      400,
      'A completed donation requires an accepted screening record.'
    );
  }

  const { data, error } = await db
    .from('donation_records')
    .insert({
      participation_id: participationId,
      bag_serial_no: bagSerialNo,
      volume_ml: donationStatus === 'completed' ? volumeMl : null,
      donation_status: donationStatus
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new HttpError(
        400,
        'This participation already has a donation record, or the bag serial number is already used.'
      );
    }
    throw error;
  }

  res.status(201).json(data);
}));

// ==========================================
// FALLBACKS & ERROR HANDLING
// ==========================================
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  console.error(err);
  const hint = explainDbError(err);
  if (hint) console.error('  Hint:', hint);
  res.status(500).json({ error: 'Database error. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`Blood Drive Manager listening on port ${PORT}`);
  checkConnection();
});
