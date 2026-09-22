// game-state — report.html: the score reporting page.
//
// A captain pastes their score report key; this page reconstructs the live
// bracket from the public markdown and offers them ONLY the matches they may
// actually report: their own, both sides known, no winner recorded yet. Every
// other case — not on the roster, not drawn, waiting on an opponent, already
// decided, eliminated, tournament over — is named explicitly rather than
// silently offering nothing.
//
// Two checks happen before any form appears:
//   1. the key's token hashes to the tokenHash published for that code in
//      roster.md — so a wrong or mistyped key is caught here, not by the
//      organizer an hour later;
//   2. the match is in playableMatches() for the current state — the "only
//      open matches" bound.
//
// Neither check is a security boundary: the real one is that the organizer
// re-verifies the token on ingest and is the only one who can publish. This
// is here so a captain never sends a report that was never going to count.

import { loadTournament, loadTournamentState } from './config.js';
import { playableMatches } from './engine.js';
import { el, clear, identityStore, copy } from './util.js';
import { hashToken, encodeBlob, parseKey } from './identity.js';

const app = document.getElementById('app');
let tournament = null;
let live = null;

boot();

async function boot() {
  try {
    tournament = await loadTournament();
    live = await loadTournamentState(tournament);
  } catch (e) {
    app.append(el('div', { class: 'card danger' }, el('h2', {}, 'Config error'), el('p', {}, e.message)));
    return;
  }
  document.getElementById('tourney-name').textContent = tournament.name;
  document.title = `${tournament.name} · report a score · game-state`;

  const saved = identityStore.load(tournament.name);
  if (saved?.token) await showFor(saved.token, { fromDevice: true });
  else renderKeyPrompt();
}

function nav() {
  return el('nav', { class: 'tabs' },
    el('a', { href: 'index.html', class: 'tab' }, '← Register'),
    el('a', { href: 'bracket.html', class: 'tab' }, 'Public bracket'),
    el('span', { class: 'tab active' }, 'Report a score'));
}

// ---- step 1: the key ---------------------------------------------------------

function renderKeyPrompt(message) {
  clear(app);
  const ta = el('textarea', {
    class: 'input mono', rows: '3',
    placeholder: 'AB12:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  });
  const out = el('div', {});

  const submit = async () => {
    const parsed = await parseKey(ta.value);
    if (!parsed) {
      clear(out);
      out.append(el('p', { class: 'sm danger' }, 'That does not look like a score report key. Paste the whole line you saved at registration.'));
      return;
    }
    await showFor(parsed.token, { fromDevice: false });
  };

  app.append(nav(), el('div', { class: 'card' },
    el('h2', {}, 'Report a score'),
    el('p', { class: 'muted' }, 'Paste the score report key you saved when you registered. It stays on this device and is never sent anywhere by this page.'),
    message ? el('p', { class: 'sm danger' }, message) : null,
    ta,
    el('div', { class: 'row' }, el('button', { class: 'btn', onclick: submit }, 'Continue')),
    out,
  ));
}

// ---- step 2: who you are, and what you may report ----------------------------

async function showFor(token, { fromDevice }) {
  const fp = (await parseKey(token)).fp;
  const team = live.roster.find((t) => t.fp === fp);

  // Not on the published roster: either not ingested yet, or a bad key.
  if (!team) {
    clear(app);
    app.append(nav(), el('div', { class: 'card' },
      el('h2', {}, 'Not on the roster yet'),
      el('p', {}, 'Team ', el('code', { class: 'mono' }, fp), ' is not in the published roster.'),
      el('p', { class: 'muted' }, 'Either the organizer has not ingested your entry yet, or this key is for a different tournament. Nothing is wrong with the key itself.'),
      changeKeyRow(),
    ));
    return;
  }

  // The key must actually be this team's key.
  if (await hashToken(token) !== team.tokenHash) {
    identityStore.clear(tournament.name);
    renderKeyPrompt(`That key does not match the published entry for ${fp}. Check you pasted the whole thing.`);
    return;
  }

  if (!fromDevice) identityStore.save(tournament.name, { fp, token });
  renderMatches({ fp, token });
}

function changeKeyRow() {
  return el('div', { class: 'row' },
    el('button', { class: 'btn ghost sm', onclick: () => {
      identityStore.clear(tournament.name);
      renderKeyPrompt();
    } }, 'Use a different key'));
}

function renderMatches(id) {
  clear(app);
  const { state } = live;

  const header = el('div', { class: 'card' },
    el('div', { class: 'row spread' },
      el('div', {},
        el('div', { class: 'muted sm' }, 'Reporting as'),
        el('div', { class: 'mono big' }, id.fp)),
      el('span', { class: 'badge good' }, 'KEY VERIFIED'),
    ),
  );

  app.append(nav(), header);

  if (!state) {
    app.append(closedCard('The draw has not happened yet',
      'There are no matches to report. Once the organizer runs the draw, your fixture appears here.'));
    return;
  }

  // The bound: only matches with both sides known and no winner, and only
  // this team's.
  const open = [...playableMatches(state)].filter(([, s]) => s.a === id.fp || s.b === id.fp);

  if (!open.length) {
    app.append(closedCard(...whyNothingOpen(state, id.fp)));
    return;
  }

  for (const [matchId, sides] of open) {
    app.append(renderReportForm(id, matchId, sides));
  }
}

// Say exactly why there is nothing to report, rather than showing an empty page.
function whyNothingOpen(state, fp) {
  if (state.status === 'complete') {
    return state.champion === fp
      ? ['🏆 You won the tournament', 'There is nothing left to report. Well played.']
      : ['The tournament is over', `${state.champion} took it. No further results can be reported.`];
  }
  const all = state.rounds.flatMap((r) => r.matches);
  const mine = all.filter((m) => m.a === fp || m.b === fp);

  if (mine.some((m) => !m.winner && (m.a === fp ? !m.b : !m.a))) {
    return ['Waiting on your opponent', 'Your next match exists but the other side is still being decided. Check back once that match is confirmed.'];
  }
  if (mine.length && mine.every((m) => m.winner && m.winner !== fp)) {
    return ['You have been eliminated', 'Your run is over, so there is nothing left to report. Thanks for playing.'];
  }
  if (mine.some((m) => m.winner === fp)) {
    return ['Nothing open right now', 'Your last result is confirmed and your next opponent has not been decided yet. Check back after the current round.'];
  }
  return ['Nothing open right now', 'You have no match awaiting a score report. If you think that is wrong, ask the organizer.'];
}

function closedCard(title, body) {
  return el('div', { class: 'card' },
    el('h3', {}, title),
    el('p', { class: 'muted' }, body),
    changeKeyRow(),
  );
}

// ---- step 3: the report -------------------------------------------------------

function renderReportForm(id, matchId, sides) {
  const opponent = sides.a === id.fp ? sides.b : sides.a;
  const box = el('div', { class: 'card' });
  const out = el('div', {});

  const mine = el('input', { class: 'input mono', type: 'number', min: '0', step: '1', placeholder: 'you', style: 'max-width:110px' });
  const theirs = el('input', { class: 'input mono', type: 'number', min: '0', step: '1', placeholder: opponent, style: 'max-width:110px' });

  const priorKey = `game-state:score:${tournament.name}:${matchId}`;
  const prior = localStorage.getItem(priorKey);

  const submit = () => {
    const my = parseInt(mine.value, 10);
    const op = parseInt(theirs.value, 10);
    if (!Number.isInteger(my) || !Number.isInteger(op)) return alert('Enter both scores.');
    if (my < 0 || op < 0) return alert('Scores cannot be negative.');
    if (my === op) return alert('A tie cannot advance a single-elimination match. Enter the decisive score.');

    const report = encodeBlob({
      v: 1, fp: id.fp, token: id.token, matchId,
      myScore: my, oppScore: op, ts: new Date().toISOString(),
    });
    try { localStorage.setItem(priorKey, `${my}-${op}`); } catch { /* private mode — fine */ }
    renderSubmitted(out, matchId, report, my, op, opponent);
  };

  // Note: native Node.append stringifies null ("null" shows up on the page),
  // unlike the el() helper which skips it. Filter before appending.
  box.append(...[
    el('div', { class: 'row spread' },
      el('h3', {}, sides.label),
      el('span', { class: 'muted sm mono' }, matchId)),
    el('div', { class: 'match' },
      el('div', { class: 'row spread' },
        el('code', { class: 'mono big' }, id.fp),
        el('span', { class: 'muted' }, 'vs'),
        el('code', { class: 'mono big' }, opponent)),
    ),
    el('p', { class: 'muted sm' }, 'Both captains report independently. The result advances only when your two reports agree and the organizer publishes it.'),
    el('div', { class: 'row' },
      mine, el('span', { class: 'muted' }, '–'), theirs,
      el('button', { class: 'btn', onclick: submit }, 'Create report'),
    ),
    prior ? el('p', { class: 'muted sm' }, 'You previously reported ', el('code', { class: 'mono' }, prior), ' for this match on this device. Reporting again replaces it.') : null,
    out,
  ].filter(Boolean));
  return box;
}

function renderSubmitted(out, matchId, report, my, op, opponent) {
  clear(out);
  out.append(el('div', { class: 'card success' },
    el('h4', {}, `${my}–${op} against ${opponent}`),
    el('p', { class: 'muted sm' }, 'Send this report to the organizer through your tournament channel. Nothing has been submitted anywhere by this page.'),
    el('pre', { class: 'blob' }, report),
    el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: async (e) => {
        e.target.textContent = (await copy(report)) ? 'Copied ✓' : 'Copy failed';
      } }, 'Copy report'),
    ),
  ));
}
