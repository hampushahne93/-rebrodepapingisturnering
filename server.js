/* Pingis Cup – server
 * Serverar webbsidan och ett litet API. Datan sparas i Neon (Postgres) via DATABASE_URL.
 * Utan DATABASE_URL körs allt i minnet (bra för att testa lokalt, men försvinner vid omstart).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const B = require('./public/bracket.js');

/* ===== Inställningar (kan ändras med miljövariabler på Render) ===== */
const PORT = process.env.PORT || 3000;
const DEADLINE = new Date(process.env.DEADLINE || '2026-11-20T23:59:00+01:00'); // sista anmälan
const ADMIN_CODE = process.env.ADMIN_CODE || '';
const DATABASE_URL = process.env.DATABASE_URL || '';

const TEST_PLAYERS = ['Anna Lind', 'Johan Berg', 'Sara Ek', 'Mohammed Ali', 'Lisa Holm', 'Erik Sund',
  'Fatima Noor', 'Oskar Lund', 'Emma Strand', 'Viktor Dahl', 'Nora Falk'];

const emptyState = () => ({ players: [], order: null, results: {}, scores: {}, log: [] });
const NOCHANGE = Symbol('nochange');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/* ===== Lagring ===== */
function memoryStore() {
  let data = emptyState(), version = 0;
  return {
    kind: 'minne',
    async init() {},
    async get() { return { data: JSON.parse(JSON.stringify(data)), version }; },
    async mutate(fn) {
      const copy = JSON.parse(JSON.stringify(data));
      const out = fn(copy);
      if (out === NOCHANGE) return;
      data = copy; version++;
      return out;
    }
  };
}

function neonStore() {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ...(DATABASE_URL.includes('sslmode=') ? {} : { ssl: true }),
    max: 5
  });
  return {
    kind: 'Neon',
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS pingis_state (
        id INT PRIMARY KEY, data JSONB NOT NULL, version INT NOT NULL DEFAULT 0)`);
      await pool.query(`INSERT INTO pingis_state (id, data, version) VALUES (1, $1, 0)
        ON CONFLICT (id) DO NOTHING`, [JSON.stringify(emptyState())]);
    },
    async get() {
      const r = await pool.query('SELECT data, version FROM pingis_state WHERE id = 1');
      return { data: r.rows[0].data, version: r.rows[0].version };
    },
    async mutate(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await c.query('SELECT data FROM pingis_state WHERE id = 1 FOR UPDATE');
        const data = r.rows[0].data;
        const out = fn(data);
        if (out === NOCHANGE) { await c.query('ROLLBACK'); return; }
        await c.query('UPDATE pingis_state SET data = $1, version = version + 1 WHERE id = 1', [JSON.stringify(data)]);
        await c.query('COMMIT');
        return out;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { c.release(); }
    }
  };
}

const store = DATABASE_URL ? neonStore() : memoryStore();

/* ===== Turneringsregler ===== */
const signupOpen = () => new Date() < DEADLINE;
// Trädet visas när admin har öppnat det. Admin ser det alltid.
const bracketVisible = (d, isAdmin) => !!isAdmin || !!d.bracketOpen;

function normalize(d) {
  d.players = d.players || []; d.results = d.results || {}; d.scores = d.scores || {}; d.log = d.log || [];
  if (d.order === undefined) d.order = null;
  if (d.bracketOpen === undefined) d.bracketOpen = false;
  return d;
}
function draw(d) {
  const idx = d.players.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  d.order = idx; d.results = {}; d.scores = {}; d.log = [];
}
const needsDraw = d => !d.order && d.players.length >= 2;
function resetDraw(d) { d.order = null; d.results = {}; d.scores = {}; d.log = []; }

function cleanName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (n.length < 2) throw new HttpError(400, 'Skriv ditt namn.');
  if (n.length > 40) throw new HttpError(400, 'Namnet är för långt.');
  return n;
}
function findMatch(d, key) {
  const t = B.buildTournament(d);
  const m = B.allMatches(t).find(x => x.key === key);
  if (!m) throw new HttpError(404, 'Matchen finns inte.');
  return m;
}

/* ===== HTTP-hjälp ===== */
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 10000) { reject(new HttpError(413, 'För stor förfrågan.')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new HttpError(400, 'Ogiltig JSON.')); } });
    req.on('error', reject);
  });
}
const isAdminReq = req => !!ADMIN_CODE && req.headers['x-admin-code'] === ADMIN_CODE;
function requireAdmin(req) {
  if (!ADMIN_CODE) throw new HttpError(503, 'ADMIN_CODE är inte inställd på servern.');
  if (!isAdminReq(req)) throw new HttpError(401, 'Fel admin-kod.');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const PUBLIC = path.join(__dirname, 'public');
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Hittades inte'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

/* ===== API ===== */
async function getState(req) {
  const admin = isAdminReq(req);
  let { data, version } = await store.get();
  normalize(data);
  // Lotta automatiskt när trädet ska visas (vid deadline, eller direkt om trädet är upplåst)
  if (bracketVisible(data, admin) && needsDraw(data)) {
    await store.mutate(d => { normalize(d); if (!needsDraw(d)) return NOCHANGE; draw(d); });
    ({ data, version } = await store.get()); normalize(data);
  }
  const visible = bracketVisible(data, admin);
  return {
    version,
    players: data.players,
    order: visible ? data.order : null,
    results: visible ? data.results : {},
    scores: visible ? data.scores : {},
    log: visible ? data.log.slice(0, 15) : [],
    config: { deadline: DEADLINE.toISOString(), signupOpen: signupOpen(), bracketVisible: visible, bracketOpen: !!data.bracketOpen }
  };
}

const routes = {
  'GET /api/state': async req => getState(req),

  'POST /api/signup': async (req, body) => {
    if (!signupOpen()) throw new HttpError(400, 'Anmälan är stängd.');
    const name = cleanName(body.name);
    await store.mutate(d => {
      normalize(d);
      if (d.players.some(p => p.toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'Det namnet är redan anmält.');
      if (d.players.length >= 128) throw new HttpError(400, 'Turneringen är full.');
      d.players.push(name);
      resetDraw(d); // ny spelare → ny lottning
    });
    return { ok: true, name };
  },

  'POST /api/report': async (req, body) => {
    const pa = Number(body.scoreA), pb = Number(body.scoreB);
    const err = B.validScore(pa, pb);
    if (err) throw new HttpError(400, err);
    return store.mutate(d => {
      normalize(d);
      if (!d.bracketOpen) throw new HttpError(400, 'Slutspelet har inte startat än.');
      const m = findMatch(d, String(body.key));
      if (!(m.a && m.b)) throw new HttpError(400, 'Matchen är inte redo att spelas än.');
      if (m.winner !== undefined) throw new HttpError(409, 'Den här matchen har redan ett resultat.');
      if (body.a !== m.a || body.b !== m.b) throw new HttpError(409, 'Matchen har ändrats – ladda om sidan.');
      const winner = pa > pb ? m.a : m.b;
      d.results[m.key] = winner;
      d.scores[m.key] = { [m.a]: pa, [m.b]: pb };
      d.log.unshift({ key: m.key, stage: m.stage, a: m.a, b: m.b, pa, pb, at: Date.now() });
      d.log = d.log.slice(0, 100);
      return { ok: true, winner };
    });
  },

  /* ----- Admin ----- */
  'POST /api/admin/check': async req => { requireAdmin(req); return { ok: true }; },

  'POST /api/admin/bracket': async (req, body) => {
    requireAdmin(req);
    await store.mutate(d => {
      normalize(d);
      d.bracketOpen = !!body.open;
      if (d.bracketOpen && needsDraw(d)) draw(d);
    });
    return { ok: true, open: !!body.open };
  },

  'POST /api/admin/draw': async req => {
    requireAdmin(req);
    await store.mutate(d => { normalize(d); if (d.players.length < 2) throw new HttpError(400, 'Minst två spelare behövs.'); draw(d); });
    return { ok: true };
  },

  'POST /api/admin/reset-results': async req => {
    requireAdmin(req);
    await store.mutate(d => { normalize(d); d.results = {}; d.scores = {}; d.log = []; });
    return { ok: true };
  },

  'POST /api/admin/set-winner': async (req, body) => {
    requireAdmin(req);
    await store.mutate(d => {
      normalize(d);
      const m = findMatch(d, String(body.key));
      if (body.winner == null) { delete d.results[m.key]; delete d.scores[m.key]; }
      else {
        if (!(m.a && m.b) || (body.winner !== m.a && body.winner !== m.b)) throw new HttpError(400, 'Ogiltig vinnare.');
        if (d.results[m.key] !== body.winner) { d.results[m.key] = body.winner; delete d.scores[m.key]; }
      }
      B.prune(d);
    });
    return { ok: true };
  },

  'POST /api/admin/remove-player': async (req, body) => {
    requireAdmin(req);
    await store.mutate(d => {
      normalize(d);
      const before = d.players.length;
      d.players = d.players.filter(p => p !== body.name);
      if (d.players.length === before) throw new HttpError(404, 'Spelaren finns inte.');
      resetDraw(d);
    });
    return { ok: true };
  },

  'POST /api/admin/test-players': async req => {
    requireAdmin(req);
    await store.mutate(d => {
      normalize(d);
      TEST_PLAYERS.forEach(n => { if (!d.players.some(p => p.toLowerCase() === n.toLowerCase())) d.players.push(n); });
      resetDraw(d);
    });
    return { ok: true };
  },

  'POST /api/admin/clear-all': async req => {
    requireAdmin(req);
    await store.mutate(d => { Object.assign(d, emptyState()); });
    return { ok: true };
  }
};

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (!pathname.startsWith('/api/')) return serveStatic(req, res);
  const handler = routes[`${req.method} ${pathname}`];
  if (!handler) return send(res, 404, { error: 'Finns inte.' });
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    send(res, 200, await handler(req, body));
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Något gick fel på servern.' });
  }
});

store.init().then(() => {
  server.listen(PORT, () => {
    console.log(`Pingis Cup kör på port ${PORT} (lagring: ${store.kind})`);
    if (!ADMIN_CODE) console.warn('Varning: ADMIN_CODE är inte satt – admin-funktionerna är avstängda.');
  });
}).catch(e => { console.error('Kunde inte starta databasen:', e); process.exit(1); });
