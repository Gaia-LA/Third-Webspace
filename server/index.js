const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/dist')));

const BOARD_FILE = path.join(__dirname, 'board.json');

// Load or initialize board data
let board = { actions: [] };
try {
  const data = fs.readFileSync(BOARD_FILE);
  board = JSON.parse(data);
} catch (e) {
  fs.writeFileSync(BOARD_FILE, JSON.stringify(board, null, 2));
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);

  // Assign a random color for cursor
  const cursorColor = '#' + Math.floor(Math.random()*16777215).toString(16);
  socket.emit('init', { board, userId: socket.id, cursorColor });

  // Receive drawing actions
  socket.on('action', (action) => {
    action.userId = socket.id;
    action.timestamp = Date.now();
    board.actions.push(action);

    // Save board
    fs.writeFileSync(BOARD_FILE, JSON.stringify(board, null, 2));
    
    // Broadcast to everyone
    socket.broadcast.emit('action', action);
  });

  // Clear board
  socket.on('clear', () => {
    board.actions = [];
    fs.writeFileSync(BOARD_FILE, JSON.stringify(board, null, 2));
    io.emit('clear');
  });

  socket.on('disconnect', () => console.log('User disconnected:', socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
