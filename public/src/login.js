document.querySelector("#btn_submit_login").addEventListener("click", () => {
    loginUser({
        email:    document.querySelector("#email").value,
        password: document.querySelector("#password").value
    });
});

document.querySelector("#password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.querySelector("#btn_submit_login").click();
});

async function loginUser(data) {
    document.querySelector("#error_msg").textContent = "";

    const response = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });

    if (response.ok) {
        // Follow wherever the server redirected us (dashboard or admin)
        window.location.href = response.url;
    } else {
        const result = await response.json();
        document.querySelector("#error_msg").textContent = result.message || "Login failed. Please check your credentials.";
    }
}
