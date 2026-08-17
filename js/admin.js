// game-state — organizer console (admin.html).
//
// Tokenless and key-only. The organizer unlocks with ORGANIZER_PRIVATE_KEY (from
// keygen.mjs), which is the SOLE privileged credential — stored encrypted under a
// passphrase in this browser and never sent anywhere. Everything runs client-side:
//
//   • paste sealed blobs (signups + score reports) → decrypt with the private key
//   • run the seeded draw, tally two-captain consensus, confirm results
//   • export the config JSON (public/bracket/queue) to commit & push
//
// No GitHub token, no server. Publishing = committing the exported JSON; the
// Pages `push` deploy then serves it.

import { el, clear, copy } from './util.js';
import {
  seal, unseal, boxSenderPub, publicRaw, fingerprint,
  encryptWithPassphrase, decryptWithPassphrase,
} from './crypto.js';
import {
  buildDraw, applyResult, computeQueue, buildPublic, buildViews,
  currentPhaseLabel, roundStartsFor, roundsForTeams, playableMatches,
} from './engine.js';

const VAULT = 'game-state:admin:vault';
const WORK = 'game-state:admin:work';
const app = document.getElementById('app');

let tournament = null;
let priv = null;                 // organizer private key (in memory, post-unlock)
let work = loadWork();           // { teams:[{fp,captainPublicKey}], reports:[], matches:null, seed:null }
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

async function keyMatchesOrganizer(privStr) {
  if (!tournament.organizerPublicKey) return false;
  try { const t = 'verify:' + Math.random(); return (await unseal(await seal(t, tournament.organizerPublicKey), privStr)) === t; }
  catch { return false; }
}

function render() {
  clear(app);
  if (!priv) return localStorage.getItem(VAULT) ? renderUnlock() : renderSetup();
  renderConsole();
}

// ---- login: setup / unlock -------------------------------------------------

function renderSetup() {
  if (!tournament.organizerPublicKey) {
    app.append(el('div', { class: 'card danger' },
      el('h2', {}, 'Organizer key not configured'),
      el('p', { class: 'muted' }, 'Set config/tournament.json → organizerPublicKey (the public half from keygen.mjs) and redeploy before using the console.')));
    return;
  }
  const priv_ta = el('textarea', { class: 'input mono', rows: '4', placeholder: 'paste organizer.keys.json contents, or just the privateKey string' });
  const file = el('input', { type: 'file', accept: '.json', class: 'input', onchange: async (e) => { const f = e.target.files[0]; if (f) priv_ta.value = await f.text(); } });
  const p1 = el('input', { type: 'password', class: 'input', placeholder: 'choose a passphrase', autocomplete: 'new-password' });
  const p2 = el('input', { type: 'password', class: 'input', placeholder: 'confirm passphrase', autocomplete: 'new-password' });

  app.append(el('div', { class: 'card' },
    el('h2', {}, 'Unlock the console'),
    el('p', { class: 'muted' }, 'Load your organizer private key (from keygen.mjs) once on this device. It is encrypted under your passphrase and stored only in this browser — never committed or sent anywhere. This key is the only thing that separates you from a regular visitor.'),
    el('label', {}, 'Organizer private key'), file, priv_ta,
    el('label', {}, 'Passphrase'), p1, p2,
    el('button', { class: 'btn', onclick: async () => {
      let privStr = priv_ta.value.trim();
      try { const j = JSON.parse(privStr); if (j.privateKey) privStr = j.privateKey; } catch { /* raw key string */ }
      if (p1.value.length < 8) return alert('Use a passphrase of at least 8 characters.');
      if (p1.value !== p2.value) return alert('Passphrases do not match.');
      if (!await keyMatchesOrganizer(privStr)) return alert('That private key does not match this tournament’s organizer public key.');
      localStorage.setItem(VAULT, await encryptWithPassphrase(privStr, p1.value));
      priv = privStr; toast('Console unlocked.'); render();
    } }, 'Verify & unlock'),
  ));
}

function renderUnlock() {
  const pass = el('input', { type: 'password', class: 'input', placeholder: 'passphrase', autocomplete: 'current-password' });
  const form = el('form', { class: 'card' },
    el('h2', {}, 'Organizer login'),
    el('p', { class: 'muted' }, 'Enter your passphrase to unlock the console on this device.'),
    pass,
    el('div', { class: 'row' },
      el('button', { type: 'submit', class: 'btn' }, 'Unlock'),
      el('button', { type: 'button', class: 'btn ghost', onclick: () => { if (confirm('Remove the stored organizer key from this device?')) { localStorage.removeItem(VAULT); render(); } } }, 'Reset device'),
    ),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const privStr = await decryptWithPassphrase(localStorage.getItem(VAULT), pass.value);
      if (!await keyMatchesOrganizer(privStr)) throw new Error('key mismatch');
      priv = privStr; render();
    } catch { alert('Wrong passphrase (or the key no longer matches this tournament).'); }
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
      el('button', { class: 'btn ghost sm', onclick: () => { priv = null; render(); } }, 'Lock'),
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
  renderDanger();

  app.append(el('p', { class: 'muted sm center' }, 'Publish by committing the exported config JSON and pushing — Pages redeploys on push.'));
}

function renderInbox() {
  const ta = el('textarea', { class: 'input mono', rows: '3', placeholder: 'paste sealed signup entries and/or score reports (any amount, any format — blobs are auto-detected)' });
  app.append(el('div', { class: 'card' },
    el('h3', {}, 'Inbox'),
    el('p', { class: 'muted sm' }, 'Paste blobs captains sent you. Signups add teams; score reports are matched to teams and matches. Only your key can open them.'),
    ta,
    el('button', { class: 'btn', onclick: async (e) => {
      e.target.disabled = true;
      const r = await ingest(ta.value);
      toast(`Processed: +${r.added} team(s), ${r.scores} score report(s)${r.dup ? `, ${r.dup} duplicate` : ''}${r.bad ? `, ${r.bad} unreadable/unknown` : ''}.`, r.bad && !r.added && !r.scores ? 'danger' : 'good');
      render();
    } }, 'Process blobs'),
  ));
}

async function ingest(text) {
  const tokens = text.match(/[A-Za-z0-9_-]{100,}/g) || [];
  const rawMap = new Map();
  for (const t of work.teams) rawMap.set(await publicRaw(t.captainPublicKey), t.fp);
  let added = 0, scores = 0, dup = 0, bad = 0;
  for (const tok of tokens) {
    let payload;
    try { payload = JSON.parse(await unseal(tok, priv)); } catch { bad++; continue; }
    if (payload.captainPublicKey && !payload.matchId) {
      const fp = await fingerprint(payload.captainPublicKey);
      if (work.teams.some((t) => t.fp === fp)) { dup++; continue; }
      work.teams.push({ fp, captainPublicKey: payload.captainPublicKey });
      rawMap.set(await publicRaw(payload.captainPublicKey), fp);
      added++;
    } else if (payload.matchId) {
      const fp = rawMap.get(boxSenderPub(tok)); // authenticated signer
      if (!fp) { bad++; continue; }
      work.reports = work.reports.filter((r) => !(r.matchId === payload.matchId && r.reporterFp === fp));
      work.reports.push({ reporterFp: fp, matchId: payload.matchId, myScore: payload.myScore, oppScore: payload.oppScore, ts: payload.ts });
      scores++;
    } else bad++;
  }
  saveWork();
  return { added, scores, dup, bad };
}

function renderRegistration() {
  const seed = el('input', { class: 'input', placeholder: 'draw seed (optional)' });
  app.append(el('div', { class: 'card' },
    el('h3', {}, 'Registration'),
    el('p', { class: 'muted sm' }, work.teams.length < 2 ? 'Add at least 2 teams via the Inbox to run the draw.' : `${work.teams.length} teams ready. Publish the seed afterward so anyone can verify the draw.`),
    el('div', { class: 'row' }, seed,
      el('button', { class: 'btn', disabled: work.teams.length < 2 || null, onclick: () => {
        if (!confirm(`Run the draw for ${work.teams.length} teams? This locks the field.`)) return;
        const s = seed.value.trim() || `${tournament.name}:${Date.now()}`;
        work.matches = buildDraw(work.teams.map((t) => t.fp), s, roundStartsFor(tournament.phases, roundsForTeams(work.teams.length)));
        work.seed = work.matches.seed; saveWork(); toast('Bracket drawn.'); render();
      } }, 'Run the draw')),
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

async function buildOutputs() {
  const teamCount = work.teams.length;
  const plaintext = buildViews(work.matches, work.teams.map((t) => t.fp));
  const pubByFp = new Map(work.teams.map((t) => [t.fp, t.captainPublicKey]));
  const views = {};
  for (const t of work.teams) views[t.fp] = await seal(JSON.stringify(plaintext[t.fp]), pubByFp.get(t.fp));
  return {
    'public.json': buildPublic(work.matches, tournament.name, teamCount),
    'bracket.json': {
      schemaVersion: 1, generatedAt: new Date().toISOString(),
      activePhase: work.matches.status === 'complete' ? 'complete' : currentPhaseLabel(work.matches),
      seed: work.matches.seed, teamCount,
      note: 'Per-captain encrypted views. Each captain can decrypt only their own entry.', views,
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
    el('button', { class: 'btn', onclick: async (e) => {
      e.target.disabled = true; e.target.textContent = 'Generating…';
      const files = await buildOutputs();
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

function renderDanger() {
  app.append(el('details', { class: 'card' }, el('summary', {}, 'Danger zone'),
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost', onclick: () => {
        if (confirm('Discard the local working state (teams, reports, bracket) on this device? Your key stays.')) { work = blankWork(); saveWork(); toast('Working state cleared.'); render(); }
      } }, 'Reset tournament state'),
    )));
}

boot();
