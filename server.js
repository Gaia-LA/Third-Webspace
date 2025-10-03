const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// serve static public folder
app.use(express.static(path.join(__dirname, "public")));

// In-memory store (simple). For production you'll want persistent storage.
let history = []; // array of actions (draw-data and action-data)
let cursors = {}; // socketId -> { x, y, color }

function randomColor() {
  // pick a visually distinct color
  const colors = [
    "#e6194b","#3cb44b","#ffe119","#4363d8","#f58231",
    "#911eb4","#46f0f0","#f032e6","#bcf60c","#fabebe",
    "#008080","#e6beff","#9a6324","#fffac8","#800000",
    "#aaffc3","#808000","#ffd8b1","#000075","#808080"
  ];
  return colors[Math.floor(Math.random()*colors.length)];
}

io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

  // assign a cursor color and send init data
  const color = randomColor();
  cursors[socket.id] = { x: 0, y: 0, color };

  // send initial state: history + existing cursors (and your assigned color & id)
  socket.emit("init", { history, cursors, myId: socket.id, myColor: color });

  // notify others of new cursor
  socket.broadcast.emit("cursor-join", { id: socket.id, color });

  socket.on("draw-data", (data) => {
    // append to history and broadcast
    history.push({ type: "draw", data });
    socket.broadcast.emit("draw-data", data);
  });

  socket.on("action-data", (data) => {
    // images, texts, clears, placements, etc
    history.push({ type: "action", data });
    socket.broadcast.emit("action-data", data);
  });

  socket.on("clear-board", () => {
    // clear history and notify
    history = [];
    io.emit("clear-board");
  });

  socket.on("cursor-move", (data) => {
    // update server cursor map and broadcast
    if (cursors[socket.id]) {
      cursors[socket.id].x = data.x;
      cursors[socket.id].y = data.y;
    }
    // broadcast to others
    socket.broadcast.emit("cursor-move", { id: socket.id, x: data.x, y: data.y });
  });

  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);
    delete cursors[socket.id];
    socket.broadcast.emit("cursor-leave", { id: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
