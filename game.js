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
const highscoresEl = document.getElementById('highscores');
const bestComboEl = document.getElementById('best-combo');
const maxLinesEl = document.getElementById('max-lines');
const resetHighscoresBtn = document.getElementById('reset-highscores');
const gameoverExtra = document.getElementById('gameover-extra');
const highscoreEntry = document.getElementById('highscore-entry');
const playerNameInput = document.getElementById('player-name');
const saveScoreBtn = document.getElementById('save-score-btn');
const overlayHighscores = document.getElementById('overlay-highscores');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, rewardPending;
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
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
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
}

function resetHighscores() {
  resetHighscoresBtn.blur(); // evita que Space sobre el botón dispare una caída
  if (!confirm('¿Borrar la tabla de records? Esta acción no se puede deshacer.')) return;
  try { localStorage.removeItem(HS_KEY); } catch (e) {}
  pendingEntry = null;
  highscoreEntry.classList.add('hidden');
  renderHighscores(highscoresEl);
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

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = cssVar('--block-highlight');
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
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
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
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

function init() {
  // Si quedó un record sin guardar (el jugador pulsó Reiniciar), se guarda antes de perderlo.
  if (pendingEntry) savePendingHighscore();
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
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
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  // Space/Enter sobre un botón enfocado lo activan: no deben llegar al juego.
  if (e.target instanceof HTMLButtonElement) return;
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
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

restartBtn.addEventListener('click', init);

function applyTheme(theme) {
  if (theme === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  themeBtn.textContent = theme === 'light' ? '🌙 Modo oscuro' : '☀️ Modo claro';
  try { localStorage.setItem('theme', theme); } catch (e) {}
  // Redibujar (el loop está cancelado en pausa / game over)
  draw();
  drawNext();
}

themeBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  themeBtn.blur(); // evita que Space sobre el botón dispare una caída
});

init();
applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
