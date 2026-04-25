console.log("script running");
let scanner;
const scanner_btn = document.querySelector("#scanner_btn");
scanner_btn.addEventListener("click", startScanner);

function startScanner() {
    scanner = new Html5QrcodeScanner("scanner", {
        fps: 20,
        qrbox: {
            width: 250,
            height: 250
        }
    });
    scanner_btn.remove();
    //displays the scanner
    scanner.render(success);
}
//scanner.render(success); //displays the QR Code Reader
async function success(decodedText, decodedResult){
    //document.querySelector("#results").innerHTML = `<h1>Success!</h1><p>QR Code has been scanned</p>`;
    scanner.clear(); //stops the QR-Code Reader
    document.querySelector("#scanner").remove();
    console.log("QR Code has been scanned!");

    const request = await fetch("/attendance", {
        method: "POST", 
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({decodedText: decodedText, decodedResult: decodedResult})});
        
    if (request.ok) {
        console.log("POST request successful!")
        const response = await request.json();
        console.log(response.message);
        console.log(response.data);

    } else {
        console.error("POST requset failed");
    }
}
