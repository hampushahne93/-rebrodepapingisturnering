/* Pingis Cup – webbsidans logik. Hämtar läget från servern var 4:e sekund. */
const POLL_MS = 4000;

let S = { players: [], order: null, results: {}, scores: {}, log: [], config: null, version: -1 };
let adminCode = sessionStorage.getItem('pingis-admin') || '';
let isAdmin = false;
let selectedKey = null;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = n => n.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const setMsg = (el, text, ok) => { el.className = 'msg ' + (ok ? 'ok' : 'err'); el.textContent = text; };

/* ===== API ===== */
async function api(path, body) {
  const opts = { method: body ? 'POST' : 'GET', headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (adminCode) opts.headers['x-admin-code'] = adminCode;
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Något gick fel.');
  return data;
}

async function refresh(force) {
  try {
    const data = await api('/api/state');
    setLive(true);
    const changed = force || data.version !== S.version ||
      JSON.stringify(data.config) !== JSON.stringify(S.config);
    S = data;
    if (changed) renderAll();
  } catch (e) {
    setLive(false);
  }
}
function setLive(ok) {
  $('live').className = 'live ' + (ok ? 'on' : 'off');
  $('liveText').textContent = ok ? 'Live' : 'Offline';
  $('offline').classList.toggle('show', !ok);
}
setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

/* ===== Flikar ===== */
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
function showTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + id));
}

/* ===== Anmälan ===== */
$('signupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('name').value.trim();
  try {
    await api('/api/signup', { name });
    setMsg($('msg'), `Grymt, ${name.split(' ')[0]}! Du är anmäld 🎉`, true);
    e.target.reset();
    refresh(true);
  } catch (err) { setMsg($('msg'), err.message, false); }
});

/* ===== Slutspelsträd ===== */
function slotHTML(name, m, waitText = 'Väntar…') {
  if (name === null) return `<div class="slot bye">${m.r === 0 && !m.key.startsWith('SF') ? 'Frirond' : '—'}</div>`;
  if (name === undefined) return `<div class="slot tbd">${waitText}</div>`;
  const real = m.a && m.b;
  const open = real && m.winner === undefined;
  const cls = ['slot'];
  if (real && (isAdmin || open)) cls.push('clickable');
  if (real && m.winner !== undefined) cls.push(m.winner === name ? 'win' : 'lose');
  const pts = S.scores[m.key] && S.scores[m.key][name];
  if (pts !== undefined) cls.push('has-pts');
  const attrs = real ? `data-key="${m.key}" data-name="${esc(name)}"` : '';
  return `<div class="${cls.join(' ')}" ${attrs}><span>${esc(name)}</span>${pts !== undefined ? `<span class="pts">${pts}</span>` : ''}</div>`;
}
const matchHTML = (m, wa, wb) => `<div class="match">${slotHTML(m.a, m, wa)}${slotHTML(m.b, m, wb)}</div>`;

function renderBracket(t) {
  const el = $('bracket'), cbEl = $('comeback');
  document.body.classList.toggle('admin-mode', isAdmin);
  $('bracketHint').textContent = isAdmin
    ? 'Admin: klicka på en spelare för att sätta eller ta bort vinnare'
    : 'Klicka på en match som ska spelas för att lämna in resultatet';
  if (!t) {
    el.innerHTML = '<div class="empty">Minst två spelare behövs för att skapa ett träd.</div>';
    cbEl.innerHTML = ''; $('statRounds').textContent = '–'; return;
  }
  const R = t.groups[0].rounds.length;
  $('statRounds').textContent = R + 2;

  let html = '';
  for (let r = 0; r < R; r++) {
    html += `<div class="round"><h3>${Bracket.mainRoundName(r, R)}</h3><div class="matches">` +
      t.groups.map((g, gi) => `<div class="group">
          <span class="group-label">${r === 0 ? 'Grupp ' + Bracket.GROUPS[gi] : '&nbsp;'}</span>
          ${g.rounds[r].map(m => matchHTML(m)).join('')}
        </div>`).join('') + `</div></div>`;
  }
  const [semis, final] = t.finals.rounds;
  html += `<div class="round"><h3>Semifinal</h3><div class="matches">
      ${matchHTML(semis[0], 'Vinnare grupp A', 'Vinnare grupp B')}
      ${matchHTML(semis[1], 'Vinnare grupp C', '🔄 Comeback-vinnare')}
    </div></div>
    <div class="round"><h3>Final</h3><div class="matches">${matchHTML(final[0])}</div></div>
    <div class="champion ${t.finals.winner ? '' : 'pending'}">
      <div class="trophy">🏆</div><small>Mästare 2026</small>
      <b>${t.finals.winner ? esc(t.finals.winner) : '???'}</b>
    </div>`;
  el.innerHTML = html;

  if (!t.entrants.length) {
    cbEl.innerHTML = '<div class="empty">Ingen comeback behövs – för få matcher i första omgången.</div>';
    return;
  }
  const CR = t.comeback.rounds.length;
  cbEl.innerHTML = t.comeback.rounds.map((ms, r) => `
      <div class="round"><h3>${Bracket.cbRoundName(r, CR)}</h3><div class="matches">
        ${ms.map(m => matchHTML(m, 'Förlorare omg. 1', 'Förlorare omg. 1')).join('')}
      </div></div>`).join('') + `
    <div class="champion comeback-card ${t.comeback.winner ? '' : 'pending'}">
      <div class="trophy">🔄</div><small>Vidare till semifinal</small>
      <b>${t.comeback.winner ? esc(t.comeback.winner) : '???'}</b>
    </div>`;
}

$('panel-bracket').addEventListener('click', async e => {
  const s = e.target.closest('.slot.clickable'); if (!s) return;
  const { key, name } = s.dataset;
  if (isAdmin) {
    const winner = S.results[key] === name ? null : name;
    try { await api('/api/admin/set-winner', { key, winner }); refresh(true); }
    catch (err) { alertMsg(err.message); }
  } else {
    selectMatch(key);
    showTab('report');
  }
});
function alertMsg(text) { setMsg($('adminMsg'), text, false); }

/* ===== Lämna in resultat ===== */
function renderReport(t) {
  const open = Bracket.openMatches(t);
  $('openCount').textContent = open.length;
  const list = $('pickList');
  if (!S.config || !S.config.bracketVisible) {
    list.innerHTML = '<div class="empty">Slutspelet har inte startat än. Matcherna dyker upp här när trädet är lottat.</div>';
  } else if (!t) {
    list.innerHTML = '<div class="empty">Inga matcher än.</div>';
  } else if (!open.length) {
    list.innerHTML = t.finals.winner
      ? `<div class="empty">🏆 Turneringen är klar – grattis ${esc(t.finals.winner)}!</div>`
      : '<div class="empty">Inga matcher att spela just nu – väntar på andra resultat.</div>';
  } else {
    list.innerHTML = open.map(m => `
      <button class="pick" type="button" data-key="${m.key}">
        <small>${esc(m.stage)}</small>
        <b>${esc(m.a)}</b><span class="vs-mini">vs</span><b>${esc(m.b)}</b>
      </button>`).join('');
  }
  // Om den valda matchen har fått ett resultat av någon annan
  if (selectedKey && !open.some(m => m.key === selectedKey)) {
    closeForm();
    setMsg($('reportMsg'), 'Den matchen har redan fått ett resultat.', false);
  }
  list.hidden = !!selectedKey;
}

function selectMatch(key) {
  const m = Bracket.openMatches(Bracket.buildTournament(S)).find(x => x.key === key);
  if (!m) return;
  selectedKey = key;
  $('rpStage').textContent = m.stage;
  $('rpA').textContent = m.a; $('rpB').textContent = m.b;
  $('rsA').value = ''; $('rsB').value = '';
  $('reportForm').hidden = false; $('pickList').hidden = true;
  $('reportMsg').textContent = '';
  setTimeout(() => $('rsA').focus(), 50);
}
function closeForm() {
  selectedKey = null;
  $('reportForm').hidden = true; $('pickList').hidden = false;
}
$('pickList').addEventListener('click', e => {
  const b = e.target.closest('.pick'); if (b) selectMatch(b.dataset.key);
});
$('rpCancel').addEventListener('click', () => { closeForm(); $('reportMsg').textContent = ''; });

$('reportForm').addEventListener('submit', async e => {
  e.preventDefault();
  const scoreA = parseInt($('rsA').value, 10), scoreB = parseInt($('rsB').value, 10);
  const err = Bracket.validScore(scoreA, scoreB);
  if (err) return setMsg($('reportMsg'), err, false);
  const a = $('rpA').textContent, b = $('rpB').textContent;
  try {
    const r = await api('/api/report', { key: selectedKey, a, b, scoreA, scoreB });
    closeForm();
    setMsg($('reportMsg'), `Tack! ${r.winner} vann ${Math.max(scoreA, scoreB)}–${Math.min(scoreA, scoreB)} 🏓`, true);
    refresh(true);
  } catch (ex) { setMsg($('reportMsg'), ex.message, false); refresh(true); }
});

function renderLatest() {
  const el = $('latest');
  if (!S.log.length) { el.innerHTML = '<div class="empty">Inga resultat än.</div>'; return; }
  el.innerHTML = S.log.map(l => {
    const aw = l.pa > l.pb;
    return `<div class="result-row">
      <span class="stage">${esc(l.stage)}</span>
      <span class="p ${aw ? 'w' : ''}">${esc(l.a)}</span>
      <span class="sc">${l.pa}–${l.pb}</span>
      <span class="p ${aw ? '' : 'w'}">${esc(l.b)}</span>
    </div>`;
  }).join('');
}

/* ===== Deltagare ===== */
function renderPlayers() {
  const el = $('players');
  if (!S.players.length) { el.innerHTML = '<div class="empty">Inga anmälda än – bli först!</div>'; return; }
  el.innerHTML = S.players.map(p => `
    <div class="player tilt">
      <div class="avatar">${esc(initials(p))}</div>
      <div><b>${esc(p)}</b><span>Anmäld ✅</span></div>
      ${isAdmin ? `<button class="remove" title="Ta bort" data-remove="${esc(p)}">✕</button>` : ''}
    </div>`).join('');
}
$('players').addEventListener('click', async e => {
  const b = e.target.closest('[data-remove]'); if (!b) return;
  if (!confirm(`Ta bort ${b.dataset.remove}? Trädet lottas om.`)) return;
  try { await api('/api/admin/remove-player', { name: b.dataset.remove }); refresh(true); }
  catch (err) { alertMsg(err.message); }
});

/* ===== Admin ===== */
async function tryAdmin(code, silent) {
  adminCode = code;
  try {
    await api('/api/admin/check', {});
    isAdmin = true;
    sessionStorage.setItem('pingis-admin', code);
    if (!silent) setMsg($('adminMsg'), 'Inloggad som admin.', true);
  } catch (err) {
    isAdmin = false; adminCode = '';
    sessionStorage.removeItem('pingis-admin');
    if (!silent) setMsg($('adminMsg'), err.message, false);
  }
  $('adminLogin').hidden = isAdmin; $('adminPanel').hidden = !isAdmin;
  refresh(true);
}
$('adminLoginBtn').addEventListener('click', () => tryAdmin($('adminCode').value));
$('adminCode').addEventListener('keydown', e => { if (e.key === 'Enter') tryAdmin($('adminCode').value); });
$('adminLogout').addEventListener('click', () => {
  isAdmin = false; adminCode = ''; sessionStorage.removeItem('pingis-admin');
  $('adminLogin').hidden = false; $('adminPanel').hidden = true; $('adminMsg').textContent = '';
  refresh(true);
});
const CONFIRM = {
  'draw': 'Lotta om trädet? Alla resultat försvinner.',
  'reset-results': 'Nollställa alla resultat?',
  'clear-all': 'Rensa ALLT – alla spelare och resultat?'
};
document.querySelectorAll('[data-admin]').forEach(b => b.addEventListener('click', async () => {
  const action = b.dataset.admin;
  if (CONFIRM[action] && !confirm(CONFIRM[action])) return;
  try { await api('/api/admin/' + action, {}); setMsg($('adminMsg'), 'Klart!', true); refresh(true); }
  catch (err) { alertMsg(err.message); }
}));

/* ===== Lås / stängd anmälan ===== */
function renderGate() {
  const c = S.config || {};
  $('bracketLocked').style.display = c.bracketVisible ? 'none' : '';
  $('bracketOpen').style.display = c.bracketVisible ? '' : 'none';
  const form = $('signupForm');
  if (c.signupOpen === false && !form.dataset.closed) {
    form.dataset.closed = '1';
    form.parentElement.querySelectorAll(':scope > h2, :scope > .sub').forEach(el => el.remove());
    form.innerHTML = `<div class="closed-msg"><span class="e">🏁</span><h2>Anmälan är stängd</h2>
      <p class="sub">Slutspelsträdet är lottat – kolla in vem du möter!</p>
      <button class="btn" type="button" onclick="showTab('bracket')">Se slutspelsträdet 🏆</button></div>`;
  }
}

function renderAll() {
  renderGate();
  const t = Bracket.buildTournament(S);
  $('statPlayers').textContent = S.players.length;
  $('tabCount').textContent = S.players.length;
  renderPlayers();
  renderBracket(t);
  renderReport(t);
  renderLatest();
}

/* ===== Nedräkning ===== */
function tick() {
  if (!S.config) return;
  let d = Math.max(0, new Date(S.config.deadline) - new Date());
  const D = Math.floor(d / 864e5); d -= D * 864e5;
  const H = Math.floor(d / 36e5); d -= H * 36e5;
  const M = Math.floor(d / 6e4); d -= M * 6e4;
  const Sec = Math.floor(d / 1e3);
  const set = (cls, v) => document.querySelectorAll(cls).forEach(el => el.textContent = v);
  set('.cdD', D); set('.cdH', String(H).padStart(2, '0'));
  set('.cdM', String(M).padStart(2, '0')); set('.cdS', String(Sec).padStart(2, '0'));
  if (S.config.signupOpen && d <= 0) refresh(true);
}
setInterval(tick, 1000);

/* ===== 3D-lutning på korten ===== */
document.addEventListener('pointermove', e => {
  const el = e.target.closest('.tilt');
  document.querySelectorAll('.tilt.tilting').forEach(o => { if (o !== el) { o.classList.remove('tilting'); o.style.transform = ''; } });
  if (!el) return;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - .5;
  const y = (e.clientY - r.top) / r.height - .5;
  const strength = el.classList.contains('player') ? 14 : 7;
  el.classList.add('tilting');
  el.style.transform = `perspective(900px) rotateX(${(-y * strength).toFixed(2)}deg) rotateY(${(x * strength).toFixed(2)}deg) translateY(-4px)`;
  el.style.setProperty('--mx', ((x + .5) * 100) + '%');
  el.style.setProperty('--my', ((y + .5) * 100) + '%');
});

/* ===== Start ===== */
if (adminCode) tryAdmin(adminCode, true); else refresh(true);
