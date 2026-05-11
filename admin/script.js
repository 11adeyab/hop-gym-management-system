let allAdminSessions = []; // all sessions are fetched from the server and displayed on timetable
let editingSessionId = null; // tracks whether the session modal is in "add" or "edit" mode
let scanner = null; // holds the Html5QrcodeScanner instance so we can stop it when switching views
let adminWeekOffset = 0; // how many weeks forward or back from the current week we're viewing
let profileActiveFilter = "upcoming"; // which booking tab is active on the customer profile page


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

// Load the logged-in admin's name into the sidebar header on page load
(async () => {
    const req = await fetch("/api/user");
    if (req.ok) {
        const res = await req.json();
        const u = res.data;
        document.querySelector("#sidebar_user_name").textContent = u.first_name + " " + u.last_name;
    }
})();

document.querySelector("#nav_qr_scanner").addEventListener("click", () => showView("qr_scanner"));
document.querySelector("#nav_timetable").addEventListener("click", () => showView("timetable"));
document.querySelector("#nav_customers").addEventListener("click", () => showView("customers"));
document.querySelector("#nav_staff").addEventListener("click", () => showView("staff"));
document.querySelector("#nav_reports").addEventListener("click", () => showView("reports"));

// Show the QR scanner by default when the admin page first loads
showView("qr_scanner");

//  Switches the main content area to the requested view.
async function showView(viewName) {
    // If the scanner is running, stop it and release the camera before clearing the page
    if (scanner !== null) {
        try {
            await scanner.clear();
        } catch (_) {
            // Ignore cleanup errors — the scanner may already be stopped
        }
        scanner = null;
    }

    // Remove the "active" highlight from all nav links, then highlight the selected one
    for (let link of document.querySelectorAll("nav a")) {
        link.classList.remove("active");
    }
    document.querySelector("#nav_" + viewName).classList.add("active");

    // Clone the matching <template> element and insert it into the page
    const template = document.querySelector("#template_" + viewName);
    const content  = template.content.cloneNode(true);

    const main = document.querySelector("#main_content");
    main.innerHTML = "";
    main.appendChild(content);

    // Call the loader function for the selected view
    if (viewName === "qr_scanner") {
        loadQRScanner();
    } else if (viewName === "timetable") {
        loadTimetable();
    } else if (viewName === "customers") {
        loadCustomers();
    } else if (viewName === "staff") {
        loadStaff();
    } else if (viewName === "reports") {
        loadReports("all");
    }
}


//QR-Code Scanner
// Wires up the "Start Scanner" button after the scanner template is inserted into the page
function loadQRScanner() {
    document.querySelector("#btn_start_scanner").addEventListener("click", () => {
        startScanner();
    });
}

// Hides the start button and launches the camera-based QR scanner
function startScanner() {
    document.querySelector("#btn_start_scanner").style.display = "none";

    // Create the scanner targeting the container div, with 20fps and a 250×250 scan box
    scanner = new Html5QrcodeScanner("scanner_container", {
        fps: 20,
        qrbox: { width: 250, height: 250 }
    });

    // onScanSuccess is called automatically whenever a QR code is decoded
    scanner.render(onScanSuccess);
}

// Called by the scanner library each time it successfully reads a QR code.
// Sends the decoded text to the server attendance endpoint and displays the result.
async function onScanSuccess(decodedText) {
    // Stop the scanner as soon as a code is read so the camera closes
    await scanner.clear();
    scanner = null;

    // Send the QR code value to the server to record attendance
    const req = await fetch("/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decodedText: decodedText })
    });

    const result  = await req.json();
    const message = result.message || result.data;

    // Choose a card colour based on the emoji prefix the server puts on the message:
    //   ✅ = success (green), ⏰/⚠️ = warning (yellow), anything else = failure (red)
    let cardClass;
    if (message && message.startsWith("✅")) {
        cardClass = "scan-ok";
    } else if (message && (message.startsWith("⏰") || message.startsWith("⚠️"))) {
        cardClass = "scan-warn";
    } else {
        cardClass = "scan-fail";
    }

    // Build and display the result card with a "Scan Another" button
    const resultDiv = document.querySelector("#scan_result");
    const card = document.createElement("div");
    card.className = "scan-result-card " + cardClass;
    card.innerHTML =
        "<p>" + message + "</p>" +
        "<button id='btn_scan_again' class='btn-secondary'>Scan Another</button>";

    resultDiv.innerHTML = "";
    resultDiv.appendChild(card);

    // "Scan Another" clears the result and re-shows the start button so staff can scan again
    document.querySelector("#btn_scan_again").addEventListener("click", () => {
        resultDiv.innerHTML = "";
        document.querySelector("#btn_start_scanner").style.display = "block";
    });
}


// Manage Timetable:
// Fetches all sessions from the server and sets up the week navigation buttons.
// Resets the week offset to 0 (current week) each time this view is opened.
async function loadTimetable() {
    adminWeekOffset = 0;

    // "Add Session" button opens a blank modal form
    document.querySelector("#btn_add_session").addEventListener("click", () => {
        openSessionModal(null);
    });

    // Week navigation buttons shift the offset and re-render with the new week's sessions
    document.querySelector("#btn_prev_week").addEventListener("click", () => {
        adminWeekOffset--;
        renderTimetable();
    });

    document.querySelector("#btn_next_week").addEventListener("click", () => {
        adminWeekOffset++;
        renderTimetable();
    });

    // Load all sessions from the server into the shared allAdminSessions array
    const req = await fetch("/api/admin/sessions");
    if (req.ok) {
        const res       = await req.json();
        allAdminSessions = res.data;
        renderTimetable();
    }
}

// Re-fetches sessions from the server and re-renders the timetable.
// Called after a session is created, edited, or deleted.
async function refreshTimetable() {
    const req = await fetch("/api/admin/sessions");
    if (req.ok) {
        const res        = await req.json();
        allAdminSessions = res.data;
        renderTimetable();
    }
}

// Filters allAdminSessions to the currently visible week and renders them as table rows.
function renderTimetable() {
    const { start, end } = getAdminWeekRange(adminWeekOffset);

    // Update the week label text (e.g. "5 May 2025 – 11 May 2025")
    const startLabel = start.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const endLabel   = end.toLocaleDateString(  "en-GB", { day: "numeric", month: "short", year: "numeric" });
    document.querySelector("#week_label").textContent = startLabel + " – " + endLabel;

    // Keep only sessions whose date falls within the selected week
    const weekSessions = allAdminSessions.filter(session => {
        const d = new Date(session.start_date + "T00:00:00");
        return d >= start && d <= end;
    });

    const tbody = document.querySelector("#timetable_body");
    tbody.innerHTML = "";

    if (weekSessions.length === 0) {
        tbody.innerHTML = "<tr><td colspan='9'>No sessions this week.</td></tr>";
        return;
    }

    // Build one table row per session with Edit and Delete buttons
    for (let session of weekSessions) {
        // Strip seconds from the stored "HH:MM:SS" time so we show "HH:MM"
        const time = session.start_time.split(":").slice(0, 2).join(":");
        const row  = document.createElement("tr");
        row.innerHTML =
            "<td>" + session.session_name + "</td>" +
            "<td>" + session.start_date + "</td>" +
            "<td>" + time + "</td>" +
            "<td>" + session.duration + " hr" + "</td>" +
            "<td>" + session.instructor + "</td>" +
            "<td>" + session.capacity + "</td>" +
            "<td>" + session.gender_eligibility + "</td>" +
            "<td>" + session.min_age + "–" + session.max_age + "</td>" +
            "<td style='display:flex;gap:6px;'>" +
                "<button id='btn_edit_"   + session.session_id + "' class='btn-secondary'>Edit</button>" +
                "<button id='btn_delete_" + session.session_id + "' class='btn-danger'>Delete</button>" +
            "</td>";

        tbody.appendChild(row);

        // Wire Edit and Delete buttons for this specific session
        document.querySelector("#btn_edit_" + session.session_id).addEventListener("click", () => openSessionModal(session));
        document.querySelector("#btn_delete_" + session.session_id).addEventListener("click", () => openDeleteModal(session));
    }
}


// Opens the session form modal. If session is null the form is blank (add mode).
// If session is an object, the fields are pre-filled with its values (edit mode).
function openSessionModal(session) {
    document.querySelector("#form_error_msg").textContent = "";

    if (session) {
        // Edit mode — store the ID so saveSession() knows to PUT instead of POST
        editingSessionId = session.session_id;
        document.querySelector("#modal_session_title").textContent  = "Edit Session";
        document.querySelector("#form_session_name").value = session.session_name;
        document.querySelector("#form_start_date").value = session.start_date;
        // Strip seconds from "HH:MM:SS" before putting the value into the time input
        document.querySelector("#form_start_time").value = session.start_time.split(":").slice(0, 2).join(":");
        document.querySelector("#form_duration").value = session.duration;
        document.querySelector("#form_instructor").value = session.instructor;
        document.querySelector("#form_capacity").value = session.capacity;
        document.querySelector("#form_gender").value = session.gender_eligibility;
        document.querySelector("#form_min_age").value = session.min_age;
        document.querySelector("#form_max_age").value = session.max_age;
    } else {
        // Add mode — clear the form and reset the editing ID
        editingSessionId = null;
        document.querySelector("#modal_session_title").textContent  = "Add Session";
        document.querySelector("#form_session_name").value = "";
        document.querySelector("#form_start_date").value = "";
        document.querySelector("#form_start_time").value = "";
        document.querySelector("#form_duration").value = "1";
        document.querySelector("#form_instructor").value = "";
        document.querySelector("#form_capacity").value = "";
        document.querySelector("#form_gender").value = "Any";
        document.querySelector("#form_min_age").value = "";
        document.querySelector("#form_max_age").value = "";
    }

    document.querySelector("#modal_session_overlay").classList.add("open");

    // Wire the Save and Close buttons each time the modal opens so they always point at the right session
    document.querySelector("#modal_session_btn_save").onclick  = () => saveSession();
    document.querySelector("#modal_session_btn_close").onclick = () => {
        document.querySelector("#modal_session_overlay").classList.remove("open");
    };
}

// Reads the session form, then sends either a POST (new) or PUT (edit) to the server.
// Closes the modal on success or shows an error message on failure.
async function saveSession() {
    const payload = {
        session_name: document.querySelector("#form_session_name").value,
        start_date: document.querySelector("#form_start_date").value,
        start_time: document.querySelector("#form_start_time").value,
        duration: Number(document.querySelector("#form_duration").value),
        instructor: document.querySelector("#form_instructor").value,
        capacity: Number(document.querySelector("#form_capacity").value),
        gender_eligibility: document.querySelector("#form_gender").value,
        min_age: Number(document.querySelector("#form_min_age").value),
        max_age: Number(document.querySelector("#form_max_age").value)
    };

    let req;
    if (editingSessionId) {
        // Attach the session ID so the server knows which record to update
        payload.session_id = editingSessionId;
        req = await fetch("/api/admin/sessions", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } else {
        req = await fetch("/api/admin/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    }

    if (req.ok) {
        document.querySelector("#modal_session_overlay").classList.remove("open");
        refreshTimetable();
    } else {
        // Show the server's validation message inside the modal
        const fail = await req.json();
        document.querySelector("#form_error_msg").textContent = fail.message;
    }
}

// Shows a confirmation dialog before deleting a session.
// Displays the session name so staff can double-check before confirming.
function openDeleteModal(session) {
    document.querySelector("#modal_delete_session_name").textContent = session.session_name;
    document.querySelector("#modal_delete_overlay").classList.add("open");

    // Confirm button: close the modal then send the delete request
    document.querySelector("#modal_delete_btn_confirm").onclick = () => {
        document.querySelector("#modal_delete_overlay").classList.remove("open");
        deleteSession(session.session_id);
    };

    // Cancel button: just close the modal without doing anything
    document.querySelector("#modal_delete_btn_close").onclick = () => {
        document.querySelector("#modal_delete_overlay").classList.remove("open");
    };
}

// Sends a DELETE request to the server for the given session ID, then refreshes the timetable.
async function deleteSession(sessionId) {
    const req = await fetch("/api/admin/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId })
    });

    if (req.ok) {
        refreshTimetable();
    }
}


//  Manage Customers:
// Fetches all non-admin users from the server and renders them in the customers table.
async function loadCustomers() {
    const req = await fetch("/api/admin/customers");
    if (!req.ok) return;
    const res = await req.json();
    renderCustomers(res.data);
}

// Builds a table row for each customer with View, Edit, and Delete buttons.
function renderCustomers(customers) {
    const tbody = document.querySelector("#customers_body");
    tbody.innerHTML = "";

    if (customers.length === 0) {
        tbody.innerHTML = "<tr><td colspan='4'>No customers found.</td></tr>";
        return;
    }

    for (let customer of customers) {
        const row = document.createElement("tr");
        row.innerHTML =
            "<td>" + customer.user_id + "</td>" +
            "<td>" + customer.first_name + " " + customer.last_name + "</td>" +
            "<td>" + customer.email + "</td>" +
            "<td class='td-actions'>" +
                "<button id='btn_view_" + customer.user_id + "' class='btn-ghost btn-sm'>View</button>"      +
                "<button id='btn_edit_" + customer.user_id + "' class='btn-ghost btn-sm'>Edit</button>"      +
                "<button id='btn_delete_" + customer.user_id + "' class='btn-danger btn-sm'>Delete</button>"  +
            "</td>";

        tbody.appendChild(row);

        document.querySelector("#btn_view_" + customer.user_id).addEventListener("click", () => openCustomerProfile(customer.user_id));
        document.querySelector("#btn_edit_" + customer.user_id).addEventListener("click", () => openEditModal(customer, "customer"));
        document.querySelector("#btn_delete_" + customer.user_id).addEventListener("click", () => openDeleteAccountModal(customer, "customer"));
    }
}

// Fetches the full profile for one customer (account info, membership, bookings)
// and replaces the main content area with a profile view instead of using a template.
async function openCustomerProfile(customerId) {
    const req = await fetch("/api/admin/customers/" + customerId);
    if (!req.ok) return;
    const res = await req.json();
    const { user, membership, bookings } = res.data;

    // Reset the booking filter tab to "upcoming" every time a profile is opened
    profileActiveFilter = "upcoming";

    const main = document.querySelector("#main_content");
    main.innerHTML = "";

    const section = document.createElement("section");

    // Back button — returns to the customers list by re-triggering the customers view
    const backBtn = document.createElement("button");
    backBtn.className = "btn-secondary";
    backBtn.textContent = "← Back to Customers";
    backBtn.style.marginBottom = "20px";
    backBtn.addEventListener("click", () => showView("customers"));
    section.appendChild(backBtn);

    // Customer's full name as the page heading
    const heading = document.createElement("h2");
    heading.textContent = user.first_name + " " + user.last_name;
    heading.style.marginBottom = "20px";
    section.appendChild(heading);

    // Account information card (static details that don't change often)
    const accountCard = document.createElement("div");
    accountCard.className = "profile-card";
    accountCard.innerHTML =
        "<h3>Account Information</h3>" +
        "<div class='profile-row'><span class='profile-label'>User ID</span><span>" + user.user_id + "</span></div>" +
        "<div class='profile-row'><span class='profile-label'>Email</span><span>" + user.email + "</span></div>" +
        "<div class='profile-row'><span class='profile-label'>Phone</span><span>" + user.phone + "</span></div>" +
        "<div class='profile-row'><span class='profile-label'>Date of Birth</span><span>" + user.date_of_birth + "</span></div>" +
        "<div class='profile-row'><span class='profile-label'>Gender</span><span>" + user.gender + "</span></div>";
    section.appendChild(accountCard);

    // Membership card — shows status badge and dates if the customer has a membership
    const memCard = document.createElement("div");
    memCard.className = "profile-card";
    if (membership) {
        const isActive = membership.status === "active";
        const badgeClass = isActive ? "mem-status-active" : "mem-status-inactive";
        const badgeText  = isActive ? "Active" : "Expired";
        memCard.innerHTML =
            "<h3>Membership</h3>" +
            "<span class='mem-status-badge " + badgeClass + "'>" + badgeText + "</span>" +
            "<div class='profile-row'><span class='profile-label'>Membership ID</span><span>" + membership.membership_id   + "</span></div>" +
            "<div class='profile-row'><span class='profile-label'>Type</span><span>" + membership.membership_type + "</span></div>" +
            "<div class='profile-row'><span class='profile-label'>Start Date</span><span>" + membership.start_date      + "</span></div>" +
            "<div class='profile-row'><span class='profile-label'>End Date</span><span>" + membership.end_date        + "</span></div>";
    } else {
        memCard.innerHTML = "<h3>Membership</h3><p style='color:#888;margin-top:8px;'>No membership on record.</p>";
    }
    section.appendChild(memCard);

    // Booking history section heading
    const bookingHeading = document.createElement("h3");
    bookingHeading.textContent = "Booking & Attendance History";
    bookingHeading.style.marginBottom = "12px";
    section.appendChild(bookingHeading);

    // Filter tabs let admin staff toggle between upcoming, missed, and attended bookings
    const tabs = document.createElement("div");
    tabs.className = "filter-tabs";
    tabs.innerHTML =
        "<button id='prof_tab_upcoming' class='active'>Upcoming</button>" +
        "<button id='prof_tab_missed'>Missed</button>" +
        "<button id='prof_tab_attended'>Attended</button>";
    section.appendChild(tabs);

    // Container div where booking cards will be rendered
    const bookingList = document.createElement("div");
    bookingList.id = "profile_bookings_list";
    section.appendChild(bookingList);

    main.appendChild(section);

    // Wire each filter tab — update the active state and re-render bookings with the new filter
    document.querySelector("#prof_tab_upcoming").addEventListener("click", () => {
        profileActiveFilter = "upcoming";
        updateTabActive();
        renderProfileBookings(bookings);
    });

    document.querySelector("#prof_tab_missed").addEventListener("click", () => {
        profileActiveFilter = "missed";
        updateTabActive();
        renderProfileBookings(bookings);
    });

    document.querySelector("#prof_tab_attended").addEventListener("click", () => {
        profileActiveFilter = "attended";
        updateTabActive();
        renderProfileBookings(bookings);
    });

    // Show upcoming bookings immediately when the profile first opens
    renderProfileBookings(bookings);
}

// Adds or removes the "active" CSS class on each booking filter tab
// to match whichever filter is currently selected (profileActiveFilter).
function updateTabActive() {
    document.querySelector("#prof_tab_upcoming").classList.toggle("active", profileActiveFilter === "upcoming");
    document.querySelector("#prof_tab_missed").classList.toggle(  "active", profileActiveFilter === "missed");
    document.querySelector("#prof_tab_attended").classList.toggle( "active", profileActiveFilter === "attended");
}

// Filters the customer's full booking list down to whichever category is active,
// then builds and displays one card per booking.
function renderProfileBookings(bookings) {
    const list = document.querySelector("#profile_bookings_list");
    list.innerHTML = "";

    // Use midnight today as the cutoff for "upcoming" vs "missed"
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const filtered = bookings.filter(b => {
        const attended = b.checkin_datetime !== null;

        if (profileActiveFilter === "attended") {
             return attended;
        }

        // Treat bookings for deleted sessions (no start_date) as missed
        if (!b.start_date) {
            return profileActiveFilter === "missed";
        }
        const sessionDate = new Date(b.start_date + "T00:00:00");
        if (profileActiveFilter === "missed")  {
            return !attended && sessionDate < now;
        }
        
        return !attended && sessionDate >= now; // "upcoming"
    });

    if (filtered.length === 0) {
        list.innerHTML = "<p style='color:#888;'>No bookings in this category.</p>";
        return;
    }

    for (let booking of filtered) {
        const attended = booking.checkin_datetime !== null;
        const sessionDate = booking.start_date ? new Date(booking.start_date + "T00:00:00") : null;
        const isPast = sessionDate && sessionDate < now;

        // Determine the status badge text and colour class for this booking
        let statusClass, statusLabel;
        if (attended) {
            statusClass = "status-attended";
            statusLabel = "Attended";
        } else if (isPast || !booking.start_date) {
            statusClass = "status-missed";
            statusLabel = "Missed";
        } else {
            statusClass = "status-upcoming";
            statusLabel = "Upcoming";
        }

        // Strip seconds from start time; show fallback text if the session has been deleted
        const time = booking.start_time ? booking.start_time.split(":").slice(0, 2).join(":") : "--";
        const dateStr = booking.start_date ? booking.start_date + " at " + time : "Session deleted";

        const card = document.createElement("div");
        card.className = "booking-card";
        card.innerHTML =
            "<div>" +
                "<strong>" + (booking.session_name || "Deleted Session") + "</strong><br>" +
                "<small style='color:#666;'>" + dateStr + "</small>" +
            "</div>" +
            "<span class='status-tag " + statusClass + "'>" + statusLabel + "</span>";

        list.appendChild(card);
    }
}


//  Manage Staff:
// Fetches all admin accounts and renders them in the staff table.
// Also wires the "Add Staff Account" button to open the creation modal.
async function loadStaff() {
    document.querySelector("#btn_add_staff").addEventListener("click", () => {
        openStaffModal();
    });

    const req = await fetch("/api/admin/staff");
    if (!req.ok) {
        return;
    }
    const res = await req.json();
    renderStaff(res.data);
}

// Builds one table row per staff member with Edit and Delete buttons.
function renderStaff(staff) {
    const tbody = document.querySelector("#staff_body");
    tbody.innerHTML = "";

    if (staff.length === 0) {
        tbody.innerHTML = "<tr><td colspan='7'>No staff accounts found.</td></tr>";
        return;
    }

    for (let member of staff) {
        const row = document.createElement("tr");
        row.innerHTML =
            "<td>" + member.user_id + "</td>" +
            "<td>" + member.first_name + " " + member.last_name + "</td>" +
            "<td>" + member.email + "</td>" +
            "<td>" + member.phone + "</td>" +
            "<td>" + member.gender + "</td>" +
            "<td>" + member.date_of_birth + "</td>" +
            "<td class='td-actions'>" +
                "<button id='btn_edit_staff_" + member.user_id + "' class='btn-ghost btn-sm'>Edit</button>"   +
                "<button id='btn_delete_staff_" + member.user_id + "' class='btn-danger btn-sm'>Delete</button>" +
            "</td>";
        tbody.appendChild(row);

        document.querySelector("#btn_edit_staff_" + member.user_id).addEventListener("click", () => openEditModal(member, "staff"));
        document.querySelector("#btn_delete_staff_" + member.user_id).addEventListener("click", () => openDeleteAccountModal(member, "staff"));
    }
}

// Clears the staff creation form and opens the modal.
function openStaffModal() {
    document.querySelector("#staff_first_name").value  = "";
    document.querySelector("#staff_last_name").value = "";
    document.querySelector("#staff_email").value = "";
    document.querySelector("#staff_password").value = "";
    document.querySelector("#staff_phone").value = "";
    document.querySelector("#staff_dob_day").value = "";
    document.querySelector("#staff_dob_month").value = "";
    document.querySelector("#staff_dob_year").value = "";
    document.querySelector("#staff_gender").value = "Male";
    document.querySelector("#staff_error_msg").textContent = "";

    document.querySelector("#modal_staff_overlay").classList.add("open");

    document.querySelector("#modal_staff_btn_save").onclick  = () => saveStaff();
    document.querySelector("#modal_staff_btn_close").onclick = () => {
        document.querySelector("#modal_staff_overlay").classList.remove("open");
    };
}

// Reads the staff form and sends a POST request to create a new admin account.
// Re-fetches and re-renders the staff list on success, or shows an error on failure.
async function saveStaff() {
    const day = document.querySelector("#staff_dob_day").value;
    const month = document.querySelector("#staff_dob_month").value;
    const year = document.querySelector("#staff_dob_year").value;
    const dob = year && month && day ? year + "-" + month + "-" + String(day).padStart(2, "0") : "";

    const payload = {
        first_name: document.querySelector("#staff_first_name").value,
        last_name: document.querySelector("#staff_last_name").value,
        email: document.querySelector("#staff_email").value,
        password: document.querySelector("#staff_password").value,
        phone: document.querySelector("#staff_phone").value,
        date_of_birth: dob,
        gender: document.querySelector("#staff_gender").value
    };

    const req = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (req.ok) {
        // Close the modal then refresh the staff list so the new account appears immediately
        document.querySelector("#modal_staff_overlay").classList.remove("open");
        const refreshReq = await fetch("/api/admin/staff");
        if (refreshReq.ok) {
            const data = await refreshReq.json();
            renderStaff(data.data);
        }
    } else {
        // Display the server's error message (e.g. "Email already in use") inside the modal
        const fail = await req.json();
        document.querySelector("#staff_error_msg").textContent = fail.message;
    }
}

// Edit User Account (customers and staff share the same modal)
// Pre-fills the edit modal with the user's current details and opens it.
// type is "customer" or "staff" — used to pick the correct API endpoint on save.
function openEditModal(user, type) {
    document.querySelector("#edit_user_id").value = user.user_id;
    document.querySelector("#edit_user_type").value = type;
    document.querySelector("#modal_edit_title").textContent = type === "staff" ? "Edit Staff Account" : "Edit Customer Account";
    document.querySelector("#edit_first_name").value = user.first_name;
    document.querySelector("#edit_last_name").value = user.last_name;
    document.querySelector("#edit_email").value = user.email;
    document.querySelector("#edit_phone").value = user.phone  || "";
    document.querySelector("#edit_gender").value = user.gender || "Male";
    document.querySelector("#edit_error_msg").textContent = "";

    // Split the stored YYYY-MM-DD string into the three separate DOB fields
    if (user.date_of_birth) {
        const [year, month, day] = user.date_of_birth.split("-");
        document.querySelector("#edit_dob_year").value = year;
        document.querySelector("#edit_dob_month").value = month;
        document.querySelector("#edit_dob_day").value = parseInt(day, 10); // strip leading zero for select match
    } else {
        document.querySelector("#edit_dob_year").value = "";
        document.querySelector("#edit_dob_month").value = "";
        document.querySelector("#edit_dob_day").value = "";
    }

    document.querySelector("#modal_edit_overlay").classList.add("open");

    document.querySelector("#modal_edit_btn_save").onclick  = () => saveEdit();
    document.querySelector("#modal_edit_btn_close").onclick = () => {
        document.querySelector("#modal_edit_overlay").classList.remove("open");
    };
}

// Reads the edit modal form and sends a PUT request to update the account.
// Refreshes the relevant list (staff or customers) on success.
async function saveEdit() {
    const userId = document.querySelector("#edit_user_id").value;
    const userType = document.querySelector("#edit_user_type").value;
    const day = document.querySelector("#edit_dob_day").value;
    const month = document.querySelector("#edit_dob_month").value;
    const year = document.querySelector("#edit_dob_year").value;
    const dob = year && month && day ? year + "-" + month + "-" + String(day).padStart(2, "0") : "";

    const payload = {
        first_name: document.querySelector("#edit_first_name").value,
        last_name: document.querySelector("#edit_last_name").value,
        email: document.querySelector("#edit_email").value,
        phone: document.querySelector("#edit_phone").value,
        date_of_birth: dob,
        gender: document.querySelector("#edit_gender").value
    };

    const endpoint = userType === "staff"
        ? "/api/admin/staff/" + userId
        : "/api/admin/customers/" + userId;

    const req = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (req.ok) {
        document.querySelector("#modal_edit_overlay").classList.remove("open");
        // Refresh whichever list is currently visible
        if (userType === "staff") {
            const r = await fetch("/api/admin/staff");
            if (r.ok) renderStaff((await r.json()).data);
        } else {
            loadCustomers();
        }
    } else {
        const fail = await req.json();
        document.querySelector("#edit_error_msg").textContent = fail.message;
    }
}


//  Delete User Account
// Shows a confirmation dialog before deleting a customer or staff account.
function openDeleteAccountModal(user, type) {
    document.querySelector("#modal_delete_account_name").textContent = user.first_name + " " + user.last_name;
    document.querySelector("#modal_delete_account_overlay").classList.add("open");
    document.querySelector("#modal_delete_account_btn_confirm").onclick = () => {
        document.querySelector("#modal_delete_account_overlay").classList.remove("open");
        deleteAccount(user.user_id, type);
    };

    document.querySelector("#modal_delete_account_btn_close").onclick = () => {
        document.querySelector("#modal_delete_account_overlay").classList.remove("open");
    };
}

// Sends a DELETE request for the given user ID, then refreshes the relevant list.
async function deleteAccount(userId, type) {
    const endpoint = type === "staff"
        ? "/api/admin/staff/"+ userId
        : "/api/admin/customers/"+ userId;

    const req = await fetch(endpoint, { method: "DELETE" });

    if (req.ok) {
        if (type === "staff") {
            const res = await fetch("/api/admin/staff");
            if (res.ok) {
                renderStaff((await res.json()).data);
            } else {
                loadCustomers();
            }
        }
    }
}


//  Reports
// Holds the last fetched payments so the CSV export can access them without re-fetching.
let currentReportPayments = [];
let currentReportFilter = "all";

// Fetches payment data from the server for the given filter, then renders the summary
// cards and payments table. Also wires up the filter tabs and CSV export button.
async function loadReports(filter) {
    currentReportFilter = filter;

    const req = await fetch("/api/admin/reports?filter="+ filter);
    if (!req.ok) {
        return;
    }
    const res = await req.json();

    const { total_revenue, booking_revenue, membership_revenue, payments } = res.data;
    currentReportPayments = payments;

    // Update the revenue summary cards (convert pence to £)
    document.querySelector("#report_total").textContent = "£" + (total_revenue / 100).toFixed(2);
    document.querySelector("#report_bookings").textContent = "£" + (booking_revenue/ 100).toFixed(2);
    document.querySelector("#report_memberships").textContent = "£" + (membership_revenue/ 100).toFixed(2);
    document.querySelector("#report_count").textContent = payments.length;

    renderReports(payments);

    // Wire filter tabs — each one re-fetches with its filter
    document.querySelector("#report_tab_all").addEventListener("click", () => {
        setReportTabActive("all");
        loadReports("all");
    });
    document.querySelector("#report_tab_bookings").addEventListener("click", () => {
        setReportTabActive("bookings");
        loadReports("bookings");
    });
    document.querySelector("#report_tab_memberships").addEventListener("click", () => {
        setReportTabActive("memberships");
        loadReports("memberships");
    });

    // CSV export button — generates a download from the currently displayed data
    document.querySelector("#btn_export_csv").addEventListener("click", () => {
        exportCSV(currentReportPayments, currentReportFilter);
    });

    setReportTabActive(filter);
}

// Highlights the active filter tab
function setReportTabActive(filter) {
    document.querySelector("#report_tab_all").classList.toggle("active", filter === "all");
    document.querySelector("#report_tab_bookings").classList.toggle("active", filter === "bookings");
    document.querySelector("#report_tab_memberships").classList.toggle("active", filter === "memberships");
}

// Builds one table row per payment in the reports table.
function renderReports(payments) {
    const tbody = document.querySelector("#reports_body");
    tbody.innerHTML = "";

    if (payments.length === 0) {
        tbody.innerHTML = "<tr><td colspan='5' style='color:#888;'>No payments found.</td></tr>";
        return;
    }

    for (let p of payments) {
        const badgeClass = p.type === "booking" ? "type-booking" : "type-membership";
        const typeLabel = p.type === "booking"  ? "Booking" : "Membership";
        const amount = "£" + (p.amount_pence / 100).toFixed(2);

        const row = document.createElement("tr");
        row.innerHTML =
            "<td>" + p.paid_at + "</td>" +
            "<td>" + p.first_name + " " + p.last_name + "</td>" +
            "<td><span class='type-badge " + badgeClass + "'>" + typeLabel + "</span></td>" +
            "<td>" + p.description + "</td>" +
            "<td>" + amount + "</td>";
        tbody.appendChild(row);
    }
}

// Converts the payments array to a CSV file and triggers a browser download.
function exportCSV(payments, filter) {
    const headers = ["Date", "Customer", "Type", "Description", "Amount (£)"];
    const rows = payments.map(p => [
        p.paid_at,
        p.first_name + " " + p.last_name,
        p.type === "booking" ? "Booking" : "Membership",
        p.description,
        (p.amount_pence / 100).toFixed(2)
    ]);

    // Build CSV content — wrap each field in quotes to handle commas in names
    const csvContent = [headers, ...rows]
        .map(row => row.map(field => '"' + String(field).replace(/"/g, '""') + '"').join(","))
        .join("\n");

    // Create a temporary link element to trigger the download
    const blob  = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const filename = "hop-payments-" + filter + "-" + new Date().toISOString().split("T")[0] + ".csv";

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

//  Helpers
// Returns the Monday and Sunday (as Date objects) for the week that is
// `offset` weeks away from the current week. offset 0 = this week,
// offset -1 = last week, offset +1 = next week, and so on.
function getAdminWeekRange(offset) {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday, 1 = Monday, …, 6 = Saturday

    // Calculate how many days to subtract to land on Monday
    const diffToMonday = (day === 0) ? -6 : 1 - day;

    const start = new Date(now);
    start.setDate(now.getDate() + diffToMonday + offset * 7);
    start.setHours(0, 0, 0, 0);

    // Sunday is 6 days after Monday
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    
    return { start, end };
}
