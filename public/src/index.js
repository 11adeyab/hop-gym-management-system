const btn = {
    login: document.querySelector("#btn_login"),
    register: document.querySelector("#btn_register")
};

btn.login.addEventListener("click", () => {
    window.location.href = "/login";
})

btn.register.addEventListener("click", () => {
    window.location.href = "/register";
})