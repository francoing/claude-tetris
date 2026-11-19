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
const skinSelect = document.getElementById('skin-select');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, rewardPending;

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
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    if (cleared === 4) rewardPending = true; // Tetris → la próxima pieza es el 1x1
    updateHUD();
  }
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
  clearLines();
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
}

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
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
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
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  rewardPending = false;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  // Si el foco está en un control del panel (p. ej. el selector de skin), las teclas
  // son para ese control y no para la partida.
  const t = e.target;
  if (t && typeof t.closest === 'function' && t.closest('select, button, input, textarea')) return;
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

function applySkin(name, persist) {
  const key = Object.prototype.hasOwnProperty.call(SKINS, name) ? name : 'retro';
  activeSkin = SKINS[key];
  skinSelect.value = key;
  if (persist !== false) {
    try { localStorage.setItem('tetris-skin', key); } catch (e) {}
  }
  // Redibujar (el loop está cancelado en pausa / game over)
  draw();
  drawNext();
}

skinSelect.addEventListener('change', () => {
  applySkin(skinSelect.value);
  skinSelect.blur(); // evita que Space sobre el selector dispare una caída
});

init();
applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

let savedSkin = 'retro';
try { savedSkin = localStorage.getItem('tetris-skin') || 'retro'; } catch (e) {}
applySkin(savedSkin, false);
