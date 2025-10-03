/* Shared whiteboard client
 * - Uses an offscreen master canvas in absolute coordinates (A1 size)
 * - mainCanvas displays a transformed view (pan/zoom) of the master
 * - overlayCanvas is used for cursors and selection overlays
 * - History from server is replayed to render previous edits on join
 */

/***********************
 * Config / Globals
 ***********************/
const socket = io();

// A1 page size (approx). We choose a reasonable pixel dimension that's large
// enough for detailed work but not insane. You can adjust if desired.
// This represents the "absolute" drawing coordinate space.
const MASTER_WIDTH = 2384 * 2; // ~4768 px (approx A1 at medium DPI)
const MASTER_HEIGHT = 3370 * 2; // ~6740 px

// DOM
const mainCanvas = document.getElementById("mainCanvas");
const overlayCanvas = document.getElementById("overlayCanvas");
const colorPicker = document.getElementById("color-picker");
const sizeRange = document.getElementById("size-range");
const eraserRange = document.getElementById("eraser-range");
const textSizeRange = document.getElementById("text-size");
const btnDraw = document.getElementById("btn-draw");
const btnErase = document.getElementById("btn-erase");
const btnText = document.getElementById("btn-text");
const btnImage = document.getElementById("btn-image");
const btnClear = document.getElementById("btn-clear");
const btnSave = document.getElementById("btn-save");
const imageInput = document.getElementById("image-input");

// contexts
const mainCtx = mainCanvas.getContext("2d");
const overlayCtx = overlayCanvas.getContext("2d");

// Offscreen master canvas holds all actual artwork in absolute coords.
const masterCanvas = document.createElement("canvas");
masterCanvas.width = MASTER_WIDTH;
masterCanvas.height = MASTER_HEIGHT;
const masterCtx = masterCanvas.getContext("2d");

// Tool state
let currentMode = "draw"; // draw, erase, text, image
let isPointerDown = false;
let lastAbs = { x: 0, y: 0 }; // last point in absolute coords (master coords)
let brushColor = colorPicker.value;
let brushSize = Number(sizeRange.value);
let eraserSize = Number(eraserRange.value);
let textSize = Number(textSizeRange.value);

// Viewport transform (how master is mapped to screen)
let view = {
  offsetX: 0, // in master coords (top-left visible master x)
  offsetY: 0,
  scale: 1 // zoom level: 1 shows master at native pixel size; >1 zooms in
};

// Cursors of other users: id -> { x, y, color }
const otherCursors = {};

// Our id/color assigned by server:
let myId = null;
let myColor = "#000000";

/***********************
 * Helpers: coordinate transforms
 ***********************/
function screenToMaster(screenX, screenY) {
  // convert screen (client) coordinates to master canvas coordinates
  const rect = mainCanvas.getBoundingClientRect();
  const sx = screenX - rect.left;
  const sy = screenY - rect.top;
  const mx = view.offsetX + sx / view.scale;
  const my = view.offsetY + sy / view.scale;
  return { x: mx, y: my };
}
function masterToScreen(mx, my) {
  const rect = mainCanvas.getBoundingClientRect();
  const sx = (mx - view.offsetX) * view.scale + rect.left;
  const sy = (my - view.offsetY) * view.scale + rect.top;
  return { x: sx, y: sy };
}

/***********************
 * Resize canvases to viewport
 ***********************/
function resizeToWindow() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  mainCanvas.width = w;
  mainCanvas.height = h;
  overlayCanvas.width = w;
  overlayCanvas.height = h;
  // Keep rendering
  drawViewport();
}
window.addEventListener("resize", resizeToWindow);
resizeToWindow();

/***********************
 * Rendering
 ***********************/
function drawViewport() {
  // Clear main
  mainCtx.clearRect(0,0,mainCanvas.width, mainCanvas.height);
  // draw portion of master onto mainCanvas: drawImage(master, sx, sy, sw, sh, dx, dy, dw, dh)
  const sx = view.offsetX;
  const sy = view.offsetY;
  const sw = mainCanvas.width / view.scale;
  const sh = mainCanvas.height / view.scale;
  mainCtx.imageSmoothingEnabled = true;
  mainCtx.drawImage(masterCanvas, sx, sy, sw, sh, 0, 0, mainCanvas.width, mainCanvas.height);

  // overlay (cursors)
  drawOverlay();
}

function drawOverlay() {
  overlayCtx.clearRect(0,0,overlayCanvas.width, overlayCanvas.height);
  // draw other cursors
  Object.entries(otherCursors).forEach(([id, info]) => {
    if (!info) return;
    // convert master coords to screen
    const screen = masterToScreen(info.x, info.y);
    // draw simple caret circle + id
    const r = 8;
    overlayCtx.beginPath();
    overlayCtx.arc(screen.x, screen.y, r, 0, Math.PI*2);
    overlayCtx.fillStyle = info.color || "#000";
    overlayCtx.fill();
    overlayCtx.font = "12px sans-serif";
    overlayCtx.fillStyle = "#000";
    overlayCtx.fillText(id === myId ? "you" : id.slice(0,4), screen.x + 12, screen.y + 4);
  });
}

/***********************
 * Drawing primitives on master canvas
 ***********************/
function drawLineOnMaster(x1,y1,x2,y2, color, width, compositeOp = "source-over") {
  masterCtx.save();
  masterCtx.globalCompositeOperation = compositeOp;
  masterCtx.strokeStyle = color;
  masterCtx.lineWidth = width;
  masterCtx.lineJoin = "round";
  masterCtx.lineCap = "round";
  masterCtx.beginPath();
  masterCtx.moveTo(x1, y1);
  masterCtx.lineTo(x2, y2);
  masterCtx.stroke();
  masterCtx.restore();
}

function drawTextOnMaster(x,y,text, size, color) {
  masterCtx.save();
  masterCtx.globalCompositeOperation = "source-over";
  masterCtx.fillStyle = color;
  masterCtx.font = `${size}px sans-serif`;
  masterCtx.textBaseline = "top";
  masterCtx.fillText(text, x, y);
  masterCtx.restore();
}

function drawImageOnMaster(x,y, img, w, h) {
  masterCtx.save();
  masterCtx.globalCompositeOperation = "source-over";
  masterCtx.drawImage(img, x, y, w, h);
  masterCtx.restore();
}

/***********************
 * Event: pointer handling (draw + pan)
 ***********************/
let pointerIdActive = null;
let isPanning = false;
let panStart = null;

function handlePointerDown(e) {
  // unify
  mainCanvas.setPointerCapture(e.pointerId);
  // for panning - if two-finger touch or middle mouse, treat as pan
  if (e.pointerType === "touch" && e.isPrimary === false) {
    // treat non-primary touch as pan start (two finger pan)
    isPanning = true;
    panStart = { x: e.clientX, y: e.clientY, offsetX: view.offsetX, offsetY: view.offsetY };
    return;
  }

  // left click or primary touch
  if (currentMode === "draw" || currentMode === "erase") {
    pointerIdActive = e.pointerId;
    isPointerDown = true;
    const abs = screenToMaster(e.clientX, e.clientY);
    lastAbs = abs;
    // immediate dot
    const comp = currentMode === "erase" ? "destination-out" : "source-over";
    const width = currentMode === "erase" ? eraserSize : brushSize;
    const color = currentMode === "erase" ? "rgba(0,0,0,1)" : brushColor;
    drawLineOnMaster(abs.x, abs.y, abs.x+0.01, abs.y+0.01, color, width, comp);
    // emit a tiny stroke so it appears on others
    socket.emit("draw-data", { lastX: abs.x, lastY: abs.y, x: abs.x+0.01, y: abs.y+0.01, mode: currentMode, color: brushColor, size: width });
    drawViewport();
  } else if (currentMode === "text") {
    const abs = screenToMaster(e.clientX, e.clientY);
    const text = prompt("Enter text:");
    if (text) {
      drawTextOnMaster(abs.x, abs.y, text, textSize, brushColor);
      socket.emit("action-data", { type: "text", x: abs.x, y: abs.y, text, size: textSize, color: brushColor });
      drawViewport();
    }
  } else if (currentMode === "image") {
    // open image dialog
    imageInput.click();
  }
}

function handlePointerMove(e) {
  // Update our cursor position (broadcast so others can see)
  const abs = screenToMaster(e.clientX, e.clientY);
  socket.emit("cursor-move", { x: abs.x, y: abs.y });

  // If panning
  if (isPanning && panStart) {
    const dx = (e.clientX - panStart.x) / view.scale;
    const dy = (e.clientY - panStart.y) / view.scale;
    view.offsetX = Math.max(0, Math.min(masterCanvas.width - mainCanvas.width / view.scale, panStart.offsetX - dx));
    view.offsetY = Math.max(0, Math.min(masterCanvas.height - mainCanvas.height / view.scale, panStart.offsetY - dy));
    drawViewport();
    return;
  }

  if (!isPointerDown || e.pointerId !== pointerIdActive) return;
  const curr = screenToMaster(e.clientX, e.clientY);

  if (currentMode === "draw") {
    drawLineOnMaster(lastAbs.x, lastAbs.y, curr.x, curr.y, brushColor, brushSize, "source-over");
    socket.emit("draw-data", { lastX: lastAbs.x, lastY: lastAbs.y, x: curr.x, y: curr.y, mode: "draw", color: brushColor, size: brushSize });
    lastAbs = curr;
    drawViewport();
  } else if (currentMode === "erase") {
    drawLineOnMaster(lastAbs.x, lastAbs.y, curr.x, curr.y, "rgba(0,0,0,1)", eraserSize, "destination-out");
    socket.emit("draw-data", { lastX: lastAbs.x, lastY: lastAbs.y, x: curr.x, y: curr.y, mode: "erase", size: eraserSize });
    lastAbs = curr;
    drawViewport();
  }
}

function handlePointerUp(e) {
  try { mainCanvas.releasePointerCapture(e.pointerId); } catch(_) {}
  isPointerDown = false;
  pointerIdActive = null;
  if (isPanning && e.pointerType === "touch") {
    isPanning = false;
    panStart = null;
  }
}

/***********************
 * Wheel zoom & pan (desktop)
 ***********************/
mainCanvas.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  const delta = ev.deltaY < 0 ? 1.1 : 1/1.1;
  const rect = mainCanvas.getBoundingClientRect();
  // zoom towards pointer
  const mouseX = ev.clientX;
  const mouseY = ev.clientY;
  const before = screenToMaster(mouseX, mouseY);
  view.scale = Math.min(4, Math.max(0.2, view.scale * delta));
  const after = screenToMaster(mouseX, mouseY);
  // adjust offset so zoom centers at mouse
  view.offsetX += (before.x - after.x);
  view.offsetY += (before.y - after.y);
  // clamp
  view.offsetX = Math.max(0, Math.min(masterCanvas.width - mainCanvas.width / view.scale, view.offsetX));
  view.offsetY = Math.max(0, Math.min(masterCanvas.height - mainCanvas.height / view.scale, view.offsetY));
  drawViewport();
}, { passive: false });

/***********************
 * Pointer events wiring
 ***********************/
mainCanvas.addEventListener("pointerdown", handlePointerDown);
mainCanvas.addEventListener("pointermove", handlePointerMove);
mainCanvas.addEventListener("pointerup", handlePointerUp);
mainCanvas.addEventListener("pointercancel", handlePointerUp);
mainCanvas.addEventListener("pointerout", handlePointerUp);

/***********************
 * Toolbar interactions
 ***********************/
function setActiveTool(name) {
  currentMode = name;
  [btnDraw, btnErase, btnText, btnImage].forEach(b => b.classList.remove("active"));
  if (name === "draw") btnDraw.classList.add("active");
  if (name === "erase") btnErase.classList.add("active");
  if (name === "text") btnText.classList.add("active");
  if (name === "image") btnImage.classList.add("active");
}

btnDraw.addEventListener("click", () => setActiveTool("draw"));
btnErase.addEventListener("click", () => setActiveTool("erase"));
btnText.addEventListener("click", () => setActiveTool("text"));
btnImage.addEventListener("click", () => setActiveTool("image"));
btnClear.addEventListener("click", () => {
  if (!confirm("Clear the board for everyone?")) return;
  socket.emit("clear-board");
  // server broadcasts clear-board to all (including us)
});
btnSave.addEventListener("click", () => {
  // create a PNG from master canvas
  const link = document.createElement("a");
  link.download = "whiteboard.png";
  link.href = masterCanvas.toDataURL("image/png");
  link.click();
});

// color and sizes
colorPicker.addEventListener("input", (e) => { brushColor = e.target.value; });
sizeRange.addEventListener("input", (e) => { brushSize = Number(e.target.value); });
eraserRange.addEventListener("input", (e) => { eraserSize = Number(e.target.value); });
textSizeRange.addEventListener("input", (e) => { textSize = Number(e.target.value); });

/***********************
 * Image upload handling (and placement)
 ***********************/
imageInput.addEventListener("change", async (ev) => {
  const file = ev.target.files && ev.target.files[0];
  imageInput.value = ""; // reset
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    const img = new Image();
    img.onload = function() {
      // place the image centered in current viewport center by default
      const centerScreenX = mainCanvas.width / 2;
      const centerScreenY = mainCanvas.height / 2;
      const centerMaster = screenToMaster(centerScreenX, centerScreenY);
      // scale image to max width of 50% viewport width (in master coords)
      const maxW = (mainCanvas.width / view.scale) * 0.5;
      let w = img.width;
      let h = img.height;
      if (w > maxW) {
        const ratio = maxW / w;
        w = w * ratio;
        h = h * ratio;
      }
      const x = centerMaster.x - w/2;
      const y = centerMaster.y - h/2;
      // draw to master canvas
      drawImageOnMaster(x, y, img, w, h);
      drawViewport();
      // emit action-data so others can render
      socket.emit("action-data", { type: "image", dataURL: evt.target.result, x, y, w, h });
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
});

/***********************
 * Socket handling: initial replay + incoming events + cursors
 ***********************/
socket.on("connect", () => {
  console.log("connected to server");
});

socket.on("init", (payload) => {
  // payload.history contains previous actions
  // payload.cursors contains existing cursors
  myId = payload.myId;
  myColor = payload.myColor || myColor;
  Object.assign(otherCursors, payload.cursors || {});
  // ensure our own entry exists
  otherCursors[myId] = otherCursors[myId] || { x: 0, y: 0, color: myColor };

  // replay history to master canvas
  if (payload.history && payload.history.length) {
    // apply in order
    payload.history.forEach(item => {
      if (item.type === "draw") {
        const d = item.data;
        const composite = d.mode === "erase" ? "destination-out" : "source-over";
        const col = d.color || "#000";
        const size = d.size || (d.mode === "erase" ? eraserSize : brushSize);
        drawLineOnMaster(d.lastX, d.lastY, d.x, d.y, col, size, composite);
      } else if (item.type === "action") {
        const a = item.data;
        if (a.type === "text") {
          drawTextOnMaster(a.x, a.y, a.text, a.size || 24, a.color || "#000");
        } else if (a.type === "image") {
          // load image then draw (synchronous replay is tricky for images; we'll draw when loaded)
          const img = new Image();
          img.onload = () => {
            drawImageOnMaster(a.x, a.y, img, a.w, a.h);
            drawViewport();
          };
          img.src = a.dataURL;
        }
      }
    });
    // after replay, draw viewport
    drawViewport();
  }
});

socket.on("draw-data", (d) => {
  const composite = d.mode === "erase" ? "destination-out" : "source-over";
  const col = d.color || "#000";
  const size = d.size || (d.mode === "erase" ? eraserSize : brushSize);
  drawLineOnMaster(d.lastX, d.lastY, d.x, d.y, col, size, composite);
  drawViewport();
});

socket.on("action-data", (a) => {
  if (a.type === "text") {
    drawTextOnMaster(a.x, a.y, a.text, a.size || 24, a.color || "#000");
    drawViewport();
  } else if (a.type === "image") {
    const img = new Image();
    img.onload = () => {
      drawImageOnMaster(a.x, a.y, img, a.w, a.h);
      drawViewport();
    };
    img.src = a.dataURL;
  }
});

socket.on("clear-board", () => {
  // clear master and history will be cleared on server
  masterCtx.clearRect(0,0,masterCanvas.width, masterCanvas.height);
  drawViewport();
});

socket.on("cursor-join", ({ id, color }) => {
  otherCursors[id] = { x: 0, y: 0, color };
  drawOverlay();
});
socket.on("cursor-move", ({ id, x, y }) => {
  if (!otherCursors[id]) otherCursors[id] = { x: 0, y: 0, color: "#000" };
  otherCursors[id].x = x;
  otherCursors[id].y = y;
  drawOverlay();
});
socket.on("cursor-leave", ({ id }) => {
  delete otherCursors[id];
  drawOverlay();
});

/***********************
 * Ensure we periodically send our cursor (so others get initial pos)
 ***********************/
setInterval(() => {
  // attempt to send last known cursor as master coords from center of screen
  const center = screenToMaster(mainCanvas.width/2, mainCanvas.height/2);
  socket.emit("cursor-move", { x: center.x, y: center.y });
}, 5000);

/***********************
 * Touch-based pan: allow two-finger pan
 * (pointer events already handle non-primary touches as pan start)
 ***********************/

/***********************
 * Utility: ensure viewport initially centered
 ***********************/
function centerViewport() {
  view.scale = Math.min(1.2, Math.max(0.2, Math.min(mainCanvas.width / masterCanvas.width, mainCanvas.height / masterCanvas.height)));
  view.offsetX = Math.max(0, (masterCanvas.width - (mainCanvas.width / view.scale)) / 2);
  view.offsetY = Math.max(0, (masterCanvas.height - (mainCanvas.height / view.scale)) / 2);
  drawViewport();
}
centerViewport();

/***********************
 * Make sure overlay updates when user changes tool sizes/colors (optional)
 ***********************/
colorPicker.addEventListener("change", () => { drawOverlay(); });

/***********************
 * Keyboard shortcuts (optional, small)
 ***********************/
window.addEventListener("keydown", (e) => {
  if (e.key === " ") {
    // space toggles panning while held? Implemented if desired
  }
});

