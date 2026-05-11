document.querySelector("#btn_submit_register").addEventListener("click", () => {
    const day   = document.querySelector("#dob_day").value;
    const month = document.querySelector("#dob_month").value;
    const year  = document.querySelector("#dob_year").value;
    const dob   = year && month && day ? year + "-" + month + "-" + String(day).padStart(2, "0") : "";

    registerUser({
        first_name: document.querySelector("#first_name").value,
        last_name:  document.querySelector("#last_name").value,
        dob:        dob,
        gender:     document.querySelector("#gender").value,
        email:      document.querySelector("#email").value,
        phone:      document.querySelector("#phone").value,
        password:   document.querySelector("#password").value
    });
});

async function registerUser(data) {
    document.querySelector("#error_msg").textContent = "";

    const response = await fetch("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });

    if (response.ok) {
        window.location.href = "/login";
    } else {
        const result = await response.json();
        document.querySelector("#error_msg").textContent = result.message || "Registration failed. Please try again.";
    }
}
