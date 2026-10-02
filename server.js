import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BLACK, WHITE, legalMoves, toCoord, fromCoord, boardToText, isValidBoard, count,
} from './public/reversi.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
if (existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const MAX_ATTEMPTS = 3;

if (!API_KEY) {
  console.error('GEMINI_API_KEY is not set. Copy .env.example to .env and fill in your key.');
  process.exit(1);
}

const PERSONAS = {
  friendly: '親しみやすく、相手を励ますフレンドリーな対戦相手',
  rival: '自信満々で少し生意気だが憎めないライバル',
  sage: '落ち着いた口調で戦略を語るリバーシの老師',
};

const responseSchema = {
  type: 'OBJECT',
  properties: {
    move: { type: 'STRING', description: '着手する座標 (例: "d3")。必ず合法手リストから選ぶ。' },
    comment: { type: 'STRING', description: '対戦相手への短いひとこと (日本語, 60文字以内)。' },
  },
  required: ['move', 'comment'],
};

function buildPrompt(board, color, moves, persona, lastMove, feedback) {
  const me = color === BLACK ? '黒 (B)' : '白 (W)';
  const { B, W } = count(board);
  return [
    `あなたはリバーシ (オセロ) をプレイしています。あなたは${me}です。`,
    `キャラクター: ${PERSONAS[persona] ?? PERSONAS.friendly}`,
    '',
    '盤面 (B=黒, W=白, .=空き。列は a-h、行は 1-8):',
    boardToText(board),
    '',
    `石の数: 黒 ${B} / 白 ${W}`,
    lastMove ? `相手の直前の手: ${lastMove}` : '',
    `あなたの合法手 (座標:返せる石の数): ${moves.map((m) => `${toCoord(m.row, m.col)}:${m.flips}`).join(', ')}`,
    '',
    '戦略のヒント: 角は非常に強い。角の隣 (X打ち・C打ち) は危険。序盤は返す石を少なくし、相手の打てる場所を減らすと有利。',
    '合法手リストの中から最善と思う一手を選び、JSONで答えてください。',
    feedback ? `\n注意: ${feedback}` : '',
  ].filter((l) => l !== '').join('\n');
}

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json',
        responseSchema,
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Gemini API error (HTTP ${res.status})`);
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return JSON.parse(text);
}

async function chooseMove({ board, color, persona, lastMove }) {
  const moves = legalMoves(board, color);
  if (!moves.length) return { pass: true };

  let feedback = '';
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const out = await callGemini(buildPrompt(board, color, moves, persona, lastMove, feedback));
      const pos = fromCoord(out.move);
      if (pos && moves.some((m) => m.row === pos.row && m.col === pos.col)) {
        return { move: pos, coord: toCoord(pos.row, pos.col), comment: String(out.comment ?? '').slice(0, 120), attempts: attempt };
      }
      feedback = `前回の回答 "${out.move}" は合法手ではありません。必ず合法手リストの座標から選んでください。`;
      console.warn(`[attempt ${attempt}] illegal move from LLM: ${out.move}`);
    } catch (err) {
      lastError = err;
      console.warn(`[attempt ${attempt}] ${err.message}`);
    }
  }
  // Fallback: pick the legal move that flips the most stones.
  const best = moves.reduce((a, b) => (b.flips > a.flips ? b : a));
  return {
    move: { row: best.row, col: best.col },
    coord: toCoord(best.row, best.col),
    comment: lastError ? `(AIの応答に失敗したため自動で打ちました: ${lastError.message})` : '(うーん…ここにしておこう)',
    fallback: true,
  };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return sendJson(res, 200, { model: MODEL, personas: PERSONAS });
  }

  if (req.method === 'POST' && url.pathname === '/api/move') {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 10_000) return sendJson(res, 413, { error: 'Payload too large' });
    }
    let body;
    try { body = JSON.parse(raw); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
    if (!isValidBoard(body.board) || ![BLACK, WHITE].includes(body.color)) {
      return sendJson(res, 400, { error: 'Invalid board or color' });
    }
    try {
      return sendJson(res, 200, await chooseMove(body));
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method === 'GET') {
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(ROOT, 'public', path.normalize(rel));
    if (!file.startsWith(path.join(ROOT, 'public') + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      return res.end(data);
    } catch { /* fall through */ }
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => console.log(`LLM Reversi: http://localhost:${PORT}  (model: ${MODEL})`));
