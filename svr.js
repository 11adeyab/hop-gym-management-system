const express = require("express");
const path = require("path");
const mysql = require("mysql");
const qrcode = require("qrcode");
const nodemailer = require("nodemailer");
const app = express();
const session = require("express-session");

const connection = mysql.createConnection( {
    host: "localhost",
    user:"root",
    password: "localhost1",
    database: "test_db",
    timezone: "local"
});

connection.connect((error) => {
    if (error) {
        console.error("Error connecting to database");
        return;
    }
    console.log("Connected to database!");
})


//API TOKEN

const transport = nodemailer.createTransport({
    host: "smtp.gmail.com", 
    port: 465, 
    secure: true,
    auth: {
        user: "11adeyab070704@gmail.com",
        pass: " qjec xbeu qmhn cmus"
    }
});

//creates a session handler that creates sessions and stores their data

app.use(session({
    secret: "this is my secret",
    resave: false,
    saveUninitialized: false
}));


app.use(express.json());

app.get("/", (req, res) => {
    console.log("hello");
    if (!req.session.user) {
        res.sendFile(path.resolve(__dirname, "public", "index.html"));
    } else {
        res.redirect("/dashboard");
    }
})

app.use("/", express.static(path.resolve(__dirname, "public")));
app.use("/node_modules", express.static((path.resolve(__dirname, "node_modules"))));
app.use("/admin", express.static(path.resolve(__dirname, "admin")));

app.get("/register", (req, res) => {
    //console.log(req);

    if (!req.session.user) {
        res.sendFile(path.resolve(__dirname, "public", "register.html"));
    } else {
        res.send("You need to log out before accessing the registration page!");
    }
})

app.get("/login", (req, res) => {
    //console.log(req);

    if (!req.session.user) {
        res.sendFile(path.resolve(__dirname, "public", "login.html"));
    } else {
        res.send("Your already logged in!");
    }
    //res.sendFile(path.resolve(__dirname, "public", "login.html"));
})

app.post("/register", (req, res) => {
    //console.log(req.body);
    const query =  `INSERT INTO users (name, email, password) VALUES ("${req.body.name}", "${req.body.email}", "${req.body.password}")`;
    connection.query(query);
    res.json({message: "Registration was a success!", data: req.body});
});

app.post("/login", (req, res) => {
    //console.log(req.body);
    //console.log(req.session);
    const query = `SELECT user_id, name, email, password FROM users`;
    connection.query(query, (error, result) => {
        if (error) {
            console.log(error);
            return res.status(500).json({message: "SQL error", data: error});
        }

        for (let i = 0; i < result.length; i++) {
            //when login details match
            if (result[i].email === req.body.email && result[i].password === req.body.password) {
                //if session doesn't exist!
                console.log("There was a match!");
                if (!req.session.user) {
                    req.session.user = {
                        id: result[i].user_id,
                        name: result[i].name,
                        email: result[i].email
                    }
                    return res.json({message: `Login successful, hello ${req.session.user.name}`})
                } else {
                    return res.json({message: `Welcome back ${req.session.user.name}`}); 
                }
            }
        }
        console.log("user can't be found!");
        return res.status(500).json({message: "Login failed, user credentials could not be found!", data: req.session});
    });
});

app.get("/dashboard", (req, res) => {
    if (!req.session.user) {
        return res.send("Error, you have not logged in");
    } 
    res.sendFile(path.resolve(__dirname, "public", "dashboard.html"));
});

app.get("/api/user", (req, res) => {
    res.json({data: req.session.user});
});

app.get("/makeBooking", (req, res) => {
    if (!req.session.user) {
        return res.send("Error, you have not logged in");
    } 
    res.sendFile(path.resolve(__dirname, "public", "makeBooking.html"));
});


app.get("/manageBookings", (req, res) => {
    if (!req.session.user) {
        return res.send("Error, you have not logged in");
    } 
    res.sendFile(path.resolve(__dirname, "public", "manageBookings.html"));
});


app.get("/api/timetable", (req, res) => {
    //res.json({data: req.session.user});

    const query = "SELECT session_id, session_name, DATE(start_date) AS start_date, start_time, duration, spaces FROM timetable";
    connection.query(query, (error, result) => {
        if (error) {
            return res.send("SQL error");
        }
        //console.log(result);
        return res.json({data: result});
    }) 
});


app.post("/api/bookings", async (req, res) => {
    console.log(req.session);
    const session_id = req.body.session_id;
    const start_date = req.body.start_date;
    const start_time = req.body.start_time;
    const duration = req.body.duration;
    const spaces = req.body.spaces;

    const current_date = new Date().getDate();
    //Session can't be booked after it ends
    if (current_date > start_date) {
        return res.status(500).json({message: "This session can't be booked, it is too late!"});
    }

    //WHen there is no more available space
    if (spaces === 0) {
        return res.status(500).json({message: "This session can't be booked, there is no more space left!"});
    }
    
    const current_time = new Date();
    const current_hrs = current_time.getHours();
    const current_mins = current_time.getMinutes();
    const current_time_str = `${String(current_hrs).padStart(2, "0")}:${String(current_mins).padStart(2, "0")}`;

    const [hrs, mins] = start_time.split(":");
    const endHour = Number(hrs) + duration;
    const end_time = `${String(endHour).padStart(2, "0")}:${mins}`;

    if (current_time_str >= end_time) {
        console.log("Session has already ended!");
        return res.status(500).json({ message: "This session can't be booked, it already ended!"});
    }

    if (current_time_str >= start_time) {
        console.log("Session has already started!");
        return res.status(500).json({message: "This session can't be booked, it already started!"})
    }

    //Prevent user from booking twice?
    const query3  = `SELECT * FROM bookings WHERE user_id = ${req.session.user.id} & session_id = ${session_id}`;
    connection.query(query3, async (error, result) => {
        if (error) {
            console.log("SQL error");
            return res.status(500).json({message: "SQL error"});
        }
        if (result.length >= 1) {
            console.log("This session has already been booked!");
            return res.status(500).json({message:"This session has already been booked!"});
        } else {
            const qrcodeData = crypto.randomUUID();
            const qrCodetoDataURL = await qrcode.toDataURL(qrcodeData);     const qrCodetoBuffer = await qrcode.toBuffer(qrcodeData);
            const query2 = `INSERT INTO bookings (user_id, session_id, qr_code) VALUES (${req.session.user.id}, ${session_id}, "${qrcodeData}")`;
            connection.query(query2);
            const query1 = `UPDATE timetable SET spaces = spaces - 1 WHERE session_id = ${req.body.session_id}`
            connection.query(query1, (error) => {
            if (error) {
                console.log(error)
                return res.status(500).json({message: "SQL error"})
            }})
            transport.sendMail({
        to: `${req.session.user.email}`,
        subject: "Your Boxing Session Booking Confirmation",
        html: `
                    <h1>Booking Confirmed!</h1>
                    <p>Hi ${req.session.user.name},</p>
                    <p>Your boxing session has been booked:</p>
                    <ul>
                        <li><strong>Session Name:</strong> ${req.body.session_name}</li>
                        <li><strong>Date:</strong> ${start_date}</li>
                        <li><strong>Time:</strong> ${start_time}</li>
                        <li><strong>Duration:</strong> ${duration}hr</li>
                    </ul>
                    <p>Your QR code is attached below. Please show this QR code at check-in.</p>
                    <img src="cid:qrcode" alt="QR Code" style="width: 200px; height: 200px;">
                `,
                attachments: [
                    {
                        filename: "booking-qrcode.png",
                        content: qrCodetoBuffer,
                        cid: "qrcode"
                    }
                ]
            }
        ); return res.json({message: "session has been booked!", data: qrCodetoDataURL});
        }
    });
});

app.get("/api/bookings", (req, res) => {
    console.log(req.session.user);
    const query1 = `SELECT booking_id, session_id, qr_code FROM bookings WHERE user_id = ${req.session.user.id}`;
    connection.query(query1, (error, result1) => {
        //console.log(result1[0].booking_id);
        if (error) {
            return res.status(500).json({message: "SQL error"});
        }

        if (result1.length === 0) {
            return res.status(500).json({message: "SQL error"});
        }

        for (let i = 0; i < result1.length; i++) {
            //retrieve session information for each booking; 
            const query2 = `SELECT session_name, start_date, start_time, duration FROM timetable WHERE session_id = ${result1[i].session_id}`;
            connection.query(query2, async (error, result2) => {
                if (error) {
                    return res.status(500).json({message: "SQL error"});
                }
                const QRCodeImageBrowser = await qrcode.toDataURL(result1[i].qr_code);
                result2[i].qr_code = QRCodeImageBrowser
                result2[i].booking_id = result1[i].booking_id;
                return res.json({message: "Booked sessions retrieved", data: result2});
            })
        }
        
    })
});

app.delete("/api/bookings", (req, res) => {
    console.log(req.body.booking_id);
    const booking_id = req.body.booking_id;
    const query =  `DELETE FROM bookings WHERE booking_id = ${booking_id}`;
    connection.query(query, (error) => {
        if (error) {
            console.log("SQL error");
            return res.status(500).json({message: "SQL error"});
        }

        return res.json({message: "Booking has been removed!"});
    } );


})
//handles booking requests by generating a QR code, storing booking information inside mySQL database server and sends a confirmation email containing the QR code
app.post("/bookings", async (req, res) => {
    //QR code will contain a randomly generated ID
    const qrcodeData = crypto.randomUUID();
    //display image in browser
    const qrCodetoDataURL = await qrcode.toDataURL(qrcodeData); 
    //display image in email 
    const qrCodetoBuffer = await qrcode.toBuffer(qrcodeData);
    //console.log(req.body);
    let query = `INSERT INTO bookings (full_name, email_address, session_type, start_date, start_time, session_duration, qr_code) VALUES ("${req.body.full_name}", "${req.body.email_address}", "${req.body.session_type}", "${req.body.start_date}", "${req.body.start_time}", "${req.body.session_duration}", "${qrcodeData}")`;
    connection.query(query);
    res.json({qrcode_img: `${qrCodetoDataURL}`, qrcode_data: `${qrcodeData}`});
    //send email
    transport.sendMail({
        to: `${req.body.email_address}`,
        subject: "Your Boxing Session Booking Confirmation",
        html: `
                    <h1>Booking Confirmed!</h1>
                    <p>Hi ${req.body.full_name},</p>
                    <p>Your boxing session has been booked:</p>
                    <ul>
                        <li><strong>Session Type:</strong> ${req.body.session_type}</li>
                        <li><strong>Date:</strong> ${req.body.start_date}</li>
                        <li><strong>Time:</strong> ${req.body.start_time}</li>
                        <li><strong>Duration:</strong> ${req.body.session_duration}</li>
                    </ul>
                    <p>Your QR code is attached below. Please show this QR code at check-in.</p>
                    <img src="cid:qrcode" alt="QR Code" style="width: 200px; height: 200px;">
                `,
                attachments: [
                    {
                        filename: "booking-qrcode.png",
                        content: qrCodetoBuffer,
                        cid: "qrcode"
                    }
                ]
            }); 
    });

//confirms each persons booking attendance
app.post("/attendance", (req, res) => {
    console.log(req.body.decodedText);
    const query1 = `SELECT booking_id, DATE(start_date), start_time, session_duration FROM bookings WHERE qr_code = "${req.body.decodedText}"`
    connection.query(query1, (error, results) => {
        if (error) {
            console.error("error sending query");
            return;
        }

        //console.log(results[0]);

        if (results.length === 0) {
            console.log("Invalid QR-Code or Depreciated!")
            return res.json({message: "Invalid QR-code or Depreciated!"});
        }

        //else continue:

        const booking_id = results[0].booking_id; 
        const checkquery = `SELECT * FROM attendance WHERE booking_id = ${booking_id}`;
        connection.query(checkquery, (error, checkresults) => {
            if (error) {
                console.error("error");
                return;
            }
            if (checkresults.length > 0) {
                console.log("QR-Code has already been scanned!");
                return res.json({data: "QR-Code has already been scanned!"});
            }

            //else continue:
             const current_time = new Date();
             const current_hrs = current_time.getHours();
             const current_mins = current_time.getMinutes();
             const current_time_str = `${String(current_hrs).padStart(2, "0")}:${String(current_mins).padStart(2, "0")}`;
             let start_time = results[0].start_time;
             let duration = results[0].session_duration;
             //let early_mins = 30;
             const [hrs, mins] = start_time.split(":");
             const endHour = Number(hrs) + duration;
             const end_time = `${String(endHour).padStart(2, "0")}:${mins}`;
             //let totalMins = Number(mins) - early_mins;
             //let earlyHour = Number(hrs);
            /* if (totalMins < 0) {
                earlyHour -= 1;
                totalMins = 60 + totalMins;
            }*/
            
            //const early_time = `${String(earlyHour).padStart(2, "0")}:${String(totalMins).padStart(2, "0")}`
            //console.log(`The Current Time is: ${current_time_str}`);
            //console.log(`Session Starts at: ${start_time}`);
            //console.log(`Session Ends at: ${end_time}`);
            //console.log(`You can attend the session as early as: ${early_time}`);
             // Check if late
            if (current_time_str >= end_time) {
                console.log("Session has already ended!")
                return res.json({ message: "❌ Session has ended - you're late" });
            }
            // Check if on time
            if (current_time_str >= start_time) {
                const query2 = `INSERT INTO attendance (booking_id, checkin_time) VALUES (${results[0].booking_id}, "${current_time_str}")`;; 
                connection.query(query2, (error) => {
                    if (error) {
                        console.error("Insert error:", error);
                        return res.status(500).json({ message: "Failed to record attendance" });
                    }
                    console.log("Attendance has been recorded!")
                    res.json({ 
                        message: `✅ Checked in on time at ${current_time_str}`,
                        data: results[0]
                    });
                });
            } else {
                console.log("Session starts at " + start_time);
                return res.json({ message: "⏰ Too early - session starts at " + start_time });
            }
        });
    });
});
//app.get("/admin", express.static(path.resolve(__dirname, "admin")));

app.listen(8080);