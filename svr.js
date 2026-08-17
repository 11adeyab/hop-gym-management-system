if (process.env.NODE_ENV !== "production") {
    require("dotenv").config();
}
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const express = require("express");
const path    = require("path");
const crypto  = require("crypto");
const Database = require("better-sqlite3");
const bcrypt  = require("bcrypt");
const qrcode = require("qrcode");
const nodemailer = require("nodemailer");
const session = require("express-session");
const app = express();

const db = new Database(path.resolve(__dirname, "database.db"));
db.pragma("journal_mode = WAL");

// Wraps better-sqlite3 (synchronous) in a Promise so all routes can use async/await unchanged
function query(sql) {
    return new Promise((resolve, reject) => {
        try {
            const stmt  = db.prepare(sql);
            const upper = sql.trimStart().toUpperCase();
            if (upper.startsWith("SELECT") || upper.startsWith("WITH")) {
                resolve(stmt.all());
            } else {
                resolve(stmt.run());
            }
        } catch (e) {
            reject(e);
        }
    });
}

function initDb() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name    TEXT NOT NULL,
            last_name     TEXT NOT NULL,
            date_of_birth TEXT,
            gender        TEXT,
            email         TEXT UNIQUE NOT NULL,
            phone         TEXT,
            password      TEXT NOT NULL,
            is_admin      INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sessions (
            session_id         INTEGER PRIMARY KEY AUTOINCREMENT,
            session_name       TEXT NOT NULL,
            start_date         TEXT NOT NULL,
            start_time         TEXT NOT NULL,
            duration           INTEGER NOT NULL,
            instructor         TEXT NOT NULL,
            capacity           INTEGER NOT NULL,
            gender_eligibility TEXT NOT NULL DEFAULT 'Any',
            min_age            INTEGER NOT NULL DEFAULT 0,
            max_age            INTEGER NOT NULL DEFAULT 100,
            qr_code            TEXT UNIQUE,
            price_pence        INTEGER NOT NULL DEFAULT 300
        );
        CREATE TABLE IF NOT EXISTS bookings (
            booking_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            session_id INTEGER NOT NULL,
            qr_code    TEXT
        );
        CREATE TABLE IF NOT EXISTS attendance (
            attendance_id    INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_id       INTEGER,
            user_id          INTEGER,
            session_id       INTEGER,
            checkin_datetime TEXT
        );
        CREATE TABLE IF NOT EXISTS memberships (
            membership_id   INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            membership_type TEXT NOT NULL,
            start_date      TEXT NOT NULL,
            end_date        TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'active',
            qr_code         TEXT UNIQUE
        );
        CREATE TABLE IF NOT EXISTS payment_memberships (
            payment_id        INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            membership_type   TEXT NOT NULL,
            start_date        TEXT NOT NULL,
            end_date          TEXT NOT NULL,
            stripe_session_id TEXT UNIQUE,
            amount_pence      INTEGER NOT NULL,
            status            TEXT NOT NULL DEFAULT 'pending',
            membership_id     INTEGER,
            created_at        TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS payment_bookings (
            payment_id        INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            session_id        INTEGER NOT NULL,
            stripe_session_id TEXT UNIQUE,
            amount_pence      INTEGER NOT NULL,
            status            TEXT NOT NULL DEFAULT 'pending',
            booking_id        INTEGER,
            created_at        TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS gym_memberships (
            gym_membership_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            membership_type   TEXT NOT NULL,
            start_date        TEXT NOT NULL,
            end_date          TEXT NOT NULL,
            status            TEXT NOT NULL DEFAULT 'active',
            qr_code           TEXT UNIQUE NOT NULL,
            has_boxing_awards INTEGER NOT NULL DEFAULT 0,
            created_at        TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS payment_gym_memberships (
            payment_id        INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            membership_type   TEXT NOT NULL,
            start_date        TEXT NOT NULL,
            end_date          TEXT NOT NULL,
            stripe_session_id TEXT UNIQUE,
            amount_pence      INTEGER NOT NULL,
            status            TEXT NOT NULL DEFAULT 'pending',
            gym_membership_id INTEGER,
            include_awards    INTEGER NOT NULL DEFAULT 0,
            created_at        TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS payment_boxing_awards (
            payment_id        INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            gym_membership_id INTEGER NOT NULL,
            stripe_session_id TEXT UNIQUE,
            amount_pence      INTEGER NOT NULL,
            status            TEXT NOT NULL DEFAULT 'pending',
            created_at        TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS pricing (
            price_key   TEXT PRIMARY KEY,
            value_pence INTEGER NOT NULL,
            label       TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_registrations (
            pending_id        INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name        TEXT NOT NULL,
            last_name         TEXT NOT NULL,
            date_of_birth     TEXT NOT NULL,
            gender            TEXT NOT NULL,
            email             TEXT NOT NULL,
            phone             TEXT,
            password_hash     TEXT NOT NULL,
            membership_type   TEXT,
            include_awards    INTEGER NOT NULL DEFAULT 0,
            stripe_session_id TEXT UNIQUE,
            amount_pence      INTEGER NOT NULL DEFAULT 0,
            status            TEXT NOT NULL DEFAULT 'pending',
            created_at        TEXT DEFAULT (datetime('now'))
        );
    `);

    // Seed pricing rows if the table is empty
    const priceCount = db.prepare("SELECT COUNT(*) AS c FROM pricing").get();
    if (priceCount.c === 0) {
        db.exec(`
            INSERT INTO pricing (price_key, value_pence, label) VALUES
                ('pass_day',               500,  'Day Ticket'),
                ('pass_weekly',           1000,  'Weekly Ticket'),
                ('pass_monthly',          4000,  'Monthly Ticket'),
                ('membership_non_carded', 1000,  'Non-Carded Membership'),
                ('membership_carded',     2500,  'Carded Membership'),
                ('session_minnows',        300,  'Minnows Session (under 10)'),
                ('session_standard',       400,  'Standard Session'),
                ('awards_with_membership',1000,  'Boxing Awards Programme (with membership)'),
                ('awards_standalone',     2000,  'Boxing Awards Programme (standalone)');
        `);
    }

    // Migrate: add columns to sessions if they don't exist yet
    const sessionCols = db.prepare("PRAGMA table_info(sessions)").all();
    if (!sessionCols.some(c => c.name === "membership_eligibility")) {
        db.exec("ALTER TABLE sessions ADD COLUMN membership_eligibility TEXT NOT NULL DEFAULT 'Any'");
    }
    if (!sessionCols.some(c => c.name === "description")) {
        db.exec("ALTER TABLE sessions ADD COLUMN description TEXT NOT NULL DEFAULT ''");
    }
    if (!sessionCols.some(c => c.name === "session_type")) {
        db.exec("ALTER TABLE sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'standard'");
    }

    // Migrate: add has_contact_awards to gym_memberships
    const gymMemCols = db.prepare("PRAGMA table_info(gym_memberships)").all();
    if (!gymMemCols.some(c => c.name === "has_contact_awards")) {
        db.exec("ALTER TABLE gym_memberships ADD COLUMN has_contact_awards INTEGER NOT NULL DEFAULT 0");
    }

    // Migrate: add award_type to payment_boxing_awards
    const awardPayCols = db.prepare("PRAGMA table_info(payment_boxing_awards)").all();
    if (!awardPayCols.some(c => c.name === "award_type")) {
        db.exec("ALTER TABLE payment_boxing_awards ADD COLUMN award_type TEXT NOT NULL DEFAULT 'non_contact'");
    }

    // Seed new pricing keys (INSERT OR IGNORE so existing custom values are preserved)
    db.exec(`
        INSERT OR IGNORE INTO pricing (price_key, value_pence, label) VALUES
            ('session_saturday',     500, 'Saturday Club Session'),
            ('session_holiday_camp', 600, 'Holiday/Fitness Camp'),
            ('awards_contact',      2000, 'Contact Boxing Awards (Awards 4-6)');
        UPDATE pricing SET value_pence = 1800, label = 'Non-Contact Boxing Awards (with membership, 10% off)'
            WHERE price_key = 'awards_with_membership' AND value_pence = 1000;
        UPDATE pricing SET label = 'Non-Contact Boxing Awards (Awards 1-3, standalone)'
            WHERE price_key = 'awards_standalone' AND label NOT LIKE '%Non-Contact%';
    `);

    // Seed a default admin account if none exists yet
    const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE is_admin = 1").get();
    if (adminCount.c === 0) {
        const hash = bcrypt.hashSync("Admin@123", 10);
        db.prepare("INSERT INTO users (first_name, last_name, date_of_birth, gender, email, phone, password, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, 1)").run("Admin", "User", "1990-01-01", "Male", "admin@hop.local", "07700000000", hash);
        console.log("Default admin created — email: admin@hop.local  password: Admin@123  (change this after first login)");
    }
}

initDb();
console.log("SQLite database ready: database.db");

//this function formats the date to YYYY-MM-DD using local tiemzones
function toLocalDateStr(date) {
    if (!(date instanceof Date)) {
        return String(date).split("T")[0];
    }
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

// Reads all rows from the pricing table and returns them as { price_key: value_pence }
async function getPrices() {
    const rows = await query(`SELECT price_key, value_pence FROM pricing`);
    const map = {};
    for (const r of rows) map[r.price_key] = r.value_pence;
    return map;
}

function computeAge(dobStr) {
    const today = new Date();
    const birth = new Date(dobStr);
    if (isNaN(birth.getTime())) return null;
    let age = today.getFullYear() - birth.getFullYear();
    if (today.getMonth() < birth.getMonth() ||
        (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
    return age;
}

//connects to the SMPT gmail server to automatically send emails
const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465, 
    secure: true,
    auth: { 
        user: "11adeyab070704@gmail.com", 
        pass: " qjec xbeu qmhn cmus" }
    }
);

//used to store and maange user sessions on the server
app.use(session({ 
    secret: "this is my secret",
    resave: false,
    saveUninitialized: false 
}));

app.use(express.json());

// ── Auth-protected static routes ─────────────────────────────────────────────
// These must come before the generic public static so their auth checks run first

app.use("/dashboard", (req, res, next) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }
    next();
}, express.static(path.resolve(__dirname, "private")));

app.use("/admin", (req, res, next) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }
    if (!req.session.user.is_admin) {
        return res.redirect("/dashboard");
    }
    next();
}, express.static(path.resolve(__dirname, "admin")));

app.use("/node_modules", express.static(path.resolve(__dirname, "node_modules")));


//Public page routes (BEFORE generic static so session checks run)
// no-store prevents the browser from caching these pages, so the back button
// always re-validates with the server instead of showing a stale cached copy.

app.get("/", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!req.session.user){
        return res.sendFile(path.resolve(__dirname, "public", "index.html"));
    } 
    if (req.session.user.is_admin) {
        return res.redirect("/admin");
    }
    return res.redirect("/dashboard");
});

app.get("/login", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!req.session.user) {
        return res.sendFile(path.resolve(__dirname, "public", "login.html"));
    }
    if (req.session.user.is_admin) {
        return res.redirect("/admin");
    }
    return res.redirect("/dashboard");
});

app.get("/register", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!req.session.user) {
        return res.sendFile(path.resolve(__dirname, "public", "register.html"));
    }
    if (req.session.user.is_admin) {
        return res.redirect("/admin");
    }
    return res.redirect("/dashboard");
});

app.get("/api/register/prices", async (req, res) => {
    try {
        const prices = await getPrices();
        return res.json({
            membership_non_carded:  prices.membership_non_carded  || 1000,
            membership_carded:      prices.membership_carded      || 2500,
            awards_with_membership: prices.awards_with_membership || 1800,
            awards_standalone:      prices.awards_standalone      || 2000,
            awards_contact:         prices.awards_contact         || 2000
        });
    } catch (_) {
        return res.status(500).json({ message: "Pricing unavailable." });
    }
});

app.get("/register/success", async (req, res) => {
    const stripeSessionId = req.query.session_id;
    if (!stripeSessionId) return res.redirect("/register");
    try {
        const rows = await query(`SELECT * FROM pending_registrations WHERE stripe_session_id = '${stripeSessionId}' LIMIT 1`);
        if (rows.length === 0) return res.redirect("/register");
        const pending = rows[0];

        if (pending.status === 'paid') {
            const users = await query(`SELECT * FROM users WHERE email = '${pending.email}' LIMIT 1`);
            if (users.length > 0) {
                req.session.user = {
                    user_id: users[0].user_id, first_name: users[0].first_name, last_name: users[0].last_name,
                    email: users[0].email, phone: users[0].phone, dob: users[0].date_of_birth,
                    gender: users[0].gender, is_admin: users[0].is_admin
                };
            }
            return res.redirect("/dashboard");
        }

        const stripeSession = await stripe.checkout.sessions.retrieve(stripeSessionId);
        if (stripeSession.payment_status !== 'paid') return res.redirect("/register");

        const existingUser = await query(`SELECT user_id FROM users WHERE email = '${pending.email}' LIMIT 1`);
        if (existingUser.length > 0) {
            await query(`UPDATE pending_registrations SET status = 'paid' WHERE pending_id = ${pending.pending_id}`);
            const users = await query(`SELECT * FROM users WHERE email = '${pending.email}' LIMIT 1`);
            req.session.user = {
                user_id: users[0].user_id, first_name: users[0].first_name, last_name: users[0].last_name,
                email: users[0].email, phone: users[0].phone, dob: users[0].date_of_birth,
                gender: users[0].gender, is_admin: users[0].is_admin
            };
            return res.redirect("/dashboard");
        }

        const dobStr = toLocalDateStr(pending.date_of_birth);
        await query(`INSERT INTO users (first_name, last_name, date_of_birth, gender, email, phone, password) VALUES ('${pending.first_name}','${pending.last_name}','${dobStr}','${pending.gender}','${pending.email}','${pending.phone}','${pending.password_hash}'\)`);
        const created = await query(`SELECT * FROM users WHERE email = '${pending.email}' LIMIT 1`);
        const newUser = created[0];

        const start_date = toLocalDateStr(new Date());
        const endDate = new Date();
        endDate.setFullYear(endDate.getFullYear() + 1);
        endDate.setDate(endDate.getDate() - 1);
        const end_date = toLocalDateStr(endDate);
        const qr_code = crypto.randomUUID();

        await query(`INSERT INTO gym_memberships (user_id, membership_type, start_date, end_date, status, qr_code, has_boxing_awards) VALUES (${newUser.user_id}, '${pending.membership_type}','${start_date}','${end_date}','active', '${qr_code}',${pending.include_awards ? 1 : 0})`);
        const gymCreated = await query(`SELECT gym_membership_id FROM gym_memberships WHERE user_id = ${newUser.user_id} AND qr_code = '${qr_code}' LIMIT 1`);

        await query(`INSERT INTO payment_gym_memberships (user_id, membership_type, start_date, end_date, stripe_session_id, amount_pence, status, gym_membership_id, include_awards) VALUES (${newUser.user_id}, '${pending.membership_type}','${start_date}','${end_date}','${stripeSessionId}',${pending.amount_pence}, 'paid', ${gymCreated[0].gym_membership_id}, ${pending.include_awards ? 1 : 0})`);

        await query(`UPDATE pending_registrations SET status = 'paid' WHERE pending_id = ${pending.pending_id}`);

        req.session.user = {
            user_id: newUser.user_id, first_name: newUser.first_name, last_name: newUser.last_name,
            email: newUser.email, phone: newUser.phone, dob: newUser.date_of_birth,
            gender: newUser.gender, is_admin: newUser.is_admin
        };
        return res.redirect("/dashboard");
    } catch (error) {
        console.error(error);
        return res.redirect("/register");
    }
});

app.get("/dashboard", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }
    res.sendFile(path.resolve(__dirname, "private", "index.html"));
});

//if the user is an admin give them access to the admin dashboard
app.get("/admin", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }
    if (!req.session.user.is_admin) {
        return res.redirect("/dashboard");
    }
    res.sendFile(path.resolve(__dirname, "admin", "index.html"));
});

//once the session is destroyed the user is redirected back to the login page.
app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/login"));
});


//generic public static files come  after explicit page routes) 
app.use("/", express.static(path.resolve(__dirname, "public")));

// Registration System — Step 1 checkout (10+ users, requires Stripe payment)
app.post("/register/checkout", async (req, res) => {
    const { first_name, last_name, dob, gender, email, phone, password, membership_type, include_awards } = req.body;
    if (!first_name || !last_name || !dob || !gender || !email || !phone || !password || !membership_type) {
        return res.status(400).json({ message: "All fields are required." });
    }
    if (!["non_carded", "carded"].includes(membership_type)) {
        return res.status(400).json({ message: "Invalid membership type." });
    }
    const age = computeAge(dob);
    if (age === null) return res.status(400).json({ message: "Invalid date of birth." });
    if (age < 10) return res.status(400).json({ message: "Members under 10 do not need a membership — please use the Minnow registration path." });
    try {
        const existingUser = await query(`SELECT user_id FROM users WHERE email = '${email}' LIMIT 1`);
        if (existingUser.length > 0) return res.status(400).json({ message: "An account with this email already exists." });

        const prices = await getPrices();
        const membershipAmt = prices["membership_" + membership_type];
        if (!membershipAmt) return res.status(500).json({ message: "Pricing not configured. Contact an administrator." });
        const awardsAmt  = include_awards ? (prices["awards_with_membership"] || 0) : 0;
        const totalAmount = membershipAmt + awardsAmt;

        const hashed = await bcrypt.hash(password, 10);

        await query(`DELETE FROM pending_registrations WHERE email = '${email}' AND status = 'pending'`);
        await query(`INSERT INTO pending_registrations (first_name, last_name, date_of_birth, gender, email, phone, password_hash, membership_type, include_awards, amount_pence) VALUES ('${first_name}','${last_name}','${dob}','${gender}','${email}','${phone}','${hashed}','${membership_type}',${include_awards ? 1 : 0}, ${totalAmount})`);

        const typeLabels = { non_carded: "Non-Carded Membership", carded: "Carded Membership" };
        const baseUrl = req.protocol + "://" + req.get("host");

        const lineItems = [{
            price_data: { currency: "gbp", product_data: { name: "HOP Boxing Academy — " + typeLabels[membership_type] }, unit_amount: membershipAmt },
            quantity: 1
        }];
        if (include_awards) {
            lineItems.push({
                price_data: { currency: "gbp", product_data: { name: "Boxing Awards Programme" }, unit_amount: awardsAmt },
                quantity: 1
            });
        }

        const stripeSession = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: lineItems,
            mode: "payment",
            success_url: baseUrl + "/register/success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url:  baseUrl + "/register"
        });

        await query(`UPDATE pending_registrations SET stripe_session_id = '${stripeSession.id}' WHERE email = '${email}' AND status = 'pending'`);
        return res.json({ url: stripeSession.url });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Registration failed. Please try again." });
    }
});

// Registration System — Minnow path (under 10, free account, no payment)
app.post("/register/minnow", async (req, res) => {
    const { first_name, last_name, dob, gender, email, phone, password } = req.body;
    if (!first_name || !last_name || !dob || !gender || !email || !phone || !password) {
        return res.status(400).json({ message: "All fields are required." });
    }
    const age = computeAge(dob);
    if (age === null) return res.status(400).json({ message: "Invalid date of birth." });
    if (age >= 10) return res.status(400).json({ message: "This registration path is only for Minnows (under 10)." });
    try {
        const existing = await query(`SELECT user_id FROM users WHERE email = '${email}' LIMIT 1`);
        if (existing.length > 0) return res.status(400).json({ message: "An account with this email already exists." });
        const hashed = await bcrypt.hash(password, 10);
        await query(`INSERT INTO users (first_name, last_name, date_of_birth, gender, email, phone, password) VALUES ('${first_name}','${last_name}','${dob}','${gender}','${email}','${phone}','${hashed}'\)`);
        const created = await query(`SELECT * FROM users WHERE email = '${email}' LIMIT 1`);
        req.session.user = {
            user_id: created[0].user_id, first_name: created[0].first_name, last_name: created[0].last_name,
            email: created[0].email, phone: created[0].phone, dob: created[0].date_of_birth,
            gender: created[0].gender, is_admin: created[0].is_admin
        };
        return res.json({ redirect: "/dashboard" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Registration failed. Please try again." });
    }
});

//Authentication System:
app.post("/login", async (req, res) => {
    try {
        //find out if user email is stored in the system.
        const users = await query(`SELECT * FROM users WHERE email = '${req.body.email}' LIMIT 1`);
        //if the user can't be found
        if (users.length === 0) {
            return res.status(401).json({ message: "Login failed, user credentials could not be found!" });
        };
        //retrieve user details
        const user  = users[0];
        //find out if the hashed password matches with the given password
        const match = await bcrypt.compare(req.body.password, user.password);
        if (!match) {
            return res.status(401).json({ message: "Login failed, user credentials could not be found!" });
        }
        req.session.user = {
            user_id: user.user_id, first_name: user.first_name, last_name: user.last_name, 
            email: user.email,
            phone: user.phone, 
            dob: user.date_of_birth,
            gender: user.gender, 
            is_admin: user.is_admin
        };
        //check if the user is an admin
        if (user.is_admin === 1) {
            return res.redirect("/admin");
        }
        return res.redirect("/dashboard");
    } catch (error) {
        console.error("Login error:", error);
        return res.status(500).json({ message: "Login failed. Please try again." });
    }
});


//User API
//key user information is used on the frontend
app.get("/api/user", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/");
    }
    res.json({ data: req.session.user });
});


//Sessions API
//used to display sessions on the calendar-grid
app.get("/api/sessions", async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/");
    }
    try {
        const results = await query(`SELECT session_id, session_name, start_date, start_time, duration, instructor, capacity, gender_eligibility, membership_eligibility, min_age, max_age, price_pence, session_type, description FROM sessions`);
        return res.json({ data: results });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});


//Bookings API
// validates the booking request, then creates a Stripe Checkout session.
// the actual booking row is only written to MySQL after Stripe confirms payment.
app.post("/api/bookings/checkout", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not logged in" });

    const { session_id, session_name, start_date, start_time, duration, capacity, gender_eligibility, min_age, max_age } = req.body;
    const { user_id, gender, dob } = req.session.user;

    const now_date = new Date();
    const today = toLocalDateStr(now_date);

    if (start_date < today) {
        return res.status(400).json({ message: "This session can't be booked, it is in the past!" });
    }
    if (start_date === today) {
        const now = new Date();
        const currentMins = now.getHours() * 60 + now.getMinutes();
        const [hrs, mins] = start_time.split(":");
        const startMins   = parseInt(hrs) * 60 + parseInt(mins);
        const endMins     = startMins + duration * 60;
        if (currentMins >= endMins) {
            return res.status(400).json({ message: "This session can't be booked, it already ended!" });
        }
        if (currentMins >= startMins) {
            return res.status(400).json({ message: "This session can't be booked, it already started!" });
        }
    }
    try {
        const duplicate = await query(`SELECT booking_id FROM bookings WHERE user_id = ${user_id} AND session_id = ${session_id}`);
        if (duplicate.length >= 1) {
            return res.status(400).json({ message: "This session has already been booked!" });
        }
        const [newH, newM] = start_time.split(":");
        const newStartMins = parseInt(newH) * 60 + parseInt(newM);
        const newEndMins   = newStartMins + duration * 60;
        const overlaps = await query(`SELECT b.booking_id FROM bookings b JOIN sessions s ON b.session_id = s.session_id WHERE b.user_id = ${user_id} AND s.start_date = '${start_date}' AND s.session_id != ${session_id} AND (CAST(substr(s.start_time,1,2) AS INTEGER)*60 + CAST(substr(s.start_time,4,2) AS INTEGER)) < ${newEndMins} AND (CAST(substr(s.start_time,1,2) AS INTEGER)*60 + CAST(substr(s.start_time,4,2) AS INTEGER) + s.duration*60) > ${newStartMins}`);
        if (overlaps.length > 0) {
            return res.status(400).json({ message: "You already have a booking that clashes with this session's time." });
        }

        // Fetch session details from DB — client values are not trusted for eligibility or price
        const sessionRows = await query(`SELECT membership_eligibility, price_pence, capacity, session_type, min_age, max_age, gender_eligibility, start_date FROM sessions WHERE session_id = ${session_id} LIMIT 1`);
        if (sessionRows.length === 0) return res.status(404).json({ message: "Session not found." });
        const sDetail = sessionRows[0];
        if (sDetail.capacity <= 0) return res.status(400).json({ message: "This session can't be booked, there are no spaces left!" });

        // Age check using DB bounds
        const age = computeAge(dob);
        if (age === null || age < sDetail.min_age || age > sDetail.max_age) {
            return res.status(400).json({ message: `You are not eligible for this session. Age requirement: ${sDetail.min_age}–${sDetail.max_age} years${age !== null ? ` (you are ${age})` : ""}.` });
        }

        // Gender check
        if (sDetail.gender_eligibility !== "Any" && gender.toLowerCase() !== sDetail.gender_eligibility.toLowerCase()) {
            return res.status(400).json({ message: `This session is for ${sDetail.gender_eligibility} only.` });
        }

        const memElig = sDetail.membership_eligibility || "Any";

        // Senior Carded (17+): monthly pass is required; booking is free if they hold one
        if (memElig === "Carded" && age >= 17) {
            const monthlyPass = await query(`SELECT membership_id FROM memberships WHERE user_id = ${user_id} AND membership_type = 'monthly' AND status = 'active' AND '${sDetail.start_date}' BETWEEN start_date AND end_date AND end_date >= date('now') LIMIT 1`);
            if (monthlyPass.length === 0) {
                return res.status(403).json({ message: "Senior Carded Boxers (17+) must hold an active monthly carded pass (£40/month) to book Carded sessions. Please purchase your monthly pass from the Tickets section first." });
            }
            // Pass covers this session — create booking at no charge and return immediately
            await query(`INSERT INTO bookings (user_id, session_id) VALUES (${user_id}, ${session_id})`);
            await query(`UPDATE sessions SET capacity = capacity - 1 WHERE session_id = ${session_id}`);
            return res.json({ free: true });
        }

        // Gym membership type eligibility check
        if (memElig !== "Any") {
            const gymMem = await query(`SELECT membership_type FROM gym_memberships WHERE user_id = ${user_id} AND status = 'active' AND end_date >= date('now') ORDER BY created_at DESC LIMIT 1`);
            const userMemType = gymMem.length > 0 ? gymMem[0].membership_type : null;
            if (memElig === "Carded" && !["carded", "minnow_carded"].includes(userMemType)) {
                return res.status(400).json({ message: "This session is for Carded Boxers only. You need an active Carded membership to book." });
            }
            if (memElig === "Non-Carded" && !["non_carded", "minnow_non_carded"].includes(userMemType)) {
                return res.status(400).json({ message: "This session is for Non-Carded members only." });
            }
        }

        // General ticket pass check (any active pass covering the session date)
        const ticketPasses = await query(`SELECT membership_id FROM memberships WHERE user_id = ${user_id} AND status = 'active' AND '${start_date}' BETWEEN start_date AND end_date AND end_date >= date('now') LIMIT 1`);
        if (ticketPasses.length > 0) {
            return res.status(400).json({ message: "This session is already covered by your active ticket pass. You have access to all sessions in this period — no individual booking is needed." });
        }

        const bookingPrice = sDetail.price_pence || 300;
        const baseUrl  = req.protocol + "://" + req.get("host");
        const stripeSession = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{
                price_data: {
                    currency: "gbp",
                    product_data: { name: session_name + " — " + start_date, description: "HOP Boxing Academy session" },
                    unit_amount: bookingPrice
                },
                quantity: 1
            }],
            mode: "payment",
            success_url: baseUrl + "/booking/success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url:  baseUrl + "/dashboard"
        });
        await query(`INSERT INTO payment_bookings (user_id, session_id, stripe_session_id, amount_pence, status) VALUES (${user_id}, ${session_id}, '${stripeSession.id}',${bookingPrice}, 'pending')`);
        return res.json({ url: stripeSession.url });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Booking failed, please try again." });
    }
});

// Stripe redirects here after payment. Verifies with Stripe, then creates the booking in MySQL.
app.get("/booking/success", async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }
    const stripeSessionId = req.query.session_id;
    if (!stripeSessionId) {
        return res.redirect("/dashboard");
    }
    try {
        const payments = await query(`SELECT * FROM payment_bookings WHERE stripe_session_id = 
            '${stripeSessionId}'`);
        if (payments.length === 0) {
            return res.redirect("/dashboard");
        }
        const payment = payments[0];

        if (payment.booking_id !== null){
             return res.redirect("/dashboard"); // already processed
        }
        const stripeSession = await stripe.checkout.sessions.retrieve(stripeSessionId);
        if (stripeSession.payment_status !== 'paid') {
            return res.redirect("/dashboard");
        }
        await makeBooking({ session_id: payment.session_id }, req.session.user);

        const bookings = await query(`SELECT booking_id FROM bookings WHERE user_id = 
            ${payment.user_id} AND session_id = ${payment.session_id} ORDER BY booking_id DESC LIMIT 1`);
        if (bookings.length > 0) {
            await query(`UPDATE payment_bookings SET booking_id = ${bookings[0].booking_id}, status = 'paid' WHERE payment_id = ${payment.payment_id}`);
        }
        return res.redirect("/dashboard");
    } catch (error) {
        console.error(error);
        return res.redirect("/dashboard");
    }
});

async function makeBooking(session, user) {
    const qrcodeData = crypto.randomUUID();
    const qrCodeBuffer = await qrcode.toBuffer(qrcodeData);

    await query(`INSERT INTO bookings (user_id, session_id, qr_code) VALUES 
        (${user.user_id}, ${session.session_id}, '${qrcodeData}'\)`);
    await query(`UPDATE sessions SET capacity = capacity - 1 WHERE session_id = ${session.session_id}`);

    try {
        await transport.sendMail({
            to: user.email, subject: "Your Boxing Session Booking Confirmation",
            html: `<h1>Booking Confirmed!</h1>`,
            attachments: [{ filename: "booking-qrcode.png", content: qrCodeBuffer, cid: "qrcode" }]
        });
    } catch (error) {
        console.error("Email send failed:", error);
    }
}

app.get("/api/bookings", async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ message: "Not logged in" });
    }
    try {
        const user_id  = req.session.user.user_id;
        const bookings = await query(`SELECT * FROM bookings WHERE user_id = ${user_id}`);
        if (bookings.length === 0) {
            return res.json({ message: "No bookings found", data: [] });
        }
        const results = await Promise.all(bookings.map(async (booking) => {
            const sessions = await query(`SELECT session_name, start_date, start_time, duration FROM sessions WHERE session_id = ${booking.session_id}`);
            if (sessions.length === 0) {
                return null;
            };
            const attendance = await query(`SELECT * FROM attendance WHERE booking_id = ${booking.booking_id}`);
            return {
                booking_id: booking.booking_id,
                session_name: sessions[0].session_name,
                start_date: sessions[0].start_date, 
                start_time: sessions[0].start_time,
                duration: sessions[0].duration, 
                qr_code: await qrcode.toDataURL(booking.qr_code),
                attended: attendance.length > 0,
                checkin_datetime: attendance.length > 0 ? attendance[0].checkin_datetime : null
            };
        }));
        return res.json({ message: "Bookings retrieved", data: results.filter(r => r !== null) });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.delete("/api/bookings", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not logged in" });
    if (!req.body || !req.body.booking_id) return res.status(400).json({ message: "Booking ID required" });
    const booking_id = req.body.booking_id;
    const user_id = req.session.user.user_id;
    try {
        const bookings = await query(`SELECT b.session_id, s.start_date FROM bookings b JOIN sessions s ON b.session_id = s.session_id WHERE b.booking_id = ${booking_id} AND b.user_id = ${user_id}`);
        if (bookings.length === 0) { 
            return res.status(404).json({ message: "Booking not found" });
        };
        const today = toLocalDateStr(new Date());
        if (bookings[0].start_date < today) {
            return res.status(400).json({ message: "Cannot cancel a session that has already taken place." });
        };
        const session_id = bookings[0].session_id;
        await query(`DELETE FROM attendance WHERE booking_id = ${booking_id} OR (user_id = ${user_id} AND session_id = ${session_id})`);
        await query(`DELETE FROM bookings WHERE booking_id = ${booking_id}`);
        await query(`UPDATE sessions SET capacity = capacity + 1 WHERE session_id = ${session_id}`);
        return res.json({ message: "Booking has been removed!" });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});


//Membership API
app.get("/api/membership", async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ message: "Not logged in" });
    }
    try {
        const user_id  = req.session.user.user_id;
        await query(`UPDATE memberships SET status = 'expired' WHERE end_date < date('now') AND status = 'active'`);
        const memberships = await query(`SELECT membership_id, membership_type, start_date, end_date, status, qr_code FROM memberships WHERE user_id = ${user_id} AND status = 'active' AND end_date >= date('now') ORDER BY end_date DESC LIMIT 1`);
        if (memberships.length === 0) {
            return res.json({ data: null });
        };
        const membership = memberships[0];
        const today_str  = toLocalDateStr(new Date());

        // Exclude sessions that have already passed, sessions already booked, and sessions the user is ineligible for
        const userAge    = computeAge(req.session.user.dob) ?? 0;
        const userGender = req.session.user.gender || 'Any';

        // Determine which membership_eligibility values this user's gym membership allows
        await query(`UPDATE gym_memberships SET status = 'expired' WHERE end_date < date('now') AND status = 'active'`);
        const gymMemRows = await query(`SELECT membership_type FROM gym_memberships WHERE user_id = ${user_id} AND status = 'active' AND end_date >= date('now') ORDER BY created_at DESC LIMIT 1`);
        const gymMemType = gymMemRows.length > 0 ? gymMemRows[0].membership_type : null;

        let memEligFilter;
        if (gymMemType === 'carded' || gymMemType === 'minnow_carded') {
            memEligFilter = "membership_eligibility IN ('Carded', 'Any')";
        } else if (gymMemType === 'non_carded' || gymMemType === 'minnow_non_carded') {
            memEligFilter = "membership_eligibility IN ('Non-Carded', 'Any')";
        } else {
            memEligFilter = "membership_eligibility = 'Any'";
        }

        const sessions = await query(`SELECT session_id, session_name, start_date, start_time, duration, instructor, capacity FROM sessions WHERE start_date BETWEEN '${membership.start_date}' AND '${membership.end_date}' AND start_date >= '${today_str}' AND session_id NOT IN (SELECT session_id FROM bookings WHERE user_id = ${user_id}) AND (gender_eligibility = 'Any' OR gender_eligibility = '${userGender}') AND min_age <= ${userAge} AND max_age >= ${userAge} AND ${memEligFilter} ORDER BY start_date, start_time`);

        return res.json({
            data: {
                membership_id: membership.membership_id,
                membership_type: membership.membership_type,
                start_date: membership.start_date,
                end_date: membership.end_date,
                status: membership.status,
                qr_code: await qrcode.toDataURL(membership.qr_code),
                covered_sessions: sessions }
        });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

// Validates, then creates a Stripe Checkout session for the membership purchase.
app.post("/api/membership/checkout", async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ message: "Not logged in" });
    }
    const user_id = req.session.user.user_id;
    const { membership_type, start_date } = req.body;

    if (!membership_type || !start_date) {
        return res.status(400).json({ message: "Membership type and start date are required." });
    }

    if (!["day", "weekly", "monthly"].includes(membership_type)) {
        return res.status(400).json({ message: "Invalid membership type." });
    }
    const today = toLocalDateStr(new Date());
    if (start_date < today) {
        return res.status(400).json({ message: "Start date cannot be in the past." });
    }
    try {
        // Senior carded members (17+) may only purchase the monthly pass.
        // Day and weekly passes are not available to this group.
        const gymMem = await query(`SELECT membership_type FROM gym_memberships WHERE user_id = ${user_id} AND status = 'active' AND end_date >= date('now') ORDER BY created_at DESC LIMIT 1`);
        const gymMemType = gymMem.length > 0 ? gymMem[0].membership_type : null;
        const userAge = computeAge(req.session.user.dob);
        if (gymMemType === 'carded' && userAge !== null && userAge >= 17) {
            if (membership_type !== 'monthly') {
                return res.status(403).json({ message: "Carded members (17+) may only purchase the monthly carded pass (£40/month). Day and weekly passes are not available to this group." });
            }
        }

        const existing = await query(`SELECT membership_id FROM memberships WHERE user_id = ${user_id} AND status = 'active' AND end_date >= date('now')`);
        if (existing.length > 0) {
            return res.status(400).json({ message: "You already have an active membership." });
        }
        const start = new Date(start_date + "T00:00:00");
        const end = new Date(start);
        if (membership_type === "weekly") {
            end.setDate(end.getDate() + 6);
        }
        if (membership_type === "monthly") { 
            end.setMonth(end.getMonth() + 1); end.setDate(end.getDate() - 1); 
        }
        const end_date    = toLocalDateStr(end);
        const prices      = await getPrices();
        const amount      = prices["pass_" + membership_type] || 0;
        const typeLabels  = { day: "Day Pass", weekly: "Weekly Pass", monthly: "Monthly Pass" };
        const baseUrl = req.protocol + "://" + req.get("host");

        const stripeSession = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{
                price_data: {
                    currency: "gbp",
                    product_data: { name: "HOP Boxing Academy — " + typeLabels[membership_type], description: start_date + " to " + end_date },
                    unit_amount: amount
                },
                quantity: 1
            }],
            mode: "payment",
            success_url: baseUrl + "/membership/success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url:  baseUrl + "/dashboard"
        });

        await query(`INSERT INTO payment_memberships (user_id, membership_type, start_date, end_date, stripe_session_id, amount_pence, status) VALUES (${user_id}, '${membership_type}','${start_date}','${end_date}','${stripeSession.id}',${amount}, 'pending')`);
        return res.json({ url: stripeSession.url });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Failed to start checkout, please try again." });
    }
});

// Stripe redirects here after membership payment. DATE_FORMAT in the query ensures dates
// come back as strings (YYYY-MM-DD) so we never hit the UTC toISOString() off-by-one bug.
app.get("/membership/success", async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }
    const stripeSessionId = req.query.session_id;
    if (!stripeSessionId) {
        return res.redirect("/dashboard");
    }
    try {
        const payments = await query(`SELECT * FROM payment_memberships WHERE stripe_session_id = '${stripeSessionId}'`);
        if (payments.length === 0) {
            return res.redirect("/dashboard");
        }
        const payment = payments[0];

        if (payment.membership_id !== null) {
            return res.redirect("/dashboard"); // already processed
        }

        const stripeSession = await stripe.checkout.sessions.retrieve(stripeSessionId);
        if (stripeSession.payment_status !== 'paid') {
            return res.redirect("/dashboard");
        }
        const qr_data = crypto.randomUUID();
        await query(`INSERT INTO memberships (user_id, membership_type, start_date, end_date, status, qr_code) VALUES (${payment.user_id}, '${payment.membership_type}','${payment.start_date}','${payment.end_date}','active', '${qr_data}'\)`);

        const memberships = await query(`SELECT membership_id FROM memberships WHERE user_id = ${payment.user_id} AND qr_code = '${qr_data}' LIMIT 1`);
        if (memberships.length > 0) {
            await query(`UPDATE payment_memberships SET membership_id = ${memberships[0].membership_id}, status = 'paid' WHERE payment_id = ${payment.payment_id}`);
        }
        return res.redirect("/dashboard");
    } catch (error) {
        console.error(error);
        return res.redirect("/dashboard");
    }
});


// ── Attendance (member self-check-in) ────────────────────────────────────────
// Member scans the session's QR code. Server identifies them from their session,
// finds their booking for that session, and records attendance.

app.post("/attendance", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not logged in" });
    if (!req.body || !req.body.decodedText) return res.json({ message: "❌ No QR data received" });
    try {
        const sessions = await query(`SELECT session_id, session_name, start_date, start_time, duration, gender_eligibility, min_age, max_age FROM sessions WHERE qr_code = '${req.body.decodedText}' LIMIT 1`);
        if (sessions.length === 0) return res.json({ message: "❌ Invalid session QR code" });

        const session = sessions[0];
        const now  = new Date();
        const current_date = toLocalDateStr(now);
        const current_time_str = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");

        if (current_date !== session.start_date) return res.json({ message: "❌ This session is not today" });

        const user_id = req.session.user.user_id;

        // Eligibility check first — confirm the member has a booking or active membership
        // before revealing any timing information to unauthorised users
        const already = await query(`SELECT 1 FROM attendance WHERE user_id = ${user_id} AND session_id = ${session.session_id} LIMIT 1`);
        if (already.length > 0) return res.json({ message: "⚠️ You have already checked in" });

        const bookings = await query(`SELECT booking_id FROM bookings WHERE user_id = ${user_id} AND session_id = ${session.session_id} LIMIT 1`);
        let booking_id = bookings.length > 0 ? bookings[0].booking_id : null;

        if (!booking_id) {
            const memberships = await query(`
                SELECT membership_id FROM memberships
                WHERE user_id = ${user_id} AND status = 'active'
                AND '${session.start_date}' BETWEEN start_date AND end_date
                AND end_date >= date('now') LIMIT 1
            `);
            if (memberships.length === 0) {
                return res.json({ message: "❌ You don't have a booking or active membership for this session" });
            }

            // Validate the ticket holder is eligible for this specific session
            const userAge    = computeAge(req.session.user.dob) ?? 0;
            const userGender = req.session.user.gender || 'Any';
            if (session.gender_eligibility !== 'Any' && session.gender_eligibility !== userGender) {
                return res.json({ message: "❌ This session is not open to your gender" });
            }
            if (userAge < session.min_age || userAge > session.max_age) {
                return res.json({ message: "❌ This session is not available for your age group" });
            }
        }

        // Timing check — only reached by members who are actually eligible
        const [sHrs, sMins]    = session.start_time.split(":");
        const startTotalMins   = Number(sHrs) * 60 + Number(sMins);
        const endTotalMins     = startTotalMins + session.duration * 60;
        const earlyTotalMins   = startTotalMins - 30;
        const [cHrs, cMins]    = current_time_str.split(":");
        const currentTotalMins = Number(cHrs) * 60 + Number(cMins);

        if (currentTotalMins >= endTotalMins) return res.json({ message: "❌ This session has already ended" });
        if (currentTotalMins < earlyTotalMins) {
            const openHr  = Math.floor(earlyTotalMins / 60);
            const openMin = earlyTotalMins % 60;
            return res.json({ message: "⏰ Check-in opens at " + String(openHr).padStart(2, "0") + ":" + String(openMin).padStart(2, "0") });
        }

        // Record attendance
        if (booking_id) {
            await query(`INSERT INTO attendance (booking_id, user_id, session_id, checkin_datetime) VALUES (${booking_id}, ${user_id}, ${session.session_id}, '${current_date} ${current_time_str}:00')`);
        } else {
            await query(`INSERT INTO attendance (user_id, session_id, checkin_datetime) VALUES (${user_id}, ${session.session_id}, '${current_date} ${current_time_str}:00')`);
        }

        let label;
        if (currentTotalMins < startTotalMins)        label = "early";
        else if (currentTotalMins === startTotalMins)  label = "on time";
        else {
            const lateBy = currentTotalMins - startTotalMins;
            label = lateBy === 1 ? "1 minute late" : `${lateBy} minutes late`;
        }
        return res.json({ message: `✅ Checked in ${label} — ${session.session_name}` });
    } catch (error) {
        return res.status(500).json({ message: "Server error" });
    }
});

// ── Admin: Membership verification ───────────────────────────────────────────
// Admin scans a member's membership QR code to verify it is currently valid.

app.post("/api/admin/verify-membership", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ status: "invalid", message: "❌ Access denied" });
    const raw = (req.body && req.body.decodedText) ? req.body.decodedText.trim() : "";
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!raw || !uuidPattern.test(raw)) return res.json({ status: "invalid", message: "❌ Invalid QR code." });
    try {
        const today = toLocalDateStr(new Date());

        // Check annual gym membership first
        const gymRows = await query(`SELECT gm.membership_type, gm.end_date, gm.status, gm.has_boxing_awards, u.first_name, u.last_name FROM gym_memberships gm JOIN users u ON u.user_id = gm.user_id WHERE gm.qr_code = '${raw}' LIMIT 1`);
        if (gymRows.length > 0) {
            const mem = gymRows[0];
            const gymTypeLabels = { carded: "Carded", non_carded: "Non-Carded", minnow_carded: "Minnows (Carded)", minnow_non_carded: "Minnows (Non-Carded)" };
            const typeLabel = gymTypeLabels[mem.membership_type] || mem.membership_type;
            const isExpired = mem.end_date < today || mem.status === "expired";
            const name = mem.first_name + " " + mem.last_name;
            if (!isExpired && mem.status === "active")
                return res.json({ status: "valid", message: "✅ Valid Membership", name, type: typeLabel, awards: !!mem.has_boxing_awards, end_date: mem.end_date });
            if (isExpired)
                return res.json({ status: "expired", message: "⏰ Membership Expired", name, type: typeLabel, awards: !!mem.has_boxing_awards, end_date: mem.end_date });
            return res.json({ status: "invalid", message: "❌ Membership Inactive", name, type: typeLabel, awards: false, end_date: mem.end_date });
        }

        // Check ticket pass (day / weekly / monthly)
        const passRows = await query(`SELECT m.membership_type, m.start_date, m.end_date, m.status, u.first_name, u.last_name FROM memberships m JOIN users u ON u.user_id = m.user_id WHERE m.qr_code = '${raw}' LIMIT 1`);
        if (passRows.length === 0) return res.json({ status: "invalid", message: "❌ QR code not found." });
        const pass = passRows[0];
        const ticketLabels = { day: "Day Ticket", weekly: "Weekly Ticket", monthly: "Monthly Ticket" };
        const typeLabel = ticketLabels[pass.membership_type] || pass.membership_type;
        const name = pass.first_name + " " + pass.last_name;
        if (pass.start_date > today)
            return res.json({ status: "expired", message: "⏰ Ticket Not Yet Valid", name, type: typeLabel, start_date: pass.start_date, end_date: pass.end_date });
        if (pass.end_date < today || pass.status !== "active")
            return res.json({ status: "expired", message: "⏰ Ticket Expired", name, type: typeLabel, start_date: pass.start_date, end_date: pass.end_date });
        return res.json({ status: "valid", message: "✅ Valid Ticket", name, type: typeLabel, start_date: pass.start_date, end_date: pass.end_date });
    } catch (error) {
        console.error("Verify membership error:", error);
        return res.status(500).json({ status: "invalid", message: "❌ Server error." });
    }
});


// ── Pricing ───────────────────────────────────────────────────────────────────

app.get("/api/pricing", async (_req, res) => {
    try {
        const rows = await query(`SELECT price_key, value_pence, label FROM pricing ORDER BY price_key`);
        return res.json({ data: rows });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.put("/api/admin/pricing", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    if (!req.body) return res.status(400).json({ message: "Request body required" });
    try {
        for (const [key, value] of Object.entries(req.body)) {
            const pence = Math.round(parseFloat(value) * 100);
            if (isNaN(pence) || pence < 0) return res.status(400).json({ message: `Invalid value for ${key}.` });
            await query(`UPDATE pricing SET value_pence = ${pence} WHERE price_key = '${key}'`);
        }
        return res.json({ message: "Prices updated successfully." });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});


// ── Gym Membership (annual joining fee) ───────────────────────────────────────

app.get("/api/gym-membership", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not logged in" });
    const user_id = req.session.user.user_id;
    try {
        await query(`UPDATE gym_memberships SET status = 'expired' WHERE end_date < date('now') AND status = 'active'`);
        const rows = await query(`SELECT gym_membership_id, membership_type, start_date, end_date, status, has_boxing_awards, has_contact_awards, qr_code FROM gym_memberships WHERE user_id = ${user_id} AND status = 'active' AND end_date >= date('now') ORDER BY end_date DESC LIMIT 1`);
        return res.json({ data: rows.length > 0 ? rows[0] : null });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.get("/api/member/membership-qr", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not logged in" });
    const user_id = req.session.user.user_id;
    try {
        const rows = await query(`SELECT qr_code FROM gym_memberships WHERE user_id = ${user_id} AND status = 'active' AND end_date >= date('now') ORDER BY end_date DESC LIMIT 1`);
        if (rows.length === 0) return res.status(404).json({ message: "No active membership." });
        const dataUrl = await qrcode.toDataURL(rows[0].qr_code, { width: 300, margin: 2 });
        return res.json({ data: dataUrl });
    } catch (error) {
        console.error("Membership QR error:", error);
        return res.status(500).json({ message: "Failed to generate QR code." });
    }
});

app.get("/api/member/pass-qr", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not logged in" });
    const user_id = req.session.user.user_id;
    try {
        await query(`UPDATE memberships SET status = 'expired' WHERE end_date < date('now') AND status = 'active'`);
        const rows = await query(`SELECT qr_code FROM memberships WHERE user_id = ${user_id} AND status = 'active' AND end_date >= date('now') ORDER BY end_date DESC LIMIT 1`);
        if (rows.length === 0) return res.status(404).json({ message: "No active ticket pass." });
        const dataUrl = await qrcode.toDataURL(rows[0].qr_code, { width: 300, margin: 2 });
        return res.json({ data: dataUrl });
    } catch (error) {
        console.error("Pass QR error:", error);
        return res.status(500).json({ message: "Failed to generate QR code." });
    }
});

app.post("/api/gym-membership/free", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not logged in" });
    const user_id = req.session.user.user_id;
    const membership_type = (req.body && req.body.membership_type) || "minnow_non_carded";
    if (!["minnow_carded", "minnow_non_carded"].includes(membership_type))
        return res.status(400).json({ message: "Invalid membership type." });

    const age = computeAge(req.session.user.dob);
    if (age === null || age >= 10)
        return res.status(400).json({ message: "Minnow membership is only available to members under 10." });

    try {
        const existing = await query(`SELECT gym_membership_id FROM gym_memberships WHERE user_id = ${user_id} AND status = 'active' AND end_date >= date('now') LIMIT 1`);
        if (existing.length > 0) return res.status(400).json({ message: "You already have an active gym membership." });

        const start_date = toLocalDateStr(new Date());
        const endDate    = new Date();
        endDate.setFullYear(endDate.getFullYear() + 1);
        endDate.setDate(endDate.getDate() - 1);
        const end_date = toLocalDateStr(endDate);
        const qr_code  = crypto.randomUUID();

        await query(`INSERT INTO gym_memberships (user_id, membership_type, start_date, end_date, status, qr_code, has_boxing_awards) VALUES (${user_id}, '${membership_type}','${start_date}','${end_date}','active','${qr_code}',0)`);
        const created = await query(`SELECT gym_membership_id FROM gym_memberships WHERE user_id = ${user_id} AND qr_code = '${qr_code}' LIMIT 1`);
        await query(`INSERT INTO payment_gym_memberships (user_id, membership_type, start_date, end_date, stripe_session_id, amount_pence, status, gym_membership_id, include_awards) VALUES (${user_id}, '${membership_type}','${start_date}','${end_date}','free-${user_id}',0,'paid',${created[0].gym_membership_id},0)`);

        return res.json({ message: "Minnow membership activated." });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Failed to activate membership. Please try again." });
    }
});

app.post("/api/gym-membership/checkout", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not logged in" });
    const user_id = req.session.user.user_id;
    const { membership_type, include_awards } = req.body;
    if (!["non_carded", "carded"].includes(membership_type))
        return res.status(400).json({ message: "Invalid membership type." });
    try {
        const existing = await query(`SELECT gym_membership_id FROM gym_memberships WHERE user_id = ${user_id} AND status = 'active' AND end_date >= date('now') LIMIT 1`);
        if (existing.length > 0) return res.status(400).json({ message: "You already have an active gym membership." });

        const prices         = await getPrices();
        const membershipAmt  = prices["membership_" + membership_type];
        if (!membershipAmt)  return res.status(500).json({ message: "Pricing not configured. Contact an administrator." });
        const awardsAmt      = include_awards ? (prices["awards_with_membership"] || 0) : 0;
        const totalAmount    = membershipAmt + awardsAmt;

        const start_date = toLocalDateStr(new Date());
        const endDate    = new Date();
        endDate.setFullYear(endDate.getFullYear() + 1);
        endDate.setDate(endDate.getDate() - 1);
        const end_date   = toLocalDateStr(endDate);

        const typeLabels = { non_carded: "Non-Carded Membership", carded: "Carded Membership" };
        const baseUrl    = req.protocol + "://" + req.get("host");

        const lineItems = [{
            price_data: {
                currency: "gbp",
                product_data: { name: "HOP Boxing Academy — " + typeLabels[membership_type] },
                unit_amount: membershipAmt
            },
            quantity: 1
        }];
        if (include_awards) {
            lineItems.push({
                price_data: {
                    currency: "gbp",
                    product_data: { name: "Boxing Awards Programme" },
                    unit_amount: awardsAmt
                },
                quantity: 1
            });
        }

        const stripeSession = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: lineItems,
            mode: "payment",
            success_url: baseUrl + "/gym-membership/success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url:  baseUrl + "/dashboard"
        });

        await query(`
            INSERT INTO payment_gym_memberships (user_id, membership_type, start_date, end_date, stripe_session_id, amount_pence, status, include_awards)
            VALUES (${user_id}, '${membership_type}','${start_date}','${end_date}','${stripeSession.id}',${totalAmount}, 'pending', ${include_awards ? 1 : 0})
        `);
        return res.json({ url: stripeSession.url });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Failed to start checkout. Please try again." });
    }
});

app.get("/gym-membership/success", async (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const stripeSessionId = req.query.session_id;
    if (!stripeSessionId) return res.redirect("/dashboard");
    try {
        const payments = await query(`SELECT * FROM payment_gym_memberships WHERE stripe_session_id = '${stripeSessionId}'`);
        if (payments.length === 0) return res.redirect("/dashboard");
        const payment = payments[0];
        if (payment.gym_membership_id !== null) return res.redirect("/dashboard");

        const stripeSession = await stripe.checkout.sessions.retrieve(stripeSessionId);
        if (stripeSession.payment_status !== 'paid') return res.redirect("/dashboard");

        const qr_code = crypto.randomUUID();
        await query(`INSERT INTO gym_memberships (user_id, membership_type, start_date, end_date, status, qr_code, has_boxing_awards) VALUES (${payment.user_id}, '${payment.membership_type}','${payment.start_date}','${payment.end_date}','active', '${qr_code}',${payment.include_awards ? 1 : 0})`);
        const created = await query(`SELECT gym_membership_id FROM gym_memberships WHERE user_id = ${payment.user_id} AND qr_code = '${qr_code}' LIMIT 1`);
        if (created.length > 0) {
            await query(`UPDATE payment_gym_memberships SET gym_membership_id = ${created[0].gym_membership_id}, status = 'paid' WHERE payment_id = ${payment.payment_id}`);
        }
        return res.redirect("/dashboard");
    } catch (error) {
        console.error(error);
        return res.redirect("/dashboard");
    }
});


// ── Boxing Awards Programme (standalone purchase) ──────────────────────────────

app.post("/api/boxing-awards/checkout", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not logged in" });
    const user_id = req.session.user.user_id;
    const award_type = req.body && req.body.award_type;
    if (!["non_contact", "contact"].includes(award_type)) {
        return res.status(400).json({ message: "Invalid award type. Must be non_contact or contact." });
    }
    try {
        await query(`UPDATE gym_memberships SET status = 'expired' WHERE end_date < date('now') AND status = 'active'`);
        const memberships = await query(`SELECT gym_membership_id, has_boxing_awards, has_contact_awards FROM gym_memberships WHERE user_id = ${user_id} AND status = 'active' AND end_date >= date('now') ORDER BY end_date DESC LIMIT 1`);
        if (memberships.length === 0)
            return res.status(400).json({ message: "You need an active gym membership to purchase Boxing Awards." });

        const gymMem = memberships[0];
        if (award_type === "non_contact" && gymMem.has_boxing_awards)
            return res.status(400).json({ message: "You already have the Non-Contact Boxing Awards (Awards 1–3)." });
        if (award_type === "contact" && gymMem.has_contact_awards)
            return res.status(400).json({ message: "You already have the Contact Boxing Awards (Awards 4–6)." });

        const prices = await getPrices();
        const priceKey = award_type === "non_contact" ? "awards_standalone" : "awards_contact";
        const amount = prices[priceKey];
        if (!amount) return res.status(500).json({ message: "Pricing not configured. Contact an administrator." });

        const productName = award_type === "non_contact"
            ? "HOP Boxing Academy — Non-Contact Boxing Awards (Awards 1–3)"
            : "HOP Boxing Academy — Contact Boxing Awards (Awards 4–6)";

        const baseUrl = req.protocol + "://" + req.get("host");
        const stripeSession = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{
                price_data: {
                    currency: "gbp",
                    product_data: { name: productName },
                    unit_amount: amount
                },
                quantity: 1
            }],
            mode: "payment",
            success_url: baseUrl + "/boxing-awards/success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url:  baseUrl + "/dashboard"
        });

        await query(`INSERT INTO payment_boxing_awards (user_id, gym_membership_id, stripe_session_id, amount_pence, status, award_type) VALUES (${user_id}, ${gymMem.gym_membership_id}, '${stripeSession.id}',${amount}, 'pending', '${award_type}')`);
        return res.json({ url: stripeSession.url });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Failed to start checkout. Please try again." });
    }
});

app.get("/boxing-awards/success", async (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const stripeSessionId = req.query.session_id;
    if (!stripeSessionId) return res.redirect("/dashboard");
    try {
        const payments = await query(`SELECT * FROM payment_boxing_awards WHERE stripe_session_id = '${stripeSessionId}'`);
        if (payments.length === 0) return res.redirect("/dashboard");
        const payment = payments[0];
        if (payment.status === 'paid') return res.redirect("/dashboard");

        const stripeSession = await stripe.checkout.sessions.retrieve(stripeSessionId);
        if (stripeSession.payment_status !== 'paid') return res.redirect("/dashboard");

        const awardType = payment.award_type || "non_contact";
        const colToSet = awardType === "contact" ? "has_contact_awards" : "has_boxing_awards";
        await query(`UPDATE gym_memberships SET ${colToSet} = 1 WHERE gym_membership_id = ${payment.gym_membership_id}`);
        await query(`UPDATE payment_boxing_awards SET status = 'paid' WHERE payment_id = ${payment.payment_id}`);
        return res.redirect("/dashboard");
    } catch (error) {
        console.error(error);
        return res.redirect("/dashboard");
    }
});


//Manage Sessions/Timetable API

app.get("/api/admin/sessions", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    try {
        const results = await query(`SELECT session_id, session_name, start_date, start_time, duration, instructor, capacity, gender_eligibility, membership_eligibility, min_age, max_age, qr_code, price_pence, session_type, description FROM sessions ORDER BY start_date ASC, start_time ASC`);
        return res.json({ data: results });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.get("/api/admin/sessions/:id/attendees", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    const session_id = Number(req.params.id);
    if (!session_id) return res.status(400).json({ message: "Invalid session ID" });
    try {
        const sessions = await query(`SELECT session_id, session_name, start_date, start_time, duration, instructor FROM sessions WHERE session_id = ${session_id} LIMIT 1`);
        if (sessions.length === 0) return res.status(404).json({ message: "Session not found" });
        const session = sessions[0];

        const attendees = await query(`
            SELECT b.booking_id, u.user_id, u.first_name, u.last_name, u.email, u.phone, a.checkin_datetime
            FROM bookings b
            JOIN users u ON b.user_id = u.user_id
            LEFT JOIN attendance a ON a.booking_id = b.booking_id
            WHERE b.session_id = ${session_id}
            ORDER BY u.last_name, u.first_name
        `);

        const sessionStart = new Date(`${session.start_date}T${session.start_time}`);
        const isPast = new Date() >= sessionStart;

        const result = attendees.map(a => {
            let status;
            if (!a.checkin_datetime) {
                status = isPast ? "missed" : "upcoming";
            } else {
                const checkin  = new Date(a.checkin_datetime.replace(" ", "T"));
                const diffMins = (checkin - sessionStart) / 60000;
                if (diffMins < 0)       status = "early";
                else if (diffMins <= 10) status = "on_time";
                else                     status = "late";
            }
            return { ...a, status };
        });

        return res.json({ data: { session, attendees: result } });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.get("/api/admin/sessions/:id/qr", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    try {
        const rows = await query(`SELECT session_name, qr_code FROM sessions WHERE session_id = ${Number(req.params.id)} LIMIT 1`);
        if (rows.length === 0) return res.status(404).json({ message: "Session not found" });
        const dataUrl = await qrcode.toDataURL(rows[0].qr_code, { width: 300 });
        return res.json({ qr: dataUrl, session_name: rows[0].session_name });
    } catch (error) {
        return res.status(500).json({ message: "Server error" });
    }
});

function validateSessionFields(body, today) {
    const { session_name, start_date, start_time, duration, instructor, capacity, gender_eligibility,
        membership_eligibility, min_age, max_age, session_type } = body;
    if (!session_name || String(session_name).trim() === "") {
        return "Session name is required.";
    }
    if (!start_date) {
         return "Date is required.";
    }
    if (start_date < today) {
        return "Session date cannot be in the past.";
    }
    if (!start_time) {
         return "Start time is required.";
    }
    if (duration !== 1 && duration !== 2) {
        return "Duration must be 1 or 2 hours.";
    }
    if (!instructor || String(instructor).trim() === "") {
        return "Instructor is required.";
    }
    if (!Number.isInteger(capacity) || capacity < 1) {
        return "Capacity must be a whole number of at least 1.";
    }
    if (!["Any","Male","Female"].includes(gender_eligibility)) {
        return "Gender eligibility must be Any, Male, or Female.";
    }
    if (!["Any","Carded","Non-Carded"].includes(membership_eligibility)) {
        return "Membership eligibility must be Any, Carded, or Non-Carded.";
    }
    if (!Number.isInteger(min_age) || min_age < 0) {
        return "Min age must be a non-negative whole number.";
    }
    if (!Number.isInteger(max_age) || max_age < min_age) {
        return "Max age must be a whole number ≥ min age.";
    }
    if (!["standard","saturday","holiday_camp","minnow"].includes(session_type)) {
        return "Session type must be standard, saturday, holiday_camp, or minnow.";
    }
    return null;
}

app.post("/api/admin/sessions", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    const { session_name, start_date, start_time, duration, instructor, capacity, gender_eligibility, membership_eligibility, min_age, max_age, session_type, description } = req.body;
    const today = toLocalDateStr(new Date());
    const err = validateSessionFields(req.body, today);
    if (err) return res.status(400).json({ message: err });
    try {
        const prices = await getPrices();
        const priceMap = {
            minnow:       prices.session_minnows      || 300,
            standard:     prices.session_standard     || 400,
            saturday:     prices.session_saturday     || 500,
            holiday_camp: prices.session_holiday_camp || 600,
        };
        const effective_type = (session_type === "minnow" || max_age < 10) ? "minnow" : session_type;
        const price_pence = priceMap[effective_type] || priceMap.standard;
        const sessionQR = crypto.randomUUID();
        const safeDesc = String(description || "").replace(/'/g, "''");
        await query(`INSERT INTO sessions (session_name, start_date, start_time, duration, instructor, capacity, gender_eligibility, membership_eligibility, min_age, max_age, qr_code, price_pence, session_type, description) VALUES ('${session_name}','${start_date}','${start_time}:00', ${duration}, '${instructor}',${capacity}, '${gender_eligibility}','${membership_eligibility}',${min_age}, ${max_age}, '${sessionQR}',${price_pence}, '${effective_type}', '${safeDesc}')`);
        return res.json({ message: "Session created successfully" });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.put("/api/admin/sessions", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    const { session_id, session_name, start_date, start_time, duration, instructor, capacity, gender_eligibility, membership_eligibility, min_age, max_age, session_type, description } = req.body;
    if (!session_id) return res.status(400).json({ message: "Session ID is required." });
    try {
        const existing = await query(`SELECT start_date FROM sessions WHERE session_id = ${session_id}`);
        if (existing.length === 0) return res.status(404).json({ message: "Session not found." });
        const today = toLocalDateStr(new Date());
        if (existing[0].start_date < today) return res.status(400).json({ message: "Cannot edit a session that is in the past." });
        const err = validateSessionFields(req.body, today);
        if (err) return res.status(400).json({ message: err });
        const prices = await getPrices();
        const priceMap = {
            minnow:       prices.session_minnows      || 300,
            standard:     prices.session_standard     || 400,
            saturday:     prices.session_saturday     || 500,
            holiday_camp: prices.session_holiday_camp || 600,
        };
        const effective_type = (session_type === "minnow" || max_age < 10) ? "minnow" : session_type;
        const price_pence = priceMap[effective_type] || priceMap.standard;
        const safeDesc = String(description || "").replace(/'/g, "''");
        await query(`UPDATE sessions SET session_name='${session_name}',start_date='${start_date}',start_time='${start_time}:00', duration=${duration}, instructor='${instructor}',capacity=${capacity}, gender_eligibility='${gender_eligibility}',membership_eligibility='${membership_eligibility}',min_age=${min_age}, max_age=${max_age}, price_pence=${price_pence}, session_type='${effective_type}', description='${safeDesc}' WHERE session_id=${session_id}`);
        return res.json({ message: "Session updated successfully" });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.delete("/api/admin/sessions", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    if (!req.body || !req.body.session_id) return res.status(400).json({ message: "Session ID required" });
    const session_id = req.body.session_id;
    try {
        const existing = await query(`SELECT start_date FROM sessions WHERE session_id = ${session_id}`);
        if (existing.length === 0) {
            return res.status(404).json({ message: "Session not found" });
        }
        const today = toLocalDateStr(new Date());
        if (existing[0].start_date < today) {
            return res.status(400).json({ message: "Cannot delete a session that is in the past." });
        }
        await query(`DELETE FROM attendance WHERE booking_id IN (SELECT booking_id FROM bookings WHERE session_id = ${session_id})`);
        await query(`DELETE FROM attendance WHERE session_id = ${session_id} AND booking_id IS NULL`);
        await query(`DELETE FROM bookings WHERE session_id = ${session_id}`);
        await query(`DELETE FROM sessions WHERE session_id = ${session_id}`);
        return res.json({ message: "Session deleted successfully" });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});


//Manage Customer Accounts API

//retrieves all customer accounts
app.get("/api/admin/customers", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    try {
        const results = await query(`SELECT user_id, first_name, last_name, email, phone, gender, date_of_birth FROM users WHERE is_admin = 0 ORDER BY last_name ASC, first_name ASC`);
        return res.json({ data: results });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

//retreive customer account information, their bookings and attendance history
app.get("/api/admin/customers/:id", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    const customer_id = Number(req.params.id);
    try {
        const users = await query(`SELECT user_id, first_name, last_name, email, phone, gender, date_of_birth FROM users WHERE user_id = ${customer_id} AND is_admin = 0`);
        if (users.length === 0) {
            return res.status(404).json({ message: "Customer not found" });
        }
        const memberships = await query(`SELECT gym_membership_id AS membership_id, membership_type, start_date, end_date, status, has_boxing_awards, has_contact_awards FROM gym_memberships WHERE user_id = ${customer_id} ORDER BY end_date DESC LIMIT 1`);
        const bookings = await query(`SELECT b.booking_id, s.session_name, s.start_date, s.start_time, s.duration, a.checkin_datetime FROM bookings b LEFT JOIN sessions s ON b.session_id = s.session_id LEFT JOIN attendance a ON b.booking_id = a.booking_id WHERE b.user_id = ${customer_id} ORDER BY s.start_date DESC, s.start_time DESC`);
        return res.json({ data: { user: users[0], membership: memberships.length > 0 ? memberships[0] : null, bookings } });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

//edit specific customer account information
app.put("/api/admin/customers/:id", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    const customer_id = Number(req.params.id);
    const { first_name, last_name, email, phone, gender, date_of_birth } = req.body;
    if (!first_name || !last_name || !email || !phone || !gender || !date_of_birth) {
        return res.status(400).json({ message: "All fields are required." });
    }
    try {
        const existing    = await query(`SELECT user_id FROM users WHERE user_id = ${customer_id} AND is_admin = 0`);
        if (existing.length === 0) {
            return res.status(404).json({ message: "Customer not found" });
        }
        const emailCheck  = await query(`SELECT user_id FROM users WHERE email = '${email}' AND user_id != ${customer_id}`);
        if (emailCheck.length > 0) {
            return res.status(400).json({ message: "This email is already in use by another account." });
        }
        await query(`UPDATE users SET first_name='${first_name}',last_name='${last_name}',email='${email}',phone='${phone}',gender='${gender}',date_of_birth='${date_of_birth}' WHERE user_id=${customer_id} AND is_admin=0`);
        return res.json({ message: "Customer updated successfully." });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.delete("/api/admin/customers/:id", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    const customer_id = Number(req.params.id);
    try {
        const existing = await query(`SELECT user_id FROM users WHERE user_id = ${customer_id} AND is_admin = 0`);
        if (existing.length === 0) {
            return res.status(404).json({ message: "Customer not found" });
        }
        // deletes in dependency order so foreign keys don't block
        await query(`DELETE FROM attendance WHERE booking_id IN (SELECT booking_id FROM bookings WHERE user_id = ${customer_id})`);
        await query(`DELETE FROM attendance WHERE user_id = ${customer_id} AND booking_id IS NULL`);
        await query(`DELETE FROM payment_bookings WHERE user_id = ${customer_id}`);
        await query(`DELETE FROM bookings WHERE user_id = ${customer_id}`);
        await query(`DELETE FROM payment_memberships WHERE user_id = ${customer_id}`);
        await query(`DELETE FROM memberships WHERE user_id = ${customer_id}`);
        await query(`DELETE FROM payment_gym_memberships WHERE user_id = ${customer_id}`);
        await query(`DELETE FROM gym_memberships WHERE user_id = ${customer_id}`);
        await query(`DELETE FROM users WHERE user_id = ${customer_id}`);
        return res.json({ message: "Customer account deleted." });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});


//Manage Staff Accounts API

app.get("/api/admin/staff", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    try {
        const results = await query(`SELECT user_id, first_name, last_name, email, phone, gender, date_of_birth FROM users WHERE is_admin = 1 ORDER BY last_name ASC, first_name ASC`);
        return res.json({ data: results });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.post("/api/admin/staff", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    const { first_name, last_name, email, password, phone, date_of_birth, gender } = req.body;
    if (!first_name || !last_name || !email || !password || !phone || !date_of_birth || !gender) {
        return res.status(400).json({ message: "All fields are required."});
    }
    try {
        const existing = await query(`SELECT user_id FROM users WHERE email = '${email}'`);
        if (existing.length > 0) {
            return res.status(400).json({ message: "An account with this email already exists." });
        }
        const hashed = await bcrypt.hash(password, 10);
        await query(`INSERT INTO users (first_name, last_name, date_of_birth, gender, email, phone, password, is_admin) VALUES ('${first_name}','${last_name}','${date_of_birth}','${gender}','${email}','${phone}','${hashed}',1)`);
        return res.json({ message: "Staff account created successfully."});
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.put("/api/admin/staff/:id", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    const staff_id = Number(req.params.id);
    const { first_name, last_name, email, phone, gender, date_of_birth } = req.body;
    if (!first_name || !last_name || !email || !phone || !gender || !date_of_birth) {
        return res.status(400).json({ message: "All fields are required." });
    }
    try {
        const existing = await query(`SELECT user_id FROM users WHERE user_id = ${staff_id} AND is_admin =
             1`);
        if (existing.length === 0) {
            return res.status(404).json({ message: "Staff member not found" });
        }
        const emailCheck = await query(`SELECT user_id FROM users WHERE email = '${email}' AND user_id != ${staff_id}`);
        if (emailCheck.length > 0) {
            return res.status(400).json({ message: "This email is already in use by another account." });
        }
        await query(`UPDATE users SET first_name='${first_name}',last_name='${last_name}',email='${email}',phone='${phone}',gender='${gender}',date_of_birth='${date_of_birth}' WHERE user_id=${staff_id} AND is_admin=1`);
        return res.json({ message: "Staff member updated successfully." });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.delete("/api/admin/staff/:id", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    const staff_id = Number(req.params.id);
    // prevent self-deletion
    if (staff_id === req.session.user.user_id) {
         return res.status(400).json({ message: "You cannot delete your own account." });
    }
    try {
        const existing = await query(`SELECT user_id FROM users WHERE user_id = ${staff_id} AND is_admin = 1`);
        if (existing.length === 0) {
            return res.status(404).json({ message: "Staff member not found" });
        }
        await query(`DELETE FROM users WHERE user_id = ${staff_id}`);
        return res.json({ message: "Staff account deleted." });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});
//Reporting API
app.get("/api/admin/reports", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    const filter = req.query.filter || "all";
    let payments = [];
    try {
        if (filter === "all" || filter === "bookings") {
            const rows = await query(`SELECT pb.payment_id, 'booking' AS type, u.first_name, u.last_name,
                       COALESCE(s.session_name, 'Deleted Session') AS description,
                       strftime('%Y-%m-%d %H:%M', pb.created_at) AS paid_at, pb.amount_pence
                FROM payment_bookings pb
                JOIN users u ON pb.user_id = u.user_id
                LEFT JOIN sessions s ON pb.session_id = s.session_id
                WHERE pb.status = 'paid' ORDER BY pb.created_at DESC
            `);
            payments = [...payments, ...rows];
        }
        if (filter === "all" || filter === "tickets") {
            const typeLabels = { day: "Day Ticket", weekly: "Weekly Ticket", monthly: "Monthly Ticket" };
            const passRows = await query(`SELECT pm.payment_id, 'ticket' AS type, u.first_name, u.last_name,
                       pm.membership_type AS description,
                       strftime('%Y-%m-%d %H:%M', pm.created_at) AS paid_at, pm.amount_pence
                FROM payment_memberships pm
                JOIN users u ON pm.user_id = u.user_id
                WHERE pm.status = 'paid' ORDER BY pm.created_at DESC
            `);
            payments = [...payments, ...passRows.map(r => ({ ...r, description: typeLabels[r.description] || r.description }))];
        }
        if (filter === "all" || filter === "memberships") {
            const gymRows = await query(`SELECT pgm.payment_id, 'membership' AS type, u.first_name, u.last_name,
                       CASE pgm.membership_type
                           WHEN 'non_carded' THEN 'Non-Carded Membership'
                           WHEN 'carded'     THEN 'Carded Membership'
                           ELSE pgm.membership_type
                       END AS description,
                       strftime('%Y-%m-%d %H:%M', pgm.created_at) AS paid_at, pgm.amount_pence
                FROM payment_gym_memberships pgm
                JOIN users u ON pgm.user_id = u.user_id
                WHERE pgm.status = 'paid' ORDER BY pgm.created_at DESC
            `);
            payments = [...payments, ...gymRows];

            try {
                const awardsRows = await query(`SELECT pba.payment_id, 'membership' AS type, u.first_name, u.last_name,
                           'Boxing Awards Programme' AS description,
                           strftime('%Y-%m-%d %H:%M', pba.created_at) AS paid_at, pba.amount_pence
                    FROM payment_boxing_awards pba
                    JOIN users u ON pba.user_id = u.user_id
                    WHERE pba.status = 'paid' ORDER BY pba.created_at DESC
                `);
                payments = [...payments, ...awardsRows];
            } catch (_) { /* table not yet created — skip */ }
        }
        payments.sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at));
        const total_revenue    = payments.reduce((s, p) => s + p.amount_pence, 0);
        const booking_revenue  = payments.filter(p => p.type === "booking").reduce((s, p) => s + p.amount_pence, 0);
        const membership_revenue = payments.filter(p => p.type === "membership").reduce((s, p) => s + p.amount_pence, 0);
        const ticket_revenue   = payments.filter(p => p.type === "ticket").reduce((s, p) => s + p.amount_pence, 0);
        return res.json({ data: { total_revenue, booking_revenue, membership_revenue, ticket_revenue, payments}});
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "SQL error" });
    }
});

app.listen(8080, "0.0.0.0");



