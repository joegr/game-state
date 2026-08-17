// game-state — the pure tournament engine.
//
// No DOM, no filesystem, no network, no crypto: just the state transitions of a
// single-elimination bracket and the two-captain score consensus. Shared by the
// browser admin console (js/admin.js) and the Node CLI (tools/advance.mjs) so
// there is exactly ONE implementation of the rules.

// ---- seeded RNG (mulberry32) — reproducible, auditable draws ----------------

export function seededRng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- bracket construction ---------------------------------------------------

export function roundLabel(slots) {
  return { 2: 'The Final', 4: 'Semi-finals', 8: 'Quarter-finals' }[slots] || `Round of ${slots}`;
}

// Build a seeded single-elimination bracket. `roundStarts[i]` is the ISO start
// for round i (or null); the caller derives these from the tournament schedule.
export function buildDraw(teamFps, seed, roundStarts = []) {
  const rng = seededRng(seed);
  const order = shuffle(teamFps, rng);
  let size = 1; while (size < order.length) size *= 2;
  const nRounds = Math.max(1, Math.log2(size));
  const nByes = size - order.length;

  // Distribute byes: the first `nByes` teams each get their own bye match; the
  // rest play in pairs. This guarantees every round-0 match has at least one
  // team (no dead null-vs-null match) for any team count.
  let current = [];
  for (let i = 0; i < nByes; i++) current.push({ a: order[i], b: null });
  const rest = order.slice(nByes);
  for (let i = 0; i < rest.length; i += 2) current.push({ a: rest[i], b: rest[i + 1] ?? null });

  const rounds = [];
  let roundSlots = size;

  for (let r = 0; r < nRounds; r++) {
    const matches = current.map((m, i) => ({
      id: `r${roundSlots}-m${i + 1}`, a: m.a ?? null, b: m.b ?? null, winner: null,
    }));
    if (r === 0) for (const m of matches) {
      if (m.a && !m.b) m.winner = m.a;
      if (m.b && !m.a) m.winner = m.b;
    }
    rounds.push({ slots: roundSlots, label: roundLabel(roundSlots), start: roundStarts[r] || null, matches });
    const next = [];
    for (let i = 0; i < matches.length; i += 2) next.push({ a: null, b: null });
    current = next; roundSlots /= 2;
  }

  const state = {
    seed, format: 'single-elimination', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), status: 'active', champion: null, rounds,
  };
  propagateByes(state);
  return state;
}

export function findMatch(state, id) {
  for (let r = 0; r < state.rounds.length; r++) {
    const m = state.rounds[r].matches.find((x) => x.id === id);
    if (m) return { round: r, match: m, index: state.rounds[r].matches.indexOf(m) };
  }
  return null;
}

export function feedForward(state, roundIdx, matchIdx) {
  const m = state.rounds[roundIdx].matches[matchIdx];
  const next = state.rounds[roundIdx + 1];
  if (!next || !m.winner) return;
  const nm = next.matches[Math.floor(matchIdx / 2)];
  if (matchIdx % 2 === 0) nm.a = m.winner; else nm.b = m.winner;
}

export function propagateByes(state) {
  for (let r = 0; r < state.rounds.length; r++) {
    state.rounds[r].matches.forEach((m, i) => { if (m.winner) feedForward(state, r, i); });
  }
}

// Record a winner. Returns { ok, error?, complete, champion? }. Idempotent-safe:
// refuses to overwrite an already-decided match.
export function applyResult(state, matchId, winnerFp) {
  const hit = findMatch(state, matchId);
  if (!hit) return { ok: false, error: `No match "${matchId}".` };
  const { round, match, index } = hit;
  if (match.winner) return { ok: false, error: `Match ${matchId} already decided (${match.winner}).` };
  if (match.a !== winnerFp && match.b !== winnerFp) {
    return { ok: false, error: `"${winnerFp}" is not in match ${matchId}.` };
  }
  match.winner = winnerFp;
  feedForward(state, round, index);
  return finalize(state, matchId);
}

export function simAll(state, seed = (state.seed || 'sim') + ':sim') {
  const rng = seededRng(seed);
  for (let r = 0; r < state.rounds.length; r++) {
    state.rounds[r].matches.forEach((m, i) => {
      if (m.winner || (!m.a && !m.b)) return;
      m.winner = !m.b ? m.a : !m.a ? m.b : (rng() < 0.5 ? m.a : m.b);
      feedForward(state, r, i);
    });
  }
  return finalize(state, 'simulated all rounds');
}

function finalize(state, msg) {
  state.updatedAt = new Date().toISOString();
  const final = state.rounds[state.rounds.length - 1].matches[0];
  const complete = !!(final && final.winner);
  if (complete) { state.status = 'complete'; state.champion = final.winner; }
  return { ok: true, complete, champion: state.champion || null, msg };
}

export function currentPhaseLabel(state) {
  const undecided = state.rounds.find((r) => r.matches.some((m) => (m.a || m.b) && !m.winner));
  return undecided ? undecided.label : 'complete';
}

// ---- score consensus --------------------------------------------------------

// Matches that are playable now (both teams known, undecided): id -> {a,b,label}.
export function playableMatches(state) {
  const out = new Map();
  for (const r of state.rounds) for (const m of r.matches) {
    if (m.a && m.b && !m.winner) out.set(m.id, { a: m.a, b: m.b, label: r.label });
  }
  return out;
}

// Compute the result queue from already-decrypted, already-identified reports.
// Each report: { reporterFp, matchId, myScore, oppScore, ts }. A match is
// `agreed` only when both captains reported mirrored, non-tied scores.
export function computeQueue(state, reports) {
  const sides = playableMatches(state);
  const latest = new Map(); // `${matchId}|${fp}` -> {myScore,oppScore,ts}
  for (const rep of reports) {
    const s = sides.get(rep.matchId);
    if (!s || (s.a !== rep.reporterFp && s.b !== rep.reporterFp)) continue;
    const my = Number(rep.myScore), opp = Number(rep.oppScore);
    if (!Number.isInteger(my) || !Number.isInteger(opp) || my < 0 || opp < 0) continue;
    const key = `${rep.matchId}|${rep.reporterFp}`;
    const prev = latest.get(key);
    if (!prev || new Date(rep.ts) > new Date(prev.ts)) latest.set(key, { myScore: my, oppScore: opp, ts: rep.ts });
  }

  const queue = {};
  for (const [id, s] of sides) {
    const ra = latest.get(`${id}|${s.a}`), rb = latest.get(`${id}|${s.b}`);
    if (!ra && !rb) continue;
    if (!ra || !rb) { queue[id] = { label: s.label, a: s.a, b: s.b, status: 'awaiting', reportedBy: ra ? s.a : s.b }; continue; }
    const mirror = ra.myScore === rb.oppScore && ra.oppScore === rb.myScore;
    if (mirror && ra.myScore !== ra.oppScore) {
      queue[id] = { label: s.label, a: s.a, b: s.b, status: 'agreed', scoreA: ra.myScore, scoreB: ra.oppScore, winner: ra.myScore > ra.oppScore ? s.a : s.b };
    } else {
      queue[id] = { label: s.label, a: s.a, b: s.b, status: mirror ? 'tie' : 'disputed', reports: { [s.a]: { my: ra.myScore, opp: ra.oppScore }, [s.b]: { my: rb.myScore, opp: rb.oppScore } } };
    }
  }
  return queue;
}

// ---- published outputs ------------------------------------------------------

export function buildPublic(state, tournamentName, teamCount) {
  const decided = state.rounds.reduce((n, r) => n + r.matches.filter((m) => m.winner).length, 0);
  const total = state.rounds.reduce((n, r) => n + r.matches.length, 0);
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    tournament: tournamentName, seed: state.seed || null,
    format: state.format || 'single-elimination', status: state.status,
    activePhase: state.status === 'complete' ? 'complete' : currentPhaseLabel(state),
    teamCount, champion: state.champion || null,
    matchesDecided: decided, matchesTotal: total,
    rounds: state.rounds.map((r) => ({
      label: r.label, slots: r.slots, start: r.start || null,
      matches: r.matches.map((m) => ({ id: m.id, a: m.a, b: m.b, winner: m.winner })),
    })),
  };
}

// Per-captain PLAINTEXT views keyed by fp; the caller seals each to the
// captain's public key. Mirrors the captain's-eye perspective.
export function buildViews(state, teamFps) {
  const nextFixture = new Map();
  const eliminated = new Set();
  for (let r = 0; r < state.rounds.length; r++) {
    for (const m of state.rounds[r].matches) {
      for (const side of ['a', 'b']) {
        const fp = m[side]; if (!fp) continue;
        if (m.winner && m.winner !== fp) eliminated.add(fp);
        if (!m.winner && !nextFixture.has(fp)) {
          nextFixture.set(fp, { phaseLabel: state.rounds[r].label, opponent: side === 'a' ? m.b : m.a, matchTime: state.rounds[r].start, matchId: m.id });
        }
      }
    }
  }
  const views = {};
  for (const fp of teamFps) {
    if (state.champion === fp) views[fp] = { status: 'champion', phaseLabel: 'Champion' };
    else if (eliminated.has(fp) && !nextFixture.has(fp)) views[fp] = { status: 'eliminated', phaseLabel: 'Eliminated' };
    else if (nextFixture.has(fp)) {
      const f = nextFixture.get(fp);
      views[fp] = {
        status: f.opponent ? 'scheduled' : 'bye', phaseLabel: f.phaseLabel, opponent: f.opponent || null,
        matchTime: f.matchTime, matchId: f.matchId,
        instructions: f.opponent ? 'Play your match, then report the score. It advances once both captains agree and the organizer confirms.' : 'Opponent to be decided — sit tight.',
      };
    } else views[fp] = { status: 'scheduled', phaseLabel: 'Awaiting draw' };
  }
  return views;
}

// Align bracket rounds to the tournament schedule from the end (last round ->
// final phase). `phases` is tournament.json's phases array.
export function roundStartsFor(phases, nRounds) {
  const knockout = phases.filter((ph) => ph.kind !== 'signup' && ph.kind !== 'complete');
  const tail = knockout.slice(Math.max(0, knockout.length - nRounds)).map((ph) => ph.start);
  while (tail.length < nRounds) tail.unshift(tail[0] || null);
  return tail;
}

export function roundsForTeams(teamCount) {
  let size = 1; while (size < teamCount) size *= 2;
  return Math.max(1, Math.log2(size));
}
