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

async function rowExists(table, id) {
  const { count, error } = await db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('id', id);

  if (error) throw error;
  return count > 0;
}
async function countRows(table, narrow) {
  let query = db.from(table).select('id', { count: 'exact', head: true });
  if (narrow) query = narrow(query);
  const { count, error } = await query;
  if (error) throw error;
  return count;
}
async function listAll(table) {
  const { data, error } = await db.from(table).select('*').order('id');
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
  const { error } = await db.from('activities').select('id', { head: true, count: 'exact' }).limit(1);
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
<div class="layout">

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

        <nav class="nav-links">
            <button class="nav-link active" data-page="dashboard"><span class="nav-icon">▦</span> Dashboard</button>
            <button class="nav-link" data-page="activities"><span class="nav-icon">▣</span> MBD Activities</button>
            <button class="nav-link" data-page="donors"><span class="nav-icon">♙</span> Donor Records</button>
            <button class="nav-link" data-page="screening"><span class="nav-icon">✓</span> Medical Screening</button>
            <button class="nav-link" data-page="donations"><span class="nav-icon">♥</span> Donation Records</button>
            <button class="nav-link" data-page="reports"><span class="nav-icon">▤</span> Reports</button>
        </nav>

        <div class="sidebar-note">
            <strong>Staff Portal</strong><br>
            Manage mobile blood donation activities and records in one place.
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
                <div class="avatar">SA</div>
                <div class="staff-label">
                    <strong>Staff Administrator</strong>
                    <p style="color:#747b87; margin-top:4px;">Demo account</p>
                </div>
            </div>
        </header>

        <div class="content">

            <div class="notice">
                <strong>Prototype notice:</strong> This demo uses fictional records.
                It is not an official Philippine Red Cross system. Do not enter real
                donor or medical information.
            </div>

            <div class="notice error hidden" id="error-box"></div>

            <!-- DASHBOARD -->
            <section class="page" id="dashboard">
                <div class="welcome">
                    <div>
                        <h2>Welcome to MBDMS</h2>
                        <p>Manage activities, donor registration, screening records,
                           and completed donations.</p>
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
                        <p class="stat-description">Fictional demo records</p>
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
                            <thead><tr><th>Activity</th><th>Date</th><th>Venue</th><th>Status</th></tr></thead>
                            <tbody id="dashboard-activities"></tbody>
                        </table>
                    </div>
                </div>
            </section>

            <!-- ACTIVITIES -->
            <section class="page hidden" id="activities">
                <div class="section-heading">
                    <h2>Mobile Blood Donation Activities</h2>
                    <button class="button" data-toggle="activity-form">+ Add Activity</button>
                </div>

                <div class="panel hidden" id="activity-form">
                    <div class="panel-header"><h2>Create Activity</h2></div>
                    <form id="new-activity">
                        <div class="form-grid">
                            <div class="field full">
                                <label for="activity-name">Activity Name</label>
                                <input id="activity-name" required>
                            </div>
                            <div class="field">
                                <label for="activity-date">Date</label>
                                <input id="activity-date" type="date" required>
                            </div>
                            <div class="field">
                                <label for="activity-venue">Venue</label>
                                <input id="activity-venue" required>
                            </div>
                        </div>
                        <div class="form-actions">
                            <button class="button" type="submit">Save Activity</button>
                            <button class="button secondary" type="button" data-toggle="activity-form">Cancel</button>
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
                            <thead><tr><th>Activity</th><th>Date</th><th>Venue</th><th>Status</th></tr></thead>
                            <tbody id="activity-table"></tbody>
                        </table>
                    </div>
                </div>
            </section>

            <!-- DONORS -->
            <section class="page hidden" id="donors">
                <div class="section-heading">
                    <h2>Donor Records</h2>
                    <button class="button" data-toggle="donor-form">+ Register Donor</button>
                </div>

                <div class="panel hidden" id="donor-form">
                    <div class="panel-header"><h2>Register New Donor</h2></div>
                    <form id="new-donor">
                        <div class="form-grid">
                            <div class="field">
                                <label for="first-name">First Name</label>
                                <input id="first-name" required>
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
                                <label for="contact">Contact Number (Demo)</label>
                                <input id="contact" placeholder="Use fictional data" required>
                            </div>
                        </div>
                        <div class="form-actions">
                            <button class="button" type="submit">Save Donor</button>
                            <button class="button secondary" type="button" data-toggle="donor-form">Cancel</button>
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
                            <thead><tr><th>Donor ID</th><th>Full Name</th><th>Birthdate</th><th>Contact (Demo)</th></tr></thead>
                            <tbody id="donor-table"></tbody>
                        </table>
                    </div>
                </div>
            </section>

            <!-- SCREENING -->
            <section class="page hidden" id="screening">
                <div class="section-heading">
                    <h2>Medical Screening Records</h2>
                    <button class="button" data-toggle="screening-form">+ Record Screening</button>
                </div>

                <div class="notice">
                    Screening outcomes must be assessed and recorded by authorized
                    personnel. This prototype does not determine medical eligibility.
                </div>

                <div class="panel hidden" id="screening-form">
                    <div class="panel-header"><h2>Record Screening Outcome</h2></div>
                    <form id="new-screening">
                        <div class="form-grid">
                            <div class="field">
                                <label for="screening-donor">Donor</label>
                                <select id="screening-donor" required></select>
                            </div>
                            <div class="field">
                                <label for="screening-activity">Activity</label>
                                <select id="screening-activity" required></select>
                            </div>
                            <div class="field">
                                <label for="screening-outcome">Outcome (as assessed by authorized personnel)</label>
                                <select id="screening-outcome" required>
                                    <option value="Cleared">Cleared</option>
                                    <option value="Not cleared">Not cleared</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-actions">
                            <button class="button" type="submit">Save Screening</button>
                            <button class="button secondary" type="button" data-toggle="screening-form">Cancel</button>
                        </div>
                    </form>
                </div>

                <div class="panel">
                    <div class="panel-header"><h2>Screening History</h2></div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Screening ID</th><th>Donor</th><th>Activity</th><th>Outcome</th></tr></thead>
                            <tbody id="screening-table"></tbody>
                        </table>
                    </div>
                </div>
            </section>

            <!-- DONATIONS -->
            <section class="page hidden" id="donations">
                <div class="section-heading">
                    <h2>Donation Records</h2>
                    <button class="button" data-toggle="donation-form">+ Record Donation</button>
                </div>

                <div class="panel hidden" id="donation-form">
                    <div class="panel-header"><h2>Record Completed Donation</h2></div>
                    <form id="new-donation">
                        <div class="form-grid">
                            <div class="field">
                                <label for="donation-donor">Donor</label>
                                <select id="donation-donor" required></select>
                            </div>
                            <div class="field">
                                <label for="donation-activity">Activity</label>
                                <select id="donation-activity" required></select>
                            </div>
                        </div>
                        <div class="form-actions">
                            <button class="button" type="submit">Save Donation</button>
                            <button class="button secondary" type="button" data-toggle="donation-form">Cancel</button>
                        </div>
                    </form>
                </div>

                <div class="panel">
                    <div class="panel-header"><h2>Donation History</h2></div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Donation ID</th><th>Donor</th><th>Activity</th><th>Status</th></tr></thead>
                            <tbody id="donation-table"></tbody>
                        </table>
                    </div>
                </div>
            </section>

            <!-- REPORTS -->
            <section class="page hidden" id="reports">
                <div class="section-heading">
                    <h2>MBD Reports</h2>
                    <div style="display:flex; gap:8px;">
                        <button class="button secondary" id="reset-data">Reset Demo Data</button>
                        <button class="button" onclick="window.print()">Print Report</button>
                    </div>
                </div>

                <div class="panel">
                    <div class="panel-header"><h2>Current Summary</h2></div>
                    <div style="padding:20px; line-height:2;">
                        <p>Total activities: <strong id="report-activities">0</strong></p>
                        <p>Total registered donors: <strong id="report-donors">0</strong></p>
                        <p>Total screening records: <strong id="report-screenings">0</strong></p>
                        <p>Completed donations: <strong id="report-donations">0</strong></p>
                        <p style="color:#747b87;font-size:12px;margin-top:12px;">
                            These figures are calculated from the server's demo data.
                        </p>
                    </div>
                </div>
            </section>

            <div class="footer">
                MBDMS Student Project Prototype | Fictional Data Only
            </div>
        </div>
    </main>
</div>

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
        donorId: $("screening-donor").value,
        activityId: $("screening-activity").value,
        outcome: $("screening-outcome").value
    }, "screening-form"));

$("new-donation").addEventListener("submit", e =>
    submitForm(e, "/api/donations", {
        donorId: $("donation-donor").value,
        activityId: $("donation-activity").value
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
    countRows('activities'),
    countRows('donors'),
    countRows('screenings'),
    countRows('donations', (q) => q.eq('status', 'Completed'))
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
  res.json(await listAll('activities'));
}));

app.post('/api/activities', handler(async (req, res) => {
  const name = text(req.body.name);
  const date = text(req.body.date);
  const venue = text(req.body.venue);

  if (!name || !date || !venue) throw new HttpError(400, 'Name, date and venue are required.');
  if (!isIsoDate(date)) throw new HttpError(400, 'Invalid date.');

  const { data, error } = await db
    .from('activities')
    .insert({ name, date, venue, status: 'Scheduled' })
    .select()
    .single();
  if (error) throw error;
  res.status(201).json(data);
}));

// ==========================================
// API: DONORS
// ==========================================
app.get('/api/donors', handler(async (req, res) => {
  res.json(await listAll('donors'));
}));

app.post('/api/donors', handler(async (req, res) => {
  const first = text(req.body.first);
  const last = text(req.body.last);
  const birthdate = text(req.body.birthdate);
  const contact = text(req.body.contact);

  if (!first || !last || !birthdate || !contact) throw new HttpError(400, 'All donor fields are required.');
  if (!isIsoDate(birthdate)) throw new HttpError(400, 'Invalid birthdate.');

  const { data, error } = await db
    .from('donors')
    .insert({ first, last, birthdate, contact })
    .select()
    .single();
  if (error) throw error;
  res.status(201).json(data);
}));

// ==========================================
// API: SCREENINGS
// Outcomes are recorded by authorized personnel; this app never decides eligibility.
// ==========================================
const OUTCOMES = ['Cleared', 'Not cleared'];
const presentScreening = (r) => ({ id: r.id, donorId: r.donor_id, activityId: r.activity_id, outcome: r.outcome });

app.get('/api/screenings', handler(async (req, res) => {
  res.json((await listAll('screenings')).map(presentScreening));
}));

app.post('/api/screenings', handler(async (req, res) => {
  const donorId = Number(req.body.donorId);
  const activityId = Number(req.body.activityId);
  const outcome = text(req.body.outcome);

  if (!isPositiveInt(donorId) || !(await rowExists('donors', donorId))) throw new HttpError(400, 'Unknown donor.');
  if (!isPositiveInt(activityId) || !(await rowExists('activities', activityId))) throw new HttpError(400, 'Unknown activity.');
  if (!OUTCOMES.includes(outcome)) throw new HttpError(400, 'Invalid outcome.');

  const { data, error } = await db
    .from('screenings')
    .insert({ donor_id: donorId, activity_id: activityId, outcome })
    .select()
    .single();
  if (error) throw error;
  res.status(201).json(presentScreening(data));
}));

// ==========================================
// API: DONATIONS
// ==========================================
const UNIQUE_VIOLATION = '23505';
const presentDonation = (r) => ({ id: r.id, donorId: r.donor_id, activityId: r.activity_id, status: r.status });

app.get('/api/donations', handler(async (req, res) => {
  res.json((await listAll('donations')).map(presentDonation));
}));

// A donation needs the donor's most recent screening for that activity to be "Cleared".
app.post('/api/donations', handler(async (req, res) => {
  const donorId = Number(req.body.donorId);
  const activityId = Number(req.body.activityId);

  if (!isPositiveInt(donorId) || !(await rowExists('donors', donorId))) throw new HttpError(400, 'Unknown donor.');
  if (!isPositiveInt(activityId) || !(await rowExists('activities', activityId))) throw new HttpError(400, 'Unknown activity.');

  const { data: recent, error: lookupError } = await db
    .from('screenings')
    .select('outcome')
    .eq('donor_id', donorId)
    .eq('activity_id', activityId)
    .order('id', { ascending: false })
    .limit(1);
  if (lookupError) throw lookupError;

  if (!recent.length || recent[0].outcome !== 'Cleared') {
    throw new HttpError(400, "Donor needs a 'Cleared' screening record for this activity first.");
  }

  const { data, error } = await db
    .from('donations')
    .insert({ donor_id: donorId, activity_id: activityId, status: 'Completed' })
    .select()
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new HttpError(400, 'Donation already recorded for this donor and activity.');
    throw error;
  }
  res.status(201).json(presentDonation(data));
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
  console.log(Blood Drive Manager listening on port ${PORT});
  checkConnection();
});
