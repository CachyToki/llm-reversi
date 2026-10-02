// Shared Reversi rules (used by both the browser and the server).
export const EMPTY = '.';
export const BLACK = 'B';
export const WHITE = 'W';
export const SIZE = 8;
const COLS = 'abcdefgh';
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

export const opponent = (c) => (c === BLACK ? WHITE : BLACK);

export function initialBoard() {
  const b = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  b[3][3] = WHITE; b[3][4] = BLACK;
  b[4][3] = BLACK; b[4][4] = WHITE;
  return b;
}

export const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

export function flipsFor(board, r, c, color) {
  if (!inBounds(r, c) || board[r][c] !== EMPTY) return [];
  const opp = opponent(color);
  const flips = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let y = r + dr, x = c + dc;
    while (inBounds(y, x) && board[y][x] === opp) { line.push([y, x]); y += dr; x += dc; }
    if (line.length && inBounds(y, x) && board[y][x] === color) flips.push(...line);
  }
  return flips;
}

export function legalMoves(board, color) {
  const moves = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const f = flipsFor(board, r, c, color);
      if (f.length) moves.push({ row: r, col: c, flips: f.length });
    }
  return moves;
}

export function applyMove(board, r, c, color) {
  const flips = flipsFor(board, r, c, color);
  if (!flips.length) return null;
  const next = board.map((row) => row.slice());
  next[r][c] = color;
  for (const [y, x] of flips) next[y][x] = color;
  return { board: next, flips };
}

export function count(board) {
  let B = 0, W = 0;
  for (const row of board) for (const v of row) { if (v === BLACK) B++; else if (v === WHITE) W++; }
  return { B, W };
}

export const isGameOver = (board) =>
  legalMoves(board, BLACK).length === 0 && legalMoves(board, WHITE).length === 0;

// "d3" <-> {row: 2, col: 3}
export const toCoord = (r, c) => COLS[c] + (r + 1);
export function fromCoord(s) {
  const m = /^\s*([a-hA-H])\s*([1-8])\s*$/.exec(String(s ?? ''));
  return m ? { row: Number(m[2]) - 1, col: COLS.indexOf(m[1].toLowerCase()) } : null;
}

export function boardToText(board) {
  const lines = ['  a b c d e f g h'];
  board.forEach((row, r) => lines.push(`${r + 1} ${row.join(' ')}`));
  return lines.join('\n');
}

export function isValidBoard(board) {
  return Array.isArray(board) && board.length === SIZE &&
    board.every((row) => Array.isArray(row) && row.length === SIZE &&
      row.every((v) => v === EMPTY || v === BLACK || v === WHITE));
}
