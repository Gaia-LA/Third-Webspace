const socket = io();

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const toolbar = document.getElementById("toolbar");
const btnDraw = document.getElementById("btn-draw");
const btnText = document.getElementById("btn-text");
const btnImage = document.getElementById("btn-image");
const btnErase = document.getElementById("btn-erase");
const imageInput = document.getElementById("image-input");

let currentMode = "draw"; // "draw", "text", "image", "erase"
let drawing = false;
let lastX = 0, lastY = 0;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight - toolbar.clientHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

canvas.addEventListener("mousedown", (e) => {
  drawing = true;
  [lastX, lastY] = [e.offsetX, e.offsetY];
});
canvas.addEventListener("mouseup", () => drawing = false);
canvas.addEventListener("mouseout", () => drawing = false);

canvas.addEventListener("mousemove", (e) => {
  if (!drawing) return;
  const x = e.offsetX, y = e.offsetY;
  if (currentMode === "draw") {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    socket.emit("draw-data", { lastX, lastY, x, y, mode: "draw" });
  } else if (currentMode === "erase") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    socket.emit("draw-data", { lastX, lastY, x, y, mode: "erase" });
  }
  [lastX, lastY] = [x, y];
});

canvas.addEventListener("click", (e) => {
  if (currentMode === "text") {
    const text = prompt("Enter text:");
    if (text) {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "black";
      ctx.font = "20px sans-serif";
      ctx.fillText(text, e.offsetX, e.offsetY);
      socket.emit("action-data", { type: "text", x: e.offsetX, y: e.offsetY, text });
    }
  }
});

btnDraw.onclick = () => { currentMode = "draw"; };
btnErase.onclick = () => { currentMode = "erase"; };
btnText.onclick = () => { currentMode = "text"; };
btnImage.onclick = () => { currentMode = "image"; imageInput.click(); };

imageInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    const img = new Image();
    img.onload = function() {
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(img, 0, toolbar.clientHeight);
      socket.emit("action-data", { type: "image", dataURL: evt.target.result });
    };
    img.src = evt.target.result;
  };
};

socket.on("draw-data", (data) => {
  if (data.mode === "draw") {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2;
  } else if (data.mode === "erase") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = 10;
  }
  ctx.beginPath();
  ctx.moveTo(data.lastX, data.lastY);
  ctx.lineTo(data.x, data.y);
  ctx.stroke();
});

socket.on("action-data", (data) => {
  if (data.type === "text") {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "black";
    ctx.font = "20px sans-serif";
    ctx.fillText(data.text, data.x, data.y);
  } else if (data.type === "image") {
    const img = new Image();
    img.onload = () => {
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(img, 0, toolbar.clientHeight);
    };
    img.src = data.dataURL;
  }
});
