'use strict';

/* ==========================================================================
   Renk Çarkı — istemci
   ========================================================================== */

const socket = io();

const $ = (id) => document.getElementById(id);

const els = {
  screens: {
    home: $('screen-home'),
    lobby: $('screen-lobby'),
    game: $('screen-game'),
  },
  nameInput: $('name-input'),
  codeInput: $('code-input'),
  btnCreate: $('btn-create'),
  btnJoin: $('btn-join'),
  btnCopy: $('btn-copy'),
  btnStart: $('btn-start'),
  btnLeaveLobby: $('btn-leave-lobby'),
  btnLeaveGame: $('btn-leave-game'),
  btnEndGame: $('btn-end-game'),
  roomCode: $('room-code'),
  lobbyCount: $('lobby-count'),
  lobbyPlayers: $('lobby-players'),
  lobbyStatus: $('lobby-status'),
  roundOptions: $('round-options'),
  roundSettingHint: $('round-setting-hint'),
  hudRound: $('hud-round'),
  hudTimer: $('hud-timer'),
  timerChip: $('hud-timer').closest('.timer-chip'),
  targetCard: $('target-card'),
  targetSwatch: $('target-swatch'),
  targetName: $('target-name'),
  scoreStrip: $('score-strip'),
  stage: $('game-stage'),
  canvas: $('wheel-canvas'),
  wheelCaption: $('wheel-caption'),
  overlay: $('game-overlay'),
  overlayCard: $('overlay-card'),
  pickPanel: $('pick-panel'),
  pickSwatch: $('pick-swatch'),
  pickHex: $('pick-hex'),
  valueSlider: $('value-slider'),
  valueLabel: $('value-label'),
  btnLock: $('btn-lock'),
  revealPanel: $('reveal-panel'),
  revealGrid: $('reveal-grid'),
  revealNext: $('reveal-next'),
  revealTargetDot: $('reveal-target-dot'),
  revealTargetHex: $('reveal-target-hex'),
  revealNote: $('reveal-note'),
  toastStack: $('toast-stack'),
  connBanner: $('conn-banner'),
};

const ctx = els.canvas.getContext('2d');
const FONT = 'Outfit, "Segoe UI", system-ui, sans-serif';
const TAU = Math.PI * 2;

let state = null;
let currentScreen = 'home';
let myId = null;
let lobbyKey = '';
let scoreKey = '';
let overlayKey = '';
let revealKey = '';
let lastTargetKey = '';
let ignoreStatesUntil = 0;
let disconnectedOnce = false;

const selection = { h: 0, s: 0, v: 1, active: false };
let selectionLocked = false;
let guessTimer = null;

const wheelView = { cssW: 0, cssH: 0, dpr: 1, cx: 0, cy: 0, r: 0 };
let wheelBase = null;
let wheelDragging = false;
let wheelPointerId = null;

/* ------------------------------- yardımcılar ------------------------------ */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function initial(name) {
  const char = String(name || '').trim().charAt(0);
  return char ? char.toLocaleUpperCase('tr-TR') : '?';
}

function rgbToHex(color) {
  return `#${[color.r, color.g, color.b]
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

function hexToRgb(hex) {
  const value = String(hex || '#000000').replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  const number = Number.parseInt(full, 16);
  if (!Number.isFinite(number)) return { r: 0, g: 0, b: 0 };
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255,
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function hsvToRgb(hue, saturation, value) {
  const h = (((hue % 360) + 360) % 360) / 60;
  const s = clamp(saturation, 0, 1);
  const v = clamp(value, 0, 1);
  const c = v * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = v - c;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 1) {
    r = c; g = x; b = 0;
  } else if (h < 2) {
    r = x; g = c; b = 0;
  } else if (h < 3) {
    r = 0; g = c; b = x;
  } else if (h < 4) {
    r = 0; g = x; b = c;
  } else if (h < 5) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function rgbToHsv(color) {
  const r = clamp(color.r, 0, 255) / 255;
  const g = clamp(color.g, 0, 255) / 255;
  const b = clamp(color.b, 0, 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  return {
    h: hue,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function contrastColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 165 ? '#0b1020' : '#ffffff';
}

function toast(text, type = 'info') {
  if (!text) return;
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.textContent = text;
  els.toastStack.appendChild(node);

  while (els.toastStack.children.length > 4) {
    els.toastStack.firstElementChild.remove();
  }

  window.setTimeout(() => {
    node.classList.add('is-out');
    window.setTimeout(() => node.remove(), 250);
  }, 2800);
}

function showScreen(name) {
  currentScreen = name;
  document.body.dataset.screen = name;
  Object.entries(els.screens).forEach(([key, element]) => {
    element.classList.toggle('is-active', key === name);
  });
  if (name === 'game') {
    window.requestAnimationFrame(resizeWheel);
  }
}

function getPlayerName() {
  const name = els.nameInput.value.trim().replace(/\s+/g, ' ').slice(0, 16) || 'Oyuncu';
  els.nameInput.value = name;
  try {
    window.localStorage.setItem('renk-carki-name', name);
  } catch {
    /* storage yoksa önemli değil */
  }
  return name;
}

function setLoading(button, loading) {
  button.disabled = loading;
}

/* ------------------------------- socket olayları -------------------------- */

socket.on('state', (next) => {
  if (performance.now() < ignoreStatesUntil) return;
  const prev = state;
  myId = socket.id;
  state = next;

  if (next.phase === 'lobby') {
    resetGameVisuals();
    if (currentScreen !== 'lobby') showScreen('lobby');
    renderLobby(next);
    return;
  }

  if (currentScreen !== 'game') {
    showScreen('game');
    resetGameVisuals();
    resetRoundInteraction();
  }

  if (!prev || prev.phase === 'lobby' || prev.round !== next.round) {
    resetRoundInteraction();
    resetOverlay();
  }

  const me = next.players.find((player) => player.id === socket.id);
  if (me && me.locked) selectionLocked = true;

  if (prev && prev.phase === 'guessing' && next.phase === 'reveal') {
    const own = next.results.find((result) => result.playerId === socket.id);
    if (own && own.points > 0) {
      const message = own.place === 1
        ? `En yakın renk senin! +${own.points} puan`
        : `En yakın ${own.place}. renk! +${own.points} puan`;
      toast(message, 'success');
    }
  }

  updateHud(next);
  renderScoreStrip(next);
  updateControls(next);
  renderReveal(next);
  renderOverlay(next);
  updateCaption(next);
});

socket.on('feedback', (payload) => {
  if (!payload || !payload.text) return;
  const typeMap = { score: 'success', wrong: 'warn', late: 'warn', error: 'error' };
  toast(payload.text, typeMap[payload.type] || 'info');
});

socket.on('notice', (payload) => {
  if (payload && payload.text) toast(payload.text, 'info');
});

socket.on('connect', () => {
  els.connBanner.classList.remove('is-visible');
  if (disconnectedOnce) {
    disconnectedOnce = false;
    state = null;
    resetGameVisuals();
    showScreen('home');
    toast('Bağlantı yeniden kuruldu. Odaya tekrar katılabilirsin.', 'info');
  }
});

socket.on('disconnect', () => {
  disconnectedOnce = true;
  resetGuessTimer();
  els.connBanner.textContent = 'Bağlantı koptu — yeniden bağlanılıyor…';
  els.connBanner.classList.add('is-visible');
});

socket.on('connect_error', () => {
  els.connBanner.textContent = 'Sunucuya bağlanılamadı — yeniden deneniyor…';
  els.connBanner.classList.add('is-visible');
});

/* -------------------------------- ana menü -------------------------------- */

els.btnCreate.addEventListener('click', () => {
  if (!socket.connected) {
    toast('Sunucuya bağlanılıyor, biraz bekle.', 'warn');
    return;
  }
  ignoreStatesUntil = 0;
  setLoading(els.btnCreate, true);
  socket.timeout(6000).emit('create_room', { name: getPlayerName() }, (error, response) => {
    setLoading(els.btnCreate, false);
    if (error) {
      toast('Sunucu yanıt vermedi, tekrar dene.', 'error');
      return;
    }
    if (!response || !response.ok) {
      toast((response && response.error) || 'Oda oluşturulamadı.', 'error');
      return;
    }
    toast('Oda oluşturuldu. Kodu arkadaşlarınla paylaş!', 'success');
  });
});

els.btnJoin.addEventListener('click', () => {
  if (!socket.connected) {
    toast('Sunucuya bağlanılıyor, biraz bekle.', 'warn');
    return;
  }
  const code = els.codeInput.value.trim().toUpperCase();
  if (code.length !== 4) {
    toast('4 haneli oda kodunu gir.', 'warn');
    els.codeInput.focus();
    return;
  }

  ignoreStatesUntil = 0;
  setLoading(els.btnJoin, true);
  socket.timeout(6000).emit('join_room', { name: getPlayerName(), code }, (error, response) => {
    setLoading(els.btnJoin, false);
    if (error) {
      toast('Sunucu yanıt vermedi, tekrar dene.', 'error');
      return;
    }
    if (!response || !response.ok) {
      toast((response && response.error) || 'Odaya katılamadın.', 'error');
      return;
    }
    els.codeInput.value = '';
  });
});

els.nameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    els.codeInput.focus();
  }
});

els.codeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    els.btnJoin.click();
  }
});

els.codeInput.addEventListener('input', () => {
  els.codeInput.value = els.codeInput.value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);
});

/* ---------------------------------- lobi ---------------------------------- */

els.btnCopy.addEventListener('click', async () => {
  const code = (state && state.code) || els.roomCode.textContent;
  try {
    await navigator.clipboard.writeText(code);
    toast('Oda kodu kopyalandı.', 'success');
  } catch {
    const area = document.createElement('textarea');
    area.value = code;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      toast('Oda kodu kopyalandı.', 'success');
    } catch {
      toast(`Kopyalanamadı. Kod: ${code}`, 'warn');
    }
    area.remove();
  }
});

els.btnStart.addEventListener('click', () => {
  socket.emit('start_game');
});

els.roundOptions.addEventListener('click', (event) => {
  const button = event.target.closest('.round-option');
  if (!button || !state || state.phase !== 'lobby') return;
  if (state.hostId !== socket.id) return;
  socket.emit('set_rounds', { rounds: Number(button.dataset.rounds) });
});

els.btnEndGame.addEventListener('click', () => {
  if (!state || state.hostId !== socket.id) return;
  if (window.confirm('Oyunu bitirip final skorlarını göstermek istiyor musun?')) {
    socket.emit('end_game');
  }
});

els.btnLeaveLobby.addEventListener('click', leaveRoom);
els.btnLeaveGame.addEventListener('click', () => {
  if (window.confirm('Odadan ayrılmak istediğine emin misin?')) leaveRoom();
});

els.overlay.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'restart') {
    button.disabled = true;
    socket.emit('restart_game');
  } else if (action === 'leave') {
    leaveRoom();
  }
});

function leaveRoom() {
  socket.emit('leave_room');
  ignoreStatesUntil = performance.now() + 900;
  state = null;
  lobbyKey = '';
  resetGameVisuals();
  showScreen('home');
  toast('Odadan ayrıldın.', 'info');
}

function renderLobby(lobbyState) {
  els.roomCode.textContent = lobbyState.code;
  const players = lobbyState.players;
  const isHost = lobbyState.hostId === socket.id;
  const totalRounds = lobbyState.totalRounds;

  const key = [
    lobbyState.code,
    lobbyState.hostId,
    lobbyState.totalRounds,
    socket.id,
    players.map((player) => `${player.id}:${player.name}:${player.color}`).join('|'),
  ].join('#');

  if (key !== lobbyKey) {
    lobbyKey = key;
    els.lobbyPlayers.innerHTML = players.map((player) => {
      const host = player.id === lobbyState.hostId;
      const me = player.id === socket.id;
      return `
        <li class="lobby-player ${me ? 'is-me' : ''}">
          <span class="avatar" style="background:${esc(player.color)};color:${esc(player.color)}">
            <span style="color:#0b1020">${esc(initial(player.name))}</span>
          </span>
          <span class="lobby-name">${esc(player.name)}</span>
          ${host ? '<span class="host-badge">👑 Oda sahibi</span>' : ''}
          ${me ? '<span class="me-badge">SEN</span>' : ''}
        </li>
      `;
    }).join('');
  }

  els.lobbyCount.textContent = `${players.length} / 6`;
  els.btnStart.style.display = isHost ? '' : 'none';
  els.btnStart.disabled = players.length < 2;

  const roundsValue = totalRounds === null ? '0' : String(totalRounds);
  els.roundOptions.querySelectorAll('.round-option').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.rounds === roundsValue);
    button.disabled = !isHost;
  });
  els.roundOptions.classList.toggle('is-readonly', !isHost);
  if (isHost) {
    els.roundSettingHint.textContent = totalRounds === null
      ? 'Sınırsız — istediğinde bitir'
      : `${totalRounds} tur oynanacak`;
  } else {
    els.roundSettingHint.textContent = 'Oda sahibi belirler';
  }

  if (isHost) {
    els.btnStart.textContent = players.length < 2 ? 'En az 2 oyuncu gerekli' : 'Oyunu Başlat';
    els.lobbyStatus.textContent = players.length < 2
      ? 'Arkadaşlarını bekle veya oda kodunu paylaş.'
      : 'Herkes hazır olduğunda oyunu başlat.';
  } else {
    els.lobbyStatus.textContent = 'Oda sahibinin oyunu başlatması bekleniyor…';
  }
}

/* --------------------------------- oyun ----------------------------------- */

function resetGuessTimer() {
  if (guessTimer) {
    window.clearTimeout(guessTimer);
    guessTimer = null;
  }
}

function resetRoundInteraction() {
  resetGuessTimer();
  selection.h = 0;
  selection.s = 0;
  selection.v = 1;
  selection.active = false;
  selectionLocked = false;

  els.valueSlider.value = '100';
  els.valueLabel.textContent = '%100';
  updateValueGradient();
  updatePickPreview();

  els.pickSwatch.style.boxShadow = '';
  els.pickPanel.classList.remove('is-locked');
  els.btnLock.textContent = 'Tahmini Kilitle';
  els.btnLock.disabled = true;

  els.revealPanel.hidden = true;
  els.pickPanel.hidden = false;
  els.canvas.classList.remove('is-interactive');
}

function resetGameVisuals() {
  resetRoundInteraction();
  scoreKey = '';
  overlayKey = '';
  revealKey = '';
  lastTargetKey = '';
  els.scoreStrip.innerHTML = '';
  els.targetName.textContent = '—';
  els.targetSwatch.style.background = '#334155';
  els.targetSwatch.style.boxShadow = 'none';
  els.hudRound.textContent = '1/5';
  els.hudTimer.textContent = '—';
  els.timerChip.classList.remove('is-low');
  els.btnEndGame.hidden = true;
  els.wheelCaption.textContent = 'Çarktan rengini seç';
  resetOverlay();
}

function resetOverlay() {
  overlayKey = '';
  els.overlay.classList.remove('is-visible');
  els.overlay.setAttribute('aria-hidden', 'true');
  els.overlayCard.innerHTML = '';
}

function updateHud(gameState) {
  const totalLabel = gameState.totalRounds === null ? '∞' : gameState.totalRounds;
  els.hudRound.textContent = `${gameState.round}/${totalLabel}`;

  if (gameState.phase === 'guessing') {
    els.hudTimer.textContent = Math.max(0, gameState.timeLeft).toFixed(1);
    els.timerChip.classList.toggle('is-low', gameState.timeLeft <= 3);
  } else if (gameState.phase === 'countdown') {
    els.hudTimer.textContent = String(Math.max(1, Math.ceil(gameState.timeLeft)));
    els.timerChip.classList.remove('is-low');
  } else {
    els.hudTimer.textContent = '—';
    els.timerChip.classList.remove('is-low');
  }

  const target = gameState.target;
  if (!target) {
    els.targetName.textContent = '—';
    els.targetSwatch.style.background = '#334155';
    els.targetSwatch.style.boxShadow = 'none';
    return;
  }

  const revealed = gameState.phase === 'reveal' || gameState.phase === 'gameover';
  els.targetSwatch.style.background = target.hex;
  els.targetSwatch.style.boxShadow = `0 0 20px ${target.hex}, 0 0 5px ${target.hex}`;
  els.targetName.textContent = revealed ? target.hex.toUpperCase() : '???';

  const key = `${gameState.round}:${target.hex}`;
  if (lastTargetKey !== key) {
    lastTargetKey = key;
    els.targetCard.classList.remove('flash');
    void els.targetCard.offsetWidth;
    els.targetCard.classList.add('flash');
    window.setTimeout(() => els.targetCard.classList.remove('flash'), 900);
  }
}

function renderScoreStrip(gameState) {
  const sorted = gameState.players.slice().sort((a, b) => (
    b.score - a.score || a.name.localeCompare(b.name, 'tr')
  ));

  const key = `${gameState.phase}|${sorted.map((player) => (
    `${player.id}:${player.name}:${player.color}:${player.score}:${player.locked}:${player.hasGuess}`
  )).join('|')}`;

  if (key === scoreKey) return;
  scoreKey = key;

  els.scoreStrip.innerHTML = sorted.map((player, index) => {
    const me = player.id === socket.id;
    let status = '';
    if (gameState.phase === 'guessing') {
      if (player.locked) status = '✓';
      else if (player.hasGuess) status = '•';
    }
    return `
      <div class="score-chip ${me ? 'is-me' : ''} ${player.locked ? 'is-locked' : ''} ${index === 0 && player.score > 0 ? 'is-first' : ''}">
        <span class="score-rank">${index + 1}</span>
        <span class="chip-dot" style="color:${esc(player.color)};background:${esc(player.color)}"></span>
        <span class="chip-name">${esc(player.name)}${me ? ' (sen)' : ''}</span>
        <span class="chip-status">${status}</span>
        <b>${player.score}</b>
      </div>
    `;
  }).join('');
}

function updateControls(gameState) {
  const phase = gameState.phase;
  const me = gameState.players.find((player) => player.id === socket.id);
  const reveal = phase === 'reveal' || phase === 'gameover';
  const canPick = phase === 'guessing' && !selectionLocked && !(me && me.locked);
  const isHost = gameState.hostId === socket.id;

  els.pickPanel.hidden = reveal;
  els.revealPanel.hidden = !reveal;
  els.valueSlider.disabled = !canPick;
  els.btnEndGame.hidden = !(isHost && (phase === 'guessing' || phase === 'reveal'));

  if (phase === 'guessing') {
    els.btnLock.disabled = !canPick || !selection.active;
    els.btnLock.textContent = selectionLocked ? 'Kilitlendi ✓' : 'Tahmini Kilitle';
  } else if (phase === 'countdown') {
    els.btnLock.disabled = true;
    els.btnLock.textContent = 'Hazır ol…';
  } else {
    els.btnLock.disabled = true;
    els.btnLock.textContent = 'Tahmini Kilitle';
  }

  els.pickPanel.classList.toggle('is-locked', selectionLocked || Boolean(me && me.locked));
  els.canvas.classList.toggle('is-interactive', canPick);
}

function renderReveal(gameState) {
  const reveal = gameState.phase === 'reveal' || gameState.phase === 'gameover';
  if (!reveal) {
    els.revealPanel.hidden = true;
    return;
  }

  els.revealPanel.hidden = false;

  if (gameState.phase === 'gameover') {
    els.revealNext.textContent = 'Oyun bitti';
  } else if (gameState.totalRounds !== null && gameState.round >= gameState.totalRounds) {
    els.revealNext.textContent = 'Oyun sonucu geliyor…';
  } else {
    els.revealNext.textContent = `Sonraki tur ${Math.max(1, Math.ceil(gameState.timeLeft))} sn`;
  }

  const target = gameState.target;
  if (target) {
    els.revealTargetDot.style.background = target.hex;
    els.revealTargetDot.style.boxShadow = `0 0 10px ${target.hex}`;
    els.revealTargetHex.textContent = target.hex.toUpperCase();
  }

  const guessed = gameState.results.filter((result) => result.guess);
  const key = `${gameState.round}:${guessed.map((result) => (
    `${result.playerId}:${result.hex}:${result.distance}:${result.points}:${result.place}`
  )).join('|')}`;

  if (key !== revealKey) {
    revealKey = key;
    const top = guessed.slice(0, 4);

    els.revealGrid.innerHTML = top.length
      ? top.map((result) => `
          <div class="reveal-card ${result.place === 1 ? 'is-first' : ''} ${result.playerId === socket.id ? 'is-me' : ''}">
            <span class="reveal-rank">${result.place}</span>
            <span class="reveal-swatch" style="background:${esc(result.hex)}"></span>
            <div class="reveal-info">
              <strong>${esc(result.name)}${result.playerId === socket.id ? ' (sen)' : ''}</strong>
              <span>Fark ${result.distance.toFixed(2)}</span>
            </div>
            <span class="reveal-points">+${result.points}</span>
          </div>
        `).join('')
      : '<div class="reveal-empty">Bu tur kimse tahmin yapmadı.</div>';
  }

  const best = guessed.find((result) => result.place === 1) || guessed[0];
  els.revealNote.textContent = best
    ? `En yakın: ${best.name} · +${best.points} puan`
    : 'Hedefe ulaşan olmadı.';
}

function updateCaption(gameState) {
  if (gameState.phase === 'countdown') {
    els.wheelCaption.textContent = 'Hedef renk geliyor — hazır ol!';
    return;
  }

  if (gameState.phase === 'guessing') {
    if (selectionLocked) {
      els.wheelCaption.textContent = 'Kilitlendi · diğer oyuncular bekleniyor…';
    } else if (!selection.active) {
      els.wheelCaption.textContent = 'Çarktan rengini seç · parlaklığı alttan ayarla';
    } else {
      els.wheelCaption.textContent = 'Rengini ayarla, hazırsan kilitle';
    }
    return;
  }

  if (gameState.phase === 'reveal') {
    const guessed = gameState.results.filter((result) => result.guess);
    const best = guessed.find((result) => result.place === 1) || guessed[0];
    els.wheelCaption.textContent = best
      ? `En yakın: ${best.name} · Fark ${best.distance.toFixed(2)}`
      : 'Bu tur kimse tahmin yapmadı';
    return;
  }

  if (gameState.phase === 'gameover') {
    els.wheelCaption.textContent = 'Oyun bitti';
  }
}

function renderOverlay(gameState) {
  if (gameState.phase === 'guessing' || gameState.phase === 'reveal') {
    if (overlayKey !== 'hidden') {
      overlayKey = 'hidden';
      els.overlayCard.innerHTML = '';
    }
    els.overlay.classList.remove('is-visible');
    els.overlay.setAttribute('aria-hidden', 'true');
    return;
  }

  let key = '';
  let html = '';

  if (gameState.phase === 'countdown') {
    const seconds = Math.max(1, Math.ceil(gameState.timeLeft));
    key = `countdown:${gameState.round}:${seconds}`;
    const totalLabel = gameState.totalRounds === null ? '∞' : gameState.totalRounds;
    html = `
      <p class="overline">RENK ÇARKI · TUR ${gameState.round} / ${totalLabel}</p>
      <div class="countdown-number">${seconds}</div>
      ${gameState.target ? `
        <div class="countdown-target">
          <span class="big-swatch" style="background:${esc(gameState.target.hex)}"></span>
          <div class="countdown-target-text">
            <span>HEDEF RENK</span>
            <strong>Bu rengi çarkta yakala</strong>
          </div>
        </div>
      ` : ''}
      <p class="overlay-hint">Hazır ol! Herkes aynı hedefi görüyor.</p>
    `;
  } else if (gameState.phase === 'gameover') {
    const sorted = gameState.players.slice().sort((a, b) => (
      b.score - a.score || a.name.localeCompare(b.name, 'tr')
    ));
    const topScore = sorted.length ? sorted[0].score : 0;
    const winners = sorted.filter((player) => player.score === topScore);
    const isHost = gameState.hostId === socket.id;

    key = `gameover:${gameState.hostId}:${sorted.map((player) => (
      `${player.id}:${player.score}:${player.name}`
    )).join('|')}`;

    let title = 'Oyun bitti';
    if (topScore > 0) {
      title = winners.length > 1
        ? `${winners.map((player) => player.name).join(' & ')} berabere!`
        : `${winners[0].name} şampiyon!`;
    } else {
      title = 'Kimse puan alamadı';
    }

    html = `
      <p class="overline">OYUN BİTTİ · ${gameState.round}. TUR</p>
      <div class="winner-line">
        ${topScore > 0 ? '<span class="trophy">🏆</span>' : ''}
        <h2>${esc(title)}</h2>
      </div>
      <ul class="result-list">
        ${sorted.map((player, index) => `
          <li class="result-row ${index === 0 && topScore > 0 ? 'is-first' : ''} ${player.id === socket.id ? 'is-me' : ''}">
            <span class="result-place">${index + 1}</span>
            <span class="result-dot" style="background:${esc(player.color)};color:${esc(player.color)}"></span>
            <span class="result-name">${esc(player.name)}${player.id === socket.id ? ' (sen)' : ''}</span>
            <span class="result-score">${player.score} puan</span>
          </li>
        `).join('')}
      </ul>
      <div class="overlay-actions">
        ${isHost
          ? '<button class="btn btn-primary" data-action="restart">Yeniden Oyna</button>'
          : '<p class="final-note">Yeni oyunu oda sahibi başlatabilir.</p>'}
        <button class="btn btn-ghost" data-action="leave">Odadan Ayrıl</button>
      </div>
    `;
  }

  if (!html) {
    els.overlay.classList.remove('is-visible');
    els.overlay.setAttribute('aria-hidden', 'true');
    return;
  }

  if (key !== overlayKey) {
    overlayKey = key;
    els.overlayCard.innerHTML = html;
  }
  els.overlay.classList.add('is-visible');
  els.overlay.setAttribute('aria-hidden', 'false');
}

/* ------------------------------ renk seçimi ------------------------------- */

function currentRgb() {
  return hsvToRgb(selection.h, selection.s, selection.v);
}

function updatePickPreview() {
  if (!selection.active) {
    els.pickSwatch.classList.remove('has-color');
    els.pickSwatch.style.backgroundColor = '';
    els.pickSwatch.style.boxShadow = '';
    els.pickHex.textContent = 'Renk seç';
    return;
  }

  const hex = rgbToHex(currentRgb());
  els.pickSwatch.classList.add('has-color');
  els.pickSwatch.style.backgroundColor = hex;
  els.pickSwatch.style.boxShadow = `inset 0 0 0 1px rgba(0,0,0,.2), 0 0 22px -6px ${hex}`;
  els.pickHex.textContent = hex.toUpperCase();
}

function updateValueGradient() {
  const top = selection.active
    ? rgbToHex(hsvToRgb(selection.h, selection.s, 1))
    : '#ffffff';
  els.valueSlider.style.background = `linear-gradient(90deg, #000000 0%, ${top} 100%)`;
  els.valueLabel.textContent = `%${Math.round(selection.v * 100)}`;
}

function sendGuess() {
  if (!state || state.phase !== 'guessing' || selectionLocked || !selection.active) return;
  const rgb = currentRgb();
  socket.emit('guess', { r: rgb.r, g: rgb.g, b: rgb.b });
}

function queueGuess() {
  if (!state || state.phase !== 'guessing' || selectionLocked || !selection.active) return;
  if (guessTimer) return;
  guessTimer = window.setTimeout(() => {
    guessTimer = null;
    sendGuess();
  }, 60);
}

function flushGuess() {
  resetGuessTimer();
  sendGuess();
}

function lockGuess() {
  if (!state || state.phase !== 'guessing' || selectionLocked || !selection.active) return;

  flushGuess();
  selectionLocked = true;
  socket.emit('lock_guess');
  updateControls(state);
  updateCaption(state);
}

els.valueSlider.addEventListener('input', () => {
  selection.v = clamp(Number(els.valueSlider.value) / 100, 0, 1);
  updateValueGradient();
  updatePickPreview();
  if (selection.active) queueGuess();
});

els.btnLock.addEventListener('click', lockGuess);

/* ------------------------------- çark kontrolü ----------------------------- */

function wheelCoordinates(event) {
  const rect = els.canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function applyPointerSelection(event, clampToEdge) {
  if (!state || state.phase !== 'guessing' || selectionLocked) return false;
  const me = state.players.find((player) => player.id === socket.id);
  if (me && me.locked) return false;

  const point = wheelCoordinates(event);
  const dx = point.x - wheelView.cx;
  const dy = point.y - wheelView.cy;
  const distance = Math.hypot(dx, dy);

  if (distance > wheelView.r + 10 && !clampToEdge) return false;

  selection.h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  selection.s = clamp(distance / wheelView.r, 0, 1);
  selection.active = true;

  updatePickPreview();
  updateValueGradient();
  queueGuess();
  if (state) updateControls(state);
  return true;
}

els.canvas.addEventListener('pointerdown', (event) => {
  if (applyPointerSelection(event, false)) {
    wheelDragging = true;
    wheelPointerId = event.pointerId;
    els.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
});

els.canvas.addEventListener('pointermove', (event) => {
  if (!wheelDragging || event.pointerId !== wheelPointerId) return;
  applyPointerSelection(event, true);
  event.preventDefault();
});

function endWheelDrag(event) {
  if (!wheelDragging || (event && event.pointerId !== wheelPointerId)) return;
  wheelDragging = false;
  wheelPointerId = null;
  flushGuess();
}

els.canvas.addEventListener('pointerup', endWheelDrag);
els.canvas.addEventListener('pointercancel', endWheelDrag);
els.canvas.addEventListener('lostpointercapture', endWheelDrag);
els.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

/* -------------------------------- çark çizimi ----------------------------- */

function resizeWheel() {
  const rect = els.stage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);

  if (els.canvas.width !== pixelWidth || els.canvas.height !== pixelHeight) {
    els.canvas.width = pixelWidth;
    els.canvas.height = pixelHeight;
  }

  const availableWidth = width - 28;
  const availableHeight = height - 72;
  const radius = Math.max(40, Math.min(availableWidth / 2, availableHeight / 2));

  wheelView.cssW = width;
  wheelView.cssH = height;
  wheelView.dpr = dpr;
  wheelView.cx = width / 2;
  wheelView.cy = (height - 36) / 2;
  wheelView.r = radius;
}

function buildWheelBase() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const data = image.data;
  const center = size / 2;
  const radius = size / 2 - 1;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const distance = Math.hypot(dx, dy);

      if (distance > radius) continue;

      const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const saturation = Math.min(1, distance / radius);
      const rgb = hsvToRgb(hue, saturation, 1);
      const alpha = distance > radius - 1.5
        ? Math.round(clamp(radius - distance, 0, 1) * 255)
        : 255;

      const index = (y * size + x) * 4;
      data[index] = rgb.r;
      data[index + 1] = rgb.g;
      data[index + 2] = rgb.b;
      data[index + 3] = alpha;
    }
  }

  context.putImageData(image, 0, 0);
  wheelBase = canvas;
}

function hueSatPoint(hue, saturation) {
  const angle = (hue * Math.PI) / 180;
  return {
    x: wheelView.cx + Math.cos(angle) * saturation * wheelView.r,
    y: wheelView.cy + Math.sin(angle) * saturation * wheelView.r,
  };
}

function drawLabelPill(text, x, y, options = {}) {
  const fontSize = options.fontSize || 9;
  const height = options.height || 17;
  ctx.font = `700 ${fontSize}px ${FONT}`;
  const width = ctx.measureText(text).width + 14;

  const left = clamp(x - width / 2, 6, wheelView.cssW - width - 6);
  const top = clamp(y, 6, wheelView.cssH - height - 6);

  const radius = height / 2;
  ctx.beginPath();
  ctx.moveTo(left + radius, top);
  ctx.lineTo(left + width - radius, top);
  ctx.quadraticCurveTo(left + width, top, left + width, top + radius);
  ctx.lineTo(left + width, top + height - radius);
  ctx.quadraticCurveTo(left + width, top + height, left + width - radius, top + height);
  ctx.lineTo(left + radius, top + height);
  ctx.quadraticCurveTo(left, top + height, left, top + height - radius);
  ctx.lineTo(left, top + radius);
  ctx.quadraticCurveTo(left, top, left + radius, top);
  ctx.closePath();
  ctx.fillStyle = options.background || 'rgba(6,10,20,0.78)';
  ctx.fill();
  ctx.strokeStyle = options.border || 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = options.color || '#f8fafc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + width / 2, top + height / 2 + 0.5);
}

function drawGuessMarker(x, y, hex, playerColor, letter, options = {}) {
  const radius = options.radius || 11;
  const time = options.time || 0;

  ctx.save();

  if (options.winner) {
    const pulse = 2 + Math.sin(time * 4) * 1.5;
    ctx.beginPath();
    ctx.arc(x, y, radius + 6 + pulse, 0, TAU);
    ctx.strokeStyle = 'rgba(255,209,102,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(x, y, radius + 3, 0, TAU);
  ctx.fillStyle = rgba(playerColor, 0.2);
  ctx.fill();
  ctx.strokeStyle = playerColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fillStyle = hex;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.stroke();

  ctx.fillStyle = contrastColor(hex);
  ctx.font = `800 ${Math.max(9, radius * 0.85)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, x, y + 0.5);

  if (options.rank && options.rank <= 4) {
    const badgeRadius = Math.max(6, radius * 0.58);
    const badgeX = x + radius * 0.82;
    const badgeY = y - radius * 0.82;

    ctx.beginPath();
    ctx.arc(badgeX, badgeY, badgeRadius, 0, TAU);
    ctx.fillStyle = options.rank === 1 ? '#ffd166' : 'rgba(241,245,249,0.95)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(6,10,20,0.7)';
    ctx.stroke();

    ctx.fillStyle = '#101728';
    ctx.font = `800 ${Math.max(7, badgeRadius)}px ${FONT}`;
    ctx.fillText(String(options.rank), badgeX, badgeY + 0.5);
  }

  if (options.locked) {
    const badgeRadius = Math.max(5, radius * 0.48);
    const badgeX = x + radius * 0.78;
    const badgeY = y + radius * 0.78;

    ctx.beginPath();
    ctx.arc(badgeX, badgeY, badgeRadius, 0, TAU);
    ctx.fillStyle = '#b8f23d';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(6,10,20,0.65)';
    ctx.stroke();

    ctx.fillStyle = '#101728';
    ctx.font = `800 ${Math.max(7, badgeRadius)}px ${FONT}`;
    ctx.fillText('✓', badgeX, badgeY + 0.5);
  }

  ctx.restore();
}

function drawTargetMarker(x, y, hex, radius, time) {
  ctx.save();

  const pulse = 1.5 + Math.sin(time * 3) * 1.2;

  ctx.beginPath();
  ctx.arc(x, y, radius + 13 + pulse, 0, TAU);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Hedefi dolu bir nokta yerine halka olarak çiziyoruz; böylece
  // hedefe denk gelen oyuncu işareti de görünür kalıyor.
  ctx.beginPath();
  ctx.arc(x, y, radius + 5, 0, TAU);
  ctx.lineWidth = 9;
  ctx.strokeStyle = 'rgba(5,8,16,0.82)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, radius + 5, 0, TAU);
  ctx.lineWidth = 6;
  ctx.strokeStyle = hex;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, radius + 9, 0, TAU);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, radius + 1, 0, TAU);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, 2.6, 0, TAU);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.stroke();

  ctx.restore();
}

function drawTargetLabel(x, y, radius) {
  const labelBelow = y - radius - 34 < 6;
  drawLabelPill(
    'HEDEF',
    x,
    labelBelow ? y + radius + 14 : y - radius - 35,
    { fontSize: 9, height: 17, background: 'rgba(5,8,16,0.86)', border: 'rgba(255,255,255,0.45)' },
  );
}

function drawWheel(time) {
  const { cssW, cssH, dpr, cx, cy, r } = wheelView;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  if (!state || state.phase === 'lobby' || r <= 0) return;

  if (state.target) {
    const glow = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r * 1.35);
    glow.addColorStop(0, rgba(state.target.hex, 0.13));
    glow.addColorStop(0.65, rgba(state.target.hex, 0.04));
    glow.addColorStop(1, rgba(state.target.hex, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  const reveal = state.phase === 'reveal' || state.phase === 'gameover';
  const wheelValue = reveal ? 1 : selection.v;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.clip();
  if (wheelBase) {
    ctx.drawImage(wheelBase, cx - r, cy - r, r * 2, r * 2);
  }
  if (wheelValue < 1) {
    ctx.fillStyle = `rgba(2,4,10,${1 - wheelValue})`;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r + 9, 0, TAU);
  ctx.setLineDash([2, 9]);
  ctx.lineDashOffset = -time * 8;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.stroke();
  ctx.setLineDash([]);

  const markerRadius = clamp(r * 0.06, 9, 13);

  if (reveal) {
    const target = state.target;
    const targetPoint = target ? hueSatPoint(rgbToHsv(target).h, rgbToHsv(target).s) : null;

    if (targetPoint) {
      ctx.save();
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1.4;
      for (const result of state.results) {
        if (!result.guess) continue;
        const hsv = rgbToHsv(result.guess);
        const point = hueSatPoint(hsv.h, hsv.s);
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(targetPoint.x, targetPoint.y);
        ctx.strokeStyle = rgba(result.playerColor, 0.36);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (targetPoint && target) {
      drawTargetMarker(targetPoint.x, targetPoint.y, target.hex, markerRadius + 4, time);
    }

    for (const result of state.results) {
      if (!result.guess) continue;
      const hsv = rgbToHsv(result.guess);
      const point = hueSatPoint(hsv.h, hsv.s);
      drawGuessMarker(point.x, point.y, result.hex, result.playerColor, initial(result.name), {
        radius: markerRadius,
        rank: result.place,
        winner: result.place === 1,
        time,
      });
    }

    if (targetPoint && target) {
      drawTargetLabel(targetPoint.x, targetPoint.y, markerRadius + 4);
    }
  } else if (state.phase === 'guessing' && selection.active) {
    const own = state.players.find((player) => player.id === socket.id);
    const point = hueSatPoint(selection.h, selection.s);
    const hex = rgbToHex(currentRgb());

    ctx.beginPath();
    ctx.arc(point.x, point.y, markerRadius + 8, 0, TAU);
    ctx.strokeStyle = rgba(own ? own.color : '#ffffff', 0.35);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    drawGuessMarker(point.x, point.y, hex, own ? own.color : '#ffffff', initial(own ? own.name : 'S'), {
      radius: markerRadius,
      locked: selectionLocked,
      time,
    });

    drawLabelPill(
      'SEN',
      point.x,
      point.y - markerRadius - 24,
      { fontSize: 9, height: 16 },
    );
  }
}

function frame(now) {
  const time = now / 1000;

  if (currentScreen !== 'game' || !state || state.phase === 'lobby') {
    if (wheelView.cssW) {
      ctx.setTransform(wheelView.dpr, 0, 0, wheelView.dpr, 0, 0);
      ctx.clearRect(0, 0, wheelView.cssW, wheelView.cssH);
    }
    window.requestAnimationFrame(frame);
    return;
  }

  if (!wheelView.cssW) resizeWheel();
  drawWheel(time);

  window.requestAnimationFrame(frame);
}

/* --------------------------------- başlangıç ------------------------------ */

try {
  const savedName = window.localStorage.getItem('renk-carki-name');
  if (savedName) els.nameInput.value = savedName;
} catch {
  /* storage yoksa önemli değil */
}

updateValueGradient();
buildWheelBase();

const resizeObserver = new ResizeObserver(() => resizeWheel());
resizeObserver.observe(els.stage);
window.addEventListener('resize', resizeWheel);
window.requestAnimationFrame(frame);
