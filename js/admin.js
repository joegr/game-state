// game-state — organizer console (admin.html).
//
// A team's identity is a token; the roster holds only its hash. The PIN below
// is a local device lock, not a credential — the real gate on publishing
// anything is who has push access to the repos.
//
//   • paste blobs (signups + score reports) → verify each token's hash
//   • run the seeded draw, tally two-captain consensus, confirm results
//   • export config JSON (public/bracket/queue) + roster.md to commit & push
//
// No server. Publishing = committing the exported files; the Pages `push`
// deploy serves the app repo, and the roster repo serves roster.md directly.

import { el, clear, copy } from './util.js';
import { hashToken, fingerprint, encodeBlob, decodeBlob } from './identity.js';
import {
  buildDraw, applyResult, computeQueue, buildPublic, buildViews,
  currentPhaseLabel, playableMatches, signupProgress, buildSignupProgress,
  formatRosterMd, parseRosterMd,
} from './engine.js';

const PIN = 'game-state:admin:pin';
const WORK = 'game-state:admin:work';
const app = document.getElementById('app');

let tournament = null;
let unlocked = false;            // local-device gate only, reset on reload
let work = loadWork();           // { teams:[{fp,tokenHash,registeredAt}], reports:[], matches:null, seed:null }
let toastMsg = null;

function loadWork() {
  try { return JSON.parse(localStorage.getItem(WORK)) || blankWork(); } catch { return blankWork(); }
}
function blankWork() { return { teams: [], reports: [], matches: null, seed: null }; }
function saveWork() { localStorage.setItem(WORK, JSON.stringify(work)); }
function toast(text, kind = 'good') { toastMsg = { text, kind }; }

async function boot() {
  try {
    const res = await fetch(new URL('config/tournament.json', document.baseURI).href, { cache: 'no-cache' });
    tournament = await res.json();
  } catch (e) {
    app.append(el('div', { class: 'card danger' }, 'Config error: ' + e.message)); return;
  }
  document.getElementById('tourney-name').textContent = tournament.name || 'Tournament';
  render();
}

function render() {
  clear(app);
  if (!unlocked) return localStorage.getItem(PIN) ? renderUnlock() : renderSetup();
  renderConsole();
}

// ---- login: local device PIN -----------------------------------------------
//
// This is NOT a security boundary — there's no key behind it, just a hash of
// a PIN in this browser's localStorage. It exists so a stray visitor to
// admin.html doesn't start clicking things by accident. The actual gate on
// changing anything real is who has push access to this repo and to the
// roster repo — nothing here can publish without a manual commit.

async function renderSetup() {
  const p1 = el('input', { type: 'password', class: 'input', placeholder: 'choose a PIN', autocomplete: 'new-password' });
  const p2 = el('input', { type: 'password', class: 'input', placeholder: 'confirm PIN', autocomplete: 'new-password' });

  app.append(el('div', { class: 'card' },
    el('h2', {}, 'Set up this console'),
    el('p', { class: 'muted' }, 'Choose a PIN for this device. It only locks this browser against accidental clicks — it is not a credential, and it does not protect anything published. Anyone with push access to the repos can already do everything this console can.'),
    el('label', {}, 'PIN'), p1, p2,
    el('button', { class: 'btn', onclick: async () => {
      if (p1.value.length < 4) return alert('Use at least 4 characters.');
      if (p1.value !== p2.value) return alert('PINs do not match.');
      localStorage.setItem(PIN, await hashToken(p1.value));
      unlocked = true; toast('Console set up.'); render();
    } }, 'Set PIN'),
  ));
}

function renderUnlock() {
  const pin = el('input', { type: 'password', class: 'input', placeholder: 'PIN', autocomplete: 'current-password' });
  const form = el('form', { class: 'card' },
    el('h2', {}, 'Organizer console'),
    el('p', { class: 'muted' }, 'Enter your PIN to unlock the console on this device.'),
    pin,
    el('div', { class: 'row' },
      el('button', { type: 'submit', class: 'btn' }, 'Unlock'),
      el('button', { type: 'button', class: 'btn ghost', onclick: () => { if (confirm('Remove the PIN from this device? (Your working state is unaffected.)')) { localStorage.removeItem(PIN); render(); } } }, 'Reset PIN'),
    ),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await hashToken(pin.value) !== localStorage.getItem(PIN)) return alert('Wrong PIN.');
    unlocked = true; render();
  });
  app.append(form);
}

// ---- console ---------------------------------------------------------------

function renderConsole() {
  const drawn = !!work.matches;
  const complete = drawn && work.matches.status === 'complete';

  app.append(el('div', { class: 'row spread' },
    el('h2', {}, 'Organizer console'),
    el('div', { class: 'row' },
      el('a', { class: 'btn ghost sm', href: 'bracket.html', target: '_blank' }, 'View public ↗'),
      el('button', { class: 'btn ghost sm', onclick: () => { unlocked = false; render(); } }, 'Lock'),
    ),
  ));

  if (toastMsg) { app.append(el('div', { class: `card ${toastMsg.kind === 'danger' ? 'danger' : 'success'}` }, el('p', {}, toastMsg.text))); toastMsg = null; }

  // Status.
  app.append(el('div', { class: 'card' },
    el('div', { class: 'row spread' },
      el('div', {}, el('div', { class: 'muted sm' }, tournament.name), el('h3', {}, complete ? 'Champion crowned' : (drawn ? currentPhaseLabel(work.matches) : 'Registration'))),
      el('span', { class: 'badge ' + (complete ? 'gold' : 'good') }, complete ? 'COMPLETE' : (drawn ? 'LIVE' : 'OPEN')),
    ),
    el('p', { class: 'muted sm' }, `${work.teams.length} team(s) · ${work.reports.length} score report(s)${work.seed ? ' · seed ' + work.seed : ''}`),
    complete ? el('p', { class: 'gold big' }, '🏆 ', el('span', { class: 'mono' }, work.matches.champion)) : null,
  ));

  renderInbox();
  if (!drawn) renderRegistration(); else renderQueue();
  if (drawn) renderExport();
  renderBackup();
  renderDanger();

  app.append(el('p', { class: 'muted sm center' }, 'Publish by committing the exported files and pushing — Pages redeploys the app repo on push, and the roster repo serves roster.md directly.'));
}

function renderInbox() {
  const ta = el('textarea', { class: 'input mono', rows: '3', placeholder: 'paste signup entries and/or score reports (any amount, any format — blobs are auto-detected)' });
  app.append(el('div', { class: 'card' },
    el('h3', {}, 'Inbox'),
    el('p', { class: 'muted sm' }, 'Paste blobs captains sent you. Signups add teams; score reports are checked against the roster and matched to matches.'),
    ta,
    el('button', { class: 'btn', onclick: async (e) => {
      e.target.disabled = true;
      const r = await ingest(ta.value);
      toast(`Processed: +${r.added} team(s), ${r.scores} score report(s)${r.dup ? `, ${r.dup} duplicate` : ''}${r.bad ? `, ${r.bad} unreadable/unauthenticated` : ''}.`, r.bad && !r.added && !r.scores ? 'danger' : 'good');
      render();
    } }, 'Process blobs'),
  ));
}

async function ingest(text) {
  const tokens = text.match(/[A-Za-z0-9_-]{60,}/g) || [];
  let added = 0, scores = 0, dup = 0, bad = 0;
  for (const tok of tokens) {
    let payload;
    try { payload = decodeBlob(tok); } catch { bad++; continue; }
    if (payload.token && !payload.matchId) {
      // Signup: the code is always DERIVED from the token, never taken as
      // given — that's what makes it unforgeable.
      const fp = await fingerprint(payload.token);
      if (work.teams.some((t) => t.fp === fp)) { dup++; continue; }
      work.teams.push({ fp, tokenHash: await hashToken(payload.token), registeredAt: new Date().toISOString() });
      added++;
    } else if (payload.matchId && payload.fp && payload.token) {
      const team = work.teams.find((t) => t.fp === payload.fp);
      if (!team || await hashToken(payload.token) !== team.tokenHash) { bad++; continue; } // wrong token for this code
      work.reports = work.reports.filter((r) => !(r.matchId === payload.matchId && r.reporterFp === payload.fp));
      work.reports.push({ reporterFp: payload.fp, matchId: payload.matchId, myScore: payload.myScore, oppScore: payload.oppScore, ts: payload.ts });
      scores++;
    } else bad++;
  }
  saveWork();
  return { added, scores, dup, bad };
}

function renderRegistration() {
  const progress = signupProgress(work.teams.map((t) => t.fp), tournament.teamCount, tournament.groupSize);
  const seed = el('input', { class: 'input', placeholder: 'draw seed (optional)' });
  app.append(el('div', { class: 'card' },
    el('h3', {}, 'Registration'),
    el('p', { class: 'muted sm' }, work.teams.length < 2 ? 'Add at least 2 teams via the Inbox to run the draw.' : `${work.teams.length} teams ready. Publish the seed afterward so anyone can verify the draw.`),
    el('div', { class: 'row' }, seed,
      el('button', { class: 'btn', disabled: work.teams.length < 2 || null, onclick: () => {
        if (!confirm(`Run the draw for ${work.teams.length} teams? This locks the field.`)) return;
        const s = seed.value.trim() || `${tournament.name}:${Date.now()}`;
        work.matches = buildDraw(work.teams.map((t) => t.fp), s);
        work.seed = work.matches.seed; saveWork(); toast('Bracket drawn.'); render();
      } }, 'Run the draw')),
  ));

  renderSignupProgress(progress);
  renderRoster();
}

// Signups fill sequentially, groupSize at a time — this is what the public
// site reads to decide whether registration is still open. It's only true for
// visitors once you publish it below; nothing updates automatically.
function renderSignupProgress(progress) {
  const out = el('div', {});
  app.append(el('div', { class: 'card' },
    el('h3', {}, 'Signup capacity'),
    el('p', { class: 'muted sm' },
      `${progress.registered}/${progress.capacity} confirmed`,
      progress.full ? ' — field is full.' : '.',
      ' The public site only knows this once you publish it below.'),
    el('div', { class: 'row' }, progress.groups.map((g) =>
      el('span', { class: 'badge ' + (g.full ? 'good' : 'upcoming') }, `Group ${g.index + 1}: ${g.filled}/${g.slots}`))),
    el('button', { class: 'btn ghost sm', onclick: async (e) => {
      e.target.disabled = true; e.target.textContent = 'Generating…';
      const obj = buildSignupProgress(work.teams.map((t) => t.fp), tournament.name, tournament.teamCount, tournament.groupSize);
      const blob = new Blob([JSON.stringify(obj, null, 2) + '\n'], { type: 'application/json' });
      clear(out);
      out.append(el('div', { class: 'row' },
        el('a', { class: 'btn ghost sm', href: URL.createObjectURL(blob), download: 'public.json' }, 'Download public.json'),
        el('button', { class: 'btn ghost sm', onclick: async (ev) => { ev.target.textContent = (await copy(JSON.stringify(obj, null, 2))) ? 'Copied ✓' : 'Copy failed'; } }, 'Copy'),
      ));
      e.target.disabled = false; e.target.textContent = 'Publish signup progress';
    } }, 'Publish signup progress'),
    out,
  ));
}

// The roster (team codes + token hashes) lives in a SEPARATE public repo —
// see config/tournament.json → rosterRepo — not in this app's config/. That's
// what makes it independently auditable regardless of this repo's own
// visibility. Import re-hydrates `work.teams` from what's already published
// there (e.g. on a fresh device); Publish writes out the current state to
// commit there.
function renderRoster() {
  const importOut = el('div', {});
  const publishOut = el('div', {});
  app.append(el('div', { class: 'card' },
    el('h3', {}, 'Roster'),
    el('p', { class: 'muted sm' }, `Lives at github.com/${tournament.rosterRepo || '(rosterRepo not set)'} as roster.md, not in this repo.`),
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost sm', disabled: !tournament.rosterRepo || null, onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Fetching…';
        try {
          const res = await fetch(`https://raw.githubusercontent.com/${tournament.rosterRepo}/main/roster.md`, { cache: 'no-cache' });
          if (!res.ok) throw new Error(`${res.status}`);
          const parsed = parseRosterMd(await res.text());
          let addedN = 0, conflictN = 0;
          for (const t of parsed) {
            const existing = work.teams.find((x) => x.fp === t.fp);
            if (!existing) { work.teams.push(t); addedN++; }
            else if (existing.tokenHash !== t.tokenHash) conflictN++;
          }
          saveWork();
          clear(importOut);
          importOut.append(el('p', { class: 'muted sm' }, `Imported: +${addedN} team(s)${conflictN ? `, ${conflictN} conflicting (kept local)` : ''}.`));
          toast(`Roster import: +${addedN} team(s).`); render();
        } catch (err) { alert('Could not fetch the roster: ' + err.message); }
        e.target.disabled = false; e.target.textContent = 'Import from roster repo';
      } }, 'Import from roster repo'),
      el('button', { class: 'btn ghost sm', onclick: (e) => {
        const md = formatRosterMd(work.teams);
        const blob = new Blob([md], { type: 'text/markdown' });
        clear(publishOut);
        publishOut.append(el('div', { class: 'row' },
          el('a', { class: 'btn ghost sm', href: URL.createObjectURL(blob), download: 'roster.md' }, 'Download roster.md'),
          el('button', { class: 'btn ghost sm', onclick: async (ev) => { ev.target.textContent = (await copy(md)) ? 'Copied ✓' : 'Copy failed'; } }, 'Copy'),
        ));
      } }, 'Publish roster'),
    ),
    importOut, publishOut,
  ));
}

function confirmResult(matchId, winnerFp, msg) {
  if (msg && !confirm(msg)) return;
  const r = applyResult(work.matches, matchId, winnerFp);
  if (!r.ok) return alert(r.error);
  saveWork(); toast(`Recorded ${matchId} → ${winnerFp}.`); render();
}

function renderQueue() {
  const queue = computeQueue(work.matches, work.reports);
  const entries = Object.entries(queue);
  const agreed = entries.filter(([, v]) => v.status === 'agreed');
  const conflicts = entries.filter(([, v]) => v.status === 'disputed' || v.status === 'tie');
  const awaiting = entries.filter(([, v]) => v.status === 'awaiting');
  const reported = new Set(entries.map(([id]) => id));
  const unreported = [...playableMatches(work.matches)].filter(([id]) => !reported.has(id));

  const card = el('div', { class: 'card' }, el('h3', {}, 'Result queue'),
    el('p', { class: 'muted sm' }, 'Both captains report matching scores → you confirm → the bracket advances.'));

  if (agreed.length) {
    card.append(el('h4', {}, `Ready to confirm (${agreed.length})`));
    for (const [id, v] of agreed) card.append(el('div', { class: 'match' },
      el('div', { class: 'row spread' }, el('strong', {}, id), el('span', { class: 'badge good' }, 'AGREED')),
      el('p', {}, el('code', { class: 'mono' }, v.winner), ' wins ', el('strong', {}, `${Math.max(v.scoreA, v.scoreB)}–${Math.min(v.scoreA, v.scoreB)}`)),
      el('button', { class: 'btn', onclick: () => confirmResult(id, v.winner, `Confirm ${v.winner} wins ${id} and advance?`) }, 'Confirm & advance'),
    ));
  }
  if (conflicts.length) {
    card.append(el('h4', {}, `Disputed (${conflicts.length})`));
    for (const [id, v] of conflicts) card.append(el('div', { class: 'match' },
      el('div', { class: 'row spread' }, el('strong', {}, id), el('span', { class: 'badge danger' }, v.status.toUpperCase())),
      el('p', { class: 'sm' }, el('span', { class: 'mono' }, v.a), ' said ', v.reports[v.a] ? `${v.reports[v.a].my}–${v.reports[v.a].opp}` : '—', ' · ', el('span', { class: 'mono' }, v.b), ' said ', v.reports[v.b] ? `${v.reports[v.b].my}–${v.reports[v.b].opp}` : '—'),
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', onclick: () => confirmResult(id, v.a, `Override: ${v.a} wins ${id}?`) }, v.a, ' wins'),
        el('button', { class: 'btn ghost', onclick: () => confirmResult(id, v.b, `Override: ${v.b} wins ${id}?`) }, v.b, ' wins'),
      ),
    ));
  }
  if (awaiting.length) {
    card.append(el('h4', {}, `Awaiting a captain (${awaiting.length})`));
    for (const [id, v] of awaiting) card.append(el('p', { class: 'sm muted' }, el('code', { class: 'mono' }, id), ' — ', el('span', { class: 'mono' }, v.reportedBy), ' reported; waiting on the other.'));
  }
  if (!entries.length) card.append(el('p', { class: 'muted' }, 'No score reports yet. Paste them in the Inbox.'));
  app.append(card);

  if (unreported.length) {
    const ov = el('details', { class: 'card' }, el('summary', {}, `Manual override — no reports (${unreported.length})`), el('p', { class: 'muted sm' }, 'For walkovers / no-shows.'));
    for (const [id, s] of unreported) ov.append(el('div', { class: 'match' },
      el('div', { class: 'muted sm' }, `${s.label} · ${id}`),
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', onclick: () => confirmResult(id, s.a, `Walkover: ${s.a} wins ${id}?`) }, s.a, ' wins'),
        el('span', { class: 'muted' }, 'vs'),
        el('button', { class: 'btn ghost', onclick: () => confirmResult(id, s.b, `Walkover: ${s.b} wins ${id}?`) }, s.b, ' wins'),
      ),
    ));
    app.append(ov);
  }
}

function buildOutputs() {
  const teamCount = work.teams.length;
  const views = buildViews(work.matches, work.teams.map((t) => t.fp));
  return {
    'public.json': buildPublic(work.matches, tournament.name, teamCount),
    'bracket.json': {
      schemaVersion: 1, generatedAt: new Date().toISOString(),
      activePhase: work.matches.status === 'complete' ? 'complete' : currentPhaseLabel(work.matches),
      seed: work.matches.seed, teamCount,
      note: 'Per-team views. The bracket is already public, so these are plaintext — only score reports need a token.', views,
    },
    'queue.json': {
      schemaVersion: 1, generatedAt: new Date().toISOString(),
      note: 'Match result queue.', matches: computeQueue(work.matches, work.reports),
    },
  };
}

function renderExport() {
  const out = el('div', {});
  app.append(el('div', { class: 'card' },
    el('h3', {}, 'Export & publish'),
    el('p', { class: 'muted sm' }, 'Generate the config files, replace them under config/ in your repo, then commit & push. Pages redeploys on push.'),
    el('button', { class: 'btn', onclick: (e) => {
      e.target.disabled = true; e.target.textContent = 'Generating…';
      const files = buildOutputs();
      clear(out);
      for (const [name, obj] of Object.entries(files)) {
        const blob = new Blob([JSON.stringify(obj, null, 2) + '\n'], { type: 'application/json' });
        out.append(el('div', { class: 'row' },
          el('a', { class: 'btn ghost sm', href: URL.createObjectURL(blob), download: name }, `Download ${name}`),
          el('button', { class: 'btn ghost sm', onclick: async (ev) => { ev.target.textContent = (await copy(JSON.stringify(obj, null, 2))) ? 'Copied ✓' : 'Copy failed'; } }, 'Copy'),
        ));
      }
      e.target.disabled = false; e.target.textContent = 'Regenerate exports';
    } }, 'Prepare exports'),
    out,
  ));
}

// ---- backup & restore ------------------------------------------------------
//
// The working state (roster, reports, bracket) lives ONLY in this browser's
// localStorage — clearing site data, switching devices, or a storage eviction
// would lose it. A backup is an encoded copy of `work`, readable by anyone who
// has it. It holds token HASHES, never raw tokens: enough to verify a report,
// not enough to forge one.

const BACKUP_V = 1;

function makeBackup() {
  return encodeBlob({ v: BACKUP_V, tournament: tournament.name, savedAt: new Date().toISOString(), work });
}

function readBackup(text) {
  const tok = (text.match(/[A-Za-z0-9_-]{40,}/g) || [])[0];
  if (!tok) throw new Error('No backup blob found in that text.');
  const payload = decodeBlob(tok);
  const w = payload.work;
  if (!w || !Array.isArray(w.teams) || !Array.isArray(w.reports)) throw new Error('That is not a game-state backup.');
  return {
    work: { teams: w.teams, reports: w.reports, matches: w.matches ?? null, seed: w.seed ?? null },
    savedAt: payload.savedAt || 'unknown date',
  };
}

function renderBackup() {
  const ta = el('textarea', { class: 'input mono', rows: '3', placeholder: 'paste a backup blob to restore' });
  const file = el('input', { type: 'file', accept: '.txt,.json', class: 'input', onchange: async (e) => { const f = e.target.files[0]; if (f) ta.value = await f.text(); } });

  app.append(el('div', { class: 'card' },
    el('h3', {}, 'Backup & restore'),
    el('p', { class: 'muted sm' }, 'This browser is the only copy of the working state (reports, bracket). Download a backup after every session.'),
    el('button', { class: 'btn', onclick: (e) => {
      const blob = new Blob([makeBackup() + '\n'], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `game-state-backup-${new Date().toISOString().slice(0, 10)}.txt` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } }, 'Download backup'),
    el('hr', {}),
    el('h4', {}, 'Restore'),
    el('p', { class: 'muted sm' }, 'Replaces everything on this device with the contents of the backup.'),
    file, ta,
    el('button', { class: 'btn ghost', onclick: () => {
      try {
        const { work: restored, savedAt } = readBackup(ta.value);
        if (!confirm(`Restore the backup from ${savedAt}? It has ${restored.teams.length} team(s) and ${restored.reports.length} report(s), and REPLACES the current state on this device.`)) return;
        work = restored; saveWork(); toast(`Restored backup from ${savedAt}.`); render();
      } catch (err) { alert('Could not restore: ' + err.message); }
    } }, 'Restore from backup'),
  ));
}

function renderDanger() {
  app.append(el('details', { class: 'card' }, el('summary', {}, 'Danger zone'),
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost', onclick: () => {
        if (!confirm('Discard the local working state (teams, reports, bracket) on this device?')) return;
        if (!confirm('This cannot be undone and there is no other copy. Download a backup first if you have not. Really reset?')) return;
        work = blankWork(); saveWork(); toast('Working state cleared.'); render();
      } }, 'Reset tournament state'),
    )));
}

boot();
