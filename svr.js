if (process.env.NODE_ENV !== "production") {
    require("dotenv").config();
}
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const express = require("express");
const path    = require("path");
const crypto  = require("crypto");
const mysql   = require("mysql");
const bcrypt  = require("bcrypt");
const qrcode = require("qrcode");
const nodemailer = require("nodemailer");
const session = require("express-session");
const app = express();

//creates a connection to the local database server
const connection = mysql.createConnection({
    host:  "localhost",
    user: "root",
    password: "localhost1",
    database: "test_db",
    timezone: "local"
});

//connection is established
connection.connect((error) => {
    if (error){ 
        console.error("Error connecting to database"); 
        return; 
    }
    console.log("Connected to database!");
});

//connection.query gets wrapped in a promise so that every route can use async/await
function query(sql) {
    return new Promise((resolve, reject) => {
        connection.query(sql, (error, results) => {
            if (error) reject(error);
            else resolve(results);
        });
    });
}

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

//Registration System:
app.post("/register", async (req, res) => {
    const { first_name, last_name, dob, gender, email, phone, password } = req.body;
    if (!first_name || !last_name || !email || !password) {
        return res.status(400).json({ message: "All fields are required." });
    }
    try {
        const existing = await query(`SELECT user_id FROM users WHERE email = "${email}" LIMIT 1`);
        if (existing.length > 0) {
            return res.status(400).json({ message: "An account with this email already exists." });
        }
        const hashed = await bcrypt.hash(password, 10);
        await query(`
            INSERT INTO users (first_name, last_name, date_of_birth, gender, email, phone, password)
            VALUES ("${first_name}", "${last_name}", "${dob}", "${gender}", "${email}", "${phone}", "${hashed}")`);
        res.redirect("/login");
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "Registration failed. Please try again." });
    }
});

//Authentication System:
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
        return res.status(500).json({ message: "SQL error" });
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
        const results = await query(`SELECT session_id, session_name, DATE_FORMAT(start_date, '%Y-%m-%d')
             AS start_date, start_time, duration, instructor, capacity,
             gender_eligibility, min_age, max_age, price_pence FROM sessions`);
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
    if (capacity === 0) {
        return res.status(400).json({ message: "This session can't be booked, there are no spaces left!" });
    }
    if (start_date === today) {
        const now = new Date();
        const current_time_str = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        const [hrs, mins] = start_time.split(":");
        const end_time = `${String(Number(hrs) + duration).padStart(2, "0")}:${mins}`;
        if (current_time_str >= end_time) {
            return res.status(400).json({ message: "This session can't be booked, it already ended!" });
        }
        if (current_time_str >= start_time) {
            return res.status(400).json({ message: "This session can't be booked, it already started!" });
        }
    }
    try {
        const duplicate = await query(`SELECT booking_id FROM bookings WHERE user_id = ${user_id} AND session_id = ${session_id}`);
        if (duplicate.length >= 1) {
            return res.status(400).json({ message: "This session has already been booked!" });
        }
        const overlaps = await query(`SELECT b.booking_id FROM bookings b JOIN sessions s ON b.session_id = s.session_id WHERE b.user_id = ${user_id} AND DATE_FORMAT(s.start_date, '%Y-%m-%d') = '${start_date}' AND s.session_id != ${session_id} AND s.start_time < ADDTIME('${start_time}:00', SEC_TO_TIME(${duration} * 3600)) AND ADDTIME(s.start_time, SEC_TO_TIME(s.duration * 3600)) > '${start_time}:00'`);
        if (overlaps.length > 0) {
            return res.status(400).json({ message: "You already have a booking that clashes with this session's time." });
        }
        const memberships = await query(`SELECT membership_id FROM memberships WHERE user_id = ${user_id} AND status = 'active' AND '${start_date}' BETWEEN start_date AND end_date AND end_date >= CURDATE()`);
        if (memberships.length > 0) {
            return res.status(400).json({ message: "This session is already covered by your active membership. You have access to all sessions in this period — no individual booking is needed." });
        }
        const today_date = new Date();
        const birth_date = new Date(dob);
        let age = today_date.getFullYear() - birth_date.getFullYear();
        const had_birthday = today_date.getMonth() > birth_date.getMonth() || (today_date.getMonth() === birth_date.getMonth() && today_date.getDate() >= birth_date.getDate());
        if (!had_birthday) {
            age--;
        }
        if (age < min_age || age > max_age){
            return res.status(400).json({ message: `You are not eligible for this session. Age requirement: ${min_age}–${max_age} years (you are ${age}).` });
        }
        if (gender_eligibility !== "Any" && gender.toLowerCase() !== gender_eligibility.toLowerCase()) return res.status(400).json({ message: `This session is for ${gender_eligibility} only.` });

        const sessionRow = await query(`SELECT price_pence FROM sessions WHERE session_id = ${session_id} LIMIT 1`);
        const bookingPrice = sessionRow.length > 0 ? sessionRow[0].price_pence : 300;
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
        await query(`INSERT INTO payment_bookings (user_id, session_id, stripe_session_id, amount_pence, status) VALUES (${user_id}, ${session_id}, "${stripeSession.id}", ${bookingPrice}, "pending")`);
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
            "${stripeSessionId}"`);
        if (payments.length === 0) {
            return res.redirect("/dashboard");
        }
        const payment = payments[0];

        if (payment.booking_id !== null){
             return res.redirect("/dashboard"); // already processed
        }
        const stripeSession = await stripe.checkout.sessions.retrieve(stripeSessionId);
        if (stripeSession.payment_status !== "paid") {
            return res.redirect("/dashboard");
        }
        await makeBooking({ session_id: payment.session_id }, req.session.user);

        const bookings = await query(`SELECT booking_id FROM bookings WHERE user_id = 
            ${payment.user_id} AND session_id = ${payment.session_id} ORDER BY booking_id DESC LIMIT 1`);
        if (bookings.length > 0) {
            await query(`UPDATE payment_bookings SET booking_id = ${bookings[0].booking_id}, status = "paid" WHERE payment_id = ${payment.payment_id}`);
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
        (${user.user_id}, ${session.session_id}, "${qrcodeData}")`);
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
            const sessions = await query(`SELECT session_name, DATE_FORMAT(start_date, '%Y-%m-%d') 
                AS start_date, start_time, duration FROM sessions WHERE session_id = ${booking.session_id}`);
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
    const booking_id = req.body.booking_id;
    const user_id = req.session.user.user_id;
    try {
        const bookings = await query(`SELECT b.session_id, DATE_FORMAT(s.start_date, '%Y-%m-%d') AS start_date FROM bookings b JOIN sessions s ON b.session_id = s.session_id WHERE b.booking_id = ${booking_id} AND b.user_id = ${user_id}`);
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
        await query(`UPDATE memberships SET status = 'expired' WHERE end_date < CURDATE() AND status = 'active'`);
        const memberships = await query(`SELECT membership_id, membership_type, DATE_FORMAT(start_date, 
            '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date, status, qr_code FROM 
            memberships WHERE user_id = ${user_id} AND status = 'active' AND end_date >= CURDATE() ORDER BY
             end_date DESC LIMIT 1`);
        if (memberships.length === 0) {
            return res.json({ data: null });
        };
        const membership = memberships[0];
        const today_str  = toLocalDateStr(new Date());

        // Exclude sessions that have already passed AND sessions the user already booked
        const sessions = await query(`SELECT session_id, session_name, DATE_FORMAT(start_date, 
            '%Y-%m-%d') AS start_date, start_time, duration, instructor, capacity FROM sessions WHERE 
            start_date BETWEEN '${membership.start_date}' AND '${membership.end_date}' AND
             DATE_FORMAT(start_date, '%Y-%m-%d') >= '${today_str}' AND session_id NOT IN (SELECT 
             session_id FROM bookings WHERE user_id = ${user_id}) ORDER BY start_date, start_time`);

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
        const existing = await query(`SELECT membership_id FROM memberships WHERE user_id = ${user_id} AND status = 'active' AND end_date >= CURDATE()`);
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

        await query(`INSERT INTO payment_memberships (user_id, membership_type, start_date, end_date, stripe_session_id, amount_pence, status) VALUES (${user_id}, "${membership_type}", "${start_date}", "${end_date}", "${stripeSession.id}", ${amount}, "pending")`);
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
        const payments = await query(`SELECT *, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date_str, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date_str FROM payment_memberships WHERE stripe_session_id = "${stripeSessionId}"`);
        if (payments.length === 0) {
            return res.redirect("/dashboard");
        }
        const payment = payments[0];

        if (payment.membership_id !== null) {
            return res.redirect("/dashboard"); // already processed
        }
        
        const stripeSession = await stripe.checkout.sessions.retrieve(stripeSessionId);
        if (stripeSession.payment_status !== "paid") {
            return res.redirect("/dashboard");
        }
        const qr_data = crypto.randomUUID();
        await query(`INSERT INTO memberships (user_id, membership_type, start_date, end_date, status, qr_code) VALUES (${payment.user_id}, "${payment.membership_type}", "${payment.start_date_str}", "${payment.end_date_str}", "active", "${qr_data}")`);

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


// ── Attendance (member self-check-in) ────────────────────────────────────────
// Member scans the session's QR code. Server identifies them from their session,
// finds their booking for that session, and records attendance.

app.post("/attendance", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not logged in" });
    try {
        const sessions = await query(`
            SELECT session_id, session_name,
                   DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
                   start_time, duration
            FROM sessions WHERE qr_code = "${req.body.decodedText}" LIMIT 1
        `);
        if (sessions.length === 0) return res.json({ message: "❌ Invalid session QR code" });

        const session          = sessions[0];
        const now              = new Date();
        const current_date     = toLocalDateStr(now);
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
                AND end_date >= CURDATE() LIMIT 1
            `);
            if (memberships.length === 0) {
                return res.json({ message: "❌ You don't have a booking or active membership for this session" });
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
            await query(`INSERT INTO attendance (booking_id, user_id, session_id, checkin_datetime) VALUES (${booking_id}, ${user_id}, ${session.session_id}, "${current_date} ${current_time_str}:00")`);
        } else {
            await query(`INSERT INTO attendance (user_id, session_id, checkin_datetime) VALUES (${user_id}, ${session.session_id}, "${current_date} ${current_time_str}:00")`);
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
    if (!req.session.user || !req.session.user.is_admin) return res.status(403).json({ message: "Access denied" });
    try {
        const memberships = await query(`
            SELECT m.membership_type,
                   DATE_FORMAT(m.start_date, '%Y-%m-%d') AS start_date,
                   DATE_FORMAT(m.end_date,   '%Y-%m-%d') AS end_date,
                   m.status, u.first_name, u.last_name
            FROM memberships m
            JOIN users u ON m.user_id = u.user_id
            WHERE m.qr_code = "${req.body.decodedText}" LIMIT 1
        `);
        if (memberships.length === 0) return res.json({ message: "❌ Invalid membership QR code" });

        const mem     = memberships[0];
        const today   = toLocalDateStr(new Date());
        const name    = mem.first_name + " " + mem.last_name;
        const typeMap = { day: "Day Pass", weekly: "Weekly Pass", monthly: "Monthly Pass" };
        const label   = typeMap[mem.membership_type] || mem.membership_type;

        if (mem.status !== "active" || today > mem.end_date)
            return res.json({ message: `❌ ${name} — ${label} (expired ${mem.end_date})` });
        if (today < mem.start_date)
            return res.json({ message: `⚠️ ${name} — ${label} (starts ${mem.start_date})` });
        return res.json({ message: `✅ ${name} — ${label} (valid until ${mem.end_date})` });
    } catch (error) {
        return res.status(500).json({ message: "Server error" });
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
    try {
        for (const [key, value] of Object.entries(req.body)) {
            const pence = Math.round(parseFloat(value) * 100);
            if (isNaN(pence) || pence < 0) return res.status(400).json({ message: `Invalid value for ${key}.` });
            await query(`UPDATE pricing SET value_pence = ${pence} WHERE price_key = "${key}"`);
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
        await query(`UPDATE gym_memberships SET status = 'expired' WHERE end_date < CURDATE() AND status = 'active'`);
        const rows = await query(`
            SELECT gym_membership_id, membership_type,
                   DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
                   DATE_FORMAT(end_date,   '%Y-%m-%d') AS end_date,
                   status
            FROM gym_memberships
            WHERE user_id = ${user_id} AND status = 'active' AND end_date >= CURDATE()
            ORDER BY end_date DESC LIMIT 1
        `);
        return res.json({ data: rows.length > 0 ? rows[0] : null });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.post("/api/gym-membership/checkout", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "Not logged in" });
    const user_id = req.session.user.user_id;
    const { membership_type } = req.body;
    if (!["non_carded", "carded"].includes(membership_type))
        return res.status(400).json({ message: "Invalid membership type." });
    try {
        const existing = await query(`SELECT gym_membership_id FROM gym_memberships WHERE user_id = ${user_id} AND status = 'active' AND end_date >= CURDATE() LIMIT 1`);
        if (existing.length > 0) return res.status(400).json({ message: "You already have an active gym membership." });

        const prices  = await getPrices();
        const amount  = prices["membership_" + membership_type];
        if (!amount)  return res.status(500).json({ message: "Pricing not configured. Contact an administrator." });

        const start_date = toLocalDateStr(new Date());
        const endDate    = new Date();
        endDate.setFullYear(endDate.getFullYear() + 1);
        endDate.setDate(endDate.getDate() - 1);
        const end_date   = toLocalDateStr(endDate);

        const typeLabels = { non_carded: "Non-Carded Boxer", carded: "Carded Boxer" };
        const baseUrl    = req.protocol + "://" + req.get("host");

        const stripeSession = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{
                price_data: {
                    currency: "gbp",
                    product_data: { name: "HOP Boxing Academy — Annual Gym Membership (" + typeLabels[membership_type] + ")" },
                    unit_amount: amount
                },
                quantity: 1
            }],
            mode: "payment",
            success_url: baseUrl + "/gym-membership/success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url:  baseUrl + "/dashboard"
        });

        await query(`
            INSERT INTO payment_gym_memberships (user_id, membership_type, start_date, end_date, stripe_session_id, amount_pence, status)
            VALUES (${user_id}, "${membership_type}", "${start_date}", "${end_date}", "${stripeSession.id}", ${amount}, "pending")
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
        const payments = await query(`
            SELECT *, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date_str, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date_str
            FROM payment_gym_memberships WHERE stripe_session_id = "${stripeSessionId}"
        `);
        if (payments.length === 0) return res.redirect("/dashboard");
        const payment = payments[0];
        if (payment.gym_membership_id !== null) return res.redirect("/dashboard");

        const stripeSession = await stripe.checkout.sessions.retrieve(stripeSessionId);
        if (stripeSession.payment_status !== "paid") return res.redirect("/dashboard");

        const qr_code = crypto.randomUUID();
        await query(`
            INSERT INTO gym_memberships (user_id, membership_type, start_date, end_date, status, qr_code)
            VALUES (${payment.user_id}, "${payment.membership_type}", "${payment.start_date_str}", "${payment.end_date_str}", "active", "${qr_code}")
        `);
        const created = await query(`SELECT gym_membership_id FROM gym_memberships WHERE user_id = ${payment.user_id} AND qr_code = "${qr_code}" LIMIT 1`);
        if (created.length > 0) {
            await query(`UPDATE payment_gym_memberships SET gym_membership_id = ${created[0].gym_membership_id}, status = "paid" WHERE payment_id = ${payment.payment_id}`);
        }
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
        const results = await query(`SELECT session_id, session_name, DATE_FORMAT(start_date, '%Y-%m-%d')
            AS start_date, start_time, duration, instructor, capacity, gender_eligibility, min_age, max_age, qr_code, price_pence
            FROM sessions ORDER BY start_date ASC, start_time ASC`);
        return res.json({ data: results });
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
        min_age, max_age } = body;
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
    if (!Number.isInteger(min_age) || min_age < 0) {
        return "Min age must be a non-negative whole number.";
    }
    if (!Number.isInteger(max_age) || max_age < min_age) {
        return "Max age must be a whole number ≥ min age.";
    }
    const price = body.price_pence;
    if (!Number.isInteger(price) || price < 0) {
        return "Price must be a non-negative whole number (in pence).";
    }
    return null;
}

app.post("/api/admin/sessions", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    const { session_name, start_date, start_time, duration, instructor, capacity, gender_eligibility, min_age, max_age, price_pence } = req.body;
    const today = toLocalDateStr(new Date());
    const err = validateSessionFields(req.body, today);
    if (err) return res.status(400).json({ message: err });
    try {
        const sessionQR = crypto.randomUUID();
        await query(`INSERT INTO sessions (session_name, start_date, start_time, duration, instructor, capacity, gender_eligibility, min_age, max_age, qr_code, price_pence) VALUES ("${session_name}", "${start_date}", "${start_time}:00", ${duration}, "${instructor}", ${capacity}, "${gender_eligibility}", ${min_age}, ${max_age}, "${sessionQR}", ${price_pence})`);
        return res.json({ message: "Session created successfully" });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.put("/api/admin/sessions", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    const { session_id, session_name, start_date, start_time, duration, instructor, capacity, gender_eligibility, min_age, max_age, price_pence } = req.body;
    if (!session_id) return res.status(400).json({ message: "Session ID is required." });
    try {
        const existing = await query(`SELECT DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date FROM sessions WHERE session_id = ${session_id}`);
        if (existing.length === 0) return res.status(404).json({ message: "Session not found." });
        const today = toLocalDateStr(new Date());
        if (existing[0].start_date < today) return res.status(400).json({ message: "Cannot edit a session that is in the past." });
        const err = validateSessionFields(req.body, today);
        if (err) return res.status(400).json({ message: err });
        await query(`UPDATE sessions SET session_name="${session_name}", start_date="${start_date}", start_time="${start_time}:00", duration=${duration}, instructor="${instructor}", capacity=${capacity}, gender_eligibility="${gender_eligibility}", min_age=${min_age}, max_age=${max_age}, price_pence=${price_pence} WHERE session_id=${session_id}`);
        return res.json({ message: "Session updated successfully" });
    } catch (error) {
        return res.status(500).json({ message: "SQL error" });
    }
});

app.delete("/api/admin/sessions", async (req, res) => {
    if (!req.session.user || !req.session.user.is_admin) {
        return res.status(403).json({ message: "Access denied" });
    }
    const session_id = req.body.session_id;
    try {
        const existing = await query(`SELECT DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date FROM sessions WHERE session_id = ${session_id}`);
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
        const results = await query(`SELECT user_id, first_name, last_name, email, phone, gender, 
            DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS date_of_birth FROM users WHERE is_admin = 0 
            ORDER BY last_name ASC, first_name ASC`);
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
        const users = await query(`SELECT user_id, first_name, last_name, email, phone, gender, 
            DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS date_of_birth FROM users WHERE user_id = 
            ${customer_id} AND is_admin = 0`);
        if (users.length === 0) {
            return res.status(404).json({ message: "Customer not found" });
        }
        const memberships = await query(`SELECT membership_id, membership_type, DATE_FORMAT(start_date, 
            '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date, status FROM 
            memberships WHERE user_id = ${customer_id} ORDER BY end_date DESC LIMIT 1`);
        const bookings = await query(`SELECT b.booking_id, s.session_name, 
            DATE_FORMAT(s.start_date, '%Y-%m-%d') AS start_date, s.start_time, s.duration, 
            a.checkin_datetime FROM bookings b LEFT JOIN sessions s ON b.session_id = s.session_id LEFT 
            JOIN attendance a ON b.booking_id = a.booking_id WHERE b.user_id = ${customer_id} 
            ORDER BY s.start_date DESC, s.start_time DESC`);
        return res.json({ data: { user: users[0], membership: memberships.length > 0 ? memberships[0] : 
            null, bookings } });
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
        const emailCheck  = await query(`SELECT user_id FROM users WHERE email = "${email}" AND user_id != ${customer_id}`);
        if (emailCheck.length > 0) {
            return res.status(400).json({ message: "This email is already in use by another account." });
        }
        await query(`UPDATE users SET first_name="${first_name}", last_name="${last_name}", email="${email}", phone="${phone}", gender="${gender}", date_of_birth="${date_of_birth}" WHERE user_id=${customer_id} AND is_admin=0`);
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
        const results = await query(`SELECT user_id, first_name, last_name, email, phone, gender, 
            DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS date_of_birth FROM users WHERE is_admin = 1 ORDER BY
             last_name ASC, first_name ASC`);
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
        const existing = await query(`SELECT user_id FROM users WHERE email = "${email}"`);
        if (existing.length > 0) {
            return res.status(400).json({ message: "An account with this email already exists." });
        }
        const hashed = await bcrypt.hash(password, 10);
        await query(`INSERT INTO users (first_name, last_name, date_of_birth, gender, email, phone, password, is_admin) VALUES ("${first_name}", "${last_name}", "${date_of_birth}", "${gender}", "${email}", "${phone}", "${hashed}", 1)`);
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
        const emailCheck = await query(`SELECT user_id FROM users WHERE email = "${email}" AND user_id != ${staff_id}`);
        if (emailCheck.length > 0) {
            return res.status(400).json({ message: "This email is already in use by another account." });
        }
        await query(`UPDATE users SET first_name="${first_name}", last_name="${last_name}", email="${email}", phone="${phone}", gender="${gender}", date_of_birth="${date_of_birth}" WHERE user_id=${staff_id} AND is_admin=1`);
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
            const rows = await query(`SELECT pb.payment_id, "booking" AS type, u.first_name, u.last_name,
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
            const rows = await query(`SELECT pm.payment_id, "membership" AS type, u.first_name, u.last_name,
                       pm.membership_type AS description,
                       DATE_FORMAT(pm.created_at, '%Y-%m-%d %H:%i') AS paid_at, pm.amount_pence
                FROM payment_memberships pm
                JOIN users u ON pm.user_id = u.user_id
                WHERE pm.status = "paid" ORDER BY pm.created_at DESC
            `);
            payments = [...payments, ...rows.map(r => ({ ...r, description: typeLabels[r.description] 
                || r.description }))];
        }
        payments.sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at));
        const total_revenue = payments.reduce((s, p) => s + p.amount_pence, 0);
        const booking_revenue = payments.filter(p => p.type === "booking").reduce((s, p) => s + p.amount_pence, 0);
        const membership_revenue = payments.filter(p => p.type === "membership").reduce((s, p) => s + p.amount_pence, 0);
        return res.json({ data: { total_revenue, booking_revenue, membership_revenue, payments}});
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "SQL error" });
    }
});

app.listen(8080, "0.0.0.0");
