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
    --blue: #1f5fbf;
}
 
* { box-sizing: border-box; margin: 0; padding: 0; }
 
body {
    font-family: Arial, Helvetica, sans-serif;
    background: var(--background);
    color: var(--text);
}
 
button, input, select { font: inherit; }
button { cursor: pointer; }
button:disabled { opacity: 0.6; cursor: not-allowed; }
.muted { color: var(--muted); }
.small-text { font-size: 11px; line-height: 1.5; }
 
.layout { display: flex; min-height: 100vh; }
 
/* LOGIN */
.login-view {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 20px;
}
.login-card {
    background: white;
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 32px 28px;
    width: 100%;
    max-width: 380px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    text-align: center;
}
.login-card .brand-symbol { margin: 0 auto; }
.login-card h1 { color: var(--red); font-size: 22px; }
.login-card .field { text-align: left; }
.login-card .notice { margin-bottom: 0; text-align: left; }
.login-card .button { padding: 12px; font-size: 13px; }
 
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
    flex-shrink: 0;
}
.brand h2 { color: var(--red); font-size: 17px; }
.brand p { color: var(--muted); font-size: 11px; margin-top: 4px; }
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
.nav-link:hover, .nav-link.active {
    background: var(--light-red);
    color: var(--red);
    font-weight: bold;
}
.nav-icon { width: 22px; text-align: center; font-size: 17px; }
.sidebar-note {
    margin-top: 35px;
    padding: 14px;
    background: var(--light-red);
    border-radius: 10px;
    font-size: 12px;
    line-height: 1.6;
    color: #6e303b;
}
 
/* MAIN */
.main { flex: 1; min-width: 0; }
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
.topbar h1 { font-size: 22px; }
.topbar p { font-size: 12px; color: var(--muted); margin-top: 5px; }
.staff-info { display: flex; align-items: center; gap: 10px; font-size: 13px; }
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
.content { padding: 28px 30px; }
 
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
.welcome h2 { font-size: 22px; margin-bottom: 8px; }
.welcome p { font-size: 13px; line-height: 1.6; opacity: 0.95; }
.welcome-icon { font-size: 52px; }
 
.section-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
}
.section-heading h2 { font-size: 17px; }
 
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
.stat-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.stat-label { color: var(--muted); font-size: 12px; }
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
.stat-number { font-size: 28px; font-weight: bold; margin-top: 16px; }
.stat-description { color: var(--muted); font-size: 11px; margin-top: 7px; }
 
/* PANELS, TABLES, FORMS */
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
.panel-header h2 { font-size: 16px; }
.table-wrap { width: 100%; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; white-space: nowrap; }
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
tbody tr:last-child td { border-bottom: 0; }
td.actions { display: flex; gap: 6px; }
 
.badge {
    display: inline-block;
    padding: 5px 9px;
    border-radius: 20px;
    font-size: 11px;
    background: #eee;
}
.badge.red { background: var(--light-red); color: var(--red); }
.badge.green { background: #e7f7ee; color: var(--green); }
.badge.orange { background: #fff1dc; color: #925700; }
.badge.blue { background: #e8f0fc; color: var(--blue); }
.badge.gray { background: #eceef1; color: var(--muted); }
 
.button {
    border: 0;
    background: var(--red);
    color: white;
    border-radius: 7px;
    padding: 10px 14px;
    font-size: 12px;
    font-weight: bold;
}
.button:hover:not(:disabled) { background: var(--dark-red); }
.button.secondary { background: white; color: var(--red); border: 1px solid var(--red); }
.button.secondary:hover:not(:disabled) { background: var(--light-red); }
.button.small { padding: 7px 10px; }
.button.danger { background: white; color: #8a1020; border: 1px solid #d9a2aa; }
 
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
.field { display: flex; flex-direction: column; gap: 7px; }
.field.full { grid-column: 1 / -1; }
.field label { font-size: 12px; font-weight: bold; }
.field input, .field select {
    width: 100%;
    padding: 11px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: white;
}
.field.check label { display: flex; gap: 10px; align-items: center; font-weight: normal; }
.field.check input { width: auto; }
.form-actions { padding: 0 20px 20px; display: flex; gap: 10px; }
select.inline { padding: 6px; border: 1px solid var(--border); border-radius: 6px; background: white; font-size: 12px; }
 
.notice {
    background: #fff8e8;
    color: #755214;
    padding: 13px 16px;
    border-radius: 8px;
    margin-bottom: 20px;
    font-size: 12px;
    line-height: 1.6;
}
.notice.error { background: #fff0f2; color: #a20d25; }
.notice.success { background: #e7f7ee; color: #115c36; }
 
.empty { padding: 28px; color: var(--muted); text-align: center; }
.footer { color: var(--muted); text-align: center; font-size: 11px; padding: 10px 0 24px; }
.hidden { display: none !important; }
 
/* ACTIVITY DETAIL */
.detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
}
.detail-grid > div { border-right: 1px solid var(--border); min-width: 0; }
.detail-grid > div:last-child { border-right: 0; }
.detail-sub { padding: 14px 20px; font-size: 13px; font-weight: bold; background: #fafafa; border-bottom: 1px solid var(--border); }
.add-row { display: flex; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border); }
.add-row select { flex: 1; min-width: 0; padding: 9px; border: 1px solid var(--border); border-radius: 7px; background: white; }
 
@media (max-width: 1050px) {
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .sidebar { width: 210px; }
    .detail-grid { grid-template-columns: 1fr; }
    .detail-grid > div { border-right: 0; border-bottom: 1px solid var(--border); }
}
 
@media (max-width: 700px) {
    .layout { display: block; }
    .sidebar { width: 100%; padding: 14px; border-right: 0; border-bottom: 1px solid var(--border); }
    .brand { padding-bottom: 14px; }
    .nav-title, .sidebar-note { display: none; }
    .nav-links { display: flex; overflow-x: auto; gap: 5px; padding-top: 12px; }
    .nav-link { width: auto; flex-shrink: 0; margin: 0; padding: 10px; }
    .topbar { padding: 16px; }
    .topbar h1 { font-size: 18px; }
    .staff-label { display: none; }
    .content { padding: 18px 14px; }
    .welcome { padding: 20px; }
    .welcome h2 { font-size: 19px; }
    .welcome-icon { font-size: 34px; }
    .stats { gap: 10px; }
    .stat-card { padding: 14px; }
    .stat-number { font-size: 24px; }
    .form-grid { grid-template-columns: 1fr; }
    .field.full { grid-column: auto; }
}
 
@media print {
    .sidebar, .topbar, .notice, .button, .footer { display: none !important; }
    .main, .content { padding: 0; }
    body { background: white; }
}
`;

const CLIENT_JS = `
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = window.MBDMS_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
 
const $ = id => document.getElementById(id);
 
const ROLES = {
    administrator: "Administrator",
    coordinator: "Activity Coordinator",
    registration_staff: "Registration Staff",
    medical_personnel: "Medical Personnel",
    donation_staff: "Donation Staff"
};
 
const LABELS = {
    planned: "Planned", ongoing: "Ongoing", completed: "Completed", cancelled: "Cancelled",
    registered: "Registered", attended: "Attended", withdrawn: "Withdrawn", no_show: "No show",
    accepted: "Accepted", deferred: "Deferred", rejected: "Rejected",
    not_completed: "Not completed", active: "Active", inactive: "Inactive",
    male: "Male", female: "Female", other: "Other", prefer_not_to_say: "Prefer not to say"
};
 
const BADGE_COLOR = {
    accepted: "green", completed: "green", active: "green", attended: "green",
    deferred: "orange", planned: "orange", registered: "orange",
    ongoing: "blue",
    rejected: "red", cancelled: "red", not_completed: "red", withdrawn: "gray",
    no_show: "gray", inactive: "gray"
};
 
const PAGES = [
    { id: "dashboard", title: "Dashboard", icon: "▦" },
    { id: "activities", title: "MBD Activities", icon: "▣" },
    { id: "donors", title: "Donor Records", icon: "♙", show: p => p.readDonors },
    { id: "screening", title: "Medical Screening", icon: "✓", show: p => p.readScreening || p.readAccepted },
    { id: "donations", title: "Donation Records", icon: "♥", show: p => p.readDonations },
    { id: "staff", title: "Staff Accounts", icon: "☰", show: p => p.manageStaff },
    { id: "reports", title: "Reports", icon: "▤" }
];
 
const state = {
    profile: null,
    activities: [], donors: [], participations: [], screenings: [],
    donations: [], staff: [], assignments: [],
    counts: null, summary: [],
    openActivity: null
};
 
/* ---------- Permissions (display only: the server enforces the same table) ---------- */
function perm() {
    const r = state.profile ? state.profile.role : null;
    const is = (...roles) => roles.includes(r);
    return {
        manageActivities: is("administrator", "coordinator"),
        manageAssignments: is("administrator", "coordinator"),
        readDonors: is("administrator", "registration_staff", "medical_personnel", "donation_staff"),
        writeDonors: is("administrator", "registration_staff"),
        readParticipations: is("administrator", "registration_staff", "medical_personnel", "donation_staff"),
        writeParticipations: is("administrator", "registration_staff"),
        readScreening: is("administrator", "medical_personnel"),
        readAccepted: is("donation_staff"),          // accepted outcomes only, no measurements
        writeScreening: is("medical_personnel"),
        readDonations: is("administrator", "medical_personnel", "donation_staff"),
        writeDonations: is("donation_staff"),
        manageStaff: is("administrator"),
        countsOnly: is("coordinator")
    };
}
 
/* ---------- Helpers ---------- */
function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
}
const pad = (n, len = 3) => String(n).padStart(len, "0");
const hhmm = t => (t ? String(t).slice(0, 5) : "");
const label = v => LABELS[v] || v || "";
const badge = v => \`<span class="badge \${BADGE_COLOR[v] || ""}">\${escapeHTML(label(v))}</span>\`;
const nullIfEmpty = v => (v === "" || v === undefined ? null : v);
const numOrNull = v => (v === "" ? null : Number(v));
 
function fullName(d) {
    return [d.first_name, d.middle_name, d.last_name].filter(Boolean).join(" ");
}
function ageOf(birthdate) {
    const b = new Date(birthdate), t = new Date();
    let age = t.getFullYear() - b.getFullYear();
    if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) age--;
    return age;
}
const donorById = id => state.donors.find(d => d.donor_id === id);
const activityById = id => state.activities.find(a => a.activity_id === id);
const staffById = id => state.staff.find(s => s.id === id);
const participationById = id => state.participations.find(p => p.participation_id === id);
 
function donorLabel(donorId) {
    const d = donorById(donorId);
    return d ? fullName(d) : "Donor (hidden for this role)";
}
function activityLabel(activityId) {
    const a = activityById(activityId);
    return a ? a.activity_name : "Unknown activity";
}
function participationLabel(pid) {
    const p = participationById(pid);
    if (!p) return \`Participation \${pid}\`;
    return \`\${donorLabel(p.donor_id)} - \${activityLabel(p.activity_id)}\`;
}
 
function showMessage(boxId, message, ms) {
    const box = $(boxId);
    box.textContent = message;
    box.classList.remove("hidden");
    clearTimeout(showMessage[boxId]);
    showMessage[boxId] = setTimeout(() => box.classList.add("hidden"), ms);
}
const showError = e => showMessage("error-box", (e && e.message) || String(e), 8000);
const showSuccess = m => showMessage("success-box", m, 3500);
 
/* A save runs once; the submit button stays disabled until it finishes. */
async function guarded(form, fn) {
    const btn = form.querySelector('button[type="submit"]');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
        await fn();
    } catch (err) {
        showError(err);
    } finally {
        btn.disabled = false;
    }
}
 
/* One place for every server call. The token comes from Supabase Auth. */
async function api(method, path, body) {
    const { data } = await sb.auth.getSession();
    const token = data.session && data.session.access_token;
    if (!token) throw Object.assign(new Error("Please sign in."), { status: 401 });
    const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(out.error || "Request failed.");
        err.status = res.status;
        if (res.status === 401) sb.auth.signOut();
        throw err;
    }
    return out;
}
 
/* ---------- Auth ---------- */
async function startSession(session) {
    if (!session) return showLogin();
    let me;
    try {
        me = await api("GET", "/api/me");   // verified by the server; role comes from the database
    } catch (err) {
        await sb.auth.signOut();
        showLogin(err.message);
        return;
    }
    state.profile = me;
    $("login-view").classList.add("hidden");
    $("app-view").classList.remove("hidden");
    setupShell();
    await loadAll();
    showPage("dashboard");
}
 
function showLogin(message) {
    state.profile = null;
    $("app-view").classList.add("hidden");
    $("login-view").classList.remove("hidden");
    const box = $("login-error");
    box.textContent = message || "";
    box.classList.toggle("hidden", !message);
}
 
$("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("login-submit");
    btn.disabled = true;
    try {
        const { error } = await sb.auth.signInWithPassword({
            email: $("login-email").value.trim(),
            password: $("login-password").value
        });
        if (error) throw error;
        $("login-password").value = "";
    } catch (err) {
        showLogin("Sign in failed: " + err.message);
    } finally {
        btn.disabled = false;
    }
});
 
let lastUserId = null;
sb.auth.onAuthStateChange((event, session) => {
    // Defer: do not call Supabase inside this callback synchronously.
    setTimeout(() => {
        const uid = session ? session.user.id : null;
        if (event === "SIGNED_OUT") { lastUserId = null; showLogin(); }
        else if (uid && uid !== lastUserId) { lastUserId = uid; startSession(session); }
    }, 0);
});
 
function setupShell() {
    const p = perm();
    const name = state.profile.full_name;
    $("staff-name").textContent = name;
    $("staff-role").textContent = ROLES[state.profile.role];
    $("staff-avatar").textContent = name.split(/\\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    $("side-role").textContent = ROLES[state.profile.role];
    $("welcome-title").textContent = \`Welcome, \${name}\`;
    $("welcome-text").textContent = {
        administrator: "Manage staff accounts and activities, and review donors, screening and donations.",
        coordinator: "Plan activities and assign staff. Medical and donor details are shown as totals only.",
        registration_staff: "Register donors and add them to activities.",
        medical_personnel: "Record screening results and outcomes for donors who join activities.",
        donation_staff: "Record donations for donors with an Accepted screening outcome."
    }[state.profile.role];
 
    $("nav-links").innerHTML = PAGES.filter(pg => !pg.show || pg.show(p)).map(pg =>
        \`<button class="nav-link" data-page="\${pg.id}"><span class="nav-icon">\${pg.icon}</span> \${pg.title}</button>\`
    ).join("");
 
    $("btn-new-activity").classList.toggle("hidden", !p.manageActivities);
    $("btn-new-donor").classList.toggle("hidden", !p.writeDonors);
    $("btn-new-screening").classList.toggle("hidden", !p.writeScreening);
    $("btn-new-donation").classList.toggle("hidden", !p.writeDonations);
    $("screening-limited-note").classList.toggle("hidden", !p.readAccepted);
    $("report-history-panel").classList.toggle("hidden", !p.readDonors || !p.readParticipations);
 
    $("staff-role-select").innerHTML = Object.entries(ROLES)
        .map(([v, l]) => \`<option value="\${v}">\${l}</option>\`).join("");
}
 
/* ---------- Data loading ---------- */
async function loadAll() {
    const p = perm();
    const get = path => api("GET", path);
    const wanted = {
        activities: get("/api/activities"),
        donors: p.readDonors ? get("/api/donors") : [],
        participations: p.readParticipations ? get("/api/participations") : [],
        screenings: (p.readScreening || p.readAccepted) ? get("/api/screenings") : [],
        donations: p.readDonations ? get("/api/donations") : [],
        staff: get("/api/staff"),
        assignments: get("/api/assignments"),
        counts: get("/api/summary"),
        summary: get("/api/reports/activity-summary")
    };
    const keys = Object.keys(wanted);
    const results = await Promise.allSettled(Object.values(wanted));
    let firstError = null;
    results.forEach((r, i) => {
        if (r.status === "fulfilled") state[keys[i]] = r.value;
        else if (!firstError) firstError = r.reason;
    });
    if (firstError) showError("Could not load some data: " + firstError.message);
    renderAll();
}
 
/* ---------- Navigation ---------- */
function showPage(pageId) {
    const p = perm();
    const page = PAGES.find(pg => pg.id === pageId);
    if (!page || (page.show && !page.show(p))) pageId = "dashboard";
    document.querySelectorAll(".page").forEach(sec => sec.classList.toggle("hidden", sec.id !== pageId));
    document.querySelectorAll(".nav-link").forEach(l => l.classList.toggle("active", l.dataset.page === pageId));
    $("page-title").textContent = (PAGES.find(pg => pg.id === pageId) || {}).title || "MBDMS";
}
 
/* ---------- Rendering ---------- */
const empty = (cols, text) => \`<tr><td colspan="\${cols}" class="empty">\${text}</td></tr>\`;
 
function summaryRows() {
    return state.summary || [];
}
 
function activityRow(a, withActions) {
    const p = perm();
    const sum = summaryRows().find(s => s.activity_id === a.activity_id);
    const manage = withActions ? \`
        <td class="actions">
            <button class="button small secondary" data-action="manage-activity" data-id="\${a.activity_id}">Manage</button>
            \${p.manageActivities ? \`<button class="button small secondary" data-action="edit-activity" data-id="\${a.activity_id}">Edit</button>
            <button class="button small danger" data-action="delete-activity" data-id="\${a.activity_id}">Delete</button>\` : ""}
        </td>\` : "";
    return \`<tr>
        <td>\${escapeHTML(a.activity_name)}</td>
        <td>\${escapeHTML(a.activity_date)}</td>
        <td>\${hhmm(a.start_time)} - \${hhmm(a.end_time)}</td>
        <td>\${escapeHTML(a.location)}</td>
        <td>\${badge(a.activity_status)}</td>
        \${withActions ? \`<td>\${sum ? sum.participants : 0}</td>\${manage}\` : ""}
    </tr>\`;
}
 
function renderActivities() {
    const q = $("activity-search").value.toLowerCase();
    const filtered = state.activities.filter(a =>
        \`\${a.activity_name} \${a.location} \${a.activity_date}\`.toLowerCase().includes(q));
    $("activity-table").innerHTML = filtered.length
        ? filtered.map(a => activityRow(a, true)).join("") : empty(7, "No activities found.");
 
    const upcoming = state.activities
        .filter(a => a.activity_status === "planned" || a.activity_status === "ongoing")
        .sort((a, b) => a.activity_date.localeCompare(b.activity_date)).slice(0, 5);
    $("dashboard-activities").innerHTML = upcoming.length
        ? upcoming.map(a => activityRow(a, false)).join("") : empty(5, "No upcoming activities.");
}
 
function renderDetail() {
    const panel = $("activity-detail");
    const a = activityById(state.openActivity);
    if (!a) { panel.classList.add("hidden"); return; }
    const p = perm();
    const sum = summaryRows().find(s => s.activity_id === a.activity_id) || {};
    const open = a.activity_status === "planned" || a.activity_status === "ongoing";
 
    // Participants
    let participants = "";
    if (p.readParticipations) {
        const parts = state.participations.filter(x => x.activity_id === a.activity_id);
        const joined = new Set(parts.map(x => x.donor_id));
        const available = state.donors.filter(d => d.donor_status === "active" && !joined.has(d.donor_id));
        const rows = parts.map(x => {
            const scr = state.screenings.find(s => s.participation_id === x.participation_id);
            const don = state.donations.find(d => d.participation_id === x.participation_id);
            const status = p.writeParticipations
                ? \`<select class="inline" data-action="participation-status" data-id="\${x.participation_id}">
                    \${["registered", "attended", "withdrawn", "no_show"].map(v =>
                        \`<option value="\${v}" \${v === x.participation_status ? "selected" : ""}>\${label(v)}</option>\`).join("")}
                   </select>\`
                : badge(x.participation_status);
            const screenCell = scr ? badge(scr.screening_outcome || "accepted") : '<span class="muted">Not screened</span>';
            const donCell = don ? badge(don.donation_status) : '<span class="muted">-</span>';
            const remove = p.writeParticipations && !scr
                ? \`<button class="button small danger" data-action="remove-participant" data-id="\${x.participation_id}">Remove</button>\` : "";
            return \`<tr><td>\${escapeHTML(donorLabel(x.donor_id))}</td><td>\${status}</td><td>\${screenCell}</td><td>\${donCell}</td><td>\${remove}</td></tr>\`;
        }).join("");
        participants = \`
            <div class="detail-sub">Participants (\${parts.length})</div>
            <div class="table-wrap"><table>
                <thead><tr><th>Donor</th><th>Attendance</th><th>Screening</th><th>Donation</th><th></th></tr></thead>
                <tbody>\${rows || empty(5, "No donors added yet.")}</tbody>
            </table></div>
            \${p.writeParticipations && open ? \`<div class="add-row">
                <select id="add-participant-select">\${available.length
                    ? available.map(d => \`<option value="\${d.donor_id}">DON-\${pad(d.donor_id)} - \${escapeHTML(fullName(d))}</option>\`).join("")
                    : '<option value="">No donors available</option>'}</select>
                <button class="button small" data-action="add-participant">Add Donor</button></div>\` : ""}\`;
    } else {
        participants = \`
            <div class="detail-sub">Participants</div>
            <div style="padding:20px;line-height:2;font-size:13px">
                Totals only for your role:<br>
                Participants <strong>\${sum.participants ?? 0}</strong> |
                Accepted <strong>\${sum.accepted ?? 0}</strong> |
                Deferred <strong>\${sum.deferred ?? 0}</strong> |
                Rejected <strong>\${sum.rejected ?? 0}</strong> |
                Completed donations <strong>\${sum.completed ?? 0}</strong>
            </div>\`;
    }
 
    // Staff
    const assigned = state.assignments.filter(x => x.activity_id === a.activity_id);
    const assignedIds = new Set(assigned.map(x => x.staff_id));
    const availableStaff = state.staff.filter(s => s.account_status === "active" && !assignedIds.has(s.id));
    const staffRows = assigned.map(x => {
        const s = staffById(x.staff_id);
        return \`<tr><td>\${escapeHTML(s ? s.full_name : "Unknown")}</td><td>\${escapeHTML(s ? ROLES[s.role] : "")}</td>
            <td>\${p.manageAssignments ? \`<button class="button small danger" data-action="remove-assignment" data-id="\${x.assignment_id}">Remove</button>\` : ""}</td></tr>\`;
    }).join("");
    const staffBlock = \`
        <div class="detail-sub">Assigned Staff (\${assigned.length})</div>
        <div class="table-wrap"><table>
            <thead><tr><th>Name</th><th>Role</th><th></th></tr></thead>
            <tbody>\${staffRows || empty(3, "No staff assigned yet.")}</tbody>
        </table></div>
        \${p.manageAssignments ? \`<div class="add-row">
            <select id="add-staff-select">\${availableStaff.length
                ? availableStaff.map(s => \`<option value="\${s.id}">\${escapeHTML(s.full_name)} (\${ROLES[s.role]})</option>\`).join("")
                : '<option value="">No active staff available</option>'}</select>
            <button class="button small" data-action="add-assignment">Assign Staff</button></div>\` : ""}\`;
 
    panel.innerHTML = \`
        <div class="panel-header">
            <h2>\${escapeHTML(a.activity_name)} \${badge(a.activity_status)}</h2>
            <button class="button small secondary" data-action="close-detail">Close</button>
        </div>
        <div style="padding:14px 20px;font-size:13px" class="muted">
            \${escapeHTML(a.activity_date)} | \${hhmm(a.start_time)} - \${hhmm(a.end_time)} | \${escapeHTML(a.location)}
        </div>
        <div class="detail-grid"><div>\${participants}</div><div>\${staffBlock}</div></div>\`;
    panel.classList.remove("hidden");
}
 
function renderDonors() {
    const q = $("donor-search").value.toLowerCase();
    const p = perm();
    const filtered = state.donors.filter(d =>
        \`\${fullName(d)} DON-\${pad(d.donor_id)}\`.toLowerCase().includes(q));
    $("donor-table").innerHTML = filtered.length ? filtered.map(d => \`<tr>
        <td>DON-\${pad(d.donor_id)}</td>
        <td>\${escapeHTML(fullName(d))}</td>
        <td>\${escapeHTML(d.birthdate)}</td>
        <td>\${ageOf(d.birthdate)}</td>
        <td>\${escapeHTML(d.sex ? label(d.sex) : "-")}</td>
        <td>\${escapeHTML(d.blood_type || "-")}</td>
        <td>\${escapeHTML(d.contact_number || "-")}</td>
        <td>\${d.consent_given ? badge("accepted").replace("Accepted", "Given") : '<span class="badge red">Not given</span>'}</td>
        <td>\${badge(d.donor_status)}</td>
        <td class="actions">\${p.writeDonors ? \`<button class="button small secondary" data-action="edit-donor" data-id="\${d.donor_id}">Edit</button>\` : ""}</td>
    </tr>\`).join("") : empty(10, "No donors found.");
}
 
function renderScreenings() {
    const p = perm();
    if (p.readAccepted) {
        $("screening-head").innerHTML = "<tr><th>Donor</th><th>Activity</th><th>Outcome</th></tr>";
        $("screening-table").innerHTML = state.screenings.length ? state.screenings.map(s =>
            \`<tr><td>\${escapeHTML(participationLabel(s.participation_id).split(" - ")[0])}</td>
             <td>\${escapeHTML(activityLabel((participationById(s.participation_id) || {}).activity_id))}</td>
             <td>\${badge("accepted")}</td></tr>\`).join("") : empty(3, "No accepted donors yet.");
        return;
    }
    $("screening-head").innerHTML = \`<tr><th>Screening ID</th><th>Donor</th><th>Activity</th><th>BP</th><th>Weight</th><th>Hemoglobin</th><th>Outcome</th><th>Reason</th><th>Screened By</th><th>Actions</th></tr>\`;
    $("screening-table").innerHTML = state.screenings.length ? state.screenings.map(s => {
        const part = participationById(s.participation_id) || {};
        const by = staffById(s.screened_by);
        const bp = s.systolic_bp && s.diastolic_bp ? \`\${s.systolic_bp}/\${s.diastolic_bp}\` : "-";
        return \`<tr>
            <td>SCR-\${pad(s.screening_id)}</td>
            <td>\${escapeHTML(donorLabel(part.donor_id))}</td>
            <td>\${escapeHTML(activityLabel(part.activity_id))}</td>
            <td>\${bp}</td>
            <td>\${s.weight_kg ?? "-"}</td>
            <td>\${s.hemoglobin_g_dl ?? "-"}</td>
            <td>\${badge(s.screening_outcome)}</td>
            <td>\${escapeHTML(s.outcome_reason || "-")}</td>
            <td>\${escapeHTML(by ? by.full_name : "")}</td>
            <td class="actions">\${p.writeScreening ? \`<button class="button small secondary" data-action="edit-screening" data-id="\${s.screening_id}">Edit</button>\` : ""}</td>
        </tr>\`;
    }).join("") : empty(10, "No screening records yet.");
}
 
function renderDonations() {
    const p = perm();
    $("donation-table").innerHTML = state.donations.length ? state.donations.map(d => {
        const part = participationById(d.participation_id) || {};
        const by = staffById(d.recorded_by);
        return \`<tr>
            <td>DONATION-\${pad(d.donation_id)}</td>
            <td>\${escapeHTML(donorLabel(part.donor_id))}</td>
            <td>\${escapeHTML(activityLabel(part.activity_id))}</td>
            <td>\${escapeHTML(d.bag_serial_no)}</td>
            <td>\${d.volume_ml === null || d.volume_ml === undefined ? "-" : d.volume_ml + " ml"}</td>
            <td>\${badge(d.donation_status)}</td>
            <td>\${escapeHTML(by ? by.full_name : "")}</td>
            <td class="actions">\${p.writeDonations ? \`<button class="button small secondary" data-action="edit-donation" data-id="\${d.donation_id}">Edit</button>\` : ""}</td>
        </tr>\`;
    }).join("") : empty(8, "No donations recorded yet.");
}
 
function renderStaff() {
    $("staff-table").innerHTML = state.staff.length ? state.staff.map(s => \`<tr>
        <td>\${escapeHTML(s.full_name)}</td>
        <td>\${escapeHTML(ROLES[s.role])}</td>
        <td>\${badge(s.account_status)}</td>
        <td>\${escapeHTML((s.created_at || "").slice(0, 10))}</td>
        <td class="actions"><button class="button small secondary" data-action="edit-staff" data-id="\${s.id}">Edit</button></td>
    </tr>\`).join("") : empty(5, "No staff profiles.");
}
 
function renderStats() {
    const c = state.counts;
    const completed = state.donations.filter(d => d.donation_status === "completed").length;
    $("activity-count").textContent = c ? c.activities : state.activities.length;
    $("donor-count").textContent = c ? c.donors : state.donors.length;
    $("screening-count").textContent = c ? c.screenings : state.screenings.length;
    $("donation-count").textContent = c ? c.completed_donations ?? c.donations : completed;
}
 
function renderReports() {
    const sums = summaryRows();
    $("report-summary").innerHTML = state.activities.length ? state.activities.map(a => {
        const s = sums.find(x => x.activity_id === a.activity_id) || {};
        return \`<tr><td>\${escapeHTML(a.activity_name)}</td><td>\${escapeHTML(a.activity_date)}</td><td>\${badge(a.activity_status)}</td>
            <td>\${s.participants ?? 0}</td><td>\${s.accepted ?? 0}</td><td>\${s.deferred ?? 0}</td><td>\${s.rejected ?? 0}</td><td>\${s.completed ?? 0}</td></tr>\`;
    }).join("") : empty(8, "No activities.");
 
    const staffRows = state.assignments.map(x => {
        const a = activityById(x.activity_id), s = staffById(x.staff_id);
        return a && s ? \`<tr><td>\${escapeHTML(a.activity_name)}</td><td>\${escapeHTML(a.activity_date)}</td><td>\${escapeHTML(s.full_name)}</td><td>\${escapeHTML(ROLES[s.role])}</td></tr>\` : "";
    }).join("");
    $("report-staff").innerHTML = staffRows || empty(4, "No staff assignments.");
 
    if (perm().readDonors && perm().readParticipations) {
        const rows = state.participations.map(x => {
            const d = donorById(x.donor_id), a = activityById(x.activity_id);
            if (!d || !a) return "";
            const scr = state.screenings.find(s => s.participation_id === x.participation_id);
            const don = state.donations.find(s => s.participation_id === x.participation_id);
            return \`<tr><td>\${escapeHTML(fullName(d))}</td><td>\${escapeHTML(a.activity_name)}</td><td>\${escapeHTML(a.activity_date)}</td>
                <td>\${badge(x.participation_status)}</td>
                <td>\${scr && scr.screening_outcome ? badge(scr.screening_outcome) : '<span class="muted">-</span>'}</td>
                <td>\${don ? badge(don.donation_status) : '<span class="muted">-</span>'}</td></tr>\`;
        }).sort().join("");
        $("report-history").innerHTML = rows || empty(6, "No participation yet.");
    }
}
 
function renderSelects() {
    // Donor form: join an activity while registering
    const open = state.activities.filter(a => a.activity_status === "planned" || a.activity_status === "ongoing");
    $("join-activity").innerHTML = '<option value="">Do not add to an activity now</option>' +
        open.map(a => \`<option value="\${a.activity_id}">\${escapeHTML(a.activity_name)} (\${a.activity_date})</option>\`).join("");
}
 
function fillParticipationSelect(selectId, items, selectedId) {
    const sel = $(selectId);
    sel.innerHTML = items.length
        ? items.map(x => \`<option value="\${x.participation_id}">\${escapeHTML(participationLabel(x.participation_id))}</option>\`).join("")
        : '<option value="">No eligible participation</option>';
    if (selectedId) sel.value = selectedId;
}
 
function renderAll() {
    renderActivities();
    renderDetail();
    renderDonors();
    renderScreenings();
    renderDonations();
    renderStaff();
    renderStats();
    renderReports();
    renderSelects();
}
 
/* ---------- Forms (open / close / fill) ---------- */
const FORMS = {
    activity: { panel: "activity-form", form: "new-activity", title: "activity-form-title", add: "Create Activity", edit: "Edit Activity" },
    donor: { panel: "donor-form", form: "new-donor", title: "donor-form-title", add: "Register New Donor", edit: "Edit Donor" },
    screening: { panel: "screening-form", form: "new-screening", title: "screening-form-title", add: "Record Screening Outcome", edit: "Edit Screening Outcome" },
    donation: { panel: "donation-form", form: "new-donation", title: "donation-form-title", add: "Record Donation", edit: "Edit Donation" },
    staff: { panel: "staff-form", form: "new-staff", title: "staff-form-title", add: "Add Staff Profile", edit: "Edit Staff Profile" }
};
 
function openForm(name, editing) {
    const f = FORMS[name];
    $(f.form).reset();
    $(f.title).textContent = editing ? f.edit : f.add;
    $(f.panel).classList.remove("hidden");
    $(f.panel).scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function closeForm(name) { $(FORMS[name].panel).classList.add("hidden"); }
 
function newForm(name) {
    openForm(name, false);
    if (name === "activity") $("activity-id").value = "";
    if (name === "donor") {
        $("donor-id").value = "";
        $("join-activity-wrap").classList.remove("hidden");
        $("consent-recorded-note").textContent = "";
    }
    if (name === "screening") {
        $("screening-id").value = "";
        $("screening-participation").disabled = false;
        const screened = new Set(state.screenings.map(s => s.participation_id));
        fillParticipationSelect("screening-participation",
            state.participations.filter(x => !screened.has(x.participation_id)
                && (x.participation_status === "registered" || x.participation_status === "attended")));
        updateReasonField();
    }
    if (name === "donation") {
        $("donation-id").value = "";
        $("donation-participation").disabled = false;
        const donated = new Set(state.donations.map(d => d.participation_id));
        const accepted = new Set(state.screenings
            .filter(s => !s.screening_outcome || s.screening_outcome === "accepted").map(s => s.participation_id));
        fillParticipationSelect("donation-participation",
            state.participations.filter(x => accepted.has(x.participation_id) && !donated.has(x.participation_id)));
    }
    if (name === "staff") {
        $("staff-editing").value = "";
        $("staff-uuid").disabled = false;
    }
}
 
function editRecord(name, id) {
    openForm(name, true);
    if (name === "activity") {
        const a = state.activities.find(x => x.activity_id === Number(id));
        $("activity-id").value = a.activity_id;
        $("activity-name").value = a.activity_name;
        $("activity-location").value = a.location;
        $("activity-date").value = a.activity_date;
        $("activity-start").value = hhmm(a.start_time);
        $("activity-end").value = hhmm(a.end_time);
        $("activity-status").value = a.activity_status;
    }
    if (name === "donor") {
        const d = donorById(Number(id));
        $("donor-id").value = d.donor_id;
        $("first-name").value = d.first_name;
        $("middle-name").value = d.middle_name || "";
        $("last-name").value = d.last_name;
        $("birthdate").value = d.birthdate;
        $("sex").value = d.sex || "";
        $("blood-type").value = d.blood_type || "";
        $("contact").value = d.contact_number || "";
        $("address").value = d.address || "";
        $("donor-status").value = d.donor_status;
        $("consent-given").checked = d.consent_given;
        $("consent-recorded-note").textContent = d.consent_recorded_at
            ? "Consent recorded " + new Date(d.consent_recorded_at).toLocaleString() : "";
        $("join-activity-wrap").classList.add("hidden");
    }
    if (name === "screening") {
        const s = state.screenings.find(x => x.screening_id === Number(id));
        $("screening-id").value = s.screening_id;
        fillParticipationSelect("screening-participation", [participationById(s.participation_id) || { participation_id: s.participation_id }], s.participation_id);
        $("screening-participation").disabled = true;
        $("systolic").value = s.systolic_bp ?? "";
        $("diastolic").value = s.diastolic_bp ?? "";
        $("weight").value = s.weight_kg ?? "";
        $("hemoglobin").value = s.hemoglobin_g_dl ?? "";
        $("screening-outcome").value = s.screening_outcome;
        $("outcome-reason").value = s.outcome_reason || "";
        $("screening-notes").value = s.notes || "";
        updateReasonField();
    }
    if (name === "donation") {
        const d = state.donations.find(x => x.donation_id === Number(id));
        $("donation-id").value = d.donation_id;
        fillParticipationSelect("donation-participation", [participationById(d.participation_id) || { participation_id: d.participation_id }], d.participation_id);
        $("donation-participation").disabled = true;
        $("bag-serial").value = d.bag_serial_no;
        $("volume").value = d.volume_ml ?? "";
        $("donation-status").value = d.donation_status;
    }
    if (name === "staff") {
        const s = staffById(id);
        $("staff-editing").value = s.id;
        $("staff-uuid").value = s.id;
        $("staff-uuid").disabled = true;
        $("staff-fullname").value = s.full_name;
        $("staff-role-select").value = s.role;
        $("staff-account-status").value = s.account_status;
    }
}
 
/* Reason rule: required for deferred, optional for rejected, not allowed for accepted. */
function updateReasonField() {
    const outcome = $("screening-outcome").value;
    const input = $("outcome-reason");
    input.disabled = outcome === "accepted";
    input.required = outcome === "deferred";
    if (outcome === "accepted") input.value = "";
    $("outcome-reason-label").textContent = outcome === "deferred" ? "Reason (required)"
        : outcome === "rejected" ? "Reason (optional)" : "Reason (not used for Accepted)";
    $("outcome-reason-hint").textContent = outcome === "deferred" ? "A deferred outcome must have a reason."
        : outcome === "accepted" ? "An accepted outcome cannot have a reason." : "";
}
$("screening-outcome").addEventListener("change", updateReasonField);
 
/* ---------- Submit handlers ---------- */
async function afterSave(name, message) {
    closeForm(name);
    await loadAll();
    showSuccess(message);
}
 
$("new-activity").addEventListener("submit", e => {
    e.preventDefault();
    guarded(e.target, async () => {
        const start = $("activity-start").value, end = $("activity-end").value;
        if (end <= start) throw new Error("End time must be after start time.");
        const payload = {
            activity_name: $("activity-name").value.trim(),
            location: $("activity-location").value.trim(),
            activity_date: $("activity-date").value,
            start_time: start,
            end_time: end,
            activity_status: $("activity-status").value
        };
        const id = $("activity-id").value;
        await (id ? api("PATCH", "/api/activities/" + id, payload) : api("POST", "/api/activities", payload));
        await afterSave("activity", "Activity saved.");
    });
});
 
$("new-donor").addEventListener("submit", e => {
    e.preventDefault();
    guarded(e.target, async () => {
        const id = $("donor-id").value;
        const consent = $("consent-given").checked;
        const payload = {
            first_name: $("first-name").value.trim(),
            middle_name: nullIfEmpty($("middle-name").value.trim()),
            last_name: $("last-name").value.trim(),
            birthdate: $("birthdate").value,
            sex: nullIfEmpty($("sex").value),
            blood_type: nullIfEmpty($("blood-type").value),
            contact_number: nullIfEmpty($("contact").value.trim()),
            address: nullIfEmpty($("address").value.trim()),
            donor_status: $("donor-status").value,
            consent_given: consent          // the server stamps the consent time
        };
        // Duplicate-donor WARNING (not a block): same name and birthdate.
        const dup = state.donors.find(d => d.donor_id !== Number(id)
            && d.first_name.toLowerCase() === payload.first_name.toLowerCase()
            && d.last_name.toLowerCase() === payload.last_name.toLowerCase()
            && d.birthdate === payload.birthdate);
        if (dup && !confirm(\`A donor with the same name and birthdate already exists (DON-\${pad(dup.donor_id)}). Save anyway?\`)) return;
 
        if (id) {
            await api("PATCH", "/api/donors/" + id, payload);
        } else {
            // With an activity chosen, the server saves donor + participation in ONE transaction.
            const activityId = $("join-activity").value;
            await api("POST", "/api/donors", activityId ? { ...payload, activity_id: Number(activityId) } : payload);
        }
        await afterSave("donor", "Donor saved.");
    });
});
 
$("new-screening").addEventListener("submit", e => {
    e.preventDefault();
    guarded(e.target, async () => {
        const outcome = $("screening-outcome").value;
        const reason = $("outcome-reason").value.trim();
        if (outcome === "deferred" && !reason) throw new Error("A deferred outcome needs a reason.");
        const sys = numOrNull($("systolic").value), dia = numOrNull($("diastolic").value);
        if (sys !== null && dia !== null && dia >= sys) throw new Error("Diastolic pressure must be lower than systolic pressure.");
        const id = $("screening-id").value;
        const payload = {
            systolic_bp: numOrNull($("systolic").value),
            diastolic_bp: numOrNull($("diastolic").value),
            weight_kg: numOrNull($("weight").value),
            hemoglobin_g_dl: numOrNull($("hemoglobin").value),
            screening_outcome: outcome,
            outcome_reason: outcome === "accepted" ? null : nullIfEmpty(reason),
            notes: nullIfEmpty($("screening-notes").value.trim())
        };
        if (id) {
            await api("PATCH", "/api/screenings/" + id, payload);
        } else {
            const pid = $("screening-participation").value;
            if (!pid) throw new Error("Choose a participation.");
            // screened_by is set by the server from your verified login, not sent from here.
            await api("POST", "/api/screenings", { ...payload, participation_id: Number(pid) });
        }
        await afterSave("screening", "Screening saved.");
    });
});
 
$("new-donation").addEventListener("submit", e => {
    e.preventDefault();
    guarded(e.target, async () => {
        const id = $("donation-id").value;
        if ($("donation-status").value === "completed" && !(Number($("volume").value) > 0)) {
            throw new Error("A completed donation needs a volume above 0 ml.");
        }
        const payload = {
            bag_serial_no: $("bag-serial").value.trim(),
            volume_ml: numOrNull($("volume").value),
            donation_status: $("donation-status").value
        };
        if (id) {
            await api("PATCH", "/api/donations/" + id, payload);
        } else {
            const pid = $("donation-participation").value;
            if (!pid) throw new Error("Choose an accepted participation.");
            // recorded_by is set by the server from your verified login.
            await api("POST", "/api/donations", { ...payload, participation_id: Number(pid) });
        }
        await afterSave("donation", "Donation saved.");
    });
});
 
$("new-staff").addEventListener("submit", e => {
    e.preventDefault();
    guarded(e.target, async () => {
        const editing = $("staff-editing").value;
        const payload = {
            full_name: $("staff-fullname").value.trim(),
            role: $("staff-role-select").value,
            account_status: $("staff-account-status").value
        };
        if (editing) await api("PATCH", "/api/staff/" + editing, payload);
        else await api("POST", "/api/staff", { id: $("staff-uuid").value.trim(), ...payload });
        await afterSave("staff", "Staff profile saved.");
    });
});
 
/* ---------- Clicks (event delegation) ---------- */
document.addEventListener("click", async e => {
    const nav = e.target.closest(".nav-link");
    if (nav) return showPage(nav.dataset.page);
    const go = e.target.closest("[data-goto]");
    if (go) return showPage(go.dataset.goto);
    const add = e.target.closest("[data-new]");
    if (add) return newForm(add.dataset.new);
    const close = e.target.closest("[data-close]");
    if (close) return closeForm(close.dataset.close);
 
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.tagName === "SELECT") return;
    const id = btn.dataset.id;
    try {
        switch (btn.dataset.action) {
            case "logout": await sb.auth.signOut(); break;
            case "print": window.print(); break;
            case "edit-activity": editRecord("activity", id); break;
            case "edit-donor": editRecord("donor", id); break;
            case "edit-screening": editRecord("screening", id); break;
            case "edit-donation": editRecord("donation", id); break;
            case "edit-staff": editRecord("staff", id); break;
            case "manage-activity":
                state.openActivity = Number(id);
                renderDetail();
                $("activity-detail").scrollIntoView({ behavior: "smooth", block: "start" });
                break;
            case "close-detail": state.openActivity = null; renderDetail(); break;
            case "delete-activity":
                if (!confirm("Delete this activity? This works only if it has no donors or staff.")) break;
                await api("DELETE", "/api/activities/" + id);
                if (state.openActivity === Number(id)) state.openActivity = null;
                await loadAll(); showSuccess("Activity deleted.");
                break;
            case "add-participant": {
                const donorId = $("add-participant-select").value;
                if (!donorId) break;
                await api("POST", "/api/participations", { activity_id: state.openActivity, donor_id: Number(donorId) });
                await loadAll(); break;
            }
            case "remove-participant":
                if (!confirm("Remove this donor from the activity?")) break;
                await api("DELETE", "/api/participations/" + id);
                await loadAll(); break;
            case "add-assignment": {
                const staffId = $("add-staff-select").value;
                if (!staffId) break;
                await api("POST", "/api/assignments", { activity_id: state.openActivity, staff_id: staffId });
                await loadAll(); break;
            }
            case "remove-assignment":
                await api("DELETE", "/api/assignments/" + id);
                await loadAll(); break;
        }
    } catch (err) {
        showError(err);
    }
});
 
document.addEventListener("change", async e => {
    const sel = e.target.closest('[data-action="participation-status"]');
    if (!sel) return;
    try {
        await api("PATCH", "/api/participations/" + sel.dataset.id, { participation_status: sel.value });
        showSuccess("Attendance updated.");
        await loadAll();
    } catch (err) {
        showError(err);
        await loadAll();
    }
});
 
$("activity-search").addEventListener("input", renderActivities);
$("donor-search").addEventListener("input", renderDonors);
 
/* ---------- Boot ---------- */
(async () => {
    const { data } = await sb.auth.getSession();
    if (!data.session) showLogin();
    // If a session exists, onAuthStateChange (INITIAL_SESSION) starts it.
})();
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
