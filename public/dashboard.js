let nav, welcome_msg, timetable;

function displayModalBox(session) {
    const modal_box = document.querySelector("#modal_box");
    const modal_content = document.querySelector("#modal_content");

    modal_content.innerHTML = `
    <h2>${session.session_name}</h2>
    <p>Date: ${session.start_date.split("T")[0]}</p>
    <p>Time: ${session.start_time}</p>
    <p>Duration: ${session.duration}hr</p>
    <p>Spaces left: ${session.spaces}</p>
    <button id="close_modal">Close</button>
    <button id="confirm_booking">Book</button> 
    <p id="booking_msg"></p>
    `;

    modal_box.style.display = "block";

    const close_modal = document.querySelector("#close_modal");
    const confirm_booking = document.querySelector("#confirm_booking");
    close_modal.addEventListener("click", () => {
        closeModalBox(modal_box);
    });

    confirm_booking.addEventListener("click", ()=> {
        makeBooking(session);
    })
};

function closeModalBox(modal_box) {
    console.log("Modal Box closed!");
    modal_box.style.display = "none";
}

 async function makeBooking(session) {
    const booking_request = await fetch("/api/bookings",
        { 
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(session)
        }
    );

    if (booking_request.ok) {
        const response = await booking_request.json();
        console.log(response.message)
        setTimeout(() => {
            document.querySelector("#booking_msg").style.backgroundColor = "";
            document.querySelector("#booking_msg").textContent = ``;
        }, 5000);
        document.querySelector("#booking_msg").style.backgroundColor = "34eb8f";
        document.querySelector("#booking_msg").textContent = `${response.message}`;

    } else {
        const response = await booking_request.json();
        console.log(response.message)
        setTimeout(() => {
            document.querySelector("#booking_msg").style.backgroundColor = "";
            document.querySelector("#booking_msg").textContent = ``;
        }, 5000);
        document.querySelector("#booking_msg").style.backgroundColor = "#b0171f";
        document.querySelector("#booking_msg").textContent = `${response.message}`;

    }  
}

function main() {
    handleElements();

    //get session informatoin from the user
    const user_data = getUserData();
    handleEventListeners();
    //console.log(user_data);
    //retrieve session information
    const session_data = getSessionData();
    const booking_data = getBookingData(user_data);
}


async function getBookingData(user_data) {
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

function showQRCode(qr_code) {
    const modal_box = document.querySelector("#modal_box");
    const modal_content = document.querySelector("#modal_content");

    modal_content.innerHTML = `
    <h2>Confirm Attendance</h2>
    <img id="qr_code"src="${qr_code}">
    <button id="close_modal">Close</button>
    `;
    modal_box.style.display = "block";
    const close_modal = document.querySelector("#close_modal");
    close_modal.addEventListener("click", () => {
        closeModalBox(modal_box);
    });

}

function removeBooking(booking) {
    const modal_box = document.querySelector("#modal_box");
    const modal_content = document.querySelector("#modal_content");
    modal_content.innerHTML = `
    <h2>Confirm Remoal</h2>
    <p>Are you sure you want to remove this booking?</p>
    <button id="remove_booking">Yes</button>
    <button id="close_modal">No</button>
    `;
    modal_box.style.display = "block";

    const remove_booking = document.querySelector("#remove_booking");
    const close_modal = document.querySelector("#close_modal");
    
    remove_booking.addEventListener("click", async () => {
        const req = await fetch("/api/bookings", {
            method: "DELETE",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(booking)
        });
        if (req.ok) {
            const res = await req.json();
            console.log("Booking has been removed")
            closeModalBox(modal_box);
        }
    })
    close_modal.addEventListener("click", () => {
        closeModalBox(modal_box);
    });

}

function displayBookings(bookings) {

    //a table element is created;
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

    //rows are created to store booking information
    for (let i = 0; i < bookings.length; i++) {
        const booking = bookings[i];

        const row = document.createElement("tr");
        row.className = "table_row";

        const values = [
            booking.session_name,
            booking.start_date.split("T")[0],
            booking.start_time,
            booking.duration,
            ""
        ];

        for (let j = 0; j < values.length + 1; j++) {
            const td = document.createElement("td");
            td.textContent = values[j];
            td.className = "table_cell";
            row.appendChild(td);
            //display QR-code button;
            if (j === 4) {
                const qrcode_btn = document.createElement("button");
                qrcode_btn.textContent = "View QR-Code";
                qrcode_btn.className = "row_btns";
                td.append(qrcode_btn);
                qrcode_btn.addEventListener("click", () => {
                    showQRCode(booking.qr_code);
                });
            }

            if (j==5) {
                const remove_btn = document.createElement("button");
                remove_btn.textContent = "Remove";
                remove_btn.className = "row_btns";
                td.append(remove_btn);
                remove_btn.addEventListener("click", () => {
                    removeBooking(booking);
                })
            }
        }


        bookings_table.appendChild(row);
    }

    //const table_container = document.querySelector("#table_container")
    const bookings_container = document.querySelector("#bookings_container");
    bookings_container.appendChild(bookings_table);

}
function handleEventListeners() {
    nav.home.addEventListener("click", () => {
        window.location.href = "/dashboard";
    })

    nav.make_a_booking.addEventListener("click", ()=> {
        window.location.href = "/makeBooking";
    })

    nav.manage_bookings.addEventListener("click", () => {
        //sends a get request to /manageBookings endpoint
        window.location.href = "/manageBookings";
    })

};

function handleElements() {
    nav = {
        home: document.querySelector("#nav_home"),
        make_a_booking: document.querySelector("#nav_make_a_booking"),
        manage_bookings: document.querySelector("#nav_manage_bookings"),    
        logout: document.querySelector("#nav_logout")
    };

    welcome_msg = document.querySelector("#welcome_msg");
    timetable = document.querySelector("#timetable");
}

function getDayName(start_date) {

    const days = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday"
    ]

    const date = new Date(start_date);
    return days[date.getDay()];
    
} 

function displayTimetable(sessions) {
    const days = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday" ];

    const columns = {};

    for (let i = 0; i < days.length; i++) {
        
        const day = days[i];
        const column = document.createElement("div");
        column.classList.add("column_headings");
        const heading = document.createElement("h3");
        heading.textContent = day;
        column.appendChild(heading);
        columns[day] = column;
        timetable.appendChild(column);

    }

    console.log(`There are ${sessions.length} sessions`);

    for (let i = 0; i < sessions.length; i++) {

        const session = sessions[i];

        const day_name = getDayName(session.start_date);

        const session_container = document.createElement("div");
        session_container.classList.add("session_containers");
        const date = session.start_date.split("T")[0];
        //session_container.textContent = session.session_name + " | " + date + " | " + session.start_time + " | "  + session.duration + " | " + session.spaces;
        
        const correct_column = columns[day_name];

        session_container.innerHTML =  `
        <p><strong>${session.session_name}</strong></p>
        <p>Date: ${date}</p>
        <p>Time: ${session.start_time}</p>
        <p>Duration: ${session.duration}hr</p>
        <p>Spaces left: ${session.spaces}</p>
        `;

        /*session_container.session_details = {
            name: session.session_name,
            date: session.start_date,
            time: session.start_time,
            duration: session.duration,
            spaces: session.spaces
        };*/
        correct_column.appendChild(session_container);
        //timetable.appendChild(session_container);

        session_container.addEventListener("click", ()=> {
            displayModalBox(session)
        })

    }

}

async function getSessionData() {
    const req = await fetch("/api/timetable");
    const res = await req.json();
    console.log(res.data);
    displayTimetable(res.data);
}

async function getUserData() {
    const req = await fetch("/api/user");
    const res = await req.json();
    console.log(res.data);
    welcome_msg.textContent = `Hello ${res.data.name}`;
    return res.data;
};


main();