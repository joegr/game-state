// game-state — admin dashboard.
//
// A single-login control panel for the organizer. It is a STATIC page: the
// "login" is a passphrase that unlocks a locally-stored, encrypted GitHub token
// (the token never leaves this device in plaintext, and is never committed).
//
// It does not compute the bracket or hold the organizer private key. Instead it
// DRIVES the GitHub Actions engine (engine.yml) via workflow_dispatch: confirm a
// match → dispatch action=result → the Action decrypts with the CI secret,
// advances the state machine, rewrites the JSON, and Pages redeploys. The admin
// only reads the public, anonymized bracket to know what to confirm.
//
// Required token: a fine-grained PAT scoped to this repo with
//   Actions: Read and write   (dispatch + read run status)
// (Contents: Read too, for a private repo.)

import { el, clear, copy } from './util.js';
import { encryptWithPassphrase, decryptWithPassphrase } from './crypto.js';

const VAULT = 'game-state:admin:vault';
const WORKFLOW = 'engine.yml';
const app = document.getElementById('app');

let tournament = null, pub = null, queue = null;
let session = null; // { token, owner, repo }

// ---- boot ------------------------------------------------------------------

async function boot() {
  await reloadState();
  document.getElementById('tourney-name').textContent = tournament.name || 'Tournament';
  render();
}

async function reloadState() {
  [tournament, pub, queue] = await Promise.all([
    fetchJson('config/tournament.json').catch(() => ({ name: 'Tournament', signup: {} })),
    fetchJson('config/public.json').catch(() => ({ rounds: [], status: 'unknown' })),
    fetchJson('config/queue.json').catch(() => ({ matches: {} })),
  ]);
}

async function fetchJson(path) {
  const res = await fetch(new URL(path, document.baseURI).href, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function repoSlug() {
  const [owner, repo] = (tournament.signup?.repo || '/').split('/');
  return { owner, repo };
}

// ---- render router ---------------------------------------------------------

function render() {
  clear(app);
  if (!session) {
    if (localStorage.getItem(VAULT)) renderUnlock();
    else renderSetup();
  } else {
    renderDashboard();
  }
}

// ---- login: setup / unlock -------------------------------------------------

function renderSetup() {
  const { owner, repo } = repoSlug();
  const form = el('form', { class: 'card' },
    el('h2', {}, 'Set up admin access'),
    el('p', { class: 'muted' }, 'One-time setup on this device. Paste a GitHub token and choose a passphrase. The token is encrypted with your passphrase and stored only in this browser — it is never committed or sent anywhere except github.com.'),
    el('p', { class: 'sm' }, 'Repo: ', el('code', { class: 'mono' }, `${owner}/${repo}`), ' — token needs ', el('strong', {}, 'Actions: Read and write'), '.'),
    el('label', {}, 'GitHub token (fine-grained PAT)'),
    el('input', { name: 'token', type: 'password', class: 'input', placeholder: 'github_pat_…', autocomplete: 'off', required: 'true' }),
    el('label', {}, 'Passphrase'),
    el('input', { name: 'pass', type: 'password', class: 'input', placeholder: 'unlock passphrase', autocomplete: 'new-password', required: 'true' }),
    el('label', {}, 'Confirm passphrase'),
    el('input', { name: 'pass2', type: 'password', class: 'input', autocomplete: 'new-password', required: 'true' }),
    el('button', { type: 'submit', class: 'btn' }, 'Encrypt & save on this device'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = form.token.value.trim();
    if (form.pass.value !== form.pass2.value) return alert('Passphrases do not match.');
    if (form.pass.value.length < 8) return alert('Use a passphrase of at least 8 characters.');
    const vault = await encryptWithPassphrase(token, form.pass.value);
    localStorage.setItem(VAULT, vault);
    session = { token, ...repoSlug() };
    render();
  });
  app.append(form,
    el('p', { class: 'muted sm center' }, 'Create a token at github.com → Settings → Developer settings → Fine-grained tokens.'));
}

function renderUnlock() {
  const form = el('form', { class: 'card' },
    el('h2', {}, 'Admin login'),
    el('p', { class: 'muted' }, 'Enter your passphrase to unlock the dashboard on this device.'),
    el('input', { name: 'pass', type: 'password', class: 'input', placeholder: 'passphrase', autocomplete: 'current-password', required: 'true' }),
    el('div', { class: 'row' },
      el('button', { type: 'submit', class: 'btn' }, 'Unlock'),
      el('button', { type: 'button', class: 'btn ghost', onclick: () => { if (confirm('Remove the stored token from this device? You will need to set it up again.')) { localStorage.removeItem(VAULT); render(); } } }, 'Reset device'),
    ),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const token = await decryptWithPassphrase(localStorage.getItem(VAULT), form.pass.value);
      session = { token, ...repoSlug() };
      render();
    } catch { alert('Wrong passphrase.'); }
  });
  app.append(form);
}

// ---- GitHub API ------------------------------------------------------------

async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${session.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function dispatch(inputs) {
  const { owner, repo } = session;
  await gh(`/repos/${owner}/${repo}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs }),
  });
}

async function listRuns() {
  const { owner, repo } = session;
  const data = await gh(`/repos/${owner}/${repo}/actions/workflows/${WORKFLOW}/runs?per_page=6`);
  return data.workflow_runs || [];
}

// ---- dashboard -------------------------------------------------------------

let busy = false;

async function act(inputs, confirmMsg) {
  if (busy) return;
  if (confirmMsg && !confirm(confirmMsg)) return;
  busy = true; render();
  try {
    await dispatch(inputs);
    toast(`Dispatched: ${inputs.action}${inputs.match_id ? ' ' + inputs.match_id : ''}. The engine is running…`, 'good');
    setTimeout(refreshRuns, 3000);
  } catch (err) {
    toast(String(err.message), 'danger');
  } finally {
    busy = false; render();
  }
}

let toastMsg = null;
function toast(text, kind) { toastMsg = { text, kind }; }

function renderDashboard() {
  const { owner, repo } = session;
  const complete = pub.status === 'complete';
  const drawn = pub.rounds && pub.rounds.length > 0;

  // Header row.
  app.append(el('div', { class: 'row spread' },
    el('h2', {}, 'Admin'),
    el('div', { class: 'row' },
      el('a', { class: 'btn ghost sm', href: 'bracket.html', target: '_blank' }, 'View public ↗'),
      el('button', { class: 'btn ghost sm', onclick: () => { session = null; render(); } }, 'Lock'),
    ),
  ));

  if (toastMsg) { app.append(el('div', { class: `card ${toastMsg.kind === 'danger' ? 'danger' : 'success'}` }, el('p', {}, toastMsg.text))); toastMsg = null; }

  // Status.
  app.append(el('div', { class: 'card' },
    el('div', { class: 'row spread' },
      el('div', {}, el('div', { class: 'muted sm' }, `${owner}/${repo}`), el('h3', {}, complete ? 'Champion crowned' : (pub.activePhase || pub.status || '—'))),
      el('span', { class: 'badge ' + (complete ? 'gold' : 'good') }, (pub.status || 'live').toUpperCase()),
    ),
    el('p', { class: 'muted sm' }, drawn ? `${pub.teamCount || 0} teams · ${pub.matchesDecided}/${pub.matchesTotal} matches decided${pub.seed ? ' · seed ' + pub.seed : ''}` : 'No draw yet.'),
    pub.champion ? el('p', { class: 'gold big' }, '🏆 ', el('span', { class: 'mono' }, pub.champion)) : null,
  ));

  // Phase-appropriate controls.
  if (complete) {
    app.append(el('div', { class: 'card' }, el('p', { class: 'muted' }, 'This tournament is complete. Stored data has been cascade-purged by the engine.')));
  } else if (!drawn) {
    app.append(el('div', { class: 'card' },
      el('h3', {}, 'Registration'),
      el('p', { class: 'muted' }, 'Collect signup issues, then run the draw once registration closes.'),
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', disabled: busy || null, onclick: () => act({ action: 'collect' }) }, 'Collect signups'),
      ),
      el('label', {}, 'Draw seed (optional)'),
      (() => {
        const seed = el('input', { class: 'input', placeholder: 'leave blank for random' });
        return el('div', {}, seed, el('button', { class: 'btn', disabled: busy || null, onclick: () => act({ action: 'draw', ...(seed.value.trim() ? { seed: seed.value.trim() } : {}) }, 'Run the draw now? This locks the field and generates the bracket.') }, 'Run the draw'));
      })(),
    ));
  } else {
    renderQueue();
  }

  // Danger zone.
  if (!complete) app.append(el('details', { class: 'card' },
    el('summary', {}, 'Danger zone'),
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost', disabled: busy || null, onclick: () => act({ action: 'sim' }, 'Simulate ALL remaining matches to a champion? For testing only.') }, 'Simulate to completion'),
      el('button', { class: 'btn ghost', disabled: busy || null, onclick: () => act({ action: 'purge' }, 'Cascade-delete ALL stored data now? This cannot be undone.') }, 'Purge all data'),
    ),
  ));

  // Activity.
  app.append(el('div', { class: 'card' },
    el('div', { class: 'row spread' }, el('h3', {}, 'Engine activity'), el('button', { class: 'btn ghost sm', onclick: refreshRuns }, 'Refresh')),
    el('div', { id: 'runs' }, el('p', { class: 'muted sm' }, 'Loading recent runs…')),
  ));
  refreshRuns();

  app.append(el('p', { class: 'muted sm center' }, 'Confirmations dispatch the engine workflow; the bracket updates once the run commits and Pages redeploys.'));
}

function renderQueue() {
  const q = (queue && queue.matches) || {};
  const entries = Object.entries(q);
  const agreed = entries.filter(([, v]) => v.status === 'agreed');
  const awaiting = entries.filter(([, v]) => v.status === 'awaiting');
  const conflicts = entries.filter(([, v]) => v.status === 'disputed' || v.status === 'tie');

  // Matches that are live but have no reports yet (for walkover override).
  const reportedIds = new Set(entries.map(([id]) => id));
  const unreported = [];
  for (const r of pub.rounds || []) for (const m of r.matches) {
    if (m.a && m.b && !m.winner && !reportedIds.has(m.id)) unreported.push({ ...m, label: r.label });
  }

  const card = el('div', { class: 'card' },
    el('div', { class: 'row spread' }, el('h3', {}, 'Result queue'), el('button', { class: 'btn ghost sm', onclick: () => act({ action: 'tally' }) }, 'Collect & tally')),
    el('p', { class: 'muted sm' }, 'Triple confirmation: both captains report matching scores → you confirm → the engine advances.'),
  );

  // Agreed — ready for the third confirmation.
  if (agreed.length) {
    card.append(el('h4', {}, `Ready to confirm (${agreed.length})`));
    for (const [id, v] of agreed) {
      card.append(el('div', { class: 'match' },
        el('div', { class: 'row spread' }, el('strong', {}, id), el('span', { class: 'badge good' }, 'AGREED')),
        el('p', {}, el('code', { class: 'mono' }, v.winner), ' wins ', el('strong', {}, `${Math.max(v.scoreA, v.scoreB)}–${Math.min(v.scoreA, v.scoreB)}`),
          ' (', el('span', { class: 'mono' }, v.a), ' ', String(v.scoreA), ' – ', String(v.scoreB), ' ', el('span', { class: 'mono' }, v.b), ')'),
        el('button', { class: 'btn', disabled: busy || null, onclick: () => act({ action: 'result', match_id: id, winner_fp: v.winner }, `Confirm ${v.winner} wins ${id} and advance the bracket?`) }, 'Confirm & advance'),
      ));
    }
  }

  // Conflicts — need a manual override.
  if (conflicts.length) {
    card.append(el('h4', {}, `Disputed (${conflicts.length})`));
    for (const [id, v] of conflicts) {
      const ra = v.reports?.[v.a], rb = v.reports?.[v.b];
      card.append(el('div', { class: 'match' },
        el('div', { class: 'row spread' }, el('strong', {}, id), el('span', { class: 'badge danger' }, v.status.toUpperCase())),
        el('p', { class: 'sm' }, el('span', { class: 'mono' }, v.a), ' reported ', ra ? `${ra.my}–${ra.opp}` : '—', ' · ', el('span', { class: 'mono' }, v.b), ' reported ', rb ? `${rb.my}–${rb.opp}` : '—'),
        el('p', { class: 'muted sm' }, 'Resolve manually:'),
        el('div', { class: 'row' },
          el('button', { class: 'btn ghost', disabled: busy || null, onclick: () => act({ action: 'result', match_id: id, winner_fp: v.a }, `Override: ${v.a} wins ${id}?`) }, v.a, ' wins'),
          el('button', { class: 'btn ghost', disabled: busy || null, onclick: () => act({ action: 'result', match_id: id, winner_fp: v.b }, `Override: ${v.b} wins ${id}?`) }, v.b, ' wins'),
        ),
      ));
    }
  }

  // Awaiting the second captain.
  if (awaiting.length) {
    card.append(el('h4', {}, `Awaiting a captain (${awaiting.length})`));
    for (const [id, v] of awaiting) {
      card.append(el('div', { class: 'match' },
        el('div', { class: 'row spread' }, el('strong', {}, id), el('span', { class: 'badge upcoming' }, 'PARTIAL')),
        el('p', { class: 'sm muted' }, el('span', { class: 'mono' }, v.reportedBy), ' reported; waiting on the other captain.'),
      ));
    }
  }

  if (!entries.length) card.append(el('p', { class: 'muted' }, 'No score reports yet. Captains submit results from their Captain view; then Collect & tally.'));
  app.append(card);

  // Walkover / manual override for matches with no reports.
  if (unreported.length) {
    const ov = el('details', { class: 'card' }, el('summary', {}, `Manual override — no reports (${unreported.length})`),
      el('p', { class: 'muted sm' }, 'Use for walkovers / no-shows. Confirms a winner without captain reports.'));
    for (const m of unreported) {
      ov.append(el('div', { class: 'match' },
        el('div', { class: 'muted sm' }, `${m.label} · ${m.id}`),
        el('div', { class: 'row' },
          el('button', { class: 'btn ghost', disabled: busy || null, onclick: () => act({ action: 'result', match_id: m.id, winner_fp: m.a }, `Walkover: ${m.a} wins ${m.id}?`) }, m.a, ' wins'),
          el('span', { class: 'muted' }, 'vs'),
          el('button', { class: 'btn ghost', disabled: busy || null, onclick: () => act({ action: 'result', match_id: m.id, winner_fp: m.b }, `Walkover: ${m.b} wins ${m.id}?`) }, m.b, ' wins'),
        ),
      ));
    }
    app.append(ov);
  }
}

async function refreshRuns() {
  const box = document.getElementById('runs');
  if (!box) return;
  try {
    const runs = await listRuns();
    clear(box);
    if (!runs.length) { box.append(el('p', { class: 'muted sm' }, 'No runs yet.')); return; }
    for (const r of runs) {
      const done = r.status === 'completed';
      const kind = !done ? 'good' : (r.conclusion === 'success' ? 'past' : 'danger');
      box.append(el('div', { class: 'row spread', style: 'padding:6px 0;border-bottom:1px solid var(--line)' },
        el('div', {}, el('span', { class: 'badge ' + kind }, done ? (r.conclusion || '—') : r.status),
          ' ', el('span', { class: 'sm' }, new Date(r.created_at).toLocaleString())),
        el('a', { class: 'sm', href: r.html_url, target: '_blank', rel: 'noopener' }, `run #${r.run_number} ↗`),
      ));
    }
  } catch (err) {
    clear(box);
    box.append(el('p', { class: 'muted sm' }, 'Could not load runs: ' + err.message));
  }
}

boot();
