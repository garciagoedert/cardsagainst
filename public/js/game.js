/* game.js — Game page client logic */

// ─── Session ─────────────────────────────────────────────────
const myPlayerId = sessionStorage.getItem('playerId');
const myRoomCode = sessionStorage.getItem('roomCode');
const myName     = sessionStorage.getItem('playerName');

if (!myPlayerId || !myRoomCode) {
  window.location.href = '/';
}

// ─── Socket ──────────────────────────────────────────────────
const socket = io();

// ─── State ───────────────────────────────────────────────────
let myHand = [];
let selectedCards = [];
let room = null;
let countdownInterval = null;
let isCzar = false;
let hasSubmitted = false;

// ─── DOM refs ────────────────────────────────────────────────
const screens = {
  lobby:    document.getElementById('screen-lobby'),
  playing:  document.getElementById('screen-playing'),
  judging:  document.getElementById('screen-judging'),
  results:  document.getElementById('screen-results'),
  gameover: document.getElementById('screen-gameover'),
  ended:    document.getElementById('screen-gameover')
};

// ─── Helpers ─────────────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('screen--active'));
  const target = screens[name];
  if (target) target.classList.add('screen--active');
}

function showToast(msg, duration = 2500) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('toast--visible');
  setTimeout(() => toast.classList.remove('toast--visible'), duration);
}

function setPhaseLabel(text) {
  document.getElementById('hud-phase').textContent = text;
}

function getAvatarColor(index) {
  return `av-${index % 10}`;
}

function getInitials(name) {
  return name.slice(0, 2).toUpperCase();
}

// ─── Scoreboard ──────────────────────────────────────────────
function renderScoreboard(roomData) {
  const list = document.getElementById('scoreboard-list');
  const goal = document.getElementById('scoreboard-goal');
  list.innerHTML = '';

  roomData.players.forEach((p, idx) => {
    const isCzarPlayer = p.id === roomData.czarId;
    const isMe = p.id === myPlayerId;
    const li = document.createElement('li');
    li.className = [
      'score-item',
      isCzarPlayer ? 'score-item--czar' : '',
      isMe ? 'score-item--me' : '',
      !p.isConnected ? 'score-item--disconnected' : ''
    ].filter(Boolean).join(' ');

    li.innerHTML = `
      <div class="score-avatar ${getAvatarColor(idx)}">${getInitials(p.name)}</div>
      <span class="score-name">${p.name}${isMe ? ' (você)' : ''}</span>
      ${isCzarPlayer ? '<span class="score-badge">Czar</span>' : ''}
      <span class="score-points">${p.score}</span>
    `;
    list.appendChild(li);
  });

  goal.textContent = `Meta: ${roomData.winPoints} pontos`;
}

// ─── Lobby screen ─────────────────────────────────────────────
function renderLobby(roomData) {
  showScreen('lobby');
  setPhaseLabel('🎮 Lobby');

  document.getElementById('lobby-room-code-big').textContent = roomData.code;
  document.getElementById('hud-room-code').textContent = roomData.code;
  document.getElementById('hud-round').textContent = '-';

  const playerList = document.getElementById('lobby-players-list');
  playerList.innerHTML = '';
  roomData.players.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="player-dot"></span>${p.name}${p.id === myPlayerId ? ' (você)' : ''}${p.id === roomData.hostId ? ' 👑' : ''}`;
    playerList.appendChild(li);
  });

  const startBtn = document.getElementById('btn-start');
  const waitingMsg = document.getElementById('waiting-host-msg');

  if (roomData.hostId === myPlayerId) {
    startBtn.style.display = roomData.players.length >= 2 ? 'flex' : 'none';
    waitingMsg.style.display = 'none';
  } else {
    startBtn.style.display = 'none';
    waitingMsg.style.display = 'block';
  }
}

// ─── Playing screen ───────────────────────────────────────────
function renderPlaying(roomData) {
  showScreen('playing');
  setPhaseLabel('🃏 Escolhendo cartas...');

  document.getElementById('hud-round').textContent = roomData.round;

  isCzar = roomData.czarId === myPlayerId;
  hasSubmitted = roomData.players.find(p => p.id === myPlayerId)?.hasSubmitted || false;

  // Black card
  const bc = roomData.currentBlackCard;
  document.getElementById('black-card-text').textContent = bc.text;
  document.getElementById('black-card-pick').textContent = bc.pick > 1 ? `Escolha ${bc.pick}` : '';

  // Czar badge
  const czarPlayer = roomData.players.find(p => p.id === roomData.czarId);
  const czarBadge = document.getElementById('czar-badge');
  czarBadge.textContent = czarPlayer
    ? (roomData.czarId === myPlayerId ? '⚡ Você é o Czar esta rodada' : `⚡ Czar: ${czarPlayer.name}`)
    : '';

  // Status
  const statusEl = document.getElementById('play-status');
  const submittedCount = roomData.players.filter(p => p.hasSubmitted).length;
  const waitingCount = roomData.players.filter(p => p.id !== roomData.czarId && p.isConnected).length;

  if (isCzar) {
    statusEl.textContent = `Você é o Czar! Aguardando os outros jogadores... (${submittedCount}/${waitingCount})`;
    statusEl.classList.add('play-status--visible');
  } else if (hasSubmitted) {
    statusEl.textContent = `✅ Resposta enviada! Aguardando outros jogadores... (${submittedCount}/${waitingCount})`;
    statusEl.classList.add('play-status--visible');
  } else {
    statusEl.textContent = `${submittedCount}/${waitingCount} jogadores já responderam.`;
    statusEl.classList.add('play-status--visible');
  }

  // Hand cards
  renderHand(roomData);
}

function renderHand(roomData) {
  const pick = roomData.currentBlackCard?.pick || 1;
  const handEl = document.getElementById('hand-cards');
  const labelEl = document.getElementById('hand-label');
  const submitBtn = document.getElementById('btn-submit');
  const handArea = document.getElementById('hand-area');

  if (isCzar) {
    handArea.style.display = 'none';
    submitBtn.style.display = 'none';
    return;
  }

  handArea.style.display = 'block';
  labelEl.textContent = hasSubmitted
    ? 'Suas cartas (já enviado)'
    : `Sua mão — Selecione ${pick} carta${pick > 1 ? 's' : ''}`;

  handEl.innerHTML = '';
  myHand.forEach((cardText) => {
    const card = document.createElement('div');
    card.className = 'card card--white card--hand';
    if (hasSubmitted) card.classList.add('card--hand--disabled');
    if (selectedCards.includes(cardText)) card.classList.add('card--hand--selected');

    const textDiv = document.createElement('div');
    textDiv.className = 'card-text';
    textDiv.textContent = cardText;
    card.appendChild(textDiv);

    if (!hasSubmitted) {
      card.addEventListener('click', () => toggleCardSelection(cardText, pick));
    }
    handEl.appendChild(card);
  });

  if (!hasSubmitted && selectedCards.length === pick) {
    submitBtn.style.display = 'flex';
  } else if (hasSubmitted) {
    submitBtn.style.display = 'none';
  } else {
    submitBtn.style.display = 'none';
  }
}

function toggleCardSelection(cardText, pick) {
  if (selectedCards.includes(cardText)) {
    selectedCards = selectedCards.filter(c => c !== cardText);
  } else {
    if (selectedCards.length >= pick) {
      if (pick === 1) selectedCards = [cardText];
      else return; // Can't select more than pick
    } else {
      selectedCards.push(cardText);
    }
  }

  // Re-render hand
  const handEl = document.getElementById('hand-cards');
  handEl.querySelectorAll('.card--hand').forEach((card, i) => {
    const cardText = card.querySelector('.card-text').textContent;
    if (selectedCards.includes(cardText)) {
      card.classList.add('card--hand--selected');
    } else {
      card.classList.remove('card--hand--selected');
    }
  });

  const submitBtn = document.getElementById('btn-submit');
  submitBtn.style.display = selectedCards.length === pick ? 'flex' : 'none';
}

// ─── Judging screen ───────────────────────────────────────────
function renderJudging(roomData) {
  showScreen('judging');
  setPhaseLabel('⚖️ Julgamento');
  document.getElementById('hud-round').textContent = roomData.round;

  const bc = roomData.currentBlackCard;
  document.getElementById('black-card-judge-text').textContent = bc.text;

  const judgePrompt = document.getElementById('judge-prompt');
  const grid = document.getElementById('submissions-grid');
  grid.innerHTML = '';

  if (roomData.czarId === myPlayerId) {
    judgePrompt.textContent = '👑 Você é o Czar! Clique na resposta mais engraçada.';
  } else {
    judgePrompt.textContent = '⏳ O Czar está escolhendo o vencedor...';
  }

  roomData.submissions.forEach(sub => {
    const pile = document.createElement('div');
    pile.className = 'submission-pile';

    sub.cards.forEach(cardText => {
      const card = document.createElement('div');
      card.className = 'card card--white';
      card.style.minWidth = '160px';
      card.style.minHeight = '200px';
      card.style.padding = '1rem';
      const textDiv = document.createElement('div');
      textDiv.className = 'card-text';
      textDiv.style.fontSize = '0.95rem';
      textDiv.textContent = cardText;
      card.appendChild(textDiv);
      pile.appendChild(card);
    });

    if (roomData.czarId === myPlayerId) {
      pile.style.cursor = 'pointer';
      pile.addEventListener('click', () => {
        document.querySelectorAll('.submission-pile').forEach(p => p.classList.remove('submission-pile--winner'));
        pile.classList.add('submission-pile--winner');
        socket.emit('pick_winner', { winnerId: sub.playerId });
      });
    }

    grid.appendChild(pile);
  });
}

// ─── Results screen ───────────────────────────────────────────
function renderResults(data) {
  const { winnerId, winnerName, reveal, room: roomData } = data;
  showScreen('results');
  setPhaseLabel('🎉 Resultado');

  document.getElementById('results-winner-name').textContent = winnerName;

  const revealEl = document.getElementById('results-reveal');
  revealEl.innerHTML = '';
  reveal.forEach(item => {
    const wrapper = document.createElement('div');
    wrapper.className = 'reveal-item';

    item.cards.forEach(cardText => {
      const card = document.createElement('div');
      card.className = 'card card--white';
      card.style.minWidth = '150px';
      card.style.maxWidth = '180px';
      card.style.minHeight = '180px';
      card.style.padding = '1rem';
      card.style.fontSize = '0.85rem';
      if (item.playerId === winnerId) {
        card.style.boxShadow = '0 0 0 3px var(--accent), 0 20px 40px rgba(255,215,0,0.2)';
      }
      card.innerHTML = `<div class="card-text" style="font-size:0.85rem">${cardText}</div>`;
      wrapper.appendChild(card);
    });

    const name = document.createElement('div');
    name.className = 'reveal-player-name';
    name.textContent = item.playerName + (item.playerId === winnerId ? ' 🏆' : '');
    wrapper.appendChild(name);

    revealEl.appendChild(wrapper);
  });

  // Countdown
  let count = 5;
  const countdownEl = document.getElementById('countdown');
  countdownEl.textContent = count;
  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    count--;
    countdownEl.textContent = count;
    if (count <= 0) clearInterval(countdownInterval);
  }, 1000);
}

// ─── Game Over screen ─────────────────────────────────────────
function renderGameOver(data) {
  const { winner, reveal, room: roomData } = data;
  showScreen('gameover');
  setPhaseLabel('🏆 Fim de Jogo');

  document.getElementById('gameover-winner').textContent = `${winner.name} venceu! 🎉`;

  const revealEl = document.getElementById('gameover-reveal');
  revealEl.innerHTML = '';

  const finalScores = document.getElementById('gameover-final-scores');
  finalScores.innerHTML = '<div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--gray-500);margin-bottom:0.5rem">Placar Final</div>';

  const sorted = [...roomData.players].sort((a, b) => b.score - a.score);
  sorted.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = `final-score-row ${p.id === winner.id ? 'final-score-row--winner' : ''}`;
    row.innerHTML = `
      <span>${i + 1}. ${p.name}${p.id === myPlayerId ? ' (você)' : ''}</span>
      <span style="font-weight:800;color:var(--accent)">${p.score} pts</span>
    `;
    finalScores.appendChild(row);
  });

  const restartBtn = document.getElementById('btn-restart');
  restartBtn.style.display = roomData.hostId === myPlayerId ? 'flex' : 'none';
}

// ─── Socket Events ────────────────────────────────────────────

socket.on('connect', () => {
  // Rejoin with session data
  socket.emit('join_room', { name: myName, roomCode: myRoomCode, playerId: myPlayerId }, (res) => {
    if (!res.success) {
      showToast('❌ ' + (res.error || 'Erro ao reconectar'));
      setTimeout(() => window.location.href = '/', 2000);
    }
  });
});

socket.on('room_update', (roomData) => {
  room = roomData;
  document.getElementById('hud-room-code').textContent = roomData.code;
  renderScoreboard(roomData);

  if (roomData.phase === 'lobby') {
    renderLobby(roomData);
  }
});

socket.on('round_start', (roomData) => {
  room = roomData;
  selectedCards = [];
  hasSubmitted = false;
  renderScoreboard(roomData);
  renderPlaying(roomData);
  document.getElementById('hud-round').textContent = roomData.round;
});

socket.on('your_hand', (hand) => {
  myHand = hand;
  if (room && room.phase === 'playing') {
    renderHand(room);
  }
});

socket.on('judging_phase', (roomData) => {
  room = roomData;
  renderScoreboard(roomData);
  renderJudging(roomData);
});

socket.on('round_results', (data) => {
  room = data.room;
  renderScoreboard(data.room);
  renderResults(data);
});

socket.on('game_over', (data) => {
  room = data.room;
  renderScoreboard(data.room);
  renderGameOver(data);
});

socket.on('error_msg', (msg) => {
  showToast('❌ ' + msg, 3000);
});

// ─── UI Interactions ──────────────────────────────────────────

// Start game button
document.getElementById('btn-start').addEventListener('click', () => {
  socket.emit('start_game');
});

// Submit cards button
document.getElementById('btn-submit').addEventListener('click', () => {
  if (selectedCards.length === 0) return;
  socket.emit('submit_cards', { cards: selectedCards });
  hasSubmitted = true;
  selectedCards = [];
  if (room) renderPlaying(room);
  showToast('✅ Carta(s) enviada(s)!');
});

// Copy room code (HUD)
document.getElementById('btn-copy-code').addEventListener('click', () => {
  navigator.clipboard?.writeText(myRoomCode);
  showToast('📋 Código copiado!');
});

// Copy room code (big)
document.getElementById('btn-copy-big').addEventListener('click', () => {
  navigator.clipboard?.writeText(myRoomCode);
  showToast('📋 Código copiado!');
});

// Restart
document.getElementById('btn-restart').addEventListener('click', () => {
  socket.emit('restart_game');
});

// Leave
document.getElementById('btn-leave').addEventListener('click', () => {
  sessionStorage.clear();
  window.location.href = '/';
});
