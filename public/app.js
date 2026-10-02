import {
  BLACK, WHITE, SIZE, opponent, initialBoard, legalMoves, applyMove, count, isGameOver, toCoord,
} from './reversi.js';

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const statusEl = $('status');

const state = {
  board: initialBoard(),
  turn: BLACK,
  human: BLACK,
  persona: 'friendly',
  playing: false,
  busy: false,
  last: null,       // {row, col}
  flipped: [],      // [[r, c], ...] for animation
  placed: null,
  gameId: 0,        // discards stale AI responses after a restart
};

const colorName = (c) => (c === BLACK ? '黒' : '白');

// ---------- rendering ----------
const cells = [];
for (let r = 0; r < SIZE; r++) {
  for (let c = 0; c < SIZE; c++) {
    const btn = document.createElement('button');
    btn.className = 'cell';
    btn.setAttribute('role', 'gridcell');
    btn.setAttribute('aria-label', toCoord(r, c));
    btn.addEventListener('click', () => onHumanClick(r, c));
    boardEl.appendChild(btn);
    cells.push(btn);
  }
}

function render() {
  const humanTurn = state.playing && !state.busy && state.turn === state.human;
  const legal = humanTurn ? legalMoves(state.board, state.human) : [];
  const legalSet = new Set(legal.map((m) => m.row * SIZE + m.col));
  const flippedSet = new Set(state.flipped.map(([r, c]) => r * SIZE + c));

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const i = r * SIZE + c;
      const cell = cells[i];
      const v = state.board[r][c];
      cell.className = 'cell';
      if (legalSet.has(i)) cell.classList.add('legal');
      if (state.last && state.last.row === r && state.last.col === c) cell.classList.add('last');
      cell.innerHTML = '';
      if (v !== '.') {
        const p = document.createElement('div');
        p.className = `piece ${v}`;
        if (flippedSet.has(i)) p.classList.add('flip');
        if (state.placed && state.placed.row === r && state.placed.col === c) p.classList.add('placed');
        cell.appendChild(p);
      }
    }
  }
  state.flipped = [];
  state.placed = null;

  const { B, W } = count(state.board);
  $('countB').textContent = B;
  $('countW').textContent = W;
  $('scoreB').classList.toggle('turn', state.playing && state.turn === BLACK);
  $('scoreW').classList.toggle('turn', state.playing && state.turn === WHITE);
}

function setStatus(text, thinking = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('thinking', thinking);
}

function say(text) {
  if (!text) return;
  $('comment').textContent = text;
  $('bubble').hidden = false;
}

function logMove(color, label) {
  const li = document.createElement('li');
  li.textContent = `${color === BLACK ? '●' : '○'} ${label}`;
  $('log').appendChild(li);
}

// ---------- game flow ----------
function play(r, c, color) {
  const result = applyMove(state.board, r, c, color);
  if (!result) return false;
  state.board = result.board;
  state.flipped = result.flips;
  state.placed = { row: r, col: c };
  state.last = { row: r, col: c };
  logMove(color, toCoord(r, c));
  return true;
}

function finishGame() {
  state.playing = false;
  const { B, W } = count(state.board);
  const humanScore = state.human === BLACK ? B : W;
  const aiScore = state.human === BLACK ? W : B;
  let msg = `終局 — 黒 ${B} : 白 ${W}  `;
  msg += humanScore > aiScore ? 'あなたの勝ち！🎉' : humanScore < aiScore ? 'AIの勝ち…' : '引き分け';
  setStatus(msg);
  render();
}

async function nextTurn() {
  render();
  if (isGameOver(state.board)) return finishGame();

  if (!legalMoves(state.board, state.turn).length) {
    logMove(state.turn, 'パス');
    const who = state.turn === state.human ? 'あなた' : 'AI';
    setStatus(`${who}は打てる場所がないためパスします`);
    state.turn = opponent(state.turn);
    await new Promise((r) => setTimeout(r, 900));
    return nextTurn();
  }

  if (state.turn === state.human) {
    setStatus(`あなたの番です (${colorName(state.human)})`);
  } else {
    await aiTurn();
  }
}

async function aiTurn() {
  const gameId = state.gameId;
  state.busy = true;
  render();
  setStatus('AIが考え中', true);
  try {
    const res = await fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        board: state.board,
        color: state.turn,
        persona: state.persona,
        lastMove: state.last ? toCoord(state.last.row, state.last.col) : null,
      }),
    });
    const data = await res.json();
    if (gameId !== state.gameId) return;
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (data.pass) {
      logMove(state.turn, 'パス');
    } else if (!play(data.move.row, data.move.col, state.turn)) {
      throw new Error('サーバーから不正な手が返されました');
    }
    say(data.comment);
    state.turn = opponent(state.turn);
    state.busy = false;
    nextTurn();
  } catch (err) {
    if (gameId !== state.gameId) return;
    state.busy = false;
    setStatus(`エラー: ${err.message}`);
    const retry = document.createElement('button');
    retry.textContent = '再試行';
    retry.style.marginLeft = '8px';
    retry.onclick = () => aiTurn();
    statusEl.appendChild(retry);
  }
}

function onHumanClick(r, c) {
  if (!state.playing || state.busy || state.turn !== state.human) return;
  if (!play(r, c, state.human)) return;
  state.turn = opponent(state.turn);
  nextTurn();
}

function newGame() {
  state.gameId++;
  state.board = initialBoard();
  state.turn = BLACK;
  state.human = $('humanColor').value;
  state.persona = $('persona').value;
  state.playing = true;
  state.busy = false;
  state.last = null;
  $('log').innerHTML = '';
  $('bubble').hidden = true;
  $('labelB').textContent = state.human === BLACK ? '黒 (あなた)' : '黒 (AI)';
  $('labelW').textContent = state.human === WHITE ? '白 (あなた)' : '白 (AI)';
  nextTurn();
}

$('newGame').addEventListener('click', newGame);

// ---------- init ----------
fetch('/api/config')
  .then((r) => r.json())
  .then(({ model, personas }) => {
    $('model').textContent = model;
    const sel = $('persona');
    for (const [key, desc] of Object.entries(personas)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = { friendly: 'フレンドリー', rival: 'ライバル', sage: '老師' }[key] ?? key;
      opt.title = desc;
      sel.appendChild(opt);
    }
  })
  .catch(() => setStatus('サーバーに接続できません'));

render();
