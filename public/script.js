//console.log("script running");

const fullname = document.querySelector("#fullname");
const email = document.querySelector("#email");
const session = document.querySelector("#session");
const date = document.querySelector("#date");
const time = document.querySelector("#time");
const duration = document.querySelector("#duration");
const submit_booking = document.querySelector("#submit_booking");

console.log(duration.options.value);
submit_booking.addEventListener("click", confirmBooking);

async function confirmBooking() {
    const payload = {
        full_name: fullname.value, 
        email_address: email.value, 
        session_type: session.value,
        start_date: date.value,
        start_time: time.value, 
        session_duration: Number(duration.value)
    }
    const post_request = await fetch("/bookings", {
        method: "POST", 
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    if (post_request.ok) {
        console.log("POST request successful");
        const response = await post_request.json();
        console.log(response);
        submitResults(response.qrcode_img);
    } else {
        console.log("POST request failed!");
    };

}

function submitResults(data) {
    document.querySelector("#booking_form").remove();
    const results = document.querySelector("#results");
    const heading = document.createElement("h1");
    heading.textContent = "Booking Successful";
    results.append(heading);
    const para = document.createElement("p");
    para.textContent = "Thank you for booking a session: here is your QR Code";
    heading.append(para);
    const qr_code = document.createElement("img");
    qr_code.src = data;
    para.append(qr_code);
}; 