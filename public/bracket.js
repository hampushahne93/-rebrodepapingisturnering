/* Delad slutspelslogik – används både av servern och av webbsidan. */
(function (root) {
  const GROUPS = ['A', 'B', 'C'];
  const nextPow2 = x => { let s = 1; while (s < x) s *= 2; return s; };

  /* slots: namn | null (frirond/tom) | undefined (inte avgjort än) */
  function knockout(slots, prefix, results) {
    const rounds = [];
    let cur = slots.slice(), r = 0;
    while (cur.length > 1) {
      const ms = [], next = [];
      for (let m = 0; m < cur.length; m += 2) {
        const a = cur[m], b = cur[m + 1], key = `${prefix}-r${r}m${m / 2}`;
        let w;
        if (a === null && b === null) w = null;
        else if (b === null) w = a;
        else if (a === null) w = b;
        else if (a && b) { w = results[key]; if (w !== a && w !== b) w = undefined; }
        else w = undefined;
        ms.push({ a, b, key, winner: w, r });
        next.push(w);
      }
      rounds.push(ms); cur = next; r++;
    }
    return { rounds, winner: cur.length ? cur[0] : null };
  }

  /* Sprid ut så att frironder aldrig möter varandra */
  function spread(entrants, size) {
    const slots = new Array(size).fill(null);
    const pos = [];
    for (let i = 0; i < size; i += 2) pos.push(i);
    for (let i = 1; i < size; i += 2) pos.push(i);
    entrants.forEach((e, k) => { slots[pos[k]] = e; });
    return slots;
  }

  function buildTournament(state) {
    const players = state.players || [];
    const results = state.results || {};
    if (!state.order || state.order.length !== players.length || players.length < 2) return null;
    const ordered = state.order.map(i => players[i]);
    const n = ordered.length;

    // Huvudslutspel: 3 grupper, varje grupp ger en semifinalist
    const S = Math.max(2, nextPow2(Math.ceil(n / 3)));
    const slots = new Array(3 * S).fill(null);
    const pos = [];
    for (let p = 0; p < S; p += 2) for (let g = 0; g < 3; g++) pos.push(g * S + p);
    for (let p = 1; p < S; p += 2) for (let g = 0; g < 3; g++) pos.push(g * S + p);
    ordered.forEach((name, k) => { slots[pos[k]] = name; });
    const groups = GROUPS.map((g, i) => knockout(slots.slice(i * S, (i + 1) * S), g, results));

    // Comeback: alla som förlorar sin match i första omgången
    const entrants = [];
    groups.forEach(g => (g.rounds[0] || []).forEach(m => {
      if (m.a && m.b) entrants.push(m.winner === undefined ? undefined : (m.winner === m.a ? m.b : m.a));
    }));
    const comeback = entrants.length
      ? knockout(spread(entrants, nextPow2(entrants.length)), 'CB', results)
      : { rounds: [], winner: null };

    // Semifinal: A–B och C–comeback-vinnaren, sedan final
    const finals = knockout([groups[0].winner, groups[1].winner, groups[2].winner, comeback.winner], 'SF', results);
    return { S, groups, entrants, comeback, finals };
  }

  function mainRoundName(r, total) {
    const left = total - r;
    if (left === 1) return 'Kvartsfinal';
    if (left === 2) return 'Åttondelsfinal';
    return 'Omgång ' + (r + 1);
  }
  function cbRoundName(r, total) {
    const left = total - r;
    if (left === 1) return 'Comeback-final';
    if (left === 2) return 'Comeback-semi';
    return 'Comeback ' + (r + 1);
  }

  /* Alla matcher med en läsbar etikett */
  function allMatches(t) {
    if (!t) return [];
    const out = [];
    const R = t.groups[0].rounds.length;
    t.groups.forEach((g, gi) => g.rounds.forEach((ms, r) =>
      ms.forEach(m => out.push(Object.assign({}, m, { stage: `Grupp ${GROUPS[gi]} · ${mainRoundName(r, R)}` })))));
    const CR = t.comeback.rounds.length;
    t.comeback.rounds.forEach((ms, r) =>
      ms.forEach(m => out.push(Object.assign({}, m, { stage: cbRoundName(r, CR) }))));
    t.finals.rounds[0].forEach(m => out.push(Object.assign({}, m, { stage: 'Semifinal' })));
    t.finals.rounds[1].forEach(m => out.push(Object.assign({}, m, { stage: 'Final' })));
    return out;
  }

  /* Matcher där båda spelarna är klara men inget resultat finns */
  function openMatches(t) {
    return allMatches(t).filter(m => m.a && m.b && m.winner === undefined);
  }

  /* Regler: till 11, vinn med 2. Över 11 måste det sluta exakt 2 isär (t.ex. 13–11). */
  function validScore(pa, pb) {
    if (!Number.isInteger(pa) || !Number.isInteger(pb) || pa < 0 || pb < 0 || pa > 99 || pb > 99) return 'Fyll i giltiga poäng.';
    const hi = Math.max(pa, pb), lo = Math.min(pa, pb);
    if (hi < 11) return 'Vinnaren måste ha minst 11 poäng.';
    if (hi - lo < 2) return 'Man måste vinna med 2 poäng.';
    if (hi > 11 && hi - lo !== 2) return `Över 11 poäng ska det sluta med exakt 2 poängs skillnad (t.ex. ${lo + 2}–${lo}).`;
    return null;
  }

  /* Ta bort resultat som inte längre stämmer med trädet */
  function prune(state) {
    state.results = state.results || {};
    state.scores = state.scores || {};
    for (let i = 0; i < 30; i++) {
      const t = buildTournament(state);
      const valid = new Set();
      allMatches(t).forEach(m => {
        const w = state.results[m.key];
        if (m.a && m.b && (w === m.a || w === m.b)) valid.add(m.key);
      });
      let changed = false;
      Object.keys(state.results).forEach(k => { if (!valid.has(k)) { delete state.results[k]; changed = true; } });
      if (!changed) break;
    }
    Object.keys(state.scores).forEach(k => { if (!(k in state.results)) delete state.scores[k]; });
  }

  const api = { GROUPS, buildTournament, allMatches, openMatches, mainRoundName, cbRoundName, validScore, prune };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Bracket = api;
})(typeof window !== 'undefined' ? window : globalThis);
