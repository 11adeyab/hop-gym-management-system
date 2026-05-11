# Development Chapter — HOP Boxing Academy Booking System

---

## 1. System Overview

The HOP Boxing Academy Booking System is a full-stack web application built to replace a manual, paper-based session booking process. The system provides three distinct interfaces:

- **Public pages** — a landing page, login form, and registration form accessible to anyone.
- **Member dashboard** — a protected single-page application allowing registered members to browse sessions, make bookings, manage their bookings, and purchase memberships.
- **Admin dashboard** — a protected single-page application allowing staff to manage the timetable, scan QR codes for attendance, view and edit customer and staff accounts, and view revenue reports.

The back end is a Node.js/Express server connected to a MySQL database. The front end is rendered server-side for page routing, with client-side JavaScript driving the dashboard views via API calls and HTML `<template>` elements.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Web framework | Express.js |
| Database | MySQL |
| Authentication | express-session (server-side sessions) |
| Password security | bcrypt (salt factor 10) |
| Payments | Stripe Checkout |
| Email | Nodemailer (Gmail SMTP) |
| QR codes | qrcode (generation), html5-qrcode (scanning) |
| Front end | Vanilla HTML/CSS/JavaScript |
| Font | Montserrat (Google Fonts) |
| Environment secrets | dotenv |

---

## 3. Architecture

### 3.1 Directory Structure

```
/
├── svr.js               — Express server, all API routes
├── public/              — Unauthenticated pages (index, login, register)
│   └── src/             — Client-side JS for public pages
├── private/             — Member dashboard (served at /dashboard)
│   └── script.js        — Member dashboard client-side logic
├── admin/               — Admin dashboard (served at /admin)
│   └── script.js        — Admin dashboard client-side logic
└── .env                 — Database credentials, Stripe keys (not committed)
```

### 3.2 Route Protection

Three tiers of access are enforced server-side before any file is served:

1. **Public** — no session required (`/`, `/login`, `/register`).
2. **Member** — valid session required (`/dashboard`). Users without a session are redirected to `/login`.
3. **Admin** — valid session with `is_admin === true` required (`/admin`). Non-admin users are redirected to `/dashboard`.

The `Cache-Control: no-store` header is set on page routes so the browser always re-validates rather than serving a stale cached copy, which would otherwise allow a logged-out user to navigate back to the dashboard using the browser's back button.

### 3.3 Single-Page Application Pattern

Both dashboards use a SPA pattern without a front-end framework. Each view is defined in a `<template>` element inside the HTML file. When a navigation link is clicked, `showView()` clones the relevant template content, inserts it into the `<main>` element, and then calls a data-loading function for that view. This approach keeps the page shell (sidebar, nav) static while only the main content changes, avoiding full page reloads.

---

## 4. Features Implemented

### 4.1 User Registration

Members register via `/register` by providing their first name, last name, date of birth, gender, email address, phone number, and password. The date of birth is captured using three separate fields — a day select, a month select, and a year number input — which are assembled into a `YYYY-MM-DD` string before submission. This was chosen over a single `<input type="date">` because the native date picker renders inconsistently across browsers and the three-field layout is more accessible on mobile.

Passwords are hashed using bcrypt with a salt factor of 10 before being stored in the database. The plain-text password is never persisted.

### 4.2 Login and Session Management

Login queries the database for the user by email address, then uses `bcrypt.compare()` to verify the submitted password against the stored hash. If both checks pass, a server-side session is created (via express-session) storing the user's ID, name, email, gender, date of birth, and `is_admin` flag. Admin users are redirected to `/admin`; regular members are redirected to `/dashboard`.

### 4.3 Member Dashboard — Overview

On loading the overview, three API calls are made in parallel using `Promise.all`: `/api/user` for the user's name, `/api/bookings` for all their bookings, and `/api/membership` for membership status. A personalised greeting is generated based on the current hour (Good Morning, Good Afternoon, Good Evening). Three statistics are displayed: total number of bookings made, attendance rate (number of attended sessions as a percentage of sessions that have already passed), and current membership status. A list of upcoming bookings is rendered below the stats.

### 4.4 Member Dashboard — Book Sessions

Sessions are displayed in a 7-column calendar grid, one column per day of the week. The user can navigate forwards and backwards by week. Each session card shows the session name, time, and remaining spaces. Clicking a card opens a modal with full session details and a "Book" button.

Booking creates a Stripe Checkout session on the server and redirects the user to Stripe's hosted payment page. After payment, Stripe redirects back to `/booking/success`, which verifies the payment with the Stripe API before writing the booking row to the database. A confirmation email containing a QR code is then sent to the member.

Validation is applied server-side before the Stripe redirect is created:
- The session date must not be in the past.
- The session must not have already started or ended (checked by comparing current time against start and end time on same-day sessions).
- The session must have remaining capacity.
- The user must not have already booked the same session.
- The new booking must not overlap in time with an existing booking on the same date.
- If the user has an active membership that covers the session's date, individual booking is not required, and the action is blocked with an explanatory message.
- The user's age and gender must meet the session's eligibility requirements.

### 4.5 Member Dashboard — My Bookings

All bookings are displayed and filterable by three tabs: Upcoming, Missed, and Attended. Each booking card shows the QR code image, session name, date, time, and attendance status. Upcoming bookings can be cancelled, which deletes the booking record and restores one space to the session's capacity. Cancelling a past session is blocked server-side.

### 4.6 Member Dashboard — Membership

Members can purchase one of three membership tiers: Day Pass (£5), Weekly Pass (£20), or Monthly Pass (£50). Membership purchase follows the same Stripe Checkout pattern as session booking. An active membership covers all sessions within its date range; the member can view which sessions are covered without booking individually.

### 4.7 Admin Dashboard — Timetable Management

Admins can view all sessions in a weekly calendar grid with the same layout as the member timetable. Sessions can be added, edited, or deleted. Server-side validation enforces that session dates cannot be in the past, duration must be 1 or 2 hours, capacity must be at least 1, and gender eligibility must be one of Any/Male/Female. Deleting a session also deletes all associated bookings and attendance records in dependency order to avoid foreign key violations.

### 4.8 Admin Dashboard — QR Code Scanner

The admin dashboard includes a QR scanner using the html5-qrcode library. When a member presents their booking QR code, the scanner decodes it and submits it to `/attendance`. The server validates:
- The QR code exists in the bookings table.
- The current date matches the session date.
- The current time is within the valid check-in window (up to 30 minutes before the session start, up to the session end).
- The member has not already checked in.

The check-in response includes whether the member was early, on time, or how many minutes late.

### 4.9 Admin Dashboard — Customer and Staff Management

Admins can view all customer accounts with their email address, edit their personal details, and delete their account. Deleting a customer cascades through attendance records, bookings, memberships, and payment records before removing the user row. Admins can also create staff accounts (which sets `is_admin = 1`), edit staff details, and delete staff. A staff member cannot delete their own account.

### 4.10 Admin Dashboard — Revenue Reports

The reports view fetches all paid booking and membership payment records and displays them in a sortable table showing the member name, description, date, and amount. Aggregate totals are shown for total revenue, revenue from bookings, and revenue from memberships. The admin can filter to show only bookings, only memberships, or all payments.

### 4.11 Responsive Design

All three public pages and both dashboards are fully responsive. On screens wider than 700px, the sidebar is permanently visible. On screens 700px and below, the sidebar is hidden off-screen (`transform: translateX(-220px)`) and a hamburger button in a top bar toggles it open by sliding it in from the left. A semi-transparent overlay covers the main content while the sidebar is open and closes it when tapped. The 7-day calendar grid uses a scroll wrapper (`overflow-x: auto`) so users can swipe horizontally to see all columns on narrow screens.

---

## 5. Design Decisions

### 5.1 Brand Colour System

A CSS custom property system was adopted across all pages so that the brand palette is defined once and applied consistently:

| Variable | Value | Usage |
|---|---|---|
| `--primary` | `#0F71F0` | Buttons, links, active states, hero background |
| `--primary-bg` | `#B2D4FC` | Hover states, accent backgrounds |
| `--bg` | `#F4F4F4` | Page background, input backgrounds |
| `--white` | `#FFFFFF` | Cards, sidebar, modals |
| `--border` | `#E0E0E0` | All borders and dividers |
| `--text` | `#1A1A1A` | Body text |
| `--muted` | `#A1A1A1` | Labels, secondary text |
| `--danger` | `#D40404` | Error messages, delete actions |

### 5.2 Flat Design

No `border-radius` property is used anywhere in the system. The design prioritises functional clarity — clear hierarchy, readable labels, and sufficient colour contrast — over decorative styling. This was a deliberate design requirement from the outset.

### 5.3 No Front-End Framework

The decision was made to build without a front-end framework (React, Vue, etc.) to keep the project focused on the server-side logic and avoid build tooling complexity. The `<template>` element pattern provides the benefits of client-side view switching without requiring a component system.

---

## 6. Testing

### 6.1 Manual Functional Testing

Each feature was tested manually end-to-end throughout development. This involved running the server locally, navigating to each page, and exercising every interaction. Testing was performed in both a desktop browser (Chrome) and a mobile viewport using Chrome DevTools' device emulator.

### 6.2 Authentication and Authorisation Testing

The following scenarios were verified manually:

| Test | Expected outcome | Result |
|---|---|---|
| Register with valid data | Account created, redirected to login | Pass |
| Register with duplicate email | MySQL constraint error caught, failure message returned | Pass |
| Login with correct credentials | Session created, redirected to appropriate dashboard | Pass |
| Login with wrong password | 401 response, error message displayed | Pass |
| Login with non-existent email | 401 response, error message displayed | Pass |
| Access `/dashboard` without session | Redirected to `/login` | Pass |
| Access `/admin` as regular member | Redirected to `/dashboard` | Pass |
| Navigate back after logout (browser back button) | `Cache-Control: no-store` prevents cached page, server redirects to login | Pass |

### 6.3 Booking Validation Testing

| Test scenario | Expected server response | Result |
|---|---|---|
| Book a session in the past | 400 — session is in the past | Pass |
| Book a session already at capacity | 400 — no spaces left | Pass |
| Book a session that has already started today | 400 — session already started | Pass |
| Book the same session twice | 400 — already booked | Pass |
| Book two sessions that overlap in time | 400 — time clash | Pass |
| Book a session covered by active membership | 400 — covered by membership | Pass |
| Book a session outside the user's eligible age range | 400 — age not eligible | Pass |
| Book a male-only session as a female user | 400 — gender not eligible | Pass |
| Valid booking submission | Stripe checkout URL returned | Pass |

### 6.4 Attendance (QR Check-in) Testing

| Test scenario | Expected response | Result |
|---|---|---|
| Scan valid QR code on correct date, within window | Check-in recorded, timing label returned | Pass |
| Scan valid QR code on wrong date | Invalid for today | Pass |
| Scan QR code more than 30 minutes before session | Too early message with opening time | Pass |
| Scan QR code after session has ended | Session has ended | Pass |
| Scan QR code already used | Already checked in | Pass |
| Scan invalid / unrecognised QR code | Invalid QR code | Pass |

### 6.5 Admin Timetable Validation Testing

| Test scenario | Expected response | Result |
|---|---|---|
| Add session with past date | 400 — date in the past | Pass |
| Add session with duration other than 1 or 2 | 400 — invalid duration | Pass |
| Add session with capacity of 0 | 400 — capacity must be at least 1 | Pass |
| Edit a session in the past | 400 — cannot edit past session | Pass |
| Delete a session with existing bookings | Bookings and attendance cascade-deleted, session removed | Pass |

### 6.6 Payment Flow Testing

Stripe's test card (`4242 4242 4242 4242`) was used throughout development. The following scenarios were tested:

| Scenario | Result |
|---|---|
| Successful booking payment — booking row created, email sent | Pass |
| Successful membership payment — membership row created | Pass |
| User closes Stripe tab without paying — cancelled, no booking created | Pass |
| User revisits `/booking/success` URL a second time — already-processed guard prevents duplicate booking | Pass |

### 6.7 Responsive / Mobile Testing

All pages were tested at 375px width (iPhone SE viewport) and 768px (tablet) using Chrome DevTools. Key checks included:

- Hamburger menu opens and closes the sidebar correctly.
- The overlay closes the sidebar when tapped.
- The calendar grid scrolls horizontally without overflowing the viewport.
- All form fields, buttons, and tables remain usable and legible on small screens.
- The registration form's two-column name row collapses to a single column below 640px.

---

## 7. Problems Encountered and Solutions

### 7.1 UTC Date Off-by-One Bug

**Problem:** JavaScript's `Date.toISOString()` returns dates in UTC. In a UTC+1 timezone (BST), a date like 14 May 2025 at midnight local time is 13 May 2025 at 23:00 UTC. This caused session dates stored or compared as `toISOString().split("T")[0]` to appear one day earlier than intended.

**Solution:** A `toLocalDateStr()` helper function was written that formats dates using local timezone methods (`getFullYear()`, `getMonth()`, `getDate()`) rather than UTC equivalents. All MySQL date columns are also retrieved using `DATE_FORMAT(col, '%Y-%m-%d')`, which returns a plain string bypassing timezone conversion entirely. The `split("T")[0]` approach was removed from all date comparisons.

### 7.2 Calendar Grid Mobile Overflow

**Problem:** The 7-column calendar grid used `grid-template-columns: repeat(7, 1fr)`, which distributed columns equally across the container. On a 375px mobile screen, each column was approximately 54px wide — too narrow to display session information legibly. Setting `min-width` on the column elements alone did not create a scroll container because the parent had `overflow: visible`.

**Solution:** A `.cal-scroll-wrap` wrapper element was added around the grid in the template HTML. This wrapper has `overflow-x: auto` and `-webkit-overflow-scrolling: touch`. The grid's column definition was changed to `repeat(7, minmax(110px, 1fr))` with `min-width: 770px`, guaranteeing each column is at least 110px and the total grid is at least 770px wide. On mobile the wrapper clips to the screen width and the user scrolls horizontally to navigate between days.

### 7.3 Login Fetching All Users

**Problem:** The original login implementation fetched every user row from the database (`SELECT * FROM users`) and iterated through them in JavaScript to find a matching email and password. This was inefficient, exposed all user records in memory for every login attempt, and prevented proper bcrypt comparison because bcrypt is asynchronous.

**Solution:** The query was rewritten to `SELECT * FROM users WHERE email = "..." LIMIT 1`, returning at most one row. `bcrypt.compare()` is then called on that single record. If the email is not found or the password does not match, the same generic error message is returned to avoid user enumeration.

### 7.4 Plaintext Password Storage

**Problem:** Passwords were stored as plaintext strings in the database. This is a critical security vulnerability; a database breach would expose every user's credentials immediately.

**Solution:** The `bcrypt` package was installed (salt factor 10). On registration and staff account creation, passwords are now hashed with `bcrypt.hash()` before the `INSERT` query runs. On login, `bcrypt.compare()` verifies the submitted password against the stored hash. The plain-text password is never stored or logged.

### 7.5 Duplicate Stripe Payment Processing

**Problem:** Stripe redirects the user back to `/booking/success` with a `session_id` query parameter after payment. If the user refreshes the success URL, the success handler would execute again and create a duplicate booking.

**Solution:** A `payment_bookings` table was introduced. When the booking checkout is initiated, a pending row is inserted with `booking_id = NULL`. After Stripe confirms payment, the handler checks whether `booking_id` is already populated on the payment record. If it is, the booking was already processed and the handler returns early. Otherwise it creates the booking, then updates the payment record with the new `booking_id` and a status of `"paid"`. The same pattern was applied to memberships via `payment_memberships`.

### 7.6 Admin Dashboard File Write Collision

**Problem:** During development, a write to `admin/index.html` failed with "File content has changed since it was last read." A background process (likely the IDE's auto-formatter or a linter) had modified the file between the read and the write, causing the update to be rejected to prevent overwriting unsaved changes.

**Solution:** The file was re-read to synchronise its state, and the write was then re-issued successfully. To avoid the issue in future, file writes were performed immediately after reads in the same operation without other tasks in between.

### 7.7 Three-Field Date of Birth Input

**Problem:** The original date of birth field was a single `<input type="date">`. The native browser date picker has inconsistent styling across browsers and renders poorly on some mobile devices. It also returns the date in `YYYY-MM-DD` format on most browsers but is unreliable in older environments.

**Solution:** The field was replaced with three separate controls: a `<select>` for day (1–31, populated via JavaScript to avoid repetitive HTML), a `<select>` for month (01–12 with full month names as labels), and a `<input type="number">` for year (min 1920, max 2015). The JavaScript click handler assembles these into a `YYYY-MM-DD` string using `String(day).padStart(2, "0")` before submitting. This approach is consistent across all browsers and gives full control over layout and styling. The same three-field pattern was applied in the admin staff-creation modal and the edit-user modal.

### 7.8 Session Booking Time Overlap Detection

**Problem:** A member could book two sessions on the same day that ran at overlapping times. The application needed to detect this conflict before confirming the booking.

**Solution:** A MySQL query was added that joins `bookings` with `sessions` for the current user on the target date, then uses `ADDTIME` and `SEC_TO_TIME` to compute end times and checks whether the new session's time window overlaps with any existing booking. Overlap is detected if the new session's start time is before an existing session's end time AND the new session's end time is after an existing session's start time.

### 7.9 QR Code Check-in Window

**Problem:** Allowing check-in at any time before the session ended created edge cases where staff could check someone in hours before the session started, or where members arriving very early would check themselves in remotely.

**Solution:** A 30-minute early check-in window was implemented. The earliest permitted check-in time is 30 minutes before the session start. Check-in after the session end time is also blocked. If a member scans too early, the response tells them the exact time check-in opens. The timing feedback (early, on time, N minutes late) was added to give the scanner operator useful information.

---

## 8. Summary of Changes Made During Development

| Change | Reason |
|---|---|
| Added `Cache-Control: no-store` to all page routes | Prevent back-button access after logout |
| Replaced `toISOString().split("T")[0]` with `toLocalDateStr()` | Fix UTC date off-by-one in BST timezone |
| Added `DATE_FORMAT('%Y-%m-%d')` to all MySQL date selects | Return date strings that bypass JS timezone conversion |
| Replaced `SELECT * FROM users` login query with email-specific query | Performance and security improvement |
| Added bcrypt hashing on register, staff creation, and compare on login | Secure password storage |
| Added `payment_bookings` and `payment_memberships` tables | Prevent duplicate Stripe payment processing |
| Changed timetable from `<table>` rows to 7-column CSS grid | Better visual representation of the weekly schedule |
| Added `.cal-scroll-wrap` with `overflow-x: auto` around calendar grid | Fix mobile horizontal overflow |
| Replaced single `<input type="date">` with 3-field DOB | Cross-browser consistency and mobile usability |
| Added membership coverage check before allowing booking | Prevent redundant individual bookings within membership period |
| Added 30-minute early check-in window to QR attendance | Prevent premature check-in while maintaining a reasonable early buffer |
| Added cascade-delete logic for customer accounts | Satisfy foreign key constraints and leave no orphan records |
| Redesigned all pages to shared brand CSS variable system | Visual consistency across public pages and both dashboards |
| Added hamburger menu with slide-in sidebar for mobile | Usable navigation on narrow screens |
| Added `is_admin` flag check before any admin API route | Prevent privilege escalation by manipulating requests directly |

---

*System developed as part of a final-year project. Server runs on Node.js (Express), database on MySQL, payments via Stripe Checkout API.*
