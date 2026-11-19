'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - azul pálido
  '#ffb74d', // L - orange
  '#f06292', // + (plus, pentominó) - rosa
  '#4db6ac', // U (pentominó) - teal
  '#dce775', // Y (pentominó) - lima
  '#e0e0e0', // single 1x1 (recompensa) - plata
  '#a1887f', // 3x3 hueca (reto) - marrón
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[0,8,0],[8,8,8],[0,8,0]],                  // + (plus, pentominó)
  [[9,0,9],[9,9,9],[0,0,0]],                  // U (pentominó)
  [[0,10,0,0],[10,10,0,0],[0,10,0,0],[0,10,0,0]], // Y (pentominó)
  [[11]],                                      // single 1x1 (recompensa)
  [[12,12,12],[12,0,12],[12,12,12]],          // 3x3 hueca (reto)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

// Pools de piezas. El índice es a la vez tipo, color y valor de celda.
const TETROMINOS = [1, 2, 3, 4, 5, 6, 7];
const PENTOMINOS = [8, 9, 10];   // +, U, Y
const SINGLE = 11;               // recompensa tras un Tetris (no sale del pool aleatorio)
const HOLLOW = 12;               // reto: 3x3 hueca

const PENTOMINO_CHANCE = 0.15;   // probabilidad de +, U o Y
const HOLLOW_CHANCE = 0.05;      // probabilidad de la 3x3 hueca

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeBtn = document.getElementById('theme-toggle');
const startScreen = document.getElementById('start-screen');
const startLevelSel = document.getElementById('start-level');
const pauseLevelSel = document.getElementById('pause-level');
const playBtn = document.getElementById('play-btn');
const resumeBtn = document.getElementById('resume-btn');
const pauseRestartBtn = document.getElementById('pause-restart-btn');
const controlsBtn = document.getElementById('controls-btn');
const pauseControls = document.getElementById('pause-controls');
const highscoresStart = document.getElementById('highscores-start');

const MIN_LEVEL = 1;
const MAX_LEVEL = 10;

const skinSelect = document.getElementById('skin-select');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, rewardPending;
let started = false;   // la partida sólo arranca desde JUGAR o Reiniciar
let startLevel = 1;    // nivel con el que empieza la próxima partida

const highscoresEl = document.getElementById('highscores');
const bestComboEl = document.getElementById('best-combo');
const maxLinesEl = document.getElementById('max-lines');
const resetHighscoresBtn = document.getElementById('reset-highscores');
const gameoverExtra = document.getElementById('gameover-extra');
const highscoreEntry = document.getElementById('highscore-entry');
const playerNameInput = document.getElementById('player-name');
const saveScoreBtn = document.getElementById('save-score-btn');
const overlayHighscores = document.getElementById('overlay-highscores');

// Métricas de la partida en curso
let comboCount, bestCombo, maxLineClear;
// Entrada pendiente de guardar en la tabla de records (null si no procede)
let pendingEntry = null;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomType() {
  if (rewardPending) {
    rewardPending = false;
    return SINGLE;
  }
  const r = Math.random();
  if (r < HOLLOW_CHANCE) return HOLLOW;
  if (r < HOLLOW_CHANCE + PENTOMINO_CHANCE)
    return PENTOMINOS[Math.floor(Math.random() * PENTOMINOS.length)];
  return TETROMINOS[Math.floor(Math.random() * TETROMINOS.length)];
}

function randomPiece() {
  const type = randomType();
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

// Velocidad de caída para un nivel dado. Compartida por init() y clearLines() para que
// la fórmula no se duplique.
function speedFor(lv) {
  return Math.max(100, 1000 - (lv - 1) * 90);
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    comboCount++;
    if (comboCount > bestCombo) bestCombo = comboCount;
    if (cleared > maxLineClear) maxLineClear = cleared;
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    // Parte del nivel inicial elegido: si no, empezar en el 10 te devolvía al 1.
    level = startLevel + Math.floor(lines / 10);
    dropInterval = speedFor(level);
    if (cleared === 4) rewardPending = true; // Tetris → la próxima pieza es el 1x1
    updateHUD();
  }
  return cleared;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (gameOver) return;
  merge();
  if (!clearLines()) comboCount = 0; // el combo se corta si el fijado no limpió nada
  updateHUD();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
    return;
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  bestComboEl.textContent = bestCombo;
  maxLinesEl.textContent = maxLineClear;
}

/* ---- Tabla de records (localStorage) ---- */

const HS_KEY = 'tetris-highscores';
const HS_MAX = 5;

function loadHighscores() {
  try {
    const raw = localStorage.getItem(HS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(e => e && typeof e === 'object')
      .map(e => ({
        name: typeof e.name === 'string' && e.name ? e.name : 'Anónimo',
        score: Number(e.score) || 0,
        lines: Number(e.lines) || 0,
        level: Number(e.level) || 1,
        combo: Number(e.combo) || 0,
        date: typeof e.date === 'string' ? e.date : '',
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, HS_MAX);
  } catch (e) {
    return [];
  }
}

function saveHighscores(list) {
  try { localStorage.setItem(HS_KEY, JSON.stringify(list)); } catch (e) {}
}

// ¿Esta puntuación entra en el top 5?
function qualifiesForHighscores(value) {
  if (!value || value <= 0) return false;
  const list = loadHighscores();
  return list.length < HS_MAX || value > list[list.length - 1].score;
}

// Inserta la entrada y devuelve su posición en el top (o -1 si no entró).
function addHighscore(entry) {
  const list = loadHighscores();
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const top = list.slice(0, HS_MAX);
  saveHighscores(top);
  return top.indexOf(entry);
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

// Pinta la tabla de records dentro del contenedor recibido.
// highlightIndex resalta la fila recién entrada (opcional).
function renderHighscores(el, highlightIndex) {
  if (!el) return;
  const list = loadHighscores();
  if (!list.length) {
    el.innerHTML = '<p class="highscores-empty">Todavía no hay records.</p>';
    return;
  }
  const rows = list.map((e, i) => {
    const cls = i === highlightIndex ? ' class="highscore-row--new"' : '';
    return `<tr${cls}>` +
      `<td class="hs-rank">${i + 1}</td>` +
      `<td class="hs-name">${escapeHTML(e.name)}</td>` +
      `<td class="hs-score">${e.score.toLocaleString()}</td>` +
      `<td class="hs-extra">${e.lines}</td>` +
      `<td class="hs-extra">${e.level}</td>` +
      `<td class="hs-extra">${e.combo}</td>` +
      `<td class="hs-extra hs-date">${escapeHTML(formatDate(e.date))}</td>` +
      '</tr>';
  }).join('');
  el.innerHTML = '<table class="highscores-table">' +
    '<thead><tr>' +
    '<th class="hs-rank">#</th><th class="hs-name">Nombre</th><th class="hs-score">SCORE</th>' +
    '<th class="hs-extra">LINES</th><th class="hs-extra">LEVEL</th>' +
    '<th class="hs-extra">COMBO</th><th class="hs-extra hs-date">Fecha</th>' +
    '</tr></thead>' +
    `<tbody>${rows}</tbody></table>`;
}

function showGameOverHighscores() {
  pendingEntry = null;
  if (qualifiesForHighscores(score)) {
    pendingEntry = {
      name: '',
      score: score,
      lines: lines,
      level: level,
      combo: bestCombo,
      date: new Date().toISOString(),
    };
    playerNameInput.value = '';
    highscoreEntry.classList.remove('hidden');
  } else {
    highscoreEntry.classList.add('hidden');
  }
  renderHighscores(overlayHighscores, -1);
  gameoverExtra.classList.remove('hidden');
  if (pendingEntry) playerNameInput.focus();
}

function savePendingHighscore() {
  if (!pendingEntry) return;
  saveScoreBtn.blur();
  const typed = playerNameInput.value.trim().slice(0, 12);
  pendingEntry.name = typed || 'Anónimo';
  const index = addHighscore(pendingEntry);
  pendingEntry = null;
  highscoreEntry.classList.add('hidden');
  renderHighscores(overlayHighscores, index);
  renderHighscores(highscoresEl);
  renderHighscores(highscoresStart);
}

function resetHighscores() {
  resetHighscoresBtn.blur(); // evita que Space sobre el botón dispare una caída
  if (!confirm('¿Borrar la tabla de records? Esta acción no se puede deshacer.')) return;
  try { localStorage.removeItem(HS_KEY); } catch (e) {}
  pendingEntry = null;
  highscoreEntry.classList.add('hidden');
  renderHighscores(highscoresEl);
  renderHighscores(highscoresStart);
  if (!gameoverExtra.classList.contains('hidden')) renderHighscores(overlayHighscores, -1);
}

// El contenedor es un <form>: así Enter en el campo guarda sin añadir otro listener de teclado.
highscoreEntry.addEventListener('submit', e => {
  e.preventDefault();
  savePendingHighscore();
});
resetHighscoresBtn.addEventListener('click', resetHighscores);

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ---- Skins ----
// Cada skin aporta una paleta alineada con COLORS/PIECES (índice 0 = null, 1 = pieza I)
// y una función de dibujo con la firma (context, x, y, colorIndex, size, alpha).
// Toda función de dibujo debe dejar el contexto como lo encontró (save/restore).

// Mezcla un color hex con blanco (amount > 0) o con negro (amount < 0).
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  r = Math.round(r + (target - r) * t);
  g = Math.round(g + (target - g) * t);
  b = Math.round(b + (target - b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

const NEON_PALETTE = [
  null,
  '#00e5ff', // I
  '#ffe600', // O
  '#d500f9', // T
  '#00ff85', // S
  '#ff1744', // Z
  '#2979ff', // J
  '#ff9100', // L
  '#ff00a0', // +
  '#00ffd0', // U
  '#c6ff00', // Y
  '#ffffff', // single 1x1
  '#ff6d00', // 3x3 hueca
];

const PASTEL_PALETTE = [
  null,
  '#b3e5fc', // I
  '#fff3b0', // O
  '#e1bee7', // T
  '#c8e6c9', // S
  '#ffcdd2', // Z
  '#c5cae9', // J
  '#ffe0b2', // L
  '#f8bbd0', // +
  '#b2dfdb', // U
  '#f0f4c3', // Y
  '#eceff1', // single 1x1
  '#d7ccc8', // 3x3 hueca
];

const PIXEL_PALETTE = [
  null,
  '#2eb8c6', // I
  '#e0b02e', // O
  '#9b52ad', // T
  '#5fae63', // S
  '#c75050', // Z
  '#5a7fc4', // J
  '#d98a2b', // L
  '#c94f7c', // +
  '#3d9b92', // U
  '#aebf4e', // Y
  '#bdbdbd', // single 1x1
  '#8d6e63', // 3x3 hueca
];

function drawBlockRetro(context, x, y, colorIndex, size, alpha) {
  const color = activeSkin.palette[colorIndex];
  context.save();
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = cssVar('--block-highlight');
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.restore();
}

function drawBlockNeon(context, x, y, colorIndex, size, alpha) {
  const color = activeSkin.palette[colorIndex];
  const px = x * size + 2;
  const py = y * size + 2;
  const s = size - 4;
  context.save();
  context.globalAlpha = alpha ?? 1;
  // Relleno oscuro con el tinte de la pieza
  context.shadowColor = color;
  context.shadowBlur = size * 0.4;
  context.fillStyle = shade(color, -0.6);
  context.fillRect(px, py, s, s);
  // Borde brillante (sin sombra: el glow ya lo aporta el relleno y el blur es caro)
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.strokeRect(px + 1, py + 1, s - 2, s - 2);
  context.restore();
}

function drawBlockPastel(context, x, y, colorIndex, size, alpha) {
  const color = activeSkin.palette[colorIndex];
  const px = x * size + 2;
  const py = y * size + 2;
  const s = size - 4;
  const radius = Math.max(2, Math.floor(size * 0.25));
  context.save();
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(px, py, s, s, radius);
  } else {
    // Fallback: esquinas redondeadas con arcos
    context.moveTo(px + radius, py);
    context.arcTo(px + s, py, px + s, py + s, radius);
    context.arcTo(px + s, py + s, px, py + s, radius);
    context.arcTo(px, py + s, px, py, radius);
    context.arcTo(px, py, px + s, py, radius);
    context.closePath();
  }
  context.fill();
  // Brillo suave arriba
  context.fillStyle = shade(color, 0.45);
  context.fillRect(px + radius, py + 2, s - radius * 2, Math.max(2, Math.floor(size * 0.1)));
  context.restore();
}

function drawBlockPixel(context, x, y, colorIndex, size, alpha) {
  const color = activeSkin.palette[colorIndex];
  const px = x * size + 1;
  const py = y * size + 1;
  const s = size - 2;
  const u = Math.max(2, Math.floor(size / 10)); // tamaño del "píxel" de textura
  context.save();
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(px, py, s, s);
  // Luz: borde superior e izquierdo
  context.fillStyle = shade(color, 0.4);
  context.fillRect(px, py, s, u);
  context.fillRect(px, py, u, s);
  // Sombra: borde inferior y derecho
  context.fillStyle = shade(color, -0.35);
  context.fillRect(px, py + s - u, s, u);
  context.fillRect(px + s - u, py, u, s);
  // Esquinas dentadas (quita el píxel de cada esquina)
  context.fillStyle = shade(color, -0.55);
  context.fillRect(px, py, u, u);
  context.fillRect(px + s - u, py, u, u);
  context.fillRect(px, py + s - u, u, u);
  context.fillRect(px + s - u, py + s - u, u, u);
  // Brillo interior tipo pixel art
  context.fillStyle = shade(color, 0.55);
  context.fillRect(px + u * 2, py + u * 2, u, u);
  context.fillRect(px + u * 3, py + u * 2, u, u);
  context.fillRect(px + u * 2, py + u * 3, u, u);
  context.restore();
}

const SKINS = {
  retro:  { label: 'Retro',     palette: COLORS,         draw: drawBlockRetro },
  neon:   { label: 'Neón',      palette: NEON_PALETTE,   draw: drawBlockNeon },
  pastel: { label: 'Pastel',    palette: PASTEL_PALETTE, draw: drawBlockPastel },
  pixel:  { label: 'Pixel art', palette: PIXEL_PALETTE,  draw: drawBlockPixel },
};

let activeSkin = SKINS.retro;

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  activeSkin.draw(context, x, y, colorIndex, size, alpha);
}

function drawGrid() {
  ctx.strokeStyle = cssVar('--grid');
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  if (gameOver) return;

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  animId = null;
  draw();
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()} · Mejor combo: ${bestCombo} · Líneas máx.: ${maxLineClear}`;
  overlay.classList.remove('hidden');
  showGameOverHighscores();
}

function togglePause() {
  if (!started || gameOver) return;
  paused = !paused;
  if (!paused) {
    overlay.classList.add('hidden');
    overlay.classList.remove('is-pause');
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    setControlsOpen(false);
    overlay.classList.add('is-pause');
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function loadStartLevel() {
  let v = 1;
  try {
    const raw = localStorage.getItem('startLevel');
    if (raw !== null) v = parseInt(raw, 10);
  } catch (e) {}
  if (!Number.isFinite(v)) v = 1;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, v));
}

function fillLevelSelect(sel) {
  for (let i = MIN_LEVEL; i <= MAX_LEVEL; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = String(i);
    sel.appendChild(opt);
  }
}

function setStartLevel(value) {
  const parsed = parseInt(value, 10);
  const v = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Number.isFinite(parsed) ? parsed : 1));
  startLevel = v;
  startLevelSel.value = String(v);
  pauseLevelSel.value = String(v);
  try { localStorage.setItem('startLevel', String(v)); } catch (e) {}
}

function setControlsOpen(open) {
  pauseControls.classList.toggle('hidden', !open);
  controlsBtn.setAttribute('aria-expanded', String(open));
  controlsBtn.textContent = open ? 'Ocultar controles' : 'Ver controles';
}

function init() {
  // Si quedó un record sin guardar (el jugador pulsó Reiniciar), se guarda antes de perderlo.
  if (pendingEntry) savePendingHighscore();
  board = createBoard();
  score = 0;
  lines = 0;
  level = startLevel;
  paused = false;
  gameOver = false;
  started = true;
  dropInterval = speedFor(startLevel);
  dropAccum = 0;
  rewardPending = false;
  comboCount = 0;
  bestCombo = 0;
  maxLineClear = 0;
  pendingEntry = null;
  gameoverExtra.classList.add('hidden');
  highscoreEntry.classList.add('hidden');
  renderHighscores(highscoresEl);
  lastTime = performance.now();
  overlay.classList.add('hidden');
  overlay.classList.remove('is-pause');
  startScreen.classList.add('hidden');
  setControlsOpen(false);
  cancelAnimationFrame(animId);
  next = randomPiece();
  spawn();
  updateHUD();
  if (gameOver) return; // spawn() pudo llamar a endGame(): no arrancar el loop
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  // Si el foco está en un control (selector de skin/nivel, campo de nombre, botón del
  // menú), las teclas son para ese control y no para la partida.
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.target instanceof HTMLButtonElement) return;
  if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
  if (!started || paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', () => {
  init();
  restartBtn.blur(); // evita que Space/Enter sobre el botón dispare una caída
});

playBtn.addEventListener('click', () => {
  setStartLevel(startLevelSel.value);
  init();
  playBtn.blur();
});

resumeBtn.addEventListener('click', () => {
  togglePause();
  resumeBtn.blur();
});

pauseRestartBtn.addEventListener('click', () => {
  init();
  pauseRestartBtn.blur();
});

controlsBtn.addEventListener('click', () => {
  setControlsOpen(pauseControls.classList.contains('hidden'));
  controlsBtn.blur();
});

// Se quita el foco del select tras elegir: con el select enfocado, el guard del
// listener de teclado ignoraría P/Esc y no se podría reanudar con el teclado.
startLevelSel.addEventListener('change', () => {
  setStartLevel(startLevelSel.value);
  startLevelSel.blur();
});

pauseLevelSel.addEventListener('change', () => {
  setStartLevel(pauseLevelSel.value);
  pauseLevelSel.blur();
});

function applyTheme(theme) {
  if (theme === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  themeBtn.textContent = theme === 'light' ? '🌙 Modo oscuro' : '☀️ Modo claro';
  try { localStorage.setItem('theme', theme); } catch (e) {}
  // Redibujar (el loop está cancelado en pausa / game over)
  if (started) {
    draw();
    drawNext();
  }
}

themeBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  themeBtn.blur(); // evita que Space sobre el botón dispare una caída
});

function applySkin(name, persist) {
  const key = Object.prototype.hasOwnProperty.call(SKINS, name) ? name : 'retro';
  activeSkin = SKINS[key];
  skinSelect.value = key;
  if (persist !== false) {
    try { localStorage.setItem('tetris-skin', key); } catch (e) {}
  }
  // Redibujar (el loop está cancelado en pausa / game over). En la pantalla de inicio
  // todavía no hay tablero, así que no hay nada que repintar.
  if (!started) return;
  draw();
  drawNext();
}

skinSelect.addEventListener('change', () => {
  applySkin(skinSelect.value);
  skinSelect.blur(); // evita que Space sobre el selector dispare una caída
});

renderHighscores(highscoresStart);
fillLevelSelect(startLevelSel);
fillLevelSelect(pauseLevelSel);
setStartLevel(loadStartLevel());
setControlsOpen(false);
applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

let savedSkin = 'retro';
try { savedSkin = localStorage.getItem('tetris-skin') || 'retro'; } catch (e) {}
applySkin(savedSkin, false);
