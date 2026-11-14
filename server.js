'use strict';

const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 6;
const COUNTDOWN_TIME = 3;
const GUESS_TIME = 12;
const REVEAL_TIME = 6;
const TICK_MS = 100;
const SCORE_POINTS = [3, 2, 1];
const DEFAULT_ROUNDS = 5;
const MAX_ROUNDS = 50;

// Her oyuncunun kendine ait rengi (oda içinde benzersiz atanır).
const PLAYER_COLORS = [
  '#ffffff',
  '#ff5d8f',
  '#4cc9f0',
  '#b8f23d',
  '#c77dff',
  '#ffd166',
];

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------- yardımcılar ------------------------------ */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function cleanName(raw) {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  return name || 'Oyuncu';
}

function generateRoomCode() {
  let code = '';
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function toByte(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return null;
  return clamp(number, 0, 255);
}

function normalizeRounds(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 0 || value === '0' || value === 'unlimited' || value === '∞') return null;
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 1) return undefined;
  return clamp(number, 1, MAX_ROUNDS);
}

function rgbToHex(color) {
  return `#${[color.r, color.g, color.b]
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

function colorDistanceSq(a, b) {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

function srgbToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

// Algısal renk farkı için sRGB -> CIE Lab (D65).
function rgbToLab(color) {
  const r = srgbToLinear(color.r);
  const g = srgbToLinear(color.g);
  const b = srgbToLinear(color.b);

  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;

  const pivot = (value) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function deltaE(labA, labB) {
  return Math.hypot(labA.L - labB.L, labA.a - labB.a, labA.b - labB.b);
}

function randomTarget(previous) {
  let candidate = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    candidate = { r: randInt(0, 255), g: randInt(0, 255), b: randInt(0, 255) };
    if (!previous || colorDistanceSq(candidate, previous) >= 50 ** 2) break;
  }
  return { ...candidate, hex: rgbToHex(candidate) };
}

/* --------------------------------- durum ---------------------------------- */

function publicState(room) {
  const reveal = room.phase === 'reveal' || room.phase === 'gameover';
  const players = Array.from(room.players.values());
  const lockedCount = players.filter((player) => player.locked).length;
  const guessCount = players.filter((player) => player.guess).length;

  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    round: room.round,
    totalRounds: room.totalRounds,
    timeLeft: Math.max(0, Math.round(room.timer * 10) / 10),
    target: room.target,
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      score: player.score,
      hasGuess: Boolean(player.guess),
      locked: Boolean(player.locked),
    })),
    results: reveal ? room.results : [],
    lockedCount,
    guessCount,
  };
}

function broadcast(room) {
  io.to(room.code).emit('state', publicState(room));
}

function notifyRoom(room, text) {
  io.to(room.code).emit('notice', { text });
}

/* -------------------------------- oda akışı -------------------------------- */

function addPlayer(room, socket, name) {
  const usedColors = new Set(Array.from(room.players.values()).map((player) => player.colorIndex));
  let colorIndex = 0;
  while (usedColors.has(colorIndex)) colorIndex += 1;

  const player = {
    id: socket.id,
    name,
    colorIndex,
    color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
    score: 0,
    guess: null,
    locked: false,
  };

  room.players.set(player.id, player);
  socket.data.roomCode = room.code;
  socket.join(room.code);
  return player;
}

function resetToLobby(room, message) {
  room.phase = 'lobby';
  room.round = 0;
  room.timer = 0;
  room.target = null;
  room.lastTarget = null;
  room.results = [];

  for (const player of room.players.values()) {
    player.score = 0;
    player.guess = null;
    player.locked = false;
  }

  if (message) notifyRoom(room, message);
  broadcast(room);
}

function removePlayer(room, playerId) {
  if (!room.players.has(playerId)) return;
  room.players.delete(playerId);

  if (room.hostId === playerId) {
    room.hostId = room.players.keys().next().value || null;
  }

  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }

  room.results = room.results.filter((result) => result.playerId !== playerId);

  if (room.phase !== 'lobby' && room.players.size < 2) {
    resetToLobby(room, 'Bir oyuncu ayrıldı. Oyun durduruldu, yeni oyuncu bekleniyor.');
    return;
  }

  broadcast(room);
}

function detachSocket(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  socket.data.roomCode = null;
  socket.leave(code);
  const room = rooms.get(code);
  if (room) removePlayer(room, socket.id);
}

function startGame(room) {
  if (room.players.size < 2) return;

  room.round = 0;
  room.lastTarget = null;
  room.results = [];

  for (const player of room.players.values()) {
    player.score = 0;
    player.guess = null;
    player.locked = false;
  }

  beginRound(room, 1);
}

function beginRound(room, roundNumber) {
  room.round = roundNumber;
  room.target = randomTarget(room.lastTarget);
  room.lastTarget = { r: room.target.r, g: room.target.g, b: room.target.b };
  room.results = [];
  room.phase = 'countdown';
  room.timer = COUNTDOWN_TIME;

  for (const player of room.players.values()) {
    player.guess = null;
    player.locked = false;
  }

  broadcast(room);
}

function startGuessing(room) {
  room.phase = 'guessing';
  room.timer = GUESS_TIME;
  broadcast(room);
}

function endGuessing(room) {
  const targetLab = rgbToLab(room.target);
  const players = Array.from(room.players.values());

  const entries = players.map((player) => {
    if (!player.guess) {
      return {
        playerId: player.id,
        name: player.name,
        playerColor: player.color,
        guess: null,
        hex: null,
        rawDistance: null,
        distance: null,
        place: null,
        points: 0,
      };
    }

    const rawDistance = deltaE(rgbToLab(player.guess), targetLab);
    return {
      playerId: player.id,
      name: player.name,
      playerColor: player.color,
      guess: { ...player.guess },
      hex: rgbToHex(player.guess),
      rawDistance,
      distance: Math.round(rawDistance * 100) / 100,
      place: null,
      points: 0,
    };
  });

  const guessed = entries
    .filter((entry) => entry.rawDistance !== null)
    .sort((a, b) => a.rawDistance - b.rawDistance);

  let previousDistance = null;
  let previousPlace = 0;

  guessed.forEach((entry, index) => {
    if (previousDistance !== null && Math.abs(entry.rawDistance - previousDistance) < 1e-9) {
      entry.place = previousPlace;
    } else {
      entry.place = index + 1;
      previousPlace = entry.place;
    }
    previousDistance = entry.rawDistance;
    entry.points = SCORE_POINTS[entry.place - 1] || 0;

    const player = room.players.get(entry.playerId);
    if (player) player.score += entry.points;
  });

  const noGuess = entries.filter((entry) => entry.rawDistance === null);

  room.results = [...guessed, ...noGuess].map((entry) => ({
    playerId: entry.playerId,
    name: entry.name,
    playerColor: entry.playerColor,
    guess: entry.guess,
    hex: entry.hex,
    distance: entry.distance,
    place: entry.place,
    points: entry.points,
  }));

  room.phase = 'reveal';
  room.timer = REVEAL_TIME;

  for (const player of room.players.values()) {
    player.locked = true;
  }

  broadcast(room);
}

function finishGame(room) {
  room.phase = 'gameover';
  room.timer = 0;
  broadcast(room);
}

function finishReveal(room) {
  if (room.totalRounds !== null && room.round >= room.totalRounds) {
    finishGame(room);
  } else {
    beginRound(room, room.round + 1);
  }
}

/* ---------------------------------- döngü ---------------------------------- */

let previousTick = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.25, (now - previousTick) / 1000);
  previousTick = now;

  for (const room of rooms.values()) {
    if (room.phase === 'countdown') {
      room.timer -= dt;
      if (room.timer <= 0) {
        startGuessing(room);
      } else {
        broadcast(room);
      }
    } else if (room.phase === 'guessing') {
      room.timer -= dt;
      if (room.timer <= 0) {
        endGuessing(room);
      } else {
        broadcast(room);
      }
    } else if (room.phase === 'reveal') {
      room.timer -= dt;
      if (room.timer <= 0) {
        finishReveal(room);
      } else {
        broadcast(room);
      }
    }
  }
}, TICK_MS);

/* --------------------------------- socket --------------------------------- */

io.on('connection', (socket) => {
  socket.on('create_room', (payload, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    if (socket.data.roomCode) {
      respond({ ok: false, error: 'Zaten bir odadasın.' });
      return;
    }

    const code = generateRoomCode();
    const room = {
      code,
      hostId: socket.id,
      phase: 'lobby',
      players: new Map(),
      round: 0,
      totalRounds: DEFAULT_ROUNDS,
      timer: 0,
      target: null,
      lastTarget: null,
      results: [],
    };

    rooms.set(code, room);
    addPlayer(room, socket, cleanName(payload && payload.name));
    respond({ ok: true, code });
    broadcast(room);
  });

  socket.on('join_room', (payload, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    if (socket.data.roomCode) {
      respond({ ok: false, error: 'Zaten bir odadasın.' });
      return;
    }

    const code = String((payload && payload.code) || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4);
    const room = rooms.get(code);

    if (!room) {
      respond({ ok: false, error: 'Bu kodla bir oda bulunamadı.' });
      return;
    }
    if (room.phase !== 'lobby') {
      respond({ ok: false, error: 'Bu odada oyun başlamış. Yeni bir oda dene.' });
      return;
    }
    if (room.players.size >= MAX_PLAYERS) {
      respond({ ok: false, error: 'Oda dolu (en fazla 6 oyuncu).' });
      return;
    }

    addPlayer(room, socket, cleanName(payload && payload.name));
    respond({ ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('leave_room', () => {
    detachSocket(socket);
  });

  socket.on('set_rounds', (payload) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'lobby') return;
    if (room.hostId !== socket.id) {
      socket.emit('feedback', { type: 'error', text: 'Tur sayısını sadece oda sahibi değiştirebilir.' });
      return;
    }
    const rounds = normalizeRounds(payload && payload.rounds);
    if (rounds === undefined) return;
    room.totalRounds = rounds;
    broadcast(room);
  });

  socket.on('start_game', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('feedback', { type: 'error', text: 'Oyunu sadece oda sahibi başlatabilir.' });
      return;
    }
    if (room.phase !== 'lobby') return;
    if (room.players.size < 2) {
      socket.emit('feedback', { type: 'error', text: 'Başlamak için en az 2 oyuncu gerekli.' });
      return;
    }
    startGame(room);
  });

  socket.on('restart_game', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('feedback', { type: 'error', text: 'Yeniden başlatmayı sadece oda sahibi yapabilir.' });
      return;
    }
    if (room.phase !== 'gameover') return;
    if (room.players.size < 2) {
      socket.emit('feedback', { type: 'error', text: 'Yeniden başlatmak için en az 2 oyuncu gerekli.' });
      return;
    }
    startGame(room);
  });

  socket.on('end_game', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('feedback', { type: 'error', text: 'Oyunu sadece oda sahibi bitirebilir.' });
      return;
    }
    if (room.phase === 'lobby' || room.phase === 'gameover') return;
    finishGame(room);
  });

  socket.on('guess', (payload) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'guessing') return;
    const player = room.players.get(socket.id);
    if (!player || player.locked) return;

    const r = toByte(payload && payload.r);
    const g = toByte(payload && payload.g);
    const b = toByte(payload && payload.b);
    if (r === null || g === null || b === null) return;

    player.guess = { r, g, b };
  });

  socket.on('lock_guess', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'guessing') return;
    const player = room.players.get(socket.id);
    if (!player || !player.guess || player.locked) return;

    player.locked = true;
    broadcast(room);

    const allLocked = Array.from(room.players.values()).every((item) => item.locked);
    if (allLocked) endGuessing(room);
  });

  socket.on('disconnect', () => {
    detachSocket(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Renk Çarkı ${PORT} portunda çalışıyor: http://localhost:${PORT}`);
});
