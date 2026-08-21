let allAdminSessions = []; // all sessions are fetched from the server and displayed on timetable
let editingSessionId = null; // tracks whether the session modal is in "add" or "edit" mode
let scanner = null; // holds the Html5QrcodeScanner instance so we can stop it when switching views
let adminWeekOffset = 0; // how many weeks forward or back from the current week we're viewing

function esc(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}


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
document.querySelector("#nav_pricing").addEventListener("click", () => showView("pricing"));

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
    } else if (viewName === "pricing") {
        loadPricing();
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

async function onScanSuccess(decodedText) {
    try {
        await scanner.clear();
    } catch (_) {}
    scanner = null;

    const resultDiv = document.querySelector("#scan_result");

    let result;
    try {
        const resp = await fetch("/api/admin/verify-membership", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decodedText })
        });
        result = await resp.json();
    } catch (err) {
        result = { status: "invalid", message: "❌ Network error: " + err.message };
    }

    let cardClass;
    if (result.status === "valid") {
        cardClass = "scan-ok";
    } else if (result.status === "expired") {
        cardClass = "scan-warn";
    } else {
        cardClass = "scan-fail";
    }

    let html = "<p>" + (result.message || "Unknown result") + "</p>";
    if (result.name) {
        html += "<div class='scan-member-name'>" + result.name + "</div>";
        html += "<div class='scan-member-detail'>" + result.type + (result.awards ? " &middot; Boxing Awards ✓" : "") + "</div>";
        if (result.start_date) {
            html += "<div class='scan-member-detail'>" + result.start_date + " &mdash; " + result.end_date + "</div>";
        } else {
            html += "<div class='scan-member-detail'>" + (result.status === "valid" ? "Valid until " : "Expired ") + result.end_date + "</div>";
        }
    }
    if (result.status !== "valid") {
        html += "<div class='scan-member-detail' style='margin-top:8px;font-size:0.75rem;opacity:0.6;'>Scanned: " + decodedText + "</div>";
    }
    html += "<button id='btn_scan_again' class='btn-secondary' style='margin-top:16px;'>Scan Another</button>";

    const card = document.createElement("div");
    card.className = "scan-result-card " + cardClass;
    card.innerHTML = html;
    resultDiv.innerHTML = "";
    resultDiv.appendChild(card);

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

// Builds a 7-column weekly calendar grid. Each day column contains admin session
// cards with inline QR / Edit / Delete actions — no scrolling through a long list.
function renderTimetable() {
    const { start, end } = getAdminWeekRange(adminWeekOffset);

    const startLabel = start.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const endLabel   = end.toLocaleDateString(  "en-GB", { day: "numeric", month: "short", year: "numeric" });
    document.querySelector("#week_label").textContent = startLabel + " – " + endLabel;

    const grid     = document.querySelector("#calendar_grid");
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const todayStr = (() => {
        const t = new Date();
        return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
    })();

    grid.innerHTML = "";

    for (let d = 0; d < 7; d++) {
        const dayDate = new Date(start);
        dayDate.setDate(start.getDate() + d);
        const dayStr =
            dayDate.getFullYear() + "-" +
            String(dayDate.getMonth() + 1).padStart(2, "0") + "-" +
            String(dayDate.getDate()).padStart(2, "0");

        const daySessions = allAdminSessions
            .filter(s => s.start_date === dayStr)
            .sort((a, b) => a.start_time.localeCompare(b.start_time));

        const col = document.createElement("div");
        col.className = "cal-col";

        const isToday = dayStr === todayStr;
        col.innerHTML =
            "<div class='cal-header'>" +
                "<span class='cal-day-name'>" + dayNames[d] + "</span>" +
                "<span class='cal-day-date" + (isToday ? " today" : "") + "'>" +
                    dayDate.getDate() + " " + dayDate.toLocaleDateString("en-GB", { month: "short" }) +
                "</span>" +
            "</div>" +
            "<div class='cal-sessions'></div>";

        const sessionsContainer = col.querySelector(".cal-sessions");

        if (daySessions.length === 0) {
            const empty = document.createElement("p");
            empty.className = "cal-empty";
            empty.textContent = "—";
            sessionsContainer.appendChild(empty);
        } else {
            for (const session of daySessions) {
                const time = session.start_time.split(":").slice(0, 2).join(":");
                const card = document.createElement("div");
                card.className = "admin-session-card";
                card.innerHTML =
                    "<div class='admin-card-name'>" + session.session_name + "</div>" +
                    "<div class='admin-card-time'>" + time + " &middot; " + session.duration + " hr</div>" +
                    "<div class='admin-card-instructor'>" + session.instructor + "</div>" +
                    "<div class='admin-card-meta'>" +
                        session.capacity + " spaces &middot; " +
                        session.gender_eligibility + " &middot; " +
                        (session.membership_eligibility && session.membership_eligibility !== "Any" ? session.membership_eligibility + " &middot; " : "") +
                        session.min_age + "–" + session.max_age + " yrs &middot; " +
                        (session.price_pence != null ? "£" + (session.price_pence / 100).toFixed(2) : "—") +
                    "</div>" +
                    "<div class='admin-card-actions'>" +
                        "<button class='btn-card-qr'>QR</button>" +
                        "<button class='btn-card-edit'>Edit</button>" +
                        "<button class='btn-card-delete'>Delete</button>" +
                    "</div>";

                card.querySelector(".btn-card-qr").addEventListener(    "click", (e) => { e.stopPropagation(); openSessionQRModal(session); });
                card.querySelector(".btn-card-edit").addEventListener(   "click", (e) => { e.stopPropagation(); openSessionModal(session); });
                card.querySelector(".btn-card-delete").addEventListener( "click", (e) => { e.stopPropagation(); openDeleteModal(session); });
                card.addEventListener("click", () => openAttendanceModal(session));

                sessionsContainer.appendChild(card);
            }
        }

        grid.appendChild(col);
    }
}


// Fetches the session's QR code image from the server and shows it in a modal.
async function openSessionQRModal(session) {
    const modal    = document.querySelector("#session_qr_modal");
    const titleEl  = document.querySelector("#session_qr_title");
    const imgEl    = document.querySelector("#session_qr_image");
    const closeBtn = document.querySelector("#btn_close_session_qr");
    const printBtn = document.querySelector("#btn_print_session_qr");

    titleEl.textContent = session.session_name + " — " + session.start_date;
    imgEl.src = "";
    printBtn.disabled = true;
    modal.style.display = "flex";

    const req = await fetch("/api/admin/sessions/" + session.session_id + "/qr");
    if (req.ok) {
        const res = await req.json();
        imgEl.src = res.qr;
        printBtn.disabled = false;
        printBtn.onclick = () => printSessionQR(session, res.qr);
    }

    closeBtn.onclick = () => { modal.style.display = "none"; };
    modal.onclick    = (e) => { if (e.target === modal) modal.style.display = "none"; };
}

function printSessionQR(session, qrSrc) {
    const win = window.open("", "_blank");
    win.document.write(
        "<!DOCTYPE html><html><head><title>Session QR — " + session.session_name + "</title>" +
        "<style>body{font-family:sans-serif;text-align:center;padding:40px;} h2{margin-bottom:4px;} p{color:#555;margin:4px 0 20px;} img{display:block;margin:0 auto;width:260px;height:260px;} @media print{button{display:none;}}</style></head><body>" +
        "<h2>" + session.session_name + "</h2>" +
        "<p>" + session.start_date + " &nbsp;·&nbsp; " + session.start_time.split(":").slice(0,2).join(":") + " &nbsp;·&nbsp; " + session.duration + " hr</p>" +
        "<img src='" + qrSrc + "' alt='QR Code'>" +
        "<p style='font-size:0.8rem;color:#999;margin-top:16px;'>Members scan to check in</p>" +
        "<button onclick='window.print()' style='margin-top:20px;padding:10px 24px;font-size:1rem;cursor:pointer;'>Print</button>" +
        "</body></html>"
    );
    win.document.close();
}

async function openAttendanceModal(session) {
    const overlay = document.querySelector("#modal_attendance_overlay");
    document.querySelector("#att_session_name").textContent = session.session_name;
    document.querySelector("#att_session_meta").textContent =
        session.start_date + "  ·  " + session.start_time.slice(0, 5) + "  ·  " + session.duration + " hr  ·  " + session.instructor;
    document.querySelector("#att_summary").innerHTML = "";
    document.querySelector("#att_list").innerHTML = "<p style='color:var(--muted);font-size:0.85rem;padding:8px 0;'>Loading...</p>";

    overlay.classList.add("open");
    document.querySelector("#att_btn_close").onclick = () => overlay.classList.remove("open");

    try {
        const req = await fetch("/api/admin/sessions/" + session.session_id + "/attendees");
        if (!req.ok) {
            document.querySelector("#att_list").innerHTML = "<p style='color:var(--danger);font-size:0.85rem;'>Failed to load attendees.</p>";
            return;
        }
        renderAttendanceModal((await req.json()).data.attendees);
    } catch (_) {
        document.querySelector("#att_list").innerHTML = "<p style='color:var(--danger);font-size:0.85rem;'>Network error.</p>";
    }
}

function renderAttendanceModal(attendees) {
    const statusMeta = {
        early:    { label: "Early",    bg: "#16A34A" },
        on_time:  { label: "On Time",  bg: "#16A34A" },
        late:     { label: "Late",     bg: "#D97706" },
        missed:   { label: "Missed",   bg: "#D40404" },
        upcoming: { label: "Upcoming", bg: "#6B7280" },
    };

    const badge = status => {
        const m = statusMeta[status] || { label: status, bg: "#6B7280" };
        return `<span style="display:inline-block;padding:2px 9px;background:${m.bg};color:#fff;font-size:0.7rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">${m.label}</span>`;
    };

    const total    = attendees.length;
    const attended = attendees.filter(a => ["early","on_time","late"].includes(a.status)).length;
    const missed   = attendees.filter(a => a.status === "missed").length;

    const chip = (label, val, color) =>
        `<div style="padding:8px 16px;background:${color}18;border:1px solid ${color}40;min-width:80px;">` +
            `<div style="font-size:1.3rem;font-weight:800;color:${color};">${val}</div>` +
            `<div style="font-size:0.72rem;font-weight:600;color:var(--muted);margin-top:1px;">${label}</div>` +
        `</div>`;

    document.querySelector("#att_summary").innerHTML =
        chip("Booked",   total,    "#0F71F0") +
        chip("Attended", attended, "#16A34A") +
        chip("Missed",   missed,   "#D40404");

    if (total === 0) {
        document.querySelector("#att_list").innerHTML =
            "<p style='color:var(--muted);font-size:0.85rem;padding:12px 0;'>No bookings for this session yet.</p>";
        return;
    }

    const fmtTime = dt => {
        if (!dt) return "—";
        const t = dt.split(" ")[1];
        return t ? t.slice(0, 5) : "—";
    };

    document.querySelector("#att_list").innerHTML =
        `<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
            <thead>
                <tr style="border-bottom:2px solid var(--border);">
                    <th style="text-align:left;padding:8px 10px;font-size:0.7rem;color:var(--muted);font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Name</th>
                    <th style="text-align:left;padding:8px 10px;font-size:0.7rem;color:var(--muted);font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Contact</th>
                    <th style="text-align:center;padding:8px 10px;font-size:0.7rem;color:var(--muted);font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Status</th>
                    <th style="text-align:center;padding:8px 10px;font-size:0.7rem;color:var(--muted);font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Check-in</th>
                </tr>
            </thead>
            <tbody>
                ${attendees.map(a =>
                    `<tr style="border-bottom:1px solid var(--border);">
                        <td style="padding:10px 10px;">${esc(a.first_name)} ${esc(a.last_name)}</td>
                        <td style="padding:10px 10px;color:var(--muted);font-size:0.8rem;line-height:1.5;">${esc(a.email)}<br>${esc(a.phone || "")}</td>
                        <td style="padding:10px;text-align:center;">${badge(a.status)}</td>
                        <td style="padding:10px;text-align:center;color:var(--muted);">${fmtTime(a.checkin_datetime)}</td>
                    </tr>`
                ).join("")}
            </tbody>
        </table>`;
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
        document.querySelector("#form_membership").value = session.membership_eligibility || "Any";
        document.querySelector("#form_min_age").value = session.min_age;
        document.querySelector("#form_max_age").value = session.max_age;
        document.querySelector("#form_session_type").value = session.session_type || "standard";
        document.querySelector("#form_description").value = session.description || "";
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
        document.querySelector("#form_membership").value = "Any";
        document.querySelector("#form_min_age").value = "";
        document.querySelector("#form_max_age").value = "";
        document.querySelector("#form_session_type").value = "standard";
        document.querySelector("#form_description").value = "";
    }

    document.querySelector("#modal_session_overlay").classList.add("open");

    document.querySelector("#modal_session_btn_save").onclick  = () => saveSession();
    document.querySelector("#modal_session_btn_close").onclick = () => {
        document.querySelector("#modal_session_overlay").classList.remove("open");
    };
}

function setAgePreset(min, max) {
    document.querySelector("#form_min_age").value = min;
    document.querySelector("#form_max_age").value = max;
}

// Auto-fill age range when session type changes to minnow
document.querySelector("#form_session_type").addEventListener("change", () => {
    if (document.querySelector("#form_session_type").value === "minnow") {
        setAgePreset(4, 9);
    }
});

// Reads the session form, then sends either a POST (new) or PUT (edit) to the server.
// Closes the modal on success or shows an error message on failure.
async function saveSession() {
    const minAgeStr = document.querySelector("#form_min_age").value.trim();
    const maxAgeStr = document.querySelector("#form_max_age").value.trim();
    if (!maxAgeStr) {
        document.querySelector("#form_error_msg").textContent = "Please set the age range using the preset buttons above, or enter values manually.";
        return;
    }
    const min_age = Number(minAgeStr);
    const max_age = Number(maxAgeStr);
    if (max_age <= 0) {
        document.querySelector("#form_error_msg").textContent = "Max age must be greater than 0. Use the preset buttons to set the age group.";
        return;
    }
    if (min_age > max_age) {
        document.querySelector("#form_error_msg").textContent = "Min age cannot be greater than max age.";
        return;
    }

    const payload = {
        session_name: document.querySelector("#form_session_name").value,
        start_date: document.querySelector("#form_start_date").value,
        start_time: document.querySelector("#form_start_time").value,
        duration: Number(document.querySelector("#form_duration").value),
        instructor: document.querySelector("#form_instructor").value,
        capacity: Number(document.querySelector("#form_capacity").value),
        gender_eligibility: document.querySelector("#form_gender").value,
        membership_eligibility: document.querySelector("#form_membership").value,
        min_age,
        max_age,
        session_type: document.querySelector("#form_session_type").value,
        description: document.querySelector("#form_description").value
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
        if (!editingSessionId) {
            offerRecurringSession(payload);
        }
    } else {
        // Show the server's validation message inside the modal
        const fail = await req.json();
        document.querySelector("#form_error_msg").textContent = fail.message;
    }
}

function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d + days);
    const pad = n => String(n).padStart(2, "0");
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

function showRecurringConfirm(nextDate) {
    return new Promise(resolve => {
        const overlay = document.querySelector("#modal_recurring_overlay");
        document.querySelector("#modal_recurring_date").textContent = nextDate;
        overlay.classList.add("open");

        document.querySelector("#btn_recurring_yes").onclick = () => {
            overlay.classList.remove("open");
            resolve(true);
        };
        document.querySelector("#btn_recurring_no").onclick = () => {
            overlay.classList.remove("open");
            resolve(false);
        };
        overlay.onclick = e => {
            if (e.target === overlay) { overlay.classList.remove("open"); resolve(false); }
        };
    });
}

async function offerRecurringSession(lastPayload) {
    const nextDate  = addDays(lastPayload.start_date, 7);
    const confirmed = await showRecurringConfirm(nextDate);
    if (!confirmed) return;

    const nextPayload = { ...lastPayload, start_date: nextDate };
    const req = await fetch("/api/admin/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextPayload)
    });

    if (req.ok) {
        refreshTimetable();
        await offerRecurringSession(nextPayload);
    } else {
        const fail = await req.json();
        alert("Could not create next session: " + (fail.message || "Unknown error"));
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
    } else {
        const fail = await req.json();
        alert(fail.message || "Delete failed. Please try again.");
    }
}


//  Manage Customers:
// Fetches all non-admin users from the server and renders them in the customers table.
let customerSearchTimer = null;

async function loadCustomers(q = "") {
    const url = q ? "/api/admin/customers?q=" + encodeURIComponent(q) : "/api/admin/customers";
    const req = await fetch(url);
    if (!req.ok) return;
    const res = await req.json();
    renderCustomers(res.data);

    // Wire search input (once — guard with data attribute)
    const searchEl = document.querySelector("#customer_search");
    if (searchEl && !searchEl.dataset.wired) {
        searchEl.dataset.wired = "1";
        searchEl.addEventListener("input", () => {
            clearTimeout(customerSearchTimer);
            customerSearchTimer = setTimeout(() => loadCustomers(searchEl.value.trim()), 300);
        });
    }

    // Wire create customer button
    const createBtn = document.querySelector("#btn_create_customer");
    if (createBtn && !createBtn.dataset.wired) {
        createBtn.dataset.wired = "1";
        createBtn.addEventListener("click", openCreateCustomerModal);
    }
}

function renderCustomers(customers) {
    const tbody = document.querySelector("#customers_body");
    tbody.innerHTML = "";

    if (customers.length === 0) {
        tbody.innerHTML = "<tr><td colspan='5'>No customers found.</td></tr>";
        return;
    }

    for (let customer of customers) {
        const row = document.createElement("tr");
        row.innerHTML =
            "<td>" + esc(customer.user_id) + "</td>" +
            "<td>" + esc(customer.first_name) + " " + esc(customer.last_name) + "</td>" +
            "<td>" + esc(customer.email) + "</td>" +
            "<td>" + esc(customer.phone || "—") + "</td>" +
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

function openCreateCustomerModal() {
    ["cc_first_name","cc_last_name","cc_email","cc_phone","cc_dob","cc_password"].forEach(id => {
        const el = document.querySelector("#" + id);
        if (el) el.value = "";
    });
    const genderEl = document.querySelector("#cc_gender");
    if (genderEl) genderEl.value = "";
    const errEl = document.querySelector("#cc_error_msg");
    if (errEl) errEl.textContent = "";

    const overlay = document.querySelector("#modal_create_customer_overlay");
    overlay.classList.add("open");

    const closeBtn = document.querySelector("#btn_close_create_customer");
    closeBtn.onclick = () => overlay.classList.remove("open");
    overlay.onclick = e => { if (e.target === overlay) overlay.classList.remove("open"); };

    const submitBtn = document.querySelector("#btn_cc_submit");
    submitBtn.onclick = null;
    submitBtn.onclick = async () => {
        errEl.textContent = "";
        const payload = {
            first_name: document.querySelector("#cc_first_name").value.trim(),
            last_name:  document.querySelector("#cc_last_name").value.trim(),
            email:      document.querySelector("#cc_email").value.trim(),
            phone:      document.querySelector("#cc_phone").value.trim(),
            date_of_birth: document.querySelector("#cc_dob").value,
            gender:     document.querySelector("#cc_gender").value,
            password:   document.querySelector("#cc_password").value
        };

        if (!payload.first_name || !payload.last_name || !payload.email || !payload.phone || !payload.dob || !payload.gender || !payload.password) {
            errEl.textContent = "Please fill in all fields.";
            return;
        }

        submitBtn.disabled    = true;
        submitBtn.textContent = "Creating...";

        const req = await fetch("/api/admin/customers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        submitBtn.disabled    = false;
        submitBtn.textContent = "Create Account";

        if (req.ok) {
            overlay.classList.remove("open");
            loadCustomers();
        } else {
            const fail = await req.json();
            errEl.textContent = fail.message || "Failed to create account.";
        }
    };
}

// Fetches the full profile for one customer (account info, membership, bookings)
// and replaces the main content area with a profile view instead of using a template.
async function openCustomerProfile(customerId) {
    const req = await fetch("/api/admin/customers/" + customerId);
    if (!req.ok) return;
    const res = await req.json();
    const { user, membership, bookings } = res.data;

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
        "<div class='profile-row'><span class='profile-label'>User ID</span><span>" + esc(user.user_id) + "</span></div>" +
        "<div class='profile-row'><span class='profile-label'>Email</span><span>" + esc(user.email) + "</span></div>" +
        "<div class='profile-row'><span class='profile-label'>Phone</span><span>" + esc(user.phone) + "</span></div>" +
        "<div class='profile-row'><span class='profile-label'>Date of Birth</span><span>" + esc(user.date_of_birth) + "</span></div>" +
        "<div class='profile-row'><span class='profile-label'>Gender</span><span>" + esc(user.gender) + "</span></div>" +
        "<div class='profile-row' style='align-items:flex-start;'><span class='profile-label' style='padding-top:2px;'>Medical / Allergy Info</span><span style='white-space:pre-wrap;'>" + (user.medical_info ? esc(user.medical_info) : "<em style='color:var(--muted);font-style:italic;'>None on record</em>") + "</span></div>";
    section.appendChild(accountCard);

    // Membership card — shows status badge and dates if the customer has a membership
    const memCard = document.createElement("div");
    memCard.className = "profile-card";
    if (membership) {
        const isActive = membership.status === "active";
        const badgeClass = isActive ? "mem-status-active" : "mem-status-inactive";
        const badgeText  = isActive ? "Active" : "Expired";
        const gymTypeLabels = { carded: "Carded", non_carded: "Non-Carded", minnow_carded: "Minnows (Carded)", minnow_non_carded: "Minnows (Non-Carded)" };
        const typeLabel  = gymTypeLabels[membership.membership_type] || membership.membership_type;
        const awardsRow = ["carded", "non_carded"].includes(membership.membership_type)
            ? "<div class='profile-row'><span class='profile-label'>Boxing Awards</span><span>" + (membership.has_boxing_awards ? "Yes" : "No") + "</span></div>"
            : "";
        memCard.innerHTML =
            "<h3>Membership</h3>" +
            "<span class='mem-status-badge " + badgeClass + "'>" + badgeText + "</span>" +
            "<div class='profile-row'><span class='profile-label'>Membership ID</span><span>" + membership.membership_id + "</span></div>" +
            "<div class='profile-row'><span class='profile-label'>Type</span><span>" + typeLabel + "</span></div>" +
            awardsRow +
            "<div class='profile-row'><span class='profile-label'>Start Date</span><span>" + membership.start_date + "</span></div>" +
            "<div class='profile-row'><span class='profile-label'>End Date</span><span>" + membership.end_date + "</span></div>";
    } else {
        memCard.innerHTML = "<h3>Membership</h3><p style='color:#888;margin-top:8px;'>No membership on record.</p>";
    }
    section.appendChild(memCard);

    // Booking history section heading
    const bookingHeading = document.createElement("h3");
    bookingHeading.textContent = "Booking & Attendance History";
    bookingHeading.style.marginBottom = "12px";
    section.appendChild(bookingHeading);

    // Container div where booking cards will be rendered
    const bookingList = document.createElement("div");
    bookingList.id = "profile_bookings_list";
    section.appendChild(bookingList);

    main.appendChild(section);

    renderProfileBookings(bookings);
}

function renderProfileBookings(bookings) {
    const list = document.querySelector("#profile_bookings_list");
    list.innerHTML = "";

    if (bookings.length === 0) {
        list.innerHTML = "<p style='color:#888;'>No bookings on record.</p>";
        return;
    }

    for (let booking of bookings) {
        const time = booking.start_time ? booking.start_time.split(":").slice(0, 2).join(":") : "--";
        const dateStr = booking.start_date ? booking.start_date + " at " + time : "Session deleted";
        const checkedIn = booking.checkin_datetime ? " · Checked in " + booking.checkin_datetime.split(" ")[0] : "";

        const card = document.createElement("div");
        card.className = "booking-card";
        card.innerHTML =
            "<div>" +
                "<strong>" + (booking.session_name || "Deleted Session") + "</strong><br>" +
                "<small style='color:#666;'>" + dateStr + checkedIn + "</small>" +
            "</div>";

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
    const dob = year && month && day ? year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0") : "";

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
    const dob = year && month && day ? year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0") : "";

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
            if (res.ok) renderStaff((await res.json()).data);
        } else {
            loadCustomers();
        }
    } else {
        const fail = await req.json();
        alert(fail.message || "Delete failed. Please try again.");
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

    const { total_revenue, booking_revenue, membership_revenue, ticket_revenue, payments } = res.data;
    currentReportPayments = payments;

    // Update the revenue summary cards (convert pence to £)
    document.querySelector("#report_total").textContent        = "£" + (total_revenue      / 100).toFixed(2);
    document.querySelector("#report_bookings").textContent     = "£" + (booking_revenue    / 100).toFixed(2);
    document.querySelector("#report_memberships").textContent  = "£" + (membership_revenue / 100).toFixed(2);
    document.querySelector("#report_tickets").textContent      = "£" + ((ticket_revenue || 0) / 100).toFixed(2);
    document.querySelector("#report_count").textContent        = payments.length;

    renderReports(payments);

    // Use onclick so re-entering this function replaces the handler rather than stacking listeners
    document.querySelector("#report_tab_all").onclick = () => {
        setReportTabActive("all");
        loadReports("all");
    };
    document.querySelector("#report_tab_bookings").onclick = () => {
        setReportTabActive("bookings");
        loadReports("bookings");
    };
    document.querySelector("#report_tab_memberships").onclick = () => {
        setReportTabActive("memberships");
        loadReports("memberships");
    };
    document.querySelector("#report_tab_tickets").onclick = () => {
        setReportTabActive("tickets");
        loadReports("tickets");
    };

    document.querySelector("#btn_export_csv").onclick = () => {
        exportCSV(currentReportPayments, currentReportFilter);
    };

    setReportTabActive(filter);
}

// Highlights the active filter tab
function setReportTabActive(filter) {
    document.querySelector("#report_tab_all").classList.toggle("active", filter === "all");
    document.querySelector("#report_tab_bookings").classList.toggle("active", filter === "bookings");
    document.querySelector("#report_tab_memberships").classList.toggle("active", filter === "memberships");
    document.querySelector("#report_tab_tickets").classList.toggle("active", filter === "tickets");
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
        const badgeClass = p.type === "booking" ? "type-booking" : p.type === "ticket" ? "type-ticket" : "type-membership";
        const typeLabel  = p.type === "booking" ? "Booking"      : p.type === "ticket" ? "Ticket"      : "Membership";
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
        p.type === "booking" ? "Booking" : p.type === "ticket" ? "Ticket" : "Membership",
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


// ── Pricing ───────────────────────────────────────────────────────────────────

async function loadPricing() {
    const req = await fetch("/api/pricing");
    if (!req.ok) return;
    const res  = await req.json();
    const rows = res.data;

    for (const row of rows) {
        const input = document.querySelector("#price_" + row.price_key);
        if (input) input.value = (row.value_pence / 100).toFixed(2);
    }

    document.querySelector("#btn_save_pricing").onclick = () => savePricing(rows.map(r => r.price_key));
}

async function savePricing(keys) {
    const payload = {};
    for (const key of keys) {
        const input = document.querySelector("#price_" + key);
        if (input) payload[key] = input.value;
    }

    const btn = document.querySelector("#btn_save_pricing");
    const msg = document.querySelector("#pricing_msg");
    btn.disabled    = true;
    btn.textContent = "Saving...";
    msg.textContent = "";
    msg.style.color = "";

    const req = await fetch("/api/admin/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const res = await req.json();
    msg.textContent = res.message;
    msg.style.color = req.ok ? "var(--success)" : "var(--danger)";
    btn.disabled    = false;
    btn.textContent = "Save Prices";
}
