const express = require("express");
const path = require("path");
const mysql = require("mysql");
const qrcode = require("qrcode");
const nodemailer = require("nodemailer");
const app = express();

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

app.use(express.json());
app.use("/", express.static(path.resolve(__dirname, "public")));
app.use("/node_modules", express.static((path.resolve(__dirname, "node_modules"))));
app.use("/admin", express.static(path.resolve(__dirname, "admin")));

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