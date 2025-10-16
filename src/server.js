import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

// --- Express setup ---
const app = express();
app.use(cors());
app.get("/", (req, res) => res.send("🎯 Bingo backend is running"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// --- In-memory storage ---
const games = new Map();

// --- Helper: generate 5x5 Bingo board ---
function generateBoard() {
  const ranges = [
    [1, 15],
    [16, 30],
    [31, 45],
    [46, 60],
    [61, 75],
  ];
  const board = Array.from({ length: 5 }, () => Array(5).fill(null));

  for (let col = 0; col < 5; col++) {
    const [min, max] = ranges[col];
    const numbers = Array.from({ length: max - min + 1 }, (_, i) => i + min);
    for (let row = 0; row < 5; row++) {
      const num = numbers.splice(
        Math.floor(Math.random() * numbers.length),
        1
      )[0];
      board[row][col] = { number: num, markedBy: null };
    }
  }

  // free center
  board[2][2].markedBy = "free";
  return board;
}

// --- Socket.IO logic ---
io.on("connection", (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);

  socket.on("create-room", ({ name }, cb) => {
    const roomId = Math.random().toString(36).substring(2, 8);
    const player = { id: socket.id, name, board: generateBoard() };

    const game = {
      id: roomId,
      hostId: socket.id,
      players: { [socket.id]: player },
      calledNumbers: [],
      started: false,
      winnerId: null,
    };

    games.set(roomId, game);
    socket.join(roomId);
    cb({ ok: true, roomId });
    io.to(roomId).emit("player-list", Object.values(game.players));
  });

  socket.on("join-room", ({ roomId, name }, cb) => {
    const game = games.get(roomId);
    if (!game) return cb({ ok: false, error: "Room not found" });
    if (game.started) return cb({ ok: false, error: "Game already started" });

    const player = { id: socket.id, name, board: generateBoard() };
    game.players[socket.id] = player;

    socket.join(roomId);
    io.to(roomId).emit("player-list", Object.values(game.players));
    cb({ ok: true, game });
  });

  socket.on("start-game", ({ roomId }, cb) => {
    const game = games.get(roomId);
    if (!game) return cb({ ok: false, error: "Room not found" });
    if (socket.id !== game.hostId)
      return cb({ ok: false, error: "Only host can start" });

    game.started = true;
    game.calledNumbers = [];
    io.to(roomId).emit("game-started");
    cb({ ok: true });
  });

  socket.on("call-number", ({ roomId }, cb) => {
    const game = games.get(roomId);
    if (!game) return cb({ ok: false, error: "Room not found" });
    if (socket.id !== game.hostId)
      return cb({ ok: false, error: "Only host can call numbers" });

    // Generate a random number not yet called
    const availableNumbers = Array.from({ length: 75 }, (_, i) => i + 1).filter(
      (num) => !game.calledNumbers.includes(num)
    );
    if (availableNumbers.length === 0)
      return cb({ ok: false, error: "All numbers called" });

    const number =
      availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
    game.calledNumbers.push(number);
    io.to(roomId).emit("number-called", number);
    cb({ ok: true, number });
  });

  socket.on("mark-cell", ({ roomId, row, col }, cb) => {
    const game = games.get(roomId);
    if (!game) return cb({ ok: false, error: "Room not found" });

    const player = game.players[socket.id];
    if (!player) return cb({ ok: false, error: "Not in game" });

    const cell = player.board[row][col];
    if (!cell) return cb({ ok: false, error: "Invalid cell" });
    // if (!game.calledNumbers.includes(cell.number) && cell.markedBy !== "free") {
    //   return cb({ ok: false, error: "Number not called" });
    // }

    cell.markedBy = cell.markedBy ? null : socket.id;
    io.to(roomId).emit("player-marked", { playerId: socket.id, row, col });
    cb({ ok: true });
  });

  socket.on("claim-bingo", ({ roomId }, cb) => {
    const game = games.get(roomId);
    if (!game) return cb({ ok: false, error: "Room not found" });

    const player = game.players[socket.id];
    if (!player) return cb({ ok: false, error: "Not in game" });

    const board = player.board;
    const checkLine = (cells) =>
      cells.every((c) => c.markedBy === socket.id || c.markedBy === "free");

    const hasBingo =
      board.some((row) => checkLine(row)) ||
      [0, 1, 2, 3, 4].some((c) => checkLine(board.map((r) => r[c]))) ||
      checkLine([0, 1, 2, 3, 4].map((i) => board[i][i])) ||
      checkLine([0, 1, 2, 3, 4].map((i) => board[i][4 - i]));

    if (hasBingo) {
      game.winnerId = socket.id;
      io.to(roomId).emit("bingo-claimed", {
        winnerId: socket.id,
        name: player.name,
      });
      cb({ ok: true });
    } else {
      cb({ ok: false, error: "Not a valid bingo" });
    }
  });

  socket.on("disconnect", () => {
    for (const [id, game] of games.entries()) {
      if (game.players[socket.id]) {
        delete game.players[socket.id];
        io.to(id).emit("player-left", socket.id);
        if (Object.keys(game.players).length === 0) games.delete(id);
      }
    }
    console.log(`❌ Disconnected: ${socket.id}`);
  });
});

// --- Start server ---
const PORT = process.env.PORT || 4000;
server.listen(PORT, () =>
  console.log(`🚀 Bingo backend running on port ${PORT}`)
);
