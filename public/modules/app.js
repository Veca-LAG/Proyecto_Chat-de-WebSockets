const socket = new WebSocket("ws://localhost:3000");

const mensajes = document.getElementById("mensajes");
const texto = document.getElementById("texto");
const btnEnviar = document.getElementById("btnEnviar");

socket.onopen = () => {
    console.log("Conectado al servidor");
};

socket.onmessage = (event) => {

    const div = document.createElement("div");

    div.classList.add("mensaje");

    div.textContent = event.data;

    mensajes.appendChild(div);

};

btnEnviar.addEventListener("click", () => {
    const mensaje = texto.value;

    if (mensaje.trim() !== "") {

        socket.send(mensaje);

        texto.value = "";

    }

});
