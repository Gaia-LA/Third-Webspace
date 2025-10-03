const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const path = require("path");
app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

  // When a user draws / updates something, broadcast to others
  socket.on("draw-data", (data) => {
    socket.broadcast.emit("draw-data", data);
  });

  // When user adds image / text etc
  socket.on("action-data", (data) => {
    socket.broadcast.emit("action-data", data);
  });

  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
