if (process.env.NODE_ENV !== "production") {
    require("dotenv").config();
}
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
// Prices in pence (100p = £1.00)
const BOOKING_PRICE_PENCE = 300;
const MEMBERSHIP_PRICES_PENCE = { day: 500, weekly: 2000, monthly: 5000 };
const express = require("express");
const path = require("path");
const mysql = require("mysql");
const bcrypt = require("bcrypt");
const qrcode = require("qrcode");
const nodemailer = require("nodemailer");
const session = require("express-session");
const app = express();

const connection = mysql.createConnection({
    host:     "localhost",
    user:     "root",
    password: "localhost1",
    database: "test_db",
    timezone: "local"
});

connection.connect((error) => {
    if (error) { console.error("Error connecting to database"); return; }
    console.log("Connected to database!");
});

// Wraps connection.query in a Promise so every route can use async/await
function query(sql) {
    return new Promise((resolve, reject) => {
        connection.query(sql, (error, results) => {
            if (error) reject(error);
            else resolve(results);
        });
    });
}

// Formats a JS Date to YYYY-MM-DD using LOCAL timezone, avoiding the UTC off-by-one
// that toISOString() causes in UTC+ timezones.
function toLocalDateStr(date) {
    if (!(date instanceof Date)) {
        return String(date).split("T")[0];
    }
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465, 
    secure: true,
    auth: { 
        user: "11adeyab070704@gmail.com", 
        pass: " qjec xbeu qmhn cmus" }
    }
);

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


// ── Public page routes (BEFORE generic static so session checks run) ─────────
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


// ── Generic public static (CSS, JS, images — comes AFTER explicit page routes) ──
app.use("/", express.static(path.resolve(__dirname, "public")));


// ── Auth ─────────────────────────────────────────────────────────────────────

app.post("/register", async (req, res) => {
    const { first_name, last_name, dob, gender, email, phone, password } = req.body;
    try {
        //hash the password before storing it into the database
        const hashed = await bcrypt.hash(password, 10);
        //wait until the new user record is created
        await query(`
            INSERT INTO users (first_name, last_name, date_of_birth, gender, email, phone, password)
            VALUES ("${first_name}", "${last_name}", "${dob}", "${gender}", "${email}", "${phone}", "${hashed}")
        `);
        //redirect them to the login after successful registraiton.
        res.redirect("/login");
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "Registration failed!" });
    }
});

app.post("/login", async (req, res) => {
    try {
        //find out if user email is stored in the system.
        const users = await query(`SELECT * FROM users WHERE email = "${req.body.email}" LIMIT 1`);
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
            user_id: user.user_id, 
            first_name: user.first_name,
            last_name: user.last_name,
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
        return res.status(500).json({ message: "SQL error" });
    }
});


// ── User API ─────────────────────────────────────────────────────────────────

//key user information is used on the frontend
app.get("/api/user", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/");
    }
    res.json({ data: req.session.user });
});


// ── Sessions ─────────────────────────────────────────────────────────────────
//used to display sessions on the calendar-grid
app.get("/api/sessions", async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/");
    }
    try {
        const results = await query(`SELECT session_id, session_name, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, start_time, duration, instructor, capacity, gender_eligibility, min_age, max_age FROM sessions`);
        return res.json({ data: results });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});


// ── Bookings ─────────────────────────────────────────────────────────────────

// Validates the booking request, then creates a Stripe Checkout session.
// The actual booking row is only written to MySQL after Stripe confirms payment.
app.post("/api/bookings/checkout", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not logged in" });

    const { session_id, session_name, start_date, start_time, duration, capacity, gender_eligibility, min_age, max_age } = req.body;
    const { user_id, gender, dob } = req.session.user;

    const now_date = new Date();
    const today    = toLocalDateStr(now_date);

    if (start_date < today) return res.status(400).json({ message: "This session can't be booked, it is in the past!" });
    if (capacity === 0)     return res.status(400).json({ message: "This session can't be booked, there are no spaces left!" });

    if (start_date === today) {
        const now              = new Date();
        const current_time_str = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        const [hrs, mins]      = start_time.split(":");
        const end_time         = `${String(Number(hrs) + duration).padStart(2, "0")}:${mins}`;
        if (current_time_str >= end_time)  return res.status(400).json({ message: "This session can't be booked, it already ended!" });
        if (current_time_str >= start_time) return res.status(400).json({ message: "This session can't be booked, it already started!" });
    }

    try {
        const duplicate = await query(`SELECT booking_id FROM bookings WHERE user_id = ${user_id} AND session_id = ${session_id}`);
        if (duplicate.length >= 1) return res.status(400).json({ message: "This session has already been booked!" });

        const overlaps = await query(`
            SELECT b.booking_id FROM bookings b JOIN sessions s ON b.session_id = s.session_id
            WHERE b.user_id = ${user_id}
            AND DATE_FORMAT(s.start_date, '%Y-%m-%d') = '${start_date}'
            AND s.session_id != ${session_id}
            AND s.start_time < ADDTIME('${start_time}:00', SEC_TO_TIME(${duration} * 3600))
            AND ADDTIME(s.start_time, SEC_TO_TIME(s.duration * 3600)) > '${start_time}:00'
        `);
        if (overlaps.length > 0) return res.status(400).json({ message: "You already have a booking that clashes with this session's time." });

        const memberships = await query(`
            SELECT membership_id FROM memberships
            WHERE user_id = ${user_id} AND status = 'active'
            AND '${start_date}' BETWEEN start_date AND end_date AND end_date >= CURDATE()
        `);
        if (memberships.length > 0) return res.status(400).json({ message: "This session is already covered by your active membership. You have access to all sessions in this period — no individual booking is needed." });

        const today_date          = new Date();
        const birth_date          = new Date(dob);
        let age                   = today_date.getFullYear() - birth_date.getFullYear();
        const had_birthday        = today_date.getMonth() > birth_date.getMonth() ||
            (today_date.getMonth() === birth_date.getMonth() && today_date.getDate() >= birth_date.getDate());
        if (!had_birthday) age--;

        if (age < min_age || age > max_age) return res.status(400).json({ message: `You are not eligible for this session. Age requirement: ${min_age}–${max_age} years (you are ${age}).` });
        if (gender_eligibility !== "Any" && gender.toLowerCase() !== gender_eligibility.toLowerCase()) return res.status(400).json({ message: `This session is for ${gender_eligibility} only.` });

        const baseUrl       = req.protocol + "://" + req.get("host");
        const stripeSession = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{
                price_data: {
                    currency: "gbp",
                    product_data: { name: session_name + " — " + start_date, description: "HOP Boxing Academy session" },
                    unit_amount: BOOKING_PRICE_PENCE
                },
                quantity: 1
            }],
            mode: "payment",
            success_url: baseUrl + "/booking/success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url:  baseUrl + "/dashboard"
        });

        await query(`
            INSERT INTO payment_bookings (user_id, session_id, stripe_session_id, amount_pence, status)
            VALUES (${user_id}, ${session_id}, "${stripeSession.id}", ${BOOKING_PRICE_PENCE}, "pending")
        `);

        return res.json({ url: stripeSession.url });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Booking failed, please try again." });
    }
});

// Stripe redirects here after payment. Verifies with Stripe, then creates the booking in MySQL.
app.get("/booking/success", async (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const stripeSessionId = req.query.session_id;
    if (!stripeSessionId) return res.redirect("/dashboard");

    try {
        const payments = await query(`SELECT * FROM payment_bookings WHERE stripe_session_id = "${stripeSessionId}"`);
        if (payments.length === 0) return res.redirect("/dashboard");
        const payment = payments[0];

        if (payment.booking_id !== null) return res.redirect("/dashboard"); // already processed

        const stripeSession = await stripe.checkout.sessions.retrieve(stripeSessionId);
        if (stripeSession.payment_status !== "paid") return res.redirect("/dashboard");

        await makeBooking({ session_id: payment.session_id }, req.session.user);

        const bookings = await query(`
            SELECT booking_id FROM bookings
            WHERE user_id = ${payment.user_id} AND session_id = ${payment.session_id}
            ORDER BY booking_id DESC LIMIT 1
        `);
        if (bookings.length > 0) {
            await query(`
                UPDATE payment_bookings SET booking_id = ${bookings[0].booking_id}, status = "paid"
                WHERE payment_id = ${payment.payment_id}
            `);
        }
        return res.redirect("/dashboard");
    } catch (error) {
        console.error(error);
        return res.redirect("/dashboard");
    }
});

async function makeBooking(session, user) {
    const qrcodeData   = crypto.randomUUID();
    const qrCodeBuffer = await qrcode.toBuffer(qrcodeData);

    await query(`INSERT INTO bookings (user_id, session_id, qr_code) VALUES (${user.user_id}, ${session.session_id}, "${qrcodeData}")`);
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
    if (!req.session.user) return res.status(401).json({ message: "Not logged in" });
    try {
        const user_id  = req.session.user.user_id;
        const bookings = await query(`SELECT * FROM bookings WHERE user_id = ${user_id}`);
        if (bookings.length === 0) return res.json({ message: "No bookings found", data: [] });

        const results = await Promise.all(bookings.map(async (booking) => {
            const sessions = await query(`
                SELECT session_name, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, start_time, duration
                FROM sessions WHERE session_id = ${booking.session_id}
            `);
            if (sessions.length === 0) return null;
            const attendance = await query(`SELECT * FROM attendance WHERE booking_id = ${booking.booking_id}`);
            return {
                booking_id: booking.booking_id, session_name: sessions[0].session_name,
                start_date: sessions[0].start_date, start_time: sessions[0].start_time,
                duration: sessions[0].duration, qr_code: await qrcode.toDataURL(booking.qr_code),
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
    const booking_id = req.body.booking_id;
    const user_id    = req.session.user.user_id;

    try {
        const bookings = await query(`
            SELECT b.session_id, DATE_FORMAT(s.start_date, '%Y-%m-%d') AS start_date
            FROM bookings b JOIN sessions s ON b.session_id = s.session_id
            WHERE b.booking_id = ${booking_id} AND b.user_id = ${user_id}
        `);
        if (bookings.length === 0) return res.status(404).json({ message: "Booking not found" });

        const today = toLocalDateStr(new Date());
        if (bookings[0].start_date < today) return res.status(400).json({ message: "Cannot cancel a session that has already taken place." });

        const session_id = bookings[0].session_id;
        await query(`DELETE FROM attendance WHERE booking_id = ${booking_id}`);
        await query(`DELETE FROM bookings WHERE booking_id = ${booking_id}`);
        await query(`UPDATE sessions SET capacity = capacity + 1 WHERE session_id = ${session_id}`);
        return res.json({ message: "Booking has been removed!" });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});


// ── Membership ────────────────────────────────────────────────────────────────

app.get("/api/membership", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not logged in" });
    try {
        const user_id    = req.session.user.user_id;
        const memberships = await query(`
            SELECT membership_id, membership_type,
                   DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
                   DATE_FORMAT(end_date,   '%Y-%m-%d') AS end_date,
                   status, qr_code
            FROM memberships
            WHERE user_id = ${user_id} AND status = 'active' AND end_date >= CURDATE()
            ORDER BY end_date DESC LIMIT 1
        `);
        if (memberships.length === 0) return res.json({ data: null });

        const membership = memberships[0];
        const today_str  = toLocalDateStr(new Date());

        // Exclude sessions that have already passed AND sessions the user already booked
        const sessions = await query(`
            SELECT session_id, session_name,
                   DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
                   start_time, duration, instructor, capacity
            FROM sessions
            WHERE start_date BETWEEN '${membership.start_date}' AND '${membership.end_date}'
            AND DATE_FORMAT(start_date, '%Y-%m-%d') >= '${today_str}'
            AND session_id NOT IN (
                SELECT session_id FROM bookings WHERE user_id = ${user_id}
            )
            ORDER BY start_date, start_time
        `);

        return res.json({
            data: {
                membership_id:   membership.membership_id,
                membership_type: membership.membership_type,
                start_date:      membership.start_date,
                end_date:        membership.end_date,
                status:          membership.status,
                qr_code:         await qrcode.toDataURL(membership.qr_code),
                covered_sessions: sessions
            }
        });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

// Validates, then creates a Stripe Checkout session for the membership purchase.
app.post("/api/membership/checkout", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not logged in" });
    const user_id = req.session.user.user_id;
    const { membership_type, start_date } = req.body;

    if (!membership_type || !start_date) return res.status(400).json({ message: "Membership type and start date are required." });
    if (!["day", "weekly", "monthly"].includes(membership_type)) return res.status(400).json({ message: "Invalid membership type." });

    const today = toLocalDateStr(new Date());
    if (start_date < today) return res.status(400).json({ message: "Start date cannot be in the past." });

    try {
        const existing = await query(`SELECT membership_id FROM memberships WHERE user_id = ${user_id} AND status = 'active' AND end_date >= CURDATE()`);
        if (existing.length > 0) return res.status(400).json({ message: "You already have an active membership." });

        const start = new Date(start_date + "T00:00:00");
        const end   = new Date(start);
        if (membership_type === "weekly")  end.setDate(end.getDate() + 6);
        if (membership_type === "monthly") { end.setMonth(end.getMonth() + 1); end.setDate(end.getDate() - 1); }

        const end_date    = toLocalDateStr(end);
        const amount      = MEMBERSHIP_PRICES_PENCE[membership_type];
        const typeLabels  = { day: "Day Pass", weekly: "Weekly Pass", monthly: "Monthly Pass" };
        const baseUrl     = req.protocol + "://" + req.get("host");

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

        await query(`
            INSERT INTO payment_memberships (user_id, membership_type, start_date, end_date, stripe_session_id, amount_pence, status)
            VALUES (${user_id}, "${membership_type}", "${start_date}", "${end_date}", "${stripeSession.id}", ${amount}, "pending")
        `);

        return res.json({ url: stripeSession.url });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Failed to start checkout, please try again." });
    }
});

// Stripe redirects here after membership payment. DATE_FORMAT in the query ensures dates
// come back as strings (YYYY-MM-DD) so we never hit the UTC toISOString() off-by-one bug.
app.get("/membership/success", async (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const stripeSessionId = req.query.session_id;
    if (!stripeSessionId) return res.redirect("/dashboard");

    try {
        const payments = await query(`
            SELECT *,
                DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date_str,
                DATE_FORMAT(end_date,   '%Y-%m-%d') AS end_date_str
            FROM payment_memberships WHERE stripe_session_id = "${stripeSessionId}"
        `);
        if (payments.length === 0) return res.redirect("/dashboard");
        const payment = payments[0];

        if (payment.membership_id !== null) return res.redirect("/dashboard"); // already processed

        const stripeSession = await stripe.checkout.sessions.retrieve(stripeSessionId);
        if (stripeSession.payment_status !== "paid") return res.redirect("/dashboard");

        const qr_data = crypto.randomUUID();
        await query(`
            INSERT INTO memberships (user_id, membership_type, start_date, end_date, status, qr_code)
            VALUES (${payment.user_id}, "${payment.membership_type}", "${payment.start_date_str}", "${payment.end_date_str}", "active", "${qr_data}")
        `);

        const memberships = await query(`SELECT membership_id FROM memberships WHERE user_id = ${payment.user_id} AND qr_code = "${qr_data}" LIMIT 1`);
        if (memberships.length > 0) {
            await query(`UPDATE payment_memberships SET membership_id = ${memberships[0].membership_id}, status = "paid" WHERE payment_id = ${payment.payment_id}`);
        }
        return res.redirect("/dashboard");
    } catch (error) {
        console.error(error);
        return res.redirect("/dashboard");
    }
});


// ── Attendance ────────────────────────────────────────────────────────────────

app.post("/attendance", async (req, res) => {
    try {
        const results = await query(`
            SELECT bookings.booking_id, sessions.start_time, sessions.duration,
                   DATE_FORMAT(sessions.start_date, '%Y-%m-%d') AS start_date
            FROM bookings JOIN sessions ON bookings.session_id = sessions.session_id
            WHERE bookings.qr_code = "${req.body.decodedText}"
        `);
        if (results.length === 0) return res.json({ message: "❌ Invalid QR code" });

        const { booking_id, start_time, duration, start_date } = results[0];
        const now              = new Date();
        const current_date     = toLocalDateStr(now);
        const current_time_str = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");

        if (current_date !== start_date) return res.json({ message: "❌ This QR code is not valid today" });

        const [sHrs, sMins]    = start_time.split(":");
        const startTotalMins   = Number(sHrs) * 60 + Number(sMins);
        const endTotalMins     = startTotalMins + duration * 60;
        const earlyTotalMins   = startTotalMins - 30;
        const [cHrs, cMins]    = current_time_str.split(":");
        const currentTotalMins = Number(cHrs) * 60 + Number(cMins);

        const checkResults = await query(`SELECT * FROM attendance WHERE booking_id = ${booking_id}`);
        if (checkResults.length > 0) return res.json({ message: "⚠️ Already checked in" });
        if (currentTotalMins >= endTotalMins) return res.json({ message: "❌ Session has ended" });
        if (currentTotalMins < earlyTotalMins) {
            const openHr  = Math.floor(earlyTotalMins / 60);
            const openMin = earlyTotalMins % 60;
            return res.json({ message: "⏰ Too early — check-in opens at " + String(openHr).padStart(2, "0") + ":" + String(openMin).padStart(2, "0") });
        }

        await query(`INSERT INTO attendance (booking_id, checkin_datetime) VALUES (${booking_id}, "${current_date} ${current_time_str}:00")`);

        let label;
        if (currentTotalMins < startTotalMins)       label = "early";
        else if (currentTotalMins === startTotalMins) label = "on time";
        else {
            const lateBy = currentTotalMins - startTotalMins;
            label = lateBy === 1 ? "1 minute late" : `${lateBy} minutes late`;
        }
        return res.json({ message: `✅ Checked in ${label} at ${current_time_str}` });
    } catch (error) {
        return res.status(500).json({ message: "Server error" });
    }
});


// ── Admin: Sessions ───────────────────────────────────────────────────────────

app.get("/api/admin/sessions", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    try {
        const results = await query(`
            SELECT session_id, session_name, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
                   start_time, duration, instructor, capacity, gender_eligibility, min_age, max_age
            FROM sessions ORDER BY start_date ASC, start_time ASC
        `);
        return res.json({ data: results });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

function validateSessionFields(body, today) {
    const { session_name, start_date, start_time, duration, instructor, capacity, gender_eligibility, min_age, max_age } = body;
    if (!session_name || String(session_name).trim() === "") return "Session name is required.";
    if (!start_date) return "Date is required.";
    if (start_date < today) return "Session date cannot be in the past.";
    if (!start_time) return "Start time is required.";
    if (duration !== 1 && duration !== 2) return "Duration must be 1 or 2 hours.";
    if (!instructor || String(instructor).trim() === "") return "Instructor is required.";
    if (!Number.isInteger(capacity) || capacity < 1) return "Capacity must be a whole number of at least 1.";
    if (!["Any","Male","Female"].includes(gender_eligibility)) return "Gender eligibility must be Any, Male, or Female.";
    if (!Number.isInteger(min_age) || min_age < 0) return "Min age must be a non-negative whole number.";
    if (!Number.isInteger(max_age) || max_age < min_age) return "Max age must be a whole number ≥ min age.";
    return null;
}

app.post("/api/admin/sessions", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    const { session_name, start_date, start_time, duration, instructor, capacity, gender_eligibility, min_age, max_age } = req.body;
    const today = toLocalDateStr(new Date());
    const err   = validateSessionFields(req.body, today);
    if (err) return res.status(400).json({ message: err });
    try {
        await query(`INSERT INTO sessions (session_name, start_date, start_time, duration, instructor, capacity, gender_eligibility, min_age, max_age) VALUES ("${session_name}", "${start_date}", "${start_time}:00", ${duration}, "${instructor}", ${capacity}, "${gender_eligibility}", ${min_age}, ${max_age})`);
        return res.json({ message: "Session created successfully" });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.put("/api/admin/sessions", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    const { session_id, session_name, start_date, start_time, duration, instructor, capacity, gender_eligibility, min_age, max_age } = req.body;
    if (!session_id) return res.status(400).json({ message: "Session ID is required." });
    try {
        const existing = await query(`SELECT DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date FROM sessions WHERE session_id = ${session_id}`);
        if (existing.length === 0) return res.status(404).json({ message: "Session not found." });
        const today = toLocalDateStr(new Date());
        if (existing[0].start_date < today) return res.status(400).json({ message: "Cannot edit a session that is in the past." });
        const err = validateSessionFields(req.body, today);
        if (err) return res.status(400).json({ message: err });
        await query(`UPDATE sessions SET session_name="${session_name}", start_date="${start_date}", start_time="${start_time}:00", duration=${duration}, instructor="${instructor}", capacity=${capacity}, gender_eligibility="${gender_eligibility}", min_age=${min_age}, max_age=${max_age} WHERE session_id=${session_id}`);
        return res.json({ message: "Session updated successfully" });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.delete("/api/admin/sessions", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    const session_id = req.body.session_id;
    try {
        const existing = await query(`SELECT DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date FROM sessions WHERE session_id = ${session_id}`);
        if (existing.length === 0) return res.status(404).json({ message: "Session not found" });
        const today = toLocalDateStr(new Date());
        if (existing[0].start_date < today) return res.status(400).json({ message: "Cannot delete a session that is in the past." });
        await query(`DELETE FROM attendance WHERE booking_id IN (SELECT booking_id FROM bookings WHERE session_id = ${session_id})`);
        await query(`DELETE FROM bookings WHERE session_id = ${session_id}`);
        await query(`DELETE FROM sessions WHERE session_id = ${session_id}`);
        return res.json({ message: "Session deleted successfully" });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});


// ── Admin: Customers ──────────────────────────────────────────────────────────

app.get("/api/admin/customers", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    try {
        const results = await query(`SELECT user_id, first_name, last_name, email, phone, gender, DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS date_of_birth FROM users WHERE is_admin = 0 ORDER BY last_name ASC, first_name ASC`);
        return res.json({ data: results });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.get("/api/admin/customers/:id", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    const customer_id = Number(req.params.id);
    try {
        const users = await query(`SELECT user_id, first_name, last_name, email, phone, gender, DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS date_of_birth FROM users WHERE user_id = ${customer_id} AND is_admin = 0`);
        if (users.length === 0) return res.status(404).json({ message: "Customer not found" });
        const memberships = await query(`SELECT membership_id, membership_type, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date, status FROM memberships WHERE user_id = ${customer_id} ORDER BY end_date DESC LIMIT 1`);
        const bookings    = await query(`SELECT b.booking_id, s.session_name, DATE_FORMAT(s.start_date, '%Y-%m-%d') AS start_date, s.start_time, s.duration, a.checkin_datetime FROM bookings b LEFT JOIN sessions s ON b.session_id = s.session_id LEFT JOIN attendance a ON b.booking_id = a.booking_id WHERE b.user_id = ${customer_id} ORDER BY s.start_date DESC, s.start_time DESC`);
        return res.json({ data: { user: users[0], membership: memberships.length > 0 ? memberships[0] : null, bookings } });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.put("/api/admin/customers/:id", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    const customer_id = Number(req.params.id);
    const { first_name, last_name, email, phone, gender, date_of_birth } = req.body;
    if (!first_name || !last_name || !email || !phone || !gender || !date_of_birth) return res.status(400).json({ message: "All fields are required." });
    try {
        const existing    = await query(`SELECT user_id FROM users WHERE user_id = ${customer_id} AND is_admin = 0`);
        if (existing.length === 0) return res.status(404).json({ message: "Customer not found" });
        const emailCheck  = await query(`SELECT user_id FROM users WHERE email = "${email}" AND user_id != ${customer_id}`);
        if (emailCheck.length > 0) return res.status(400).json({ message: "This email is already in use by another account." });
        await query(`UPDATE users SET first_name="${first_name}", last_name="${last_name}", email="${email}", phone="${phone}", gender="${gender}", date_of_birth="${date_of_birth}" WHERE user_id=${customer_id} AND is_admin=0`);
        return res.json({ message: "Customer updated successfully." });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.delete("/api/admin/customers/:id", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    const customer_id = Number(req.params.id);
    try {
        const existing = await query(`SELECT user_id FROM users WHERE user_id = ${customer_id} AND is_admin = 0`);
        if (existing.length === 0) return res.status(404).json({ message: "Customer not found" });
        // Delete in dependency order so foreign keys don't block
        await query(`DELETE FROM attendance WHERE booking_id IN (SELECT booking_id FROM bookings WHERE user_id = ${customer_id})`);
        await query(`DELETE FROM payment_bookings WHERE user_id = ${customer_id}`);
        await query(`DELETE FROM bookings WHERE user_id = ${customer_id}`);
        await query(`DELETE FROM payment_memberships WHERE user_id = ${customer_id}`);
        await query(`DELETE FROM memberships WHERE user_id = ${customer_id}`);
        await query(`DELETE FROM users WHERE user_id = ${customer_id}`);
        return res.json({ message: "Customer account deleted." });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});


// ── Admin: Staff ──────────────────────────────────────────────────────────────

app.get("/api/admin/staff", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    try {
        const results = await query(`SELECT user_id, first_name, last_name, email, phone, gender, DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS date_of_birth FROM users WHERE is_admin = 1 ORDER BY last_name ASC, first_name ASC`);
        return res.json({ data: results });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.post("/api/admin/staff", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    const { first_name, last_name, email, password, phone, date_of_birth, gender } = req.body;
    if (!first_name || !last_name || !email || !password || !phone || !date_of_birth || !gender) return res.status(400).json({ message: "All fields are required." });
    try {
        const existing = await query(`SELECT user_id FROM users WHERE email = "${email}"`);
        if (existing.length > 0) return res.status(400).json({ message: "An account with this email already exists." });
        const hashed = await bcrypt.hash(password, 10);
        await query(`INSERT INTO users (first_name, last_name, date_of_birth, gender, email, phone, password, is_admin) VALUES ("${first_name}", "${last_name}", "${date_of_birth}", "${gender}", "${email}", "${phone}", "${hashed}", 1)`);
        return res.json({ message: "Staff account created successfully." });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.put("/api/admin/staff/:id", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    const staff_id = Number(req.params.id);
    const { first_name, last_name, email, phone, gender, date_of_birth } = req.body;
    if (!first_name || !last_name || !email || !phone || !gender || !date_of_birth) return res.status(400).json({ message: "All fields are required." });
    try {
        const existing   = await query(`SELECT user_id FROM users WHERE user_id = ${staff_id} AND is_admin = 1`);
        if (existing.length === 0) return res.status(404).json({ message: "Staff member not found" });
        const emailCheck = await query(`SELECT user_id FROM users WHERE email = "${email}" AND user_id != ${staff_id}`);
        if (emailCheck.length > 0) return res.status(400).json({ message: "This email is already in use by another account." });
        await query(`UPDATE users SET first_name="${first_name}", last_name="${last_name}", email="${email}", phone="${phone}", gender="${gender}", date_of_birth="${date_of_birth}" WHERE user_id=${staff_id} AND is_admin=1`);
        return res.json({ message: "Staff member updated successfully." });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.delete("/api/admin/staff/:id", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    const staff_id = Number(req.params.id);
    // Prevent self-deletion
    if (staff_id === req.session.user.user_id) return res.status(400).json({ message: "You cannot delete your own account." });
    try {
        const existing = await query(`SELECT user_id FROM users WHERE user_id = ${staff_id} AND is_admin = 1`);
        if (existing.length === 0) return res.status(404).json({ message: "Staff member not found" });
        await query(`DELETE FROM users WHERE user_id = ${staff_id}`);
        return res.json({ message: "Staff account deleted." });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});


// ── Admin: Reports ────────────────────────────────────────────────────────────

app.get("/api/admin/reports", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    const filter   = req.query.filter || "all";
    let   payments = [];
    try {
        if (filter === "all" || filter === "bookings") {
            const rows = await query(`
                SELECT pb.payment_id, "booking" AS type, u.first_name, u.last_name,
                       COALESCE(s.session_name, "Deleted Session") AS description,
                       DATE_FORMAT(pb.created_at, '%Y-%m-%d %H:%i') AS paid_at, pb.amount_pence
                FROM payment_bookings pb
                JOIN users u ON pb.user_id = u.user_id
                LEFT JOIN sessions s ON pb.session_id = s.session_id
                WHERE pb.status = "paid" ORDER BY pb.created_at DESC
            `);
            payments = [...payments, ...rows];
        }
        if (filter === "all" || filter === "memberships") {
            const typeLabels = { day: "Day Pass", weekly: "Weekly Pass", monthly: "Monthly Pass" };
            const rows = await query(`
                SELECT pm.payment_id, "membership" AS type, u.first_name, u.last_name,
                       pm.membership_type AS description,
                       DATE_FORMAT(pm.created_at, '%Y-%m-%d %H:%i') AS paid_at, pm.amount_pence
                FROM payment_memberships pm
                JOIN users u ON pm.user_id = u.user_id
                WHERE pm.status = "paid" ORDER BY pm.created_at DESC
            `);
            payments = [...payments, ...rows.map(r => ({ ...r, description: typeLabels[r.description] || r.description }))];
        }
        payments.sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at));
        const total_revenue      = payments.reduce((s, p) => s + p.amount_pence, 0);
        const booking_revenue    = payments.filter(p => p.type === "booking").reduce((s, p) => s + p.amount_pence, 0);
        const membership_revenue = payments.filter(p => p.type === "membership").reduce((s, p) => s + p.amount_pence, 0);
        return res.json({ data: { total_revenue, booking_revenue, membership_revenue, payments } });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "SQL error" });
    }
});


app.listen(8080, "0.0.0.0");
