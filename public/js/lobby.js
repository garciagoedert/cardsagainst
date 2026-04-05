/* lobby.js — Lobby page logic */
const socket = io();

// ─── Tab Switching ───────────────────────────────────────────
const tabCreate = document.getElementById('tab-create');
const tabJoin   = document.getElementById('tab-join');
const panelCreate = document.getElementById('panel-create');
const panelJoin   = document.getElementById('panel-join');

function switchTab(tab) {
  if (tab === 'create') {
    tabCreate.classList.add('tab-btn--active');
    tabJoin.classList.remove('tab-btn--active');
    tabCreate.setAttribute('aria-selected', 'true');
    tabJoin.setAttribute('aria-selected', 'false');
    panelCreate.classList.add('tab-panel--active');
    panelJoin.classList.remove('tab-panel--active');
  } else {
    tabJoin.classList.add('tab-btn--active');
    tabCreate.classList.remove('tab-btn--active');
    tabJoin.setAttribute('aria-selected', 'true');
    tabCreate.setAttribute('aria-selected', 'false');
    panelJoin.classList.add('tab-panel--active');
    panelCreate.classList.remove('tab-panel--active');
  }
}

tabCreate.addEventListener('click', () => switchTab('create'));
tabJoin.addEventListener('click', () => switchTab('join'));

// ─── Range slider display ────────────────────────────────────
const winSlider = document.getElementById('win-points');
const winDisplay = document.getElementById('win-points-display');
winSlider.addEventListener('input', () => { winDisplay.textContent = winSlider.value; });

// ─── Error display ───────────────────────────────────────────
const errorEl = document.getElementById('lobby-error');

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add('error-toast--visible');
  setTimeout(() => errorEl.classList.remove('error-toast--visible'), 4000);
}

// ─── Create Room ─────────────────────────────────────────────
const formCreate = document.getElementById('form-create');
formCreate.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('create-name').value.trim();
  if (!name) return showError('Digite seu apelido.');

  const btn = document.getElementById('btn-create');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Criando sala...';

  socket.emit('create_room', { name, winPoints: parseInt(winSlider.value) }, (res) => {
    if (res.success) {
      // Save session
      sessionStorage.setItem('playerId', res.playerId);
      sessionStorage.setItem('roomCode', res.roomCode);
      sessionStorage.setItem('playerName', name);
      window.location.href = `/game.html`;
    } else {
      showError(res.error || 'Erro ao criar sala.');
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Criar Sala';
    }
  });
});

// ─── Join Room ───────────────────────────────────────────────
const formJoin = document.getElementById('form-join');
const roomCodeInput = document.getElementById('room-code');

roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

formJoin.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('join-name').value.trim();
  const roomCode = roomCodeInput.value.trim().toUpperCase();
  if (!name) return showError('Digite seu apelido.');
  if (roomCode.length !== 4) return showError('O código tem 4 caracteres.');

  const btn = document.getElementById('btn-join');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Entrando...';

  socket.emit('join_room', { name, roomCode }, (res) => {
    if (res.success) {
      sessionStorage.setItem('playerId', res.playerId);
      sessionStorage.setItem('roomCode', res.roomCode);
      sessionStorage.setItem('playerName', name);
      window.location.href = `/game.html`;
    } else {
      showError(res.error || 'Erro ao entrar na sala.');
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Entrar na Sala';
    }
  });
});

// ─── Check if already in a session ──────────────────────────
const savedRoom = sessionStorage.getItem('roomCode');
const savedId   = sessionStorage.getItem('playerId');
if (savedRoom && savedId) {
  // Pre-fill code
  roomCodeInput.value = savedRoom;
  switchTab('join');
}
