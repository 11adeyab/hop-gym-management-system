let selectedMembership = null;
let prices = { membership_non_carded: 1000, membership_carded: 2500, awards_with_membership: 1000 };
let isMinnow = false;

(async () => {
    try {
        const res = await fetch("/api/register/prices");
        if (res.ok) prices = await res.json();
    } catch (_) {}
    renderPrices();
})();

function renderPrices() {
    const fmt = p => "£" + (p / 100).toFixed(2);
    document.querySelector("#price_non_carded").textContent = fmt(prices.membership_non_carded);
    document.querySelector("#price_carded").textContent     = fmt(prices.membership_carded);
    document.querySelector("#price_awards").textContent     = "+" + fmt(prices.awards_with_membership);
}

function selectMembership(type) {
    selectedMembership = type;
    document.querySelector("#opt_non_carded").classList.toggle("selected", type === "non_carded");
    document.querySelector("#opt_carded").classList.toggle("selected", type === "carded");
    document.querySelector("#step1_error").textContent = "";
}

function setStepIndicator(step) {
    const titles    = ["Choose Your Membership", "Your Details", "Review & Confirm"];
    const subtitles = [
        "Step 1 of 3 — Select a membership to get started",
        "Step 2 of 3 — Enter your personal details",
        "Step 3 of 3 — Review your order and complete registration"
    ];
    document.querySelector("#card_title").textContent    = titles[step - 1];
    document.querySelector("#card_subtitle").textContent = subtitles[step - 1];

    for (let i = 1; i <= 3; i++) {
        const dot = document.querySelector("#sdot_" + i);
        dot.classList.remove("active", "done");
        if (i < step) dot.classList.add("done");
        else if (i === step) dot.classList.add("active");
    }
}

// Step 1 Continue → Step 2
function advanceToDetails() {
    document.querySelector("#step1_error").textContent = "";
    document.querySelector("#step_1").style.display = "none";
    document.querySelector("#step_2").style.display = "block";
    setStepIndicator(2);
    checkDobMinnow();
}

// Step 2 Back → Step 1
function backToSelect() {
    document.querySelector("#step_2").style.display = "none";
    document.querySelector("#step_1").style.display = "block";
    setStepIndicator(1);
}

// Step 2 Continue → Step 3
function advanceToConfirm() {
    document.querySelector("#step2_error").textContent = "";

    const first_name      = document.querySelector("#first_name").value.trim();
    const last_name       = document.querySelector("#last_name").value.trim();
    const day             = document.querySelector("#dob_day").value;
    const month           = document.querySelector("#dob_month").value;
    const year            = document.querySelector("#dob_year").value;
    const gender          = document.querySelector("#gender").value;
    const email           = document.querySelector("#email").value.trim();
    const phone           = document.querySelector("#phone").value.trim();
    const password        = document.querySelector("#password").value;
    const confirmPassword = document.querySelector("#confirm_password").value;

    if (!first_name || !last_name) {
        document.querySelector("#step2_error").textContent = "Please enter your full name."; return;
    }
    if (!day || !month || !year || year.length < 4) {
        document.querySelector("#step2_error").textContent = "Please enter a valid date of birth."; return;
    }
    if (!gender) {
        document.querySelector("#step2_error").textContent = "Please select a gender."; return;
    }
    if (!email) {
        document.querySelector("#step2_error").textContent = "Please enter your email address."; return;
    }
    if (!phone) {
        document.querySelector("#step2_error").textContent = "Please enter your phone number."; return;
    }
    if (!password) {
        document.querySelector("#step2_error").textContent = "Please create a password."; return;
    }
    if (password.length < 6) {
        document.querySelector("#step2_error").textContent = "Password must be at least 6 characters."; return;
    }
    if (password !== confirmPassword) {
        document.querySelector("#step2_error").textContent = "Passwords do not match."; return;
    }

    const dob = year + "-" + month + "-" + String(day).padStart(2, "0");
    const age = computeAgeClient(dob);

    if (age === null || age < 0) {
        document.querySelector("#step2_error").textContent = "Please enter a valid date of birth."; return;
    }

    isMinnow = age < 10;

    if (!isMinnow && !selectedMembership) {
        document.querySelector("#step2_error").textContent = "Please go back and select a membership."; return;
    }

    buildOrderSummary(dob);
    document.querySelector("#step_2").style.display = "none";
    document.querySelector("#step_3").style.display = "block";
    setStepIndicator(3);
}

// Step 3 Back → Step 2
function backToDetails() {
    document.querySelector("#step_3").style.display = "none";
    document.querySelector("#step_2").style.display = "block";
    setStepIndicator(2);
}

function buildOrderSummary(dob) {
    const fmt = p => "£" + (p / 100).toFixed(2);
    const minnowNotice = document.querySelector("#minnow_confirm_notice");
    const payBtn       = document.querySelector("#btn_pay");
    const summary      = document.querySelector("#order_summary");
    summary.innerHTML  = "";

    if (isMinnow) {
        addOrderRow(summary, "Minnow Registration (under 10)", "Free", false);
        addOrderRow(summary, "Gym Membership", "Not required", false);
        addOrderRow(summary, "Total", "£0.00", true);
        minnowNotice.style.display = "block";
        payBtn.textContent = "Create Account →";
    } else {
        const include_awards = document.querySelector("#chk_awards").checked;
        const typeLabels = { non_carded: "Non-Carded Membership", carded: "Carded Membership" };
        const memAmt    = prices["membership_" + selectedMembership] || 0;
        const awardsAmt = include_awards ? (prices.awards_with_membership || 0) : 0;
        const total     = memAmt + awardsAmt;

        addOrderRow(summary, typeLabels[selectedMembership] + " (Annual)", fmt(memAmt), false);
        if (include_awards) {
            addOrderRow(summary, "Boxing Awards Programme", fmt(awardsAmt), false);
        }
        addOrderRow(summary, "Total", fmt(total), true);
        minnowNotice.style.display = "none";
        payBtn.textContent = "Pay " + fmt(total) + " →";
    }
}

function addOrderRow(container, label, value, isTotal) {
    const row = document.createElement("div");
    row.className = "order-row" + (isTotal ? " total" : "");
    row.innerHTML = "<span>" + label + "</span><span>" + value + "</span>";
    container.appendChild(row);
}

async function submitRegistration() {
    document.querySelector("#error_msg").textContent = "";
    const btn = document.querySelector("#btn_pay");
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = isMinnow ? "Creating account..." : "Redirecting to payment...";

    const day   = document.querySelector("#dob_day").value;
    const month = document.querySelector("#dob_month").value;
    const year  = document.querySelector("#dob_year").value;
    const dob   = year + "-" + month + "-" + String(day).padStart(2, "0");

    const payload = {
        first_name: document.querySelector("#first_name").value.trim(),
        last_name:  document.querySelector("#last_name").value.trim(),
        dob,
        gender:   document.querySelector("#gender").value,
        email:    document.querySelector("#email").value.trim(),
        phone:    document.querySelector("#phone").value.trim(),
        password: document.querySelector("#password").value
    };

    const endpoint = isMinnow ? "/register/minnow" : "/register/checkout";
    if (!isMinnow) {
        payload.membership_type  = selectedMembership;
        payload.include_awards   = document.querySelector("#chk_awards").checked;
    }

    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const data = await res.json();
            window.location.href = data.redirect || data.url || "/dashboard";
        } else {
            const err = await res.json();
            document.querySelector("#error_msg").textContent = err.message || "Registration failed. Please try again.";
            btn.disabled = false;
            btn.textContent = originalText;
        }
    } catch (_) {
        document.querySelector("#error_msg").textContent = "Network error. Please try again.";
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

function checkDobMinnow() {
    const day   = document.querySelector("#dob_day").value;
    const month = document.querySelector("#dob_month").value;
    const year  = document.querySelector("#dob_year").value;
    if (!day || !month || !year || year.length < 4) return;
    const dob   = year + "-" + month + "-" + String(day).padStart(2, "0");
    const age   = computeAgeClient(dob);
    document.querySelector("#minnow_notice").style.display = (age !== null && age < 10) ? "block" : "none";
}

function computeAgeClient(dobStr) {
    const today = new Date();
    const birth = new Date(dobStr);
    if (isNaN(birth.getTime())) return null;
    let age = today.getFullYear() - birth.getFullYear();
    if (today.getMonth() < birth.getMonth() ||
        (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
    return age;
}

document.querySelector("#dob_day").addEventListener("change", checkDobMinnow);
document.querySelector("#dob_month").addEventListener("change", checkDobMinnow);
document.querySelector("#dob_year").addEventListener("input", checkDobMinnow);
