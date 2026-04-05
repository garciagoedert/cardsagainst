const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Load cards ────────────────────────────────────────────────────────────
const rawCards = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'cards.json'), 'utf8'));

// ─── Game state ────────────────────────────────────────────────────────────
const rooms = {}; // roomCode → Room

function createDeck() {
  return {
    black: shuffle([...rawCards.black]),
    white: shuffle([...rawCards.white])
  };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function dealWhiteCards(room, playerId, count) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;
  while (player.hand.length < count) {
    if (room.deck.white.length === 0) {
      room.deck.white = shuffle([...rawCards.white]);
    }
    player.hand.push(room.deck.white.pop());
  }
}

function getPublicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase, // 'lobby' | 'playing' | 'judging' | 'results' | 'ended'
    czarId: room.czarId,
    currentBlackCard: room.currentBlackCard,
    submissions: room.phase === 'judging'
      ? shuffle(room.submissions.map(s => ({ playerId: s.playerId, cards: s.cards })))
      : [],
    scores: room.scores,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      isConnected: p.isConnected,
      hasSubmitted: room.submissions.some(s => s.playerId === p.id)
    })),
    winPoints: room.winPoints,
    winner: room.winner || null,
    round: room.round
  };
}

function getPlayerHand(room, playerId) {
  const player = room.players.find(p => p.id === playerId);
  return player ? player.hand : [];
}

function nextCzar(room) {
  const activePlayers = room.players.filter(p => p.isConnected);
  const currentIdx = activePlayers.findIndex(p => p.id === room.czarId);
  const nextIdx = (currentIdx + 1) % activePlayers.length;
  room.czarId = activePlayers[nextIdx].id;
}

function startRound(room) {
  room.phase = 'playing';
  room.submissions = [];
  room.round++;

  // Deal black card
  if (room.deck.black.length === 0) {
    room.deck.black = shuffle([...rawCards.black]);
  }
  room.currentBlackCard = room.deck.black.pop();

  // Deal white cards to all non-czar players (fill to 7 + pick count)
  const pick = room.currentBlackCard.pick || 1;
  room.players.forEach(p => {
    if (p.id !== room.czarId && p.isConnected) {
      dealWhiteCards(room, p.id, 7);
    }
  });

  io.to(room.code).emit('round_start', getPublicRoom(room));

  // Send each player their hand privately
  room.players.forEach(p => {
    const socket = io.sockets.sockets.get(p.socketId);
    if (socket) {
      socket.emit('your_hand', getPlayerHand(room, p.id));
    }
  });
}

function checkAllSubmitted(room) {
  const activePlayers = room.players.filter(p => p.isConnected && p.id !== room.czarId);
  return activePlayers.every(p => room.submissions.some(s => s.playerId === p.id));
}

// ─── Socket events ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // Create room
  socket.on('create_room', ({ name, winPoints }, callback) => {
    const code = generateRoomCode();
    const playerId = uuidv4();
    const room = {
      code,
      hostId: playerId,
      phase: 'lobby',
      czarId: null,
      currentBlackCard: null,
      submissions: [],
      scores: {},
      deck: createDeck(),
      winPoints: winPoints || 8,
      winner: null,
      round: 0,
      players: [{
        id: playerId,
        socketId: socket.id,
        name,
        hand: [],
        score: 0,
        isConnected: true
      }]
    };
    rooms[code] = room;
    socket.join(code);
    socket.data = { playerId, roomCode: code };
    callback({ success: true, roomCode: code, playerId });
    io.to(code).emit('room_update', getPublicRoom(room));
  });

  // Join room
  socket.on('join_room', ({ name, roomCode, playerId: existingId }, callback) => {
    const room = rooms[roomCode];
    if (!room) return callback({ success: false, error: 'Sala não encontrada.' });
    if (room.phase !== 'lobby' && !existingId) return callback({ success: false, error: 'O jogo já começou.' });

    let player = room.players.find(p => p.id === existingId);

    if (player) {
      // Reconnect
      player.socketId = socket.id;
      player.isConnected = true;
      socket.join(roomCode);
      socket.data = { playerId: player.id, roomCode };
      callback({ success: true, roomCode, playerId: player.id });
      socket.emit('room_update', getPublicRoom(room));
      socket.emit('your_hand', getPlayerHand(room, player.id));
      io.to(roomCode).emit('room_update', getPublicRoom(room));
    } else {
      // New player
      if (room.players.length >= 10) return callback({ success: false, error: 'Sala cheia (máx 10 jogadores).' });
      const newId = uuidv4();
      const newPlayer = { id: newId, socketId: socket.id, name, hand: [], score: 0, isConnected: true };
      room.players.push(newPlayer);
      socket.join(roomCode);
      socket.data = { playerId: newId, roomCode };
      callback({ success: true, roomCode, playerId: newId });
      io.to(roomCode).emit('room_update', getPublicRoom(room));
    }
  });

  // Start game (host only)
  socket.on('start_game', () => {
    const { playerId, roomCode } = socket.data || {};
    const room = rooms[roomCode];
    if (!room) return;
    if (room.hostId !== playerId) return;
    if (room.players.length < 2) return socket.emit('error_msg', 'Precisa de ao menos 2 jogadores.');

    room.czarId = room.players[0].id;
    room.players.forEach(p => { p.score = 0; p.hand = []; });
    startRound(room);
  });

  // Submit white cards
  socket.on('submit_cards', ({ cards }) => {
    const { playerId, roomCode } = socket.data || {};
    const room = rooms[roomCode];
    if (!room || room.phase !== 'playing') return;
    if (room.czarId === playerId) return;
    if (room.submissions.some(s => s.playerId === playerId)) return;

    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    const pick = room.currentBlackCard.pick || 1;
    if (cards.length !== pick) return socket.emit('error_msg', `Selecione exatamente ${pick} carta(s).`);

    // Remove submitted cards from hand
    cards.forEach(card => {
      const idx = player.hand.indexOf(card);
      if (idx !== -1) player.hand.splice(idx, 1);
    });

    room.submissions.push({ playerId, cards });
    io.to(roomCode).emit('room_update', getPublicRoom(room));

    if (checkAllSubmitted(room)) {
      room.phase = 'judging';
      io.to(roomCode).emit('judging_phase', getPublicRoom(room));
    }
  });

  // Czar picks winner
  socket.on('pick_winner', ({ winnerId }) => {
    const { playerId, roomCode } = socket.data || {};
    const room = rooms[roomCode];
    if (!room || room.phase !== 'judging') return;
    if (room.czarId !== playerId) return;

    const winner = room.players.find(p => p.id === winnerId);
    if (!winner) return;

    winner.score++;

    // Reveal who submitted what
    const revealData = room.submissions.map(s => ({
      playerId: s.playerId,
      playerName: room.players.find(p => p.id === s.playerId)?.name,
      cards: s.cards
    }));

    if (winner.score >= room.winPoints) {
      room.phase = 'ended';
      room.winner = { id: winner.id, name: winner.name, score: winner.score };
      io.to(roomCode).emit('game_over', { winner: room.winner, reveal: revealData, room: getPublicRoom(room) });
    } else {
      room.phase = 'results';
      io.to(roomCode).emit('round_results', {
        winnerId,
        winnerName: winner.name,
        reveal: revealData,
        room: getPublicRoom(room)
      });

      // After 5 seconds, start next round
      setTimeout(() => {
        if (!rooms[roomCode] || room.phase !== 'results') return;
        nextCzar(room);
        startRound(room);
      }, 5000);
    }
  });

  // Restart game
  socket.on('restart_game', () => {
    const { playerId, roomCode } = socket.data || {};
    const room = rooms[roomCode];
    if (!room || room.hostId !== playerId) return;
    room.phase = 'lobby';
    room.czarId = null;
    room.currentBlackCard = null;
    room.submissions = [];
    room.winner = null;
    room.round = 0;
    room.deck = createDeck();
    room.players.forEach(p => { p.score = 0; p.hand = []; });
    io.to(roomCode).emit('room_update', getPublicRoom(room));
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    const { playerId, roomCode } = socket.data || {};
    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.isConnected = false;
      io.to(roomCode).emit('room_update', getPublicRoom(room));

      // If all disconnected, remove room after delay
      setTimeout(() => {
        if (room.players.every(p => !p.isConnected)) {
          delete rooms[roomCode];
          console.log(`[x] Room ${roomCode} deleted (all disconnected)`);
        }
      }, 30 * 60 * 1000); // 30 min
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🃏  Cards Against Humanity BR`);
  console.log(`🚀  Servidor rodando na porta ${PORT}`);
  console.log(`📡  O jogo está pronto para ser compartilhado!\n`);
});
