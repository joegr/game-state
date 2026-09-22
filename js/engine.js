// game-state — the pure tournament engine.
//
// No DOM, no filesystem, no network, no I/O: just the state transitions of a
// single-elimination bracket and the two-captain score consensus. Shared by the
// browser, the intake/batch/stage workflows (tools/*.mjs) and the organizer CLI
// (tools/advance.mjs), so there is exactly ONE implementation of the rules.

// ---- config (tournament.md, the organizer-owned spine) ----------------------
//
// Every durable fact about the tournament lives as markdown, in plain text —
// no JSON anywhere in this app. `tournament.md` is the one file the organizer
// edits directly (name, teamCount, format, phases) and the one field they
// change over time (activePhase, drawSeed) to progress the tournament; every
// change to it publishes only via `gh` (see tools/advance.mjs). Field lines
// are `- Label: value`; matching is case-insensitive and whitespace-tolerant
// so hand edits don't need to be exact.

const orNone = (v) => (v === '(none)' || v === '' ? null : v);
const CONFIG_FIELDS = [
  ['Team count', 'teamCount', Number],
  ['Group size', 'groupSize', Number],
  ['Format', 'format', String],
  ['App repo', 'appRepo', String],
  ['Roster repo', 'rosterRepo', String],
  ['Tentative repo', 'tentativeRepo', orNone],
  ['Active phase', 'activePhase', String],
  ['Draw seed', 'drawSeed', orNone],
  // After the draw, the stage IS the round being played: 1, 2, … or "done".
  // Only the stage workflow (tools/stage.mjs) moves it.
  ['Round', 'round', (v) => { const x = orNone(v); return x === null ? null : x === 'done' ? 'done' : Number(x); }],
];
const NULLABLE = new Set(['tentativeRepo', 'drawSeed', 'round']);

export function formatConfigMd(t) {
  const bullets = CONFIG_FIELDS.map(([label, key]) => `- ${label}: ${t[key] ?? (NULLABLE.has(key) ? '(none)' : '')}`).join('\n');
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

// ---- the tentative repo (private) --------------------------------------------
//
// Everything a captain's action produces lands here first: intake.yml writes
// one inbox file per submission, and batch.yml, the only writer of these
// queue files, folds them in. Never a captain directly, never a public repo:
//
//   signups.md    every registration: code, token hash, PIN hash, when
//   scores.md     submitted scores awaiting the organizer's acceptance
//   attempts.md   wrong-PIN attempts, which lock a team at MAX_PIN_ATTEMPTS
//
// Nothing here is part of the public record. The organizer accepts teams and
// results privately (admitted.md, accepted.md, below), and they are published
// only by a stage change the organizer confirms (tools/stage.mjs).

export const MAX_PIN_ATTEMPTS = 5;

export function mdTable(title, note, header, rows) {
  const sep = '|' + header.map(() => '---').join('|') + '|';
  const head = '| ' + header.join(' | ') + ' |';
  const body = rows.map((r) => '| ' + r.map((c) => (c ?? '')).join(' | ') + ' |').join('\n');
  return `# ${title}\n\n_${note}_\n\n${head}\n${sep}${body ? '\n' + body : ''}\n`;
}

export function tableRows(md) {
  return (md || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'))
    .slice(2)
    .map((line) => line.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells[0]);
}

export function formatSignupsMd(signups) {
  return mdTable('Signups', 'Every registration, admitted or not. PRIVATE — the PIN hashes must never be published.',
    ['Code', 'Token hash', 'PIN hash', 'Submitted'],
    signups.map((t) => [t.fp, t.tokenHash, t.pinHash, t.submittedAt]));
}
export function parseSignupsMd(md) {
  return tableRows(md).map(([fp, tokenHash, pinHash, submittedAt]) => ({ fp, tokenHash, pinHash, submittedAt: submittedAt || null }));
}

// Score is from the reporter's side, "mine-theirs" — exactly computeQueue's input.
export function formatScoresMd(reports) {
  return mdTable('Tentative scores', 'Submitted by captains, awaiting the organizer. A score leaves this file when its match is confirmed.',
    ['Match', 'Team', 'Score', 'Submitted'],
    reports.map((r) => [r.matchId, r.reporterFp, `${r.myScore}-${r.oppScore}`, r.ts]));
}
export function parseScoresMd(md) {
  return tableRows(md).map(([matchId, reporterFp, score, ts]) => {
    const [myScore, oppScore] = (score || '').split('-').map(Number);
    return { matchId, reporterFp, myScore, oppScore, ts: ts || null };
  });
}

export function formatAttemptsMd(attempts) {
  return mdTable('Wrong-PIN attempts', `A team locks after ${MAX_PIN_ATTEMPTS}. The organizer unlocks it by clearing its rows.`,
    ['Team', 'At'], attempts.map((a) => [a.fp, a.at]));
}
export function parseAttemptsMd(md) {
  return tableRows(md).map(([fp, at]) => ({ fp, at: at || null }));
}

// The "only open matches" rule, in one place: intake and batch enforce it,
// the captain view uses it to decide what to offer. Open means: the current
// round, both sides known, no published winner, and not already accepted by
// the organizer (an accepted result is waiting to be published at the
// advance, and nobody can resubmit over it).
export function validateSubmission(record, fp, { matchId, myScore, oppScore } = {}, accepted = []) {
  if (!record?.state) return { ok: false, error: 'The draw has not happened yet.' };
  if (record.stage !== 'round') return { ok: false, error: record.stage === 'complete' ? 'The tournament is over.' : 'Scores are not being taken right now.' };
  const sides = roundOpenMatches(record).get(matchId);
  if (!sides) return { ok: false, error: `Match ${matchId} is not open in round ${record.round}.` };
  if (sides.a !== fp && sides.b !== fp) return { ok: false, error: `Your team is not in match ${matchId}.` };
  if (accepted.some((r) => r.matchId === matchId)) return { ok: false, error: `The organizer has already accepted the result of ${matchId}.` };
  const my = Number(myScore), opp = Number(oppScore);
  if (!Number.isInteger(my) || !Number.isInteger(opp) || my < 0 || opp < 0) return { ok: false, error: 'Scores must be whole numbers, zero or more.' };
  if (my === opp) return { ok: false, error: 'A tie cannot decide a knockout match. Enter the decisive score.' };
  return { ok: true, sides, opponent: sides.a === fp ? sides.b : sides.a };
}

// One live submission per team per match: a resubmission replaces the old one.
export function upsertScore(reports, report) {
  return [...reports.filter((r) => !(r.matchId === report.matchId && r.reporterFp === report.reporterFp)), report];
}

// Scores for matches outside the current round's open set (published, or
// never valid) are dead weight; the batch drops them whenever it writes.
// Scores for ACCEPTED matches stay until the round is published, so an
// accept the organizer takes back still has both submissions behind it.
export function pruneScores(reports, record) {
  const open = roundOpenMatches(record || {});
  return reports.filter((r) => open.has(r.matchId));
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

// ---- reconstruction, invariants, stage, gates ------------------------------------
//
// ONE function turns the three public files into the tournament, and every
// consumer calls it: every page, the intake and batch workflows, and the
// organizer CLI. It also checks the record's invariants. If any fails, the
// stage is 'invalid' and every gate refuses every action until the organizer
// fixes the record. A broken bracket is never "sort of" used.
//
// The stage is derived from the published files, never set directly:
//   registration  no draw yet, and the active phase is a signup phase
//   closed        no draw yet, and registration has been closed
//   round         drawn, `Round: k` is being played (record.round = k)
//   complete      `Round: done` and the final is decided
//   invalid       the record contradicts itself
// Only the stage workflow (tools/stage.mjs), dispatched by the organizer
// after they confirm its plan, changes any of the inputs.

export const STAGES = ['registration', 'closed', 'round', 'complete', 'invalid'];

export function reconstruct(tournament, rosterMd, resultsMd) {
  const roster = parseRosterMd(rosterMd).sort((a, b) => a.fp.localeCompare(b.fp));
  const results = parseResultsMd(resultsMd);
  const progress = signupProgress(roster.map((t) => t.fp), tournament.teamCount, tournament.groupSize);
  const errors = [];
  let state = null;
  const round = tournament.round ?? null;

  const phase = tournament.phases.find((p) => p.id === tournament.activePhase);
  if (!phase) errors.push(`Active phase "${tournament.activePhase}" is not in the phase table.`);

  const codes = roster.map((t) => t.fp);
  const dup = codes.find((c, i) => codes.indexOf(c) !== i);
  if (dup) errors.push(`roster.md lists ${dup} more than once.`);
  const badCode = codes.find((c) => !/^[A-Z0-9]{4}$/.test(c));
  if (badCode) errors.push(`roster.md has a malformed team code "${badCode}".`);
  if (roster.length > progress.capacity) errors.push(`roster.md has ${roster.length} teams; capacity is ${progress.capacity}.`);

  if (!tournament.drawSeed) {
    if (results.length) errors.push('results.md has results but there is no draw seed.');
    if (round !== null) errors.push(`tournament.md says Round ${round} but there is no draw seed.`);
  } else {
    if (roster.length < 2) errors.push('There is a draw seed but fewer than 2 teams on the roster.');
    if (phase?.kind === 'signup') errors.push('There is a draw seed but the active phase is still a signup phase.');
    if (roster.length >= 2) {
      state = buildDraw(codes, tournament.drawSeed);
      const R = state.rounds.length;
      if (round === null) errors.push('There is a draw seed but no Round.');
      else if (round !== 'done' && !(Number.isInteger(round) && round >= 1 && round <= R)) errors.push(`Round ${round} does not exist — this bracket has rounds 1–${R}.`);

      // Strict replay, in order. The first row that doesn't fit stops it. Rows
      // after a bad one describe a bracket that may not exist.
      const limit = round === 'done' ? R : Number(round);
      for (const r of results) {
        const hit = findMatch(state, r.matchId);
        if (hit && hit.round + 1 > limit) { errors.push(`results.md has ${r.matchId} (round ${hit.round + 1}) but only round ${limit} has been reached.`); break; }
        const v = validateResult(state, r);
        if (!v.ok) { errors.push(`results.md, ${r.matchId}: ${v.error}`); break; }
        applyResult(state, r.matchId, r.winner);
      }
      // Every round before the current one must be fully decided. A round
      // only ends when the organizer advances it, and that publishes it whole.
      if (!errors.length && Number.isInteger(round)) {
        for (let i = 0; i < round - 1; i++) {
          const open = state.rounds[i].matches.filter((m) => (m.a || m.b) && !m.winner);
          if (open.length) { errors.push(`Round ${round} is current but round ${i + 1} still has undecided matches (${open.map((m) => m.id).join(', ')}).`); break; }
        }
      }
      if (!errors.length && round === 'done' && state.status !== 'complete') errors.push('Round is "done" but the final has not been decided.');
    }
  }

  const stage = errors.length ? 'invalid'
    : !tournament.drawSeed ? (phase?.kind === 'signup' ? 'registration' : 'closed')
    : round === 'done' ? 'complete' : 'round';
  return { roster, results, progress, state, stage, round: stage === 'round' ? round : null, errors };
}

// The matches that can be played RIGHT NOW: in the current round, both sides
// known, no published winner. The single definition of "open" that intake,
// batch, acceptance and every page use.
export function roundOpenMatches(record) {
  const out = new Map();
  if (record.stage !== 'round' || !record.state) return out;
  const rd = record.state.rounds[record.round - 1];
  for (const m of rd.matches) if (m.a && m.b && !m.winner) out.set(m.id, { a: m.a, b: m.b, label: rd.label });
  return out;
}

// May the organizer advance from the current round? Only when every open
// match in it has an accepted result that is valid against the bracket. The
// returned rows are exactly what the advance publishes, in bracket order.
export function advanceCheck(record, accepted) {
  if (record.stage !== 'round') return { ok: false, error: gate('round:advance', record.stage).error };
  const open = [...roundOpenMatches(record)];
  const rows = [];
  const missing = [];
  for (const [id, s] of open) {
    const r = accepted.find((x) => x.matchId === id);
    if (!r) { missing.push(id); continue; }
    const v = validateResult(record.state, r);
    if (!v.ok) return { ok: false, error: `accepted result for ${id} is not valid: ${v.error}` };
    rows.push({ matchId: id, winner: r.winner, scoreWinner: r.scoreWinner, scoreLoser: r.scoreLoser, confirmedAt: r.confirmedAt, sides: s });
  }
  if (missing.length) return { ok: false, missing, error: `${missing.length} match(es) in round ${record.round} have no accepted result yet: ${missing.join(', ')}.` };
  const last = record.round === record.state.rounds.length;
  return { ok: true, rows, next: last ? 'done' : record.round + 1 };
}

// ---- the organizer's private acceptance files ------------------------------------
//
// admitted.md and accepted.md live in the tentative repo and are written ONLY
// by the organizer's CLI. They are decisions not yet published. The stage
// workflow publishes them, and only at a stage change: the roster when
// registration closes and at the draw, and a round's results when the round
// is advanced.

export function formatAdmittedMd(teams) {
  return mdTable('Admitted', 'Teams the organizer has accepted. Published to roster.md when registration closes and at the draw.',
    ['Code', 'Token hash', 'Registered'], [...teams].sort((a, b) => a.fp.localeCompare(b.fp)).map((t) => [t.fp, t.tokenHash, t.registeredAt]));
}
export const parseAdmittedMd = parseRosterMd;

export function formatAcceptedMd(results) {
  return mdTable('Accepted', 'Results the organizer has accepted. A round is published to results.md, whole, when the organizer advances it.',
    ['Match', 'Winner', 'Score', 'Accepted'], results.map((r) => [r.matchId, r.winner, `${r.scoreWinner}-${r.scoreLoser}`, r.confirmedAt]));
}
export const parseAcceptedMd = parseResultsMd;

// A result may enter the record only if its match is open right now, the
// winner actually played it, and the score is a real, decisive score for
// that winner. Used by the CLI before writing and by the replay above, so a
// row that was invalid when written can never become valid later.
export function validateResult(state, { matchId, winner, scoreWinner, scoreLoser }) {
  if (!state) return { ok: false, error: 'there is no draw.' };
  const sides = playableMatches(state).get(matchId);
  if (!sides) {
    const hit = findMatch(state, matchId);
    return { ok: false, error: !hit ? 'no such match in this bracket.' : hit.match.winner ? `already decided (${hit.match.winner}).` : 'not open yet — both sides are not known.' };
  }
  if (winner !== sides.a && winner !== sides.b) return { ok: false, error: `${winner} did not play in it (${sides.a} vs ${sides.b}).` };
  const w = Number(scoreWinner), l = Number(scoreLoser);
  if (!Number.isInteger(w) || !Number.isInteger(l) || w < 0 || l < 0) return { ok: false, error: 'scores must be whole numbers, zero or more.' };
  if (w <= l) return { ok: false, error: `the winner's score (${w}) must be higher than the loser's (${l}).` };
  return { ok: true, sides };
}

// Which actions each stage allows. This table is the whole policy. Anything
// not listed for a stage is refused, and 'invalid' allows nothing.
export const GATES = {
  'signup:intake': ['registration'],
  'signup:admit': ['registration', 'closed'],
  'signup:reject': ['registration', 'closed'],
  'phase:close': ['registration'],
  'phase:reopen': ['closed'],
  draw: ['closed'],
  'score:intake': ['round'],
  'score:accept': ['round'],
  'score:reject': ['round'],
  'round:advance': ['round'],
};

const GATE_WHY = {
  'signup:intake': 'registration is not open',
  'signup:admit': 'teams can only be admitted before the draw',
  'signup:reject': 'registrations can only be rejected before the draw',
  'phase:close': 'registration is not open',
  'phase:reopen': 'registration can only be reopened after closing it and before the draw',
  draw: 'the draw happens exactly once, after registration is closed',
  'score:intake': 'scores are only taken for the round being played',
  'score:accept': 'results are only accepted for the round being played',
  'score:reject': 'scores are only handled for the round being played',
  'round:advance': 'only a round being played can be advanced',
};

export function gate(action, stage) {
  if (!GATES[action]) return { ok: false, error: `Unknown action "${action}".` };
  if (stage === 'invalid') return { ok: false, error: 'The published record is inconsistent, so nothing can change until the organizer fixes it (`node tools/advance.mjs check`).' };
  if (GATES[action].includes(stage)) return { ok: true };
  return { ok: false, error: `Not allowed while the tournament is "${stage}": ${GATE_WHY[action]}.` };
}
