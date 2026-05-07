let nav, welcome_msg, timetable, calendar_grid;
let offset = 0;

function handleElements() {
    nav = {
        home: document.querySelector("#nav_home"),
        make_a_booking: document.querySelector("#nav_make_a_booking"),
        manage_bookings: document.querySelector("#nav_manage_bookings"),    
        logout: document.querySelector("#nav_logout")
    };

    welcome_msg = document.querySelector("#welcome_msg");
    timetable = document.querySelector("#timetable");
    week_label = document.querySelector("#week_label");
    prev_btn = document.querySelector("#prev_week");
    next_btn = document.querySelector("#next_week");
    calendar_grid = document.querySelector("#calendar_grid");
}

function handleEventListeners() {
    // ✅ Only add listeners if elements exist
    if (nav.home) nav.home.addEventListener("click", () => {
        window.location.href = "/dashboard";
    });

    if (nav.make_a_booking) nav.make_a_booking.addEventListener("click", () => {
        window.location.href = "/makeBooking";
    });

    if (nav.manage_bookings) nav.manage_bookings.addEventListener("click", () => {
        window.location.href = "/manageBookings";
    });

    if (prev_btn) prev_btn.addEventListener("click", () => {
        offset--;
        getSessionData();
    });

    if (next_btn) next_btn.addEventListener("click", () => {
        offset++;
        getSessionData();
    });
}

function main() {
    handleElements();

    // ✅ Only run if on dashboard (makeBooking page)
    if (timetable && calendar_grid) {
        console.log("Running on makeBooking page");
        getSessionData();
    }

    // ✅ Only run if on manage bookings page
    if (document.querySelector("#bookings_container")) {
        console.log("Running on manageBookings page");
        getBookingData();
    }

    // ✅ Always get user data and handle nav listeners
    getUserData();
    handleEventListeners();
}

async function getBookingData() {
    const request = await fetch("/api/bookings");
    if (request.ok) {
        const response = await request.json();
        console.log(response.message);
        console.log(response.data);
        displayBookings(response.data);
    } else {
        const response = await request.json();
        console.log(response.message);
    }
}

function displayBookings(bookings) {
    const bookings_table = document.createElement("table");
    bookings_table.id = "bookings_table";
    
    const header_row = document.createElement("tr");
    header_row.className = "header_row";
    const headers = ["Session:", "Date:", "Time:", "Duration:", "QR-Code:"];

    for (let i = 0; i < headers.length + 1; i++) {
        const th = document.createElement("th");
        th.textContent = headers[i];
        th.className = "table_header";
        header_row.appendChild(th);
    }

    bookings_table.appendChild(header_row);

    for (let i = 0; i < bookings.length; i++) {
        const booking = bookings[i];
        const row = document.createElement("tr");
        row.className = "table_row";

        const values = [
            booking.session_name,
            booking.start_date,
            booking.start_time,
            booking.duration,
            ""
        ];

        for (let j = 0; j < values.length + 1; j++) {
            const td = document.createElement("td");
            td.textContent = values[j];
            td.className = "table_cell";
            row.appendChild(td);

            if (j === 4) {
                const qrcode_btn = document.createElement("button");
                qrcode_btn.textContent = "View QR-Code";
                qrcode_btn.className = "row_btns";
                td.append(qrcode_btn);
                qrcode_btn.addEventListener("click", () => {
                    showQRCode(booking.qr_code);
                });
            }

            if (j === 5) {
                const remove_btn = document.createElement("button");
                remove_btn.textContent = "Remove";
                remove_btn.className = "row_btns";
                td.append(remove_btn);
                remove_btn.addEventListener("click", () => {
                    removeBooking(booking);
                });
            }
        }

        bookings_table.appendChild(row);
    }

    const bookings_container = document.querySelector("#bookings_container");
    if (bookings_container) {
        bookings_container.appendChild(bookings_table);
    }
}

function displayTimetable(sessions) {
    if (!calendar_grid) return; // ✅ Exit if not on right page

    calendar_grid.innerHTML = "";
    const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

    const today = new Date(); 
    let day_index = today.getDay();

    if (day_index === 0) {
        day_index = 6;
    } else {
        day_index = day_index - 1;
    }

    const monday = new Date(today);
    monday.setDate(today.getDate() - day_index + (offset * 7));

    let week = [];

    for (let i = 0; i < 7; i++) {
        const day = new Date(monday);
        day.setDate(monday.getDate() + i)
        const formatted = day.toLocaleDateString("en-CA");
        week.push(formatted);
    }

    if (week_label) week_label.textContent = week[0] + " → " + week[6];

    for (let i = 0; i < 7; i++) {
        const column = document.createElement("div");
        column.className = "column";
        const heading = document.createElement("h4");
        heading.textContent = days[i];
        column.appendChild(heading);
        const date = week[i];
        
        const result = [];
        for (let j = 0; j < sessions.length; j++) {
            const sessionDate = new Date(sessions[j].start_date);
            const localDate = sessionDate.toLocaleDateString("en-CA");
            if (localDate === date) {
                result.push(sessions[j]);
            }
        }

        for (let k = 0; k < result.length; k++) {
            const session = result[k];
            const session_container = document.createElement("div");
            session_container.className = "session_container";
            session_container.innerHTML = `
            <h4>${session.session_name}</h4>
            <p>Time: ${session.start_time}</p>
            <p>Duration: ${session.duration}hr</p>
            <p>Spaces left: ${session.spaces}</p>
            `;
            column.appendChild(session_container);

            session_container.addEventListener("click", () => {
                displayModalBox(session);
            });
        }
        calendar_grid.appendChild(column);
    }
}

async function getSessionData() {
    const req = await fetch("/api/timetable");
    const res = await req.json();
    displayTimetable(res.data);
}

async function getUserData() {
    const req = await fetch("/api/user");
    const res = await req.json();
    if (welcome_msg) {
        welcome_msg.textContent = `Hello ${res.data.name}`;
    }
    return res.data;
}

function displayModalBox(session) {
    const modal_box = document.querySelector("#modal_box");
    const modal_content = document.querySelector("#modal_content");

    modal_content.innerHTML = `
    <h2>${session.session_name}</h2>
    <p>Date: ${session.start_date}</p>
    <p>Time: ${session.start_time}</p>
    <p>Duration: ${session.duration}hr</p>
    <p>Spaces left: ${session.spaces}</p>
    <button id="close_modal">Close</button>
    <button id="confirm_booking">Book</button> 
    <p id="booking_msg"></p>
    `;

    modal_box.style.display = "block";

    document.querySelector("#close_modal").addEventListener("click", () => {
        modal_box.style.display = "none";
    });

    document.querySelector("#confirm_booking").addEventListener("click", () => {
        makeBooking(session);
    });
}

async function makeBooking(session) {
    const booking_request = await fetch("/api/bookings", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(session)
    });

    const response = await booking_request.json();
    const booking_msg = document.querySelector("#booking_msg");
    
    if (booking_request.ok) {
        booking_msg.style.backgroundColor = "#34eb8f";
        booking_msg.textContent = response.message;
        setTimeout(() => {
            window.location.href = "/makeBooking";
        }, 2000);
    } else {
        booking_msg.style.backgroundColor = "#b0171f";
        booking_msg.textContent = response.message;
    }
}

function showQRCode(qr_code) {
    const modal_box = document.querySelector("#modal_box");
    const modal_content = document.querySelector("#modal_content");

    modal_content.innerHTML = `
    <h2>QR Code</h2>
    <img id="qr_code" src="${qr_code}" style="width: 300px; height: 300px;">
    <button id="close_modal">Close</button>
    `;
    modal_box.style.display = "block";
    document.querySelector("#close_modal").addEventListener("click", () => {
        modal_box.style.display = "none";
    });
}

function removeBooking(booking) {
    const modal_box = document.querySelector("#modal_box");
    const modal_content = document.querySelector("#modal_content");
    modal_content.innerHTML = `
    <h2>Confirm Removal</h2>
    <p>Are you sure you want to remove this booking?</p>
    <button id="remove_booking">Yes</button>
    <button id="close_modal">No</button>
    <p id="removal_msg"></p>
    `;
    modal_box.style.display = "block";

    document.querySelector("#remove_booking").addEventListener("click", async () => {
        const req = await fetch("/api/bookings", {
            method: "DELETE",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(booking)
        });
        if (req.ok) {
            document.querySelector("#removal_msg").textContent = "Booking removed!";
            document.querySelector("#removal_msg").style.backgroundColor = "green";
            setTimeout(() => {
                window.location.href = "/manageBookings";
            }, 1000);
        }
    });

    document.querySelector("#close_modal").addEventListener("click", () => {
        modal_box.style.display = "none";
    });
}

// ✅ Wait for DOM to load before running
document.addEventListener("DOMContentLoaded", main);