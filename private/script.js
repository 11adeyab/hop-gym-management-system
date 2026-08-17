//variables that track what the user is currently viewing
let allSessions    = [];
let allBookings    = [];
let weekOffset     = 0;
let activeFilter   = "upcoming";
let checkinScanner = null;

// Prefetched at page load — used to determine pass coverage in the booking modal
let pageGymData  = null;
let pagePassData = null;
let pageUserDob  = null;


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

// Load user name into sidebar and prefetch gym/pass data for booking modal awareness
(async () => {
    const [userReq, gymReq, passReq] = await Promise.all([
        fetch("/api/user"),
        fetch("/api/gym-membership"),
        fetch("/api/membership")
    ]);
    if (userReq.ok) {
        const res = await userReq.json();
        const u   = res.data;
        document.querySelector("#sidebar_user_name").textContent = u.first_name + " " + u.last_name;
        pageUserDob = u.dob || null;
    }
    if (gymReq.ok)  { const r = await gymReq.json();  pageGymData  = r.data || null; }
    if (passReq.ok) { const r = await passReq.json();  pagePassData = (r.data && r.data.membership_type) ? r.data : null; }
})();

document.querySelector("#nav_overview").addEventListener("click",        () => showView("overview"));
document.querySelector("#nav_book_sessions").addEventListener("click",    () => showView("book_sessions"));
document.querySelector("#nav_my_bookings").addEventListener("click",      () => showView("my_bookings"));
document.querySelector("#nav_gym_membership").addEventListener("click",   () => showView("gym_membership"));
document.querySelector("#nav_session_passes").addEventListener("click",   () => showView("session_passes"));
document.querySelector("#nav_shop").addEventListener("click",             () => showView("shop"));
document.querySelector("#nav_checkin").addEventListener("click",          () => showView("checkin"));

showView("overview");


async function showView(viewName) {
    // Stop the check-in scanner if it's running before leaving the view
    if (checkinScanner !== null) {
        try { await checkinScanner.clear(); } catch (_) {}
        checkinScanner = null;
    }

    for (let i of document.querySelectorAll("nav a")) {
        i.classList.remove("active");
    }
    document.querySelector("#nav_" + viewName).classList.add("active");

    const template = document.querySelector("#template_" + viewName);
    const content  = template.content.cloneNode(true);

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
    else if (viewName === "gym_membership") {
        loadGymMembership();
    }
    else if (viewName === "session_passes") {
        loadSessionPasses();
    }
    else if (viewName === "shop") {
        loadShop();
    }
    else if (viewName === "checkin") {
        loadCheckin();
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

    const [userReq, bookingsReq, membershipReq, gymReq] = await Promise.all([
        fetch("/api/user"),
        fetch("/api/bookings"),
        fetch("/api/membership"),
        fetch("/api/gym-membership")
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

    // Gym membership status for the overview stat
    let membershipLabel = "None";
    if (gymReq.ok) {
        const d = await gymReq.json();
        if (d.data) {
            const labels = { non_carded: "Non-Carded", carded: "Carded" };
            membershipLabel = labels[d.data.membership_type] || "Active";
        }
    }
    // Show session pass alongside if active
    if (membershipReq.ok) {
        const d = await membershipReq.json();
        if (d.data) {
            const passLabels = { day: "Day Ticket", weekly: "Weekly Ticket", monthly: "Monthly Ticket" };
            const passLabel  = passLabels[d.data.membership_type] || "Pass";
            membershipLabel  = membershipLabel === "None" ? passLabel : membershipLabel + " + " + passLabel;
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

    document.querySelector("#week_label").textContent = formatDate(week.start) + " - " + formatDate(week.end);

    const grid = document.querySelector("#calendar_grid");
    grid.innerHTML = "";

    const now = new Date();
    const todayStr =
        now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0");

    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    for (let d = 0; d < 7; d++) {
        const dayDate = new Date(week.start);
        dayDate.setDate(week.start.getDate() + d);

        const dayStr =
            dayDate.getFullYear() + "-" +
            String(dayDate.getMonth() + 1).padStart(2, "0") + "-" +
            String(dayDate.getDate()).padStart(2, "0");

        const daySessions = allSessions.filter(s => s.start_date === dayStr);

        const col = document.createElement("div");
        col.className = "cal-col" + (dayStr === todayStr ? " cal-col-today" : "");

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
                const cardPrice = session.price_pence != null ? "£" + (session.price_pence / 100).toFixed(2) : "";
                const memElig = session.membership_eligibility || "Any";
                const memBadge = memElig !== "Any"
                    ? "<div class='session-card-badge'>" + memElig + "</div>"
                    : "";
                card.innerHTML =
                    "<div class='session-card-name'>" + session.session_name + "</div>" +
                    "<div class='session-card-time'>" + session.start_time.split(":").slice(0, 2).join(":") + "</div>" +
                    "<div class='session-card-spaces'>" + session.capacity + " spaces" + (cardPrice ? " &middot; " + cardPrice : "") + "</div>" +
                    memBadge;
                card.addEventListener("click", () => openModal(session));
                sessionsContainer.appendChild(card);
            }
        }

        grid.appendChild(col);
    }
}

function isCoveredByMonthlyPass(session) {
    return !!(
        session.membership_eligibility === "Carded" &&
        pageGymData && pageGymData.membership_type === "carded" &&
        pageUserDob && calcAge(pageUserDob) >= 17 &&
        pagePassData && pagePassData.membership_type === "monthly"
    );
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
    const memEligLabel = session.membership_eligibility || "Any";
    document.querySelector("#modal_membership").textContent =
        memEligLabel === "Any" ? "Any" :
        memEligLabel === "Carded" ? "Carded Boxers only" : "Non-Carded only";
    document.querySelector("#modal_age").textContent = session.min_age + " to " + session.max_age + " years";

    const descRow = document.querySelector("#modal_description_row");
    const descEl  = document.querySelector("#modal_description");
    if (session.description && session.description.trim()) {
        descEl.textContent = session.description.trim();
        descRow.style.display = "";
    } else {
        descRow.style.display = "none";
    }

    const covered    = isCoveredByMonthlyPass(session);
    const priceLabel = covered ? "Covered by monthly pass" :
        (session.price_pence != null ? "£" + (session.price_pence / 100).toFixed(2) : "—");
    document.querySelector("#modal_price_display").textContent = priceLabel;
    document.querySelector("#modal_btn_book").textContent = "Book — " + priceLabel;

    document.querySelector("#modal_overlay").classList.add("open");

    document.querySelector("#modal_btn_book").onclick = () => bookSession(session);
    document.querySelector("#modal_btn_close").onclick = () => {
        document.querySelector("#modal_overlay").classList.remove("open");
    };
}
async function bookSession(session) {
    document.querySelector("#error_msg").textContent = "";
    const covered    = isCoveredByMonthlyPass(session);
    const priceLabel = covered ? "Covered by monthly pass" :
        (session.price_pence != null ? "£" + (session.price_pence / 100).toFixed(2) : "—");
    document.querySelector("#modal_btn_book").textContent = covered ? "Booking..." : "Redirecting to payment...";
    document.querySelector("#modal_btn_book").disabled = true;

    try {
        const req = await fetch("/api/bookings/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(session)
        });

        if (req.ok) {
            const data = await req.json();
            if (data.free) {
                // Booking confirmed via monthly pass — close the modal and refresh the timetable in place
                document.querySelector("#modal_overlay").classList.remove("open");
                const refreshReq = await fetch("/api/sessions");
                if (refreshReq.ok) {
                    const refreshData = await refreshReq.json();
                    allSessions = refreshData.data;
                    renderTimetable();
                }
                return;
            }
            window.location.href = data.url;
        } else {
            const fail = await req.json();
            document.querySelector("#error_msg").textContent = fail.message;
            document.querySelector("#modal_btn_book").textContent = "Book — " + priceLabel;
            document.querySelector("#modal_btn_book").disabled = false;
        }
    } catch (_) {
        document.querySelector("#error_msg").textContent = "Network error — please try again.";
        document.querySelector("#modal_btn_book").textContent = "Book — " + priceLabel;
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
            } else if (checkinTime < time) {
                attendanceLabel = "<p>Checked in at " + checkinTime + " — <strong>Early</strong></p>";
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
            let buttonsHtml = "<button id='btn_qr_" + booking.booking_id + "' class='btn-ghost btn-sm'>View QR</button>";
            if (activeFilter === "upcoming") {
                buttonsHtml += "<button id='btn_cancel_" + booking.booking_id + "' class='btn-danger btn-sm'>Cancel</button>";
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
    const req = await fetch("/api/bookings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: bookingId })
    });
    if (req.ok) {
        loadMyBookings();
    } else {
        const fail = await req.json();
        const list  = document.querySelector("#bookings_list");
        const err   = document.createElement("p");
        err.style.cssText = "color:var(--danger);font-size:0.85rem;margin-bottom:12px;";
        err.textContent   = fail.message || "Cancellation failed. Please try again.";
        list.prepend(err);
    }
}

async function loadGymMembership() {
    const [gymReq, pricingReq, userReq] = await Promise.all([
        fetch("/api/gym-membership"),
        fetch("/api/pricing"),
        fetch("/api/user")
    ]);

    const prices = {};
    if (pricingReq.ok) {
        const pd = await pricingReq.json();
        for (const row of pd.data) prices[row.price_key] = row.value_pence;
    }

    const gymData  = gymReq.ok  ? (await gymReq.json()).data  : null;
    const userData = userReq.ok ? (await userReq.json()).data : null;

    // Auto-activate free minnow membership on first visit — no action required from the member
    if (!gymData && userData && calcAge(userData.dob) !== null && calcAge(userData.dob) < 10) {
        const resp = await fetch("/api/gym-membership/free", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ membership_type: "minnow_non_carded" })
        });
        if (resp.ok) loadGymMembership();
        else renderGymMembership(null, prices, userData);
        return;
    }

    renderGymMembership(gymData, prices, userData);
}

async function loadSessionPasses() {
    const [passReq, pricingReq, gymReq, userReq] = await Promise.all([
        fetch("/api/membership"),
        fetch("/api/pricing"),
        fetch("/api/gym-membership"),
        fetch("/api/user")
    ]);

    const prices = {};
    if (pricingReq.ok) {
        const pd = await pricingReq.json();
        for (const row of pd.data) prices[row.price_key] = row.value_pence;
    }

    const passData = passReq.ok ? (await passReq.json()).data : null;
    const gymData  = gymReq.ok  ? (await gymReq.json()).data   : null;
    const userData = userReq.ok ? (await userReq.json()).data  : null;
    renderSessionPass(passData, prices, gymData, userData);
}

function renderGymMembership(membership, prices, user) {
    const badge           = document.querySelector("#gym_mem_badge");
    const details         = document.querySelector("#gym_mem_details");
    const purchaseSec     = document.querySelector("#gym_mem_purchase_section");
    const awardsPurchSec  = document.querySelector("#gym_awards_purchase_section");

    const typeLabels = { non_carded: "Non-Carded Membership", carded: "Carded Membership", minnow_non_carded: "Minnows (Non-Carded)", minnow_carded: "Minnows (Carded)" };
    const fmt = p => p ? "£" + (p / 100).toFixed(2) : "—";

    if (membership) {
        badge.textContent   = "Active";
        badge.className     = "mem-status-badge mem-status-active";
        details.style.display    = "block";
        purchaseSec.style.display  = "none";

        document.querySelector("#gym_mem_type").textContent     = typeLabels[membership.membership_type] || membership.membership_type;
        document.querySelector("#gym_mem_end_date").textContent = membership.end_date;
        document.querySelector("#gym_mem_nc_awards_status").textContent = membership.has_boxing_awards  ? "Active" : "Not purchased";
        document.querySelector("#gym_mem_c_awards_status").textContent  = membership.has_contact_awards ? "Active" : "Not purchased";

        document.querySelector("#btn_gym_mem_qr").onclick = () => openGymMemQRModal(membership);

        const isMinnow = ["minnow_carded", "minnow_non_carded"].includes(membership.membership_type);
        const needsNonContact = !isMinnow && !membership.has_boxing_awards;
        const needsContact    = !isMinnow && !membership.has_contact_awards;

        if (!needsNonContact && !needsContact) {
            awardsPurchSec.style.display = "none";
        } else {
            awardsPurchSec.style.display = "block";

            const ncRow = document.querySelector("#gym_awards_nc_row");
            const cRow  = document.querySelector("#gym_awards_c_row");

            if (needsNonContact) {
                ncRow.style.display = "block";
                document.querySelector("#price_awards_nc_display").textContent = fmt(prices.awards_standalone);
                document.querySelector("#btn_buy_awards_nc").onclick = () => purchaseBoxingAwards("non_contact");
            } else {
                ncRow.style.display = "none";
            }

            if (needsContact) {
                cRow.style.display = "block";
                document.querySelector("#price_awards_c_display").textContent = fmt(prices.awards_contact);
                document.querySelector("#btn_buy_awards_c").onclick = () => purchaseBoxingAwards("contact");
            } else {
                cRow.style.display = "none";
            }
        }
    } else {
        badge.textContent = "No Active Membership";
        badge.className   = "mem-status-badge mem-status-inactive";
        details.style.display    = "none";
        awardsPurchSec.style.display = "none";
        purchaseSec.style.display  = "block";

        document.querySelector("#price_non_carded").textContent = fmt(prices.membership_non_carded);
        document.querySelector("#price_carded").textContent     = fmt(prices.membership_carded);

        const awardsAddonPrice = prices.awards_with_membership;
        document.querySelector("#awards_addon_price").textContent = "+" + fmt(awardsAddonPrice);

        document.querySelector("#btn_join_non_carded").onclick = () => purchaseGymMembership("non_carded", prices);
        document.querySelector("#btn_join_carded").onclick     = () => purchaseGymMembership("carded", prices);
    }
}

async function openGymMemQRModal(membership) {
    const typeLabels = { non_carded: "Non-Carded", carded: "Carded", minnow_non_carded: "Minnows (Non-Carded)", minnow_carded: "Minnows (Carded)" };
    document.querySelector("#modal_gym_mem_qr_details").textContent = (typeLabels[membership.membership_type] || membership.membership_type) + "  ·  Valid until " + membership.end_date;
    const img = document.querySelector("#modal_gym_mem_qr_image");
    img.src = "";
    img.alt = "Loading QR code…";
    document.querySelector("#modal_gym_mem_qr_overlay").classList.add("open");
    document.querySelector("#modal_gym_mem_qr_btn_close").onclick = () => {
        document.querySelector("#modal_gym_mem_qr_overlay").classList.remove("open");
    };
    try {
        const resp = await fetch("/api/member/membership-qr");
        if (resp.ok) {
            const data = await resp.json();
            img.src = data.data;
            img.alt = "Gym Membership QR Code";
        } else {
            img.alt = "QR code unavailable";
        }
    } catch (_) {
        img.alt = "QR code unavailable";
    }
}

function calcAge(dob) {
    if (!dob) return null;
    const today = new Date();
    const birth = new Date(dob);
    if (isNaN(birth.getTime())) return null;
    let age = today.getFullYear() - birth.getFullYear();
    if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
    return age;
}

async function purchaseGymMembership(type, prices) {
    document.querySelector("#gym_mem_error_msg").textContent = "";
    const include_awards = document.querySelector("#chk_include_awards").checked;
    const btn = document.querySelector("#btn_join_" + type);
    btn.disabled = true;
    btn.querySelector(".gym-mem-option-label").textContent = "Redirecting...";

    const req = await fetch("/api/gym-membership/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_type: type, include_awards })
    });

    if (req.ok) {
        window.location.href = (await req.json()).url;
    } else {
        const fail = await req.json();
        document.querySelector("#gym_mem_error_msg").textContent = fail.message;
        btn.disabled = false;
        const typeLabels = { non_carded: "Non-Carded Membership", carded: "Carded Membership" };
        btn.querySelector(".gym-mem-option-label").textContent = typeLabels[type] || type;
    }
}


async function purchaseBoxingAwards(award_type) {
    document.querySelector("#gym_awards_error_msg").textContent = "";
    const btnId = award_type === "contact" ? "#btn_buy_awards_c" : "#btn_buy_awards_nc";
    const btn = document.querySelector(btnId);
    const priceSpanId = award_type === "contact" ? "#price_awards_c_display" : "#price_awards_nc_display";
    const priceText = document.querySelector(priceSpanId).textContent;
    btn.disabled = true;
    btn.textContent = "Redirecting to payment...";

    const req = await fetch("/api/boxing-awards/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ award_type })
    });

    if (req.ok) {
        window.location.href = (await req.json()).url;
    } else {
        const fail = await req.json();
        document.querySelector("#gym_awards_error_msg").textContent = fail.message;
        btn.disabled = false;
        const label = award_type === "contact" ? "Purchase Contact Awards (4–6) — " : "Purchase Non-Contact Awards (1–3) — ";
        btn.innerHTML = label + "<span id='" + priceSpanId.slice(1) + "'>" + priceText + "</span>";
    }
}

function renderSessionPass(membership, prices, gymData, userData) {
    const userAge = userData ? calcAge(userData.dob) : null;
    const isCardedSenior = !!(gymData && gymData.membership_type === "carded" && userAge !== null && userAge >= 17);

    const typeLabels = {
        day:     "Day Ticket",
        weekly:  "Weekly Ticket",
        monthly: isCardedSenior ? "Carded Monthly Pass" : "Monthly Ticket"
    };

    if (membership) {
        const badge = document.querySelector("#mem_status_badge");
        badge.textContent = "Active";
        badge.className   = "mem-status-badge mem-status-active";

        document.querySelector("#pass_details").style.display           = "block";
        document.querySelector("#mem_purchase_section").style.display    = "none";
        document.querySelector("#carded_purchase_section").style.display = "none";
        document.querySelector("#mem_type").textContent       = typeLabels[membership.membership_type] || membership.membership_type;
        document.querySelector("#mem_start_date").textContent = membership.start_date;
        document.querySelector("#mem_end_date").textContent   = membership.end_date;

        document.querySelector("#btn_mem_qr").addEventListener("click", () => openPassQRModal(membership));

        document.querySelector("#covered_sessions_section").style.display = "block";
        const tbody = document.querySelector("#covered_sessions_body");
        tbody.innerHTML = "";
        if (membership.covered_sessions.length === 0) {
            tbody.innerHTML = "<tr><td colspan='5'>No sessions scheduled within your pass period.</td></tr>";
        } else {
            for (const session of membership.covered_sessions) {
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
        document.querySelector("#mem_status_badge").textContent           = "No Active Pass";
        document.querySelector("#mem_status_badge").className             = "mem-status-badge mem-status-inactive";
        document.querySelector("#pass_details").style.display             = "none";
        document.querySelector("#covered_sessions_section").style.display = "none";

        const today = new Date();
        const todayStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");

        if (isCardedSenior) {
            // Carded seniors (17+): monthly pass only — hide generic dropdown, show carded-specific UI
            document.querySelector("#mem_purchase_section").style.display    = "none";
            document.querySelector("#carded_purchase_section").style.display = "block";

            const monthlyPrice = prices.pass_monthly ? "£" + (prices.pass_monthly / 100).toFixed(2) : "£40.00";
            document.querySelector("#carded_start_input").min   = todayStr;
            document.querySelector("#carded_start_input").value = todayStr;
            document.querySelector("#btn_purchase_carded_pass").textContent = "Purchase Carded Monthly Pass — " + monthlyPrice;
            document.querySelector("#btn_purchase_carded_pass").addEventListener("click", () => purchaseCardedPass(prices));
        } else {
            // Non-carded members: full day/weekly/monthly dropdown
            document.querySelector("#mem_purchase_section").style.display    = "block";
            document.querySelector("#carded_purchase_section").style.display = "none";

            document.querySelector("#mem_start_input").min   = todayStr;
            document.querySelector("#mem_start_input").value = todayStr;

            const fmt = key => prices[key] ? "£" + (prices[key] / 100).toFixed(2) : "";
            const select = document.querySelector("#mem_type_select");

            for (const opt of select.options) {
                opt.textContent = typeLabels[opt.value] + (fmt("pass_" + opt.value) ? " — " + fmt("pass_" + opt.value) : "");
            }

            const updateBtn = () => {
                const price = fmt("pass_" + select.value);
                document.querySelector("#btn_purchase_membership").textContent = "Purchase" + (price ? " — " + price : "");
            };
            updateBtn();
            select.addEventListener("change", updateBtn);
            document.querySelector("#btn_purchase_membership").addEventListener("click", () => purchaseSessionPass(prices));
        }
    }
}

async function purchaseCardedPass(prices) {
    const start_date = document.querySelector("#carded_start_input").value;
    const monthlyPrice = prices.pass_monthly ? "£" + (prices.pass_monthly / 100).toFixed(2) : "£40.00";
    const errEl = document.querySelector("#carded_pass_error_msg");
    const btn   = document.querySelector("#btn_purchase_carded_pass");
    errEl.textContent = "";

    if (!start_date) {
        errEl.textContent = "Please select a start date.";
        return;
    }

    btn.textContent = "Redirecting to payment...";
    btn.disabled    = true;

    const req = await fetch("/api/membership/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_type: "monthly", start_date })
    });

    if (req.ok) {
        window.location.href = (await req.json()).url;
    } else {
        const fail = await req.json();
        errEl.textContent   = fail.message;
        btn.textContent     = "Purchase Carded Monthly Pass — " + monthlyPrice;
        btn.disabled        = false;
    }
}


async function openPassQRModal(membership) {
    const typeLabels = { day: "Day Ticket", weekly: "Weekly Ticket", monthly: "Monthly Ticket" };
    document.querySelector("#modal_mem_qr_details").textContent = (typeLabels[membership.membership_type] || membership.membership_type) + "  ·  " + membership.start_date + " to " + membership.end_date;
    const img = document.querySelector("#modal_mem_qr_image");
    img.src = "";
    img.alt = "Loading QR code…";
    document.querySelector("#modal_mem_qr_overlay").classList.add("open");
    document.querySelector("#modal_mem_qr_btn_close").onclick = () => {
        document.querySelector("#modal_mem_qr_overlay").classList.remove("open");
    };
    try {
        const resp = await fetch("/api/member/pass-qr");
        if (resp.ok) {
            const data = await resp.json();
            img.src = data.data;
            img.alt = "Ticket QR Code";
        } else {
            img.alt = "QR code unavailable";
        }
    } catch (_) {
        img.alt = "QR code unavailable";
    }
}

async function purchaseSessionPass(prices) {
    const membership_type = document.querySelector("#mem_type_select").value;
    const start_date      = document.querySelector("#mem_start_input").value;
    const priceLabel      = prices["pass_" + membership_type] ? "£" + (prices["pass_" + membership_type] / 100).toFixed(2) : "";

    document.querySelector("#mem_error_msg").textContent = "";

    if (!start_date) {
        document.querySelector("#mem_error_msg").textContent = "Please select a start date.";
        return;
    }

    document.querySelector("#btn_purchase_membership").textContent = "Redirecting to payment...";
    document.querySelector("#btn_purchase_membership").disabled    = true;

    const req = await fetch("/api/membership/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_type, start_date })
    });

    if (req.ok) {
        window.location.href = (await req.json()).url;
    } else {
        const fail = await req.json();
        document.querySelector("#mem_error_msg").textContent          = fail.message;
        document.querySelector("#btn_purchase_membership").textContent = "Purchase" + (priceLabel ? " — " + priceLabel : "");
        document.querySelector("#btn_purchase_membership").disabled    = false;
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

// Formats a Date as "8 May 2026"
function formatDate(date) {
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}


// ── Shop ─────────────────────────────────────────────────────────────────────

async function loadShop() {
    const [gymReq, pricingReq] = await Promise.all([
        fetch("/api/gym-membership"),
        fetch("/api/pricing")
    ]);

    const prices = {};
    if (pricingReq.ok) {
        const pd = await pricingReq.json();
        for (const row of pd.data) prices[row.price_key] = row.value_pence;
    }

    let hasNonContact = false;
    let hasContact    = false;
    if (gymReq.ok) {
        const gd = await gymReq.json();
        if (gd.data) {
            hasNonContact = !!gd.data.has_boxing_awards;
            hasContact    = !!gd.data.has_contact_awards;
        }
    }

    const fmt = (p, fallback) => p ? "£" + (p / 100).toFixed(2) : fallback;
    const grid = document.querySelector("#shop_products");
    grid.className = "product-grid";
    grid.innerHTML = "";

    function buildAwardCard(opts) {
        const card = document.createElement("div");
        card.className = "product-card";
        if (opts.owned) {
            card.innerHTML =
                "<div class='product-name'>" + opts.name + "</div>" +
                "<div class='product-desc'>" + opts.desc + "</div>" +
                "<div class='product-price'>" + opts.price + "</div>" +
                "<button class='btn-primary btn-sm' disabled style='margin-top:0;width:auto;'>Already Purchased</button>";
        } else {
            card.innerHTML =
                "<div class='product-name'>" + opts.name + "</div>" +
                "<div class='product-desc'>" + opts.desc + "</div>" +
                "<div class='product-price'>" + opts.price + "</div>" +
                "<button class='btn-primary btn-sm' id='" + opts.btnId + "' style='margin-top:0;width:auto;'>Buy Now</button>" +
                "<p class='product-msg' id='" + opts.msgId + "'></p>";
            card.querySelector("#" + opts.btnId).addEventListener("click", async () => {
                const btn = card.querySelector("#" + opts.btnId);
                const msg = card.querySelector("#" + opts.msgId);
                btn.disabled = true;
                btn.textContent = "Redirecting...";
                msg.textContent = "";
                const req = await fetch("/api/boxing-awards/checkout", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ award_type: opts.awardType })
                });
                if (req.ok) {
                    window.location.href = (await req.json()).url;
                } else {
                    const fail = await req.json();
                    msg.textContent = fail.message || "Purchase failed. Please try again.";
                    btn.disabled = false;
                    btn.textContent = "Buy Now";
                }
            });
        }
        return card;
    }

    grid.appendChild(buildAwardCard({
        name:      "Non-Contact Boxing Awards (Awards 1–3)",
        desc:      "Begin your official grading journey with the first three Boxing Awards levels, covering fundamentals, footwork and non-contact technique.",
        price:     fmt(prices.awards_standalone, "£20.00"),
        awardType: "non_contact",
        owned:     hasNonContact,
        btnId:     "btn_shop_buy_nc",
        msgId:     "shop_nc_msg"
    }));

    grid.appendChild(buildAwardCard({
        name:      "Contact Boxing Awards (Awards 4–6)",
        desc:      "Progress to contact sparring and advanced technique with Awards 4–6, building on the Non-Contact foundation.",
        price:     fmt(prices.awards_contact, "£20.00"),
        awardType: "contact",
        owned:     hasContact,
        btnId:     "btn_shop_buy_c",
        msgId:     "shop_c_msg"
    }));
}

// ── Check In ──────────────────────────────────────────────────────────────────

function loadCheckin() {
    document.querySelector("#btn_start_checkin_scanner").addEventListener("click", startCheckinScanner);
}

function startCheckinScanner() {
    document.querySelector("#btn_start_checkin_scanner").style.display = "none";

    checkinScanner = new Html5QrcodeScanner("checkin_scanner_container", {
        fps: 20,
        qrbox: { width: 250, height: 250 }
    });

    checkinScanner.render(onCheckinScanSuccess);
}

async function onCheckinScanSuccess(decodedText) {
    await checkinScanner.clear();
    checkinScanner = null;

    let message  = "❌ Check-in failed — network error. Please try again.";
    let cardClass = "scan-fail";

    try {
        const req = await fetch("/attendance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decodedText })
        });
        const result = await req.json();
        message = result.message;
        if (message && message.startsWith("✅"))                                       cardClass = "scan-ok";
        else if (message && (message.startsWith("⏰") || message.startsWith("⚠️"))) cardClass = "scan-warn";
    } catch (_) { /* keep defaults */ }

    const resultDiv = document.querySelector("#checkin_scan_result");
    const card      = document.createElement("div");
    card.className  = "scan-result-card " + cardClass;
    card.innerHTML  = "<p>" + message + "</p>" +
                      "<button id='btn_scan_again' class='btn-ghost'>Scan Again</button>";
    resultDiv.innerHTML = "";
    resultDiv.appendChild(card);

    document.querySelector("#btn_scan_again").addEventListener("click", () => {
        resultDiv.innerHTML = "";
        document.querySelector("#btn_start_checkin_scanner").style.display = "block";
    });
}
