// game-state — the pure tournament engine.
//
// No DOM, no filesystem, no network, no I/O: just the state transitions of a
// single-elimination bracket and the two-captain score consensus. Shared by the
// browser (js/organizer.js, js/report.js) and the Node CLI (tools/advance.mjs)
// so there is exactly ONE implementation of the rules.

// ---- config (tournament.md, the organizer-owned spine) ----------------------
//
// Every durable fact about the tournament lives as markdown, in plain text —
// no JSON anywhere in this app. `tournament.md` is the one file the organizer
// edits directly (name, teamCount, format, phases) and the one field they
// change over time (activePhase, drawSeed) to progress the tournament; every
// change to it publishes only via `gh` (see tools/advance.mjs). Field lines
// are `- Label: value`; matching is case-insensitive and whitespace-tolerant
// so hand edits don't need to be exact.

const CONFIG_FIELDS = [
  ['Team count', 'teamCount', Number],
  ['Group size', 'groupSize', Number],
  ['Format', 'format', String],
  ['App repo', 'appRepo', String],
  ['Roster repo', 'rosterRepo', String],
  ['Active phase', 'activePhase', String],
  ['Draw seed', 'drawSeed', (v) => (v === '(none)' || v === '' ? null : v)],
];

export function formatConfigMd(t) {
  const bullets = CONFIG_FIELDS.map(([label, key]) => `- ${label}: ${t[key] ?? (key === 'drawSeed' ? '(none)' : '')}`).join('\n');
  const header = '| ID | Kind | Label | Blurb |\n|----|------|-------|-------|';
  const rows = t.phases.map((p) => `| ${p.id} | ${p.kind} | ${p.label} | ${p.blurb || ''} |`).join('\n');
  return `# ${t.name}\n\n_${t.tagline || ''}_\n\n${bullets}\n\n## Phases\n\n${header}\n${rows}\n`;
}

export function parseConfigMd(md) {
  const lines = md.split('\n');
  const titleLine = lines.find((l) => l.startsWith('# '));
  const taglineLine = lines.find((l) => /^_.*_$/.test(l.trim()));
  const out = {
    name: titleLine ? titleLine.slice(2).trim() : '',
    tagline: taglineLine ? taglineLine.trim().slice(1, -1) : '',
  };

  const byLabel = new Map(CONFIG_FIELDS.map(([label, key, cast]) => [label.toLowerCase(), [key, cast]]));
  for (const line of lines) {
    const m = line.match(/^-\s*([^:]+):\s*(.*)$/);
    if (!m) continue;
    const hit = byLabel.get(m[1].trim().toLowerCase());
    if (!hit) continue;
    const [key, cast] = hit;
    out[key] = cast(m[2].trim());
  }

  const tableLines = lines.map((l) => l.trim()).filter((l) => l.startsWith('|'));
  out.phases = tableLines.slice(2) // header + separator
    .map((line) => {
      const [id, kind, label, blurb] = line.split('|').slice(1, -1).map((c) => c.trim());
      return id ? { id, kind, label, blurb: blurb || '' } : null;
    })
    .filter(Boolean);

  return out;
}

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

// Build a seeded single-elimination bracket.
export function buildDraw(teamFps, seed) {
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
    rounds.push({ slots: roundSlots, label: roundLabel(roundSlots), matches });
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

// Compute the result queue from already-verified, already-identified reports.
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

// ---- roster (roster.md, in the roster repo) ---------------------------------
//
// The confirmed roster is a committed markdown table: `fp` (team code) and
// `tokenHash` (never the raw token) per team, plus when they were added. It's
// the roster's own git history that makes it auditable — a plain table, not a
// blob, so a diff of who joined when is just a diff.
//
// Rows are always written sorted by `fp`. This isn't cosmetic: buildDraw()'s
// shuffle depends on the INPUT ARRAY'S ORDER, not just the seed, so if the
// file's row order could drift (registration order, a manual edit), the same
// seed would reconstruct a DIFFERENT bracket. Sorting gives one canonical
// order no matter how the rows got there.

export function formatRosterMd(teams) {
  const sorted = [...teams].sort((a, b) => a.fp.localeCompare(b.fp));
  const header = '| Code | Token hash | Registered |\n|------|------------|------------|';
  const rows = sorted.map((t) => `| ${t.fp} | ${t.tokenHash} | ${t.registeredAt || ''} |`).join('\n');
  return '# Roster\n\n'
    + '_Confirmed teams. `tokenHash` proves a captain\'s identity for score reports — never publish the raw token._\n\n'
    + header + (rows ? '\n' + rows : '') + '\n';
}

export function parseRosterMd(md) {
  const lines = md.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  return lines.slice(2) // header + separator
    .map((line) => {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      const [fp, tokenHash, registeredAt] = cells;
      return fp ? { fp, tokenHash, registeredAt: registeredAt || null } : null;
    })
    .filter(Boolean);
}

// ---- results ledger (results.md, in the roster repo) ------------------------
//
// Once a match is double-verified (both captains' reports agree) and the
// organizer confirms it, the result is posted here — an append-only public
// record. Score consensus itself (computeQueue, below) is working state that
// never gets published; only a CONFIRMED result becomes a fact.

export function formatResultsMd(results) {
  const header = '| Match | Winner | Score | Confirmed |\n|-------|--------|-------|-----------|';
  const rows = results.map((r) => `| ${r.matchId} | ${r.winner} | ${r.scoreWinner}-${r.scoreLoser} | ${r.confirmedAt} |`).join('\n');
  return '# Results\n\n_Confirmed match results, most recent last. Append-only._\n\n'
    + header + (rows ? '\n' + rows : '') + '\n';
}

export function parseResultsMd(md) {
  const lines = md.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  return lines.slice(2)
    .map((line) => {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      const [matchId, winner, score, confirmedAt] = cells;
      if (!matchId) return null;
      const [scoreWinner, scoreLoser] = (score || '').split('-').map(Number);
      return { matchId, winner, scoreWinner, scoreLoser, confirmedAt: confirmedAt || null };
    })
    .filter(Boolean);
}

// ---- pasted-blob classification ---------------------------------------------
//
// A decoded blob is either a signup (a bare token) or a score report (a code +
// token + match result). This is the ONE place that decides which — shared by
// the CLI's real `ingest` and the admin console's dry-run preview, so the two
// can never classify the same blob differently.

export function classifyPayload(payload) {
  if (!payload || typeof payload.token !== 'string') return null;
  if (typeof payload.matchId === 'string' && typeof payload.fp === 'string') {
    const { fp, token, matchId, myScore, oppScore, ts } = payload;
    return { type: 'report', fp, token, matchId, myScore, oppScore, ts };
  }
  if (!payload.matchId) return { type: 'signup', token: payload.token };
  return null;
}

// ---- signup capacity (pre-draw groups) --------------------------------------
//
// Registration is anonymous and captains never pick a group — the confirmed
// roster fills sequentially, in the order the organizer accepts entries,
// `groupSize` at a time. Whether signups are still open is a fact about
// capacity, not a clock: once every group has its full complement, the field
// is closed. This has nothing to do with `activePhase` — that's the
// organizer's explicit switch; this is what's true about the roster right now.

export function buildGroups(teamFps, teamCount, groupSize) {
  const groupCount = Math.max(1, Math.ceil(teamCount / groupSize));
  return Array.from({ length: groupCount }, (_, i) => {
    const slots = Math.min(groupSize, teamCount - i * groupSize);
    const teams = teamFps.slice(i * groupSize, i * groupSize + slots);
    return { index: i, teams, slots, full: teams.length >= slots };
  });
}

export function signupProgress(teamFps, teamCount, groupSize) {
  const groups = buildGroups(teamFps, teamCount, groupSize);
  return {
    registered: teamFps.length,
    capacity: teamCount,
    full: teamFps.length >= teamCount,
    groups: groups.map(({ index, teams, slots, full }) => ({ index, filled: teams.length, slots, full })),
  };
}

// The pre-draw counterpart to buildPublic(): the shape the landing page and
// the organizer's status view render while the field is still filling.
// Computed on the fly from the live roster — never stored.
export function buildSignupProgress(teamFps, tournamentName, teamCount, groupSize) {
  const progress = signupProgress(teamFps, teamCount, groupSize);
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    tournament: tournamentName, status: 'registration',
    ...progress,
    rounds: [],
    note: progress.full
      ? 'Registration is full. Waiting for the organizer to run the draw.'
      : `Registration is open — ${progress.registered}/${progress.capacity} confirmed.`,
  };
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
      label: r.label, slots: r.slots,
      matches: r.matches.map((m) => ({ id: m.id, a: m.a, b: m.b, winner: m.winner })),
    })),
  };
}

// Per-team views keyed by team code — the captain's-eye perspective of a
// bracket that is already public.
export function buildViews(state, teamFps) {
  const nextFixture = new Map();
  const eliminated = new Set();
  for (let r = 0; r < state.rounds.length; r++) {
    for (const m of state.rounds[r].matches) {
      for (const side of ['a', 'b']) {
        const fp = m[side]; if (!fp) continue;
        if (m.winner && m.winner !== fp) eliminated.add(fp);
        if (!m.winner && !nextFixture.has(fp)) {
          nextFixture.set(fp, { phaseLabel: state.rounds[r].label, opponent: side === 'a' ? m.b : m.a, matchId: m.id });
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
        matchId: f.matchId,
        instructions: f.opponent ? 'Play your match, then report the score. It advances once both captains agree and the organizer confirms.' : 'Opponent to be decided — sit tight.',
      };
    } else views[fp] = { status: 'scheduled', phaseLabel: 'Awaiting draw' };
  }
  return views;
}
