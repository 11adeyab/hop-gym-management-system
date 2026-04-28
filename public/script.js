//window.addEventListener("load", loadPage);
function main() {
    handleElements()
    handleEventListener();
}

//this should display a dashboard for the user when they successfully log-in

function handleEventListener() {
    nav.home.addEventListener("click", () => {
        console.log("nav home was clicked!");
        window.location.href="/";
    }); 

    nav.register.addEventListener("click", () => {
        console.log("nav register was clicked!");
        //sends a HTTP request to the server
        window.location.href = "/register";
    })
    
    nav.login.addEventListener("click", () => {
        console.log("nav login was clicked!");
        //refreshes the page
        window.location.href = "/login";
    });

    if (register.btn) {
        register.btn.addEventListener("click", async() => {
            console.log("register btn clicked")
            const payload = {
                name: register.name.value,
                email: register.email.value,
                password: register.password.value

            }

            const request = await fetch("/register", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload) });

            if (request.ok) {
                const response = await request.json();
                console.log(response.message);
                console.log(response.data);
                
                document.querySelector("#register_form").remove();
            } 
            else {
                console.error("Error - POST request failed!");
            }});
        
    }
    
    login.btn.addEventListener("click", async() => {
        console.log("login btn clicked");
        const payload = {
            email: login.email.value,
            password: login.password.value
        }
        const request = await fetch("/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload) 
        });

        if (request.ok) {
            const response = await request.json();
            console.log(response.message);
            console.log(response.data);
                
            //document.querySelector("#login_form").remove();
            return window.location.href = "/dashboard";
            
        } 
        else {
            const response = await request.json();
            console.log(response.message);
            console.log(response.data);
            console.error("Error - POST request failed!");
            }
        });

}

function handleElements() {
     nav = {
        home: document.querySelector("#nav_home"),
        register: document.querySelector("#nav_register"),
        login: document.querySelector("#nav_login") 
    };

     register = {
        name: document.querySelector("#register_name "),
        email: document.querySelector("#register_email"),
        password: document.querySelector("#register_password"),
        btn: document.querySelector("#register_btn")
    };

    login = {
        email: document.querySelector("#login_email"),
        password: document.querySelector("#login_password"),
        btn: document.querySelector("#login_btn") 
    };

}

let nav, login, register;
main();