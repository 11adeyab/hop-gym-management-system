//variables that track what the user is currently viewing
let allSessions = []; // all sessions fetched from the server
let allBookings = []; // all bookings fetched from the server
let weekOffset = 0; // 0 = current week, -1 = last week, +1 = next week
let activeFilter = "upcoming"; // which booking filter is selected


// Hamburger menu toggle (mobile)
document.querySelector("#hamburger_btn").addEventListener("click", () => {
    document.querySelector("#sidebar").classList.toggle("open");
    document.querySelector("#nav_overlay").classList.toggle("open");
});

document.querySelector("#nav_overlay").addEventListener("click", () => {
    document.querySelector("#sidebar").classList.remove("open");
    document.querySelector("#nav_overlay").classList.remove("open");
});

// Close the mobile sidebar whenever a nav link is clicked
for (const link of document.querySelectorAll("nav a")) {
    link.addEventListener("click", () => {
        document.querySelector("#sidebar").classList.remove("open");
        document.querySelector("#nav_overlay").classList.remove("open");
    });
}

// Load the logged-in user's name into the sidebar header once on page load
(async () => {
    const req = await fetch("/api/user");
    if (req.ok) {
        const res = await req.json();
        const u = res.data;
        document.querySelector("#sidebar_user_name").textContent = u.first_name + " " + u.last_name;
    }
})();

document.querySelector("#nav_overview").addEventListener("click", () => showView("overview"));
document.querySelector("#nav_book_sessions").addEventListener("click", () => showView("book_sessions"));
document.querySelector("#nav_my_bookings").addEventListener("click", () => showView("my_bookings"));
document.querySelector("#nav_membership").addEventListener("click", () => showView("membership"));

showView("overview");


function showView(viewName) {
    // Highlight the active nav link

    for (let i of document.querySelectorAll("nav a")) {
        i.classList.remove("active");
    }
    document.querySelector("#nav_" + viewName).classList.add("active");

    // Get the template for this view
    const template = document.querySelector("#template_" + viewName);

    // cloneNode(true) makes a full copy of everything inside the template
    const content = template.content.cloneNode(true);

    // Clear main and insert the cloned content
    const main = document.querySelector("#main_content");
    main.innerHTML = "";
    main.appendChild(content);

    // Load data for the view that was just shown
    if (viewName === "overview") {
        loadOverview();
    } 
    else if (viewName === "book_sessions") {
        loadBookSessions();
    }
    else if (viewName === "my_bookings") {
        loadMyBookings();
    }
    else if (viewName === "membership") {
        loadMembership();
    }
}


async function loadOverview() {
    // Time-based greeting
    const hour = new Date().getHours();
    const period = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

    // Long date string e.g. "Saturday, 10 May 2026"
    const dateStr = new Date().toLocaleDateString("en-GB", {
        weekday: "long", day: "numeric", month: "long", year: "numeric"
    });
    document.querySelector("#greeting_date").textContent = dateStr;

    // Fetch user info, all bookings, and membership status in parallel
    const [userReq, bookingsReq, membershipReq] = await Promise.all([
        fetch("/api/user"),
        fetch("/api/bookings"),
        fetch("/api/membership")
    ]);

    // Set greeting using the user's first name
    let firstName = "";
    if (userReq.ok) {
        const d = await userReq.json();
        firstName = d.data.first_name;
    }
    document.querySelector("#greeting_text").textContent = "Good " + period + ", " + firstName;

    // Compute booking stats
    let bookings = [];
    if (bookingsReq.ok) {
        const d = await bookingsReq.json();
        bookings = d.data || [];
    }

    const now = new Date();
    const pastBookings     = bookings.filter(b => new Date(b.start_date + "T" + b.start_time) < now);
    const attendedBookings = bookings.filter(b => !!b.attended);
    const upcomingBookings = bookings
        .filter(b => new Date(b.start_date + "T" + b.start_time) >= now)
        .sort((a, z) => new Date(a.start_date + "T" + a.start_time) - new Date(z.start_date + "T" + z.start_time));

    const attendanceRate = pastBookings.length > 0
        ? Math.round((attendedBookings.length / pastBookings.length) * 100) + "%"
        : "N/A";

    document.querySelector("#stat_total_bookings").textContent  = bookings.length;
    document.querySelector("#stat_attendance_rate").textContent = attendanceRate;

    // Membership status
    let membershipLabel = "None";
    if (membershipReq.ok) {
        const d = await membershipReq.json();
        if (d.data) {
            const labels = { day: "Day Pass", weekly: "Weekly", monthly: "Monthly" };
            membershipLabel = labels[d.data.membership_type] || "Active";
        }
    }
    document.querySelector("#stat_membership").textContent = membershipLabel;

    // Upcoming bookings list (show at most 5)
    const list = document.querySelector("#overview_upcoming");
    if (upcomingBookings.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.innerHTML = "No upcoming bookings. <a href='#' id='link_book_now'>Book a session</a>";
        list.appendChild(empty);
        document.querySelector("#link_book_now").addEventListener("click", (e) => {
            e.preventDefault();
            showView("book_sessions");
        });
    } else {
        for (const booking of upcomingBookings.slice(0, 5)) {
            const row = document.createElement("div");
            row.className = "upcoming-row";
            const time = booking.start_time.split(":").slice(0, 2).join(":");
            row.innerHTML =
                "<span class='upcoming-name'>" + booking.session_name + "</span>" +
                "<span class='upcoming-date'>" + booking.start_date  + "</span>" +
                "<span class='upcoming-time'>" + time               + "</span>";
            list.appendChild(row);
        }
    }
}



async function loadBookSessions() {
    weekOffset = 0;

    // Wire up the Previous and Next week buttons
    document.querySelector("#btn_prev_week").addEventListener("click", () => {
        weekOffset = weekOffset - 1;
        renderTimetable();
    });

    document.querySelector("#btn_next_week").addEventListener("click", () => {
        weekOffset = weekOffset + 1;
        renderTimetable();
    });

    // Fetch all sessions from the server once, then filter by week in renderTimetable()
    
    const request = await fetch("/api/sessions");
    if (request.ok) {
        const response = await request.json();
        allSessions = response.data;
        renderTimetable();
    }
}

function renderTimetable() {
    const week = getWeekRange(weekOffset);

    // Update the week label in the middle of the nav
    document.querySelector("#week_label").textContent = formatDate(week.start) + " - " + formatDate(week.end);

    const grid = document.querySelector("#calendar_grid");
    grid.innerHTML = "";

    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    // Build one column per day of the week (index 0 = Monday, 6 = Sunday)
    for (let d = 0; d < 7; d++) {
        const dayDate = new Date(week.start);
        dayDate.setDate(week.start.getDate() + d);

        // Format as YYYY-MM-DD using local time to match DATE_FORMAT output from server
        const dayStr =
            dayDate.getFullYear() + "-" +
            String(dayDate.getMonth() + 1).padStart(2, "0") + "-" +
            String(dayDate.getDate()).padStart(2, "0");

        const daySessions = allSessions.filter(s => s.start_date === dayStr);

        const col = document.createElement("div");
        col.className = "cal-col";

        col.innerHTML =
            "<div class='cal-header'>" +
                "<span class='cal-day-name'>" + dayNames[d] + "</span>" +
                "<span class='cal-day-date'>" + dayDate.getDate() + " " +
                    dayDate.toLocaleDateString("en-GB", { month: "short" }) + "</span>" +
            "</div>" +
            "<div class='cal-sessions'></div>";

        const sessionsContainer = col.querySelector(".cal-sessions");

        if (daySessions.length === 0) {
            const empty = document.createElement("p");
            empty.className = "cal-empty";
            empty.textContent = "—";
            sessionsContainer.appendChild(empty);
        } else {
            for (let session of daySessions) {
                const card = document.createElement("div");
                card.className = "session-card";
                card.innerHTML =
                    "<div class='session-card-name'>" + session.session_name + "</div>" +
                    "<div class='session-card-time'>" + session.start_time.split(":").slice(0, 2).join(":") + "</div>" +
                    "<div class='session-card-spaces'>" + session.capacity + " spaces</div>";
                card.addEventListener("click", () => openModal(session));
                sessionsContainer.appendChild(card);
            }
        }

        grid.appendChild(col);
    }
}

function openModal(session) {
    document.querySelector("#error_msg").textContent = "";
    document.querySelector("#modal_session_name").textContent = session.session_name;
    document.querySelector("#modal_date").textContent = session.start_date;
    document.querySelector("#modal_time").textContent = session.start_time.split(":").slice(0, 2).join(":");
    document.querySelector("#modal_duration").textContent = session.duration + " hr";
    document.querySelector("#modal_instructor").textContent = session.instructor;
    document.querySelector("#modal_spaces").textContent = session.capacity;
    document.querySelector("#modal_gender").textContent = session.gender_eligibility;
    document.querySelector("#modal_age").textContent = session.min_age + " to " + session.max_age + " years";

    document.querySelector("#modal_overlay").classList.add("open");

    document.querySelector("#modal_btn_book").onclick = () => {
        bookSession(session);
    };

    document.querySelector("#modal_btn_close").onclick = () => {
        document.querySelector("#modal_overlay").classList.remove("open");
    };
}
// Validates the booking on the server, then redirects the user to Stripe to pay.
// The booking is only created in the database after payment is confirmed.
async function bookSession(session) {
    document.querySelector("#error_msg").textContent = "";
    document.querySelector("#modal_btn_book").textContent = "Redirecting to payment...";
    document.querySelector("#modal_btn_book").disabled = true;

    const req = await fetch("/api/bookings/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session)
    });

    if (req.ok) {
        // Server returned a Stripe Checkout URL — send the user there to pay
        const data = await req.json();
        window.location.href = data.url;
    } else {
        // Show the validation error inside the modal and re-enable the button
        const fail = await req.json();
        document.querySelector("#error_msg").textContent = fail.message;
        document.querySelector("#modal_btn_book").textContent = "Book — £3.00";
        document.querySelector("#modal_btn_book").disabled = false;
    }
}

async function loadMyBookings() {
    activeFilter = "upcoming";

    // Wire up the three filter buttons
    document.querySelector("#btn_filter_upcoming").addEventListener("click", () => {
        activeFilter = "upcoming";
        setActiveFilterButton("btn_filter_upcoming");
        renderBookings();
    });

    document.querySelector("#btn_filter_missed").addEventListener("click", function() {
        activeFilter = "missed";
        setActiveFilterButton("btn_filter_missed");
        renderBookings();
    });

    document.querySelector("#btn_filter_attended").addEventListener("click", () => {
        activeFilter = "attended";
        setActiveFilterButton("btn_filter_attended");
        renderBookings();
    });

    // Fetch the user's bookings from the server
    const req = await fetch("/api/bookings");
    if (req.ok) {
        const res = await req.json();
        allBookings = res.data || [];
        renderBookings();
    }
}

function setActiveFilterButton(activeId) {
    document.querySelector("#btn_filter_upcoming").classList.remove("active");
    document.querySelector("#btn_filter_missed").classList.remove("active");
    document.querySelector("#btn_filter_attended").classList.remove("active");
    document.querySelector("#" + activeId).classList.add("active");
}

function renderBookings() {
    const now = new Date();
    const list = document.querySelector("#bookings_list");
    list.innerHTML = "";

    const filtered = allBookings.filter((booking) => {
            const sessionStart = getSessionStartTime(booking);
            if (activeFilter === "upcoming") {
                // Only show if the session hasn't started yet
                return sessionStart > now;
            } else if (activeFilter === "missed") {
                return sessionStart <= now && !booking.attended;
            } else if (activeFilter === "attended") {
                return !!booking.attended;
            }
        }
    );

    if (filtered.length === 0) {
        list.innerHTML = "<p>No " + activeFilter + " bookings found.</p>";
        return;
    }

    for (let booking of filtered) {
        const date = booking.start_date.split("T")[0];
        const time = booking.start_time.split(":").slice(0, 2).join(":");

        const card = document.createElement("div");
        card.className = "booking-card";
        let attendanceLabel = "";
        if (activeFilter === "attended" && booking.checkin_datetime) {
            const checkinDate = new Date(booking.checkin_datetime);
            const checkinTime = String(checkinDate.getHours()).padStart(2, "0") + ":" + String(checkinDate.getMinutes()).padStart(2, "0");
            if (checkinTime > time) {
                attendanceLabel = "<p>Checked in at " + checkinTime + " — <strong>Late</strong></p>";
            } else {
                attendanceLabel = "<p>Checked in at " + checkinTime + " — <strong>On time</strong></p>";
            }
        }

        card.innerHTML =
            "<div>" +
                "<strong>" + booking.session_name + "</strong>" +
                "<p>" + date + " at " + time + " (" + booking.duration + " hr)</p>" +
                attendanceLabel +
            "</div>";

        if (activeFilter !== "attended") {
            let buttonsHtml = "<button id='btn_qr_" + booking.booking_id + "'>View QR</button>";
            if (activeFilter === "upcoming") {
                buttonsHtml += "<button id='btn_cancel_" + booking.booking_id + "'>Cancel</button>";
            }
            card.innerHTML += "<div>" + buttonsHtml + "</div>";
        }

        list.appendChild(card);

        if (activeFilter !== "attended") {
            document.querySelector("#btn_qr_" + booking.booking_id).addEventListener("click", () => {
                openQRModal(booking);
            });

            if (activeFilter === "upcoming") {
                document.querySelector("#btn_cancel_" + booking.booking_id).addEventListener("click", () => {
                    openCancelModal(booking);
                });
            }
        }
    }
}

function openQRModal(booking) {
    const date = booking.start_date.split("T")[0];
    const time = booking.start_time.split(":").slice(0, 2).join(":");

    document.querySelector("#modal_qr_session_name").textContent = booking.session_name;
    document.querySelector("#modal_qr_details").textContent = date + " at " + time + " (" + booking.duration + " hr)";
    document.querySelector("#modal_qr_image").src = booking.qr_code;

    document.querySelector("#modal_qr_overlay").classList.add("open");

    document.querySelector("#modal_qr_btn_close").onclick = () => {
        document.querySelector("#modal_qr_overlay").classList.remove("open");
    };
}

function openCancelModal(booking) {
    document.querySelector("#modal_cancel_session_name").textContent = booking.session_name;

    document.querySelector("#modal_cancel_overlay").classList.add("open");

    document.querySelector("#modal_cancel_btn_confirm").onclick = () => {
        document.querySelector("#modal_cancel_overlay").classList.remove("open");
        cancelBooking(booking.booking_id);
    };

    document.querySelector("#modal_cancel_btn_close").onclick = () => {
        document.querySelector("#modal_cancel_overlay").classList.remove("open");
    };
}

async function cancelBooking(bookingId) {
    await fetch("/api/bookings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: bookingId })
    });
    loadMyBookings();
}

async function loadMembership() {
    const req = await fetch("/api/membership");
    if (req.ok) {
        const res = await req.json();
        renderMembership(res.data);
    }
}

function renderMembership(membership) {
    if (membership) {
        const badge = document.querySelector("#mem_status_badge");
        badge.textContent = "Active";
        badge.className = "mem-status-badge mem-status-active";

        document.querySelector("#mem_id").textContent = membership.membership_id;
        document.querySelector("#mem_start_date").textContent = membership.start_date;
        document.querySelector("#mem_end_date").textContent = membership.end_date;

        if (membership.membership_type === "day") {
            document.querySelector("#mem_type").textContent = "Day Pass";
        } else if (membership.membership_type === "weekly") {
            document.querySelector("#mem_type").textContent = "Weekly Pass";
        } else if (membership.membership_type === "monthly") {
            document.querySelector("#mem_type").textContent = "Monthly Pass";
        }

        document.querySelector("#mem_purchase_section").style.display = "none";
        document.querySelector("#mem_qr_btn_section").style.display = "block";

        document.querySelector("#btn_mem_qr").addEventListener("click", () => {
            openMembershipQRModal(membership);
        });

        document.querySelector("#covered_sessions_section").style.display = "block";
        const tbody = document.querySelector("#covered_sessions_body");
        tbody.innerHTML = "";

        if (membership.covered_sessions.length === 0) {
            tbody.innerHTML = "<tr><td colspan='5'>No sessions scheduled within your membership period.</td></tr>";
        } else {
            for (let session of membership.covered_sessions) {
                const row = document.createElement("tr");
                row.innerHTML =
                    "<td>" + session.session_name + "</td>" +
                    "<td>" + session.start_date + "</td>" +
                    "<td>" + session.start_time.split(":").slice(0, 2).join(":") + "</td>" +
                    "<td>" + session.duration + " hr</td>" +
                    "<td>" + session.capacity + " spaces</td>";
                tbody.appendChild(row);
            }
        }
    } else {
        const badge = document.querySelector("#mem_status_badge");
        badge.textContent = "No Active Membership";
        badge.className = "mem-status-badge mem-status-inactive";

        document.querySelector("#mem_purchase_section").style.display = "block";

        const today = new Date();
        const todayStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
        document.querySelector("#mem_start_input").min = todayStr;
        document.querySelector("#mem_start_input").value = todayStr;

        // Update button price text whenever the membership type changes
        const prices = { day: "£5.00", weekly: "£20.00", monthly: "£50.00" };
        document.querySelector("#mem_type_select").addEventListener("change", function() {
            document.querySelector("#btn_purchase_membership").textContent = "Purchase — " + (prices[this.value] || "");
        });

        document.querySelector("#btn_purchase_membership").addEventListener("click", () => {
            purchaseMembership();
        });
    }
}

function openMembershipQRModal(membership) {
    let typeLabel;
    if (membership.membership_type === "day") {
        typeLabel = "Day Pass";
    } else if (membership.membership_type === "weekly") {
        typeLabel = "Weekly Pass";
    } else if (membership.membership_type === "monthly") {
        typeLabel = "Monthly Pass";
    }

    document.querySelector("#modal_mem_qr_details").textContent = typeLabel + "  ·  " + membership.start_date + " to " + membership.end_date;
    document.querySelector("#modal_mem_qr_image").src = membership.qr_code;

    document.querySelector("#modal_mem_qr_overlay").classList.add("open");

    document.querySelector("#modal_mem_qr_btn_close").onclick = () => {
        document.querySelector("#modal_mem_qr_overlay").classList.remove("open");
    };
}

// Validates the membership on the server, then redirects the user to Stripe to pay.
// The membership is only created in the database after payment is confirmed.
async function purchaseMembership() {
    const membership_type = document.querySelector("#mem_type_select").value;
    const start_date      = document.querySelector("#mem_start_input").value;
    const prices          = { day: "£5.00", weekly: "£20.00", monthly: "£50.00" };
    const priceLabel      = prices[membership_type] || "";

    document.querySelector("#mem_error_msg").textContent = "";

    if (!start_date) {
        document.querySelector("#mem_error_msg").textContent = "Please select a start date.";
        return;
    }

    document.querySelector("#btn_purchase_membership").textContent = "Redirecting to payment...";
    document.querySelector("#btn_purchase_membership").disabled = true;

    const req = await fetch("/api/membership/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_type: membership_type, start_date: start_date })
    });

    if (req.ok) {
        // Server returned a Stripe Checkout URL — send the user there to pay
        const data = await req.json();
        window.location.href = data.url;
    } else {
        const fail = await req.json();
        document.querySelector("#mem_error_msg").textContent = fail.message;
        document.querySelector("#btn_purchase_membership").textContent = "Purchase — " + priceLabel;
        document.querySelector("#btn_purchase_membership").disabled = false;
    }
}

// Returns the Monday and Sunday of the week at the given offset
// offset 0 = current week, -1 = previous week, +1 = next week
function getWeekRange(offset) {

    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday ... 6 = Saturday

    // Work out how many days back we need to go to land on Monday.
    // Sunday is a special case - getDay() returns 0 for Sunday, so
    // the normal formula (dayOfWeek - 1) would give -1, which is wrong.
    let daysToMonday;
    if (dayOfWeek === 0) {
        daysToMonday = 6;       // Sunday: go back 6 days to reach Monday
    } else {
        daysToMonday = dayOfWeek - 1;   // e.g. Wednesday(3) - 1 = 2 days back
    }

    // new Date(today) makes a COPY of today - without this, monday and today
    // would point to the same object and changing one would change the other.
    const monday = new Date(today);
    monday.setDate(today.getDate() - daysToMonday + (offset * 7));
    monday.setHours(0, 0, 0, 0);       // set to start of day (midnight)

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);  // set to end of day

    return { start: monday, end: sunday };
}

// Returns a Date object for when a session starts
function getSessionStartTime(booking) {
    return new Date(booking.start_date + "T" + booking.start_time);
}

// Returns a Date object for when a session ends
function getSessionEndTime(booking) {
    const end = new Date(booking.start_date + "T" + booking.start_time);
    end.setHours(end.getHours() + booking.duration);
    return end;
}

// Formats a Date as "8 May 2026"
function formatDate(date) {
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
