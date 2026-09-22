// game-state — index.html: the registration page, for everyone.
//
// Two generated fields, two buttons:
//   1. your team code        — the anonymous identity the bracket shows
//   2. your score report key — what report.html asks for, every time
//
// Nothing is typed and nothing is collected: the browser mints a random token,
// the code is a hash of it, and the key is that same token with the code
// attached. One secret per team, shown twice for two different jobs.
//
// The organizer gets the same page as everybody else, plus a modal (see
// js/organizer.js) on devices where they've set a PIN. That modal is a status
// view with copyable commands — it cannot change the tournament, because
// nothing in a browser can.

import { loadTournament, loadTournamentState } from './config.js';
import { isSignupOpen } from './stateMachine.js';
import { el, clear, identityStore, copy } from './util.js';
import { randomToken, generateCode, formatKey, signupEntry } from './identity.js';
import { mountOrganizer } from './organizer.js';

const app = document.getElementById('app');

boot();

async function boot() {
  let tournament, live;
  try {
    tournament = await loadTournament();
    live = await loadTournamentState(tournament);
  } catch (e) {
    app.append(el('div', { class: 'card danger' }, 'Config error: ' + e.message));
    return;
  }
  document.getElementById('tourney-name').textContent = tournament.name;
  document.title = `${tournament.name} · game-state`;
  render(tournament, live);
  mountOrganizer(tournament, live);
}

function footer() {
  return el('p', { class: 'muted sm center' },
    el('a', { href: 'bracket.html' }, 'Public bracket'), ' · ',
    el('a', { href: 'report.html' }, 'Report a score'), ' · ',
    el('a', { href: 'captain.html' }, 'Captain view'));
}

function render(tournament, live) {
  clear(app);
  const existing = identityStore.load(tournament.name);

  // Already registered on this device → show both fields, already filled.
  if (existing) {
    app.append(renderFields(tournament, existing, { registered: true }), footer());
    return;
  }

  if (!isSignupOpen(tournament, live.progress)) {
    const msg = live.progress?.full
      ? 'Registration is full — thanks for your interest!'
      : 'Registration is not open yet.';
    app.append(
      el('div', { class: 'card center hero' },
        el('p', { class: 'muted' }, msg),
        el('p', { class: 'muted sm' }, 'Already registered? ',
          el('a', { href: 'report.html' }, 'Report a score'), ' with your key.'),
      ),
      footer());
    return;
  }

  app.append(renderFields(tournament, null, { registered: false }), footer());
}

// The two-field form. Both values are generated, never typed — field 2 stays
// locked until field 1 exists, because the key is derived from that token.
function renderFields(tournament, existing, { registered }) {
  const card = el('div', { class: 'card' },
    el('h2', {}, 'Register your team'),
    el('p', { class: 'muted' }, 'No name, no email, no account. Your team is a random four-character code, and one secret proves it is yours.'),
  );

  const codeField = el('input', { class: 'input mono big', readonly: '', placeholder: '————', value: existing?.fp || '' });
  const keyField = el('textarea', { class: 'input mono', rows: '2', readonly: '', placeholder: 'generated in step 2' });
  const entryOut = el('div', {});
  const keyOut = el('div', {});

  const keyBtn = el('button', { class: 'btn', disabled: registered ? null : '', onclick: async () => {
    const id = identityStore.load(tournament.name);
    if (!id) return;
    keyField.value = await formatKey(id.token);
    renderKeyActions(keyOut, id, keyField.value);
  } }, 'Generate my score report key');

  const codeBtn = el('button', { class: 'btn', disabled: registered ? '' : null, onclick: async () => {
    codeBtn.disabled = true;
    const token = randomToken();
    const fp = await generateCode(token);
    identityStore.save(tournament.name, { fp, token });
    codeField.value = fp;
    keyBtn.disabled = false;
    renderEntry(entryOut, tournament, token);
  } }, 'Create my anonymous team');

  card.append(
    el('div', { class: 'field' },
      el('label', { class: 'field-label' }, '1 · Your team code'),
      el('p', { class: 'muted sm' }, 'This is how you appear on the public bracket.'),
      codeField,
      el('div', { class: 'row' }, codeBtn),
    ),
    el('hr', {}),
    el('div', { class: 'field' },
      el('label', { class: 'field-label' }, '2 · Your score report key'),
      el('p', { class: 'muted sm' }, 'Paste this into the reporting page every time you report a result. Save it now — it cannot be recovered.'),
      keyField,
      el('div', { class: 'row' }, keyBtn),
      keyOut,
    ),
  );

  if (registered && existing) {
    card.append(
      el('hr', {}),
      el('div', { class: 'row' },
        el('a', { class: 'btn ghost', href: 'report.html' }, 'Report a score'),
        el('a', { class: 'btn ghost', href: 'captain.html' }, 'Captain view'),
        el('button', { class: 'btn ghost', onclick: () => {
          if (!confirm('Forget this team on this device? Without your saved key you cannot report a score again.')) return;
          identityStore.clear(tournament.name);
          location.reload();
        } }, 'Forget on this device'),
      ));
    renderEntry(entryOut, tournament, existing.token);
  }

  card.append(entryOut);
  return card;
}

// Step 1's output: the blob the organizer ingests. This is a different artifact
// from the key — it goes to the organizer, the key stays with the captain.
function renderEntry(out, tournament, token) {
  clear(out);
  const entry = signupEntry(token);
  out.append(el('div', { class: 'card success' },
    el('h4', {}, 'Send this entry to the organizer'),
    el('p', { class: 'muted sm' }, 'Post it in your tournament channel (Discord, chat, email). You are not on the roster until the organizer ingests it.'),
    el('pre', { class: 'blob' }, entry),
    el('button', { class: 'btn', onclick: async (e) => {
      e.target.textContent = (await copy(entry)) ? 'Copied ✓' : 'Copy failed';
    } }, 'Copy entry'),
  ));
}

// Step 2's output: save-your-key actions. Plain text, not JSON — everything in
// this app that is written down is readable text.
function renderKeyActions(out, id, key) {
  clear(out);
  const file = `game-state score report key
tournament key for team ${id.fp}

${key}

Keep this private. Anyone holding it can report scores as your team.
`;
  const dl = URL.createObjectURL(new Blob([file], { type: 'text/plain' }));
  out.append(el('div', { class: 'card success' },
    el('p', { class: 'warn' }, '⚠ Save this key now. It is the only way to prove you are ', el('code', { class: 'mono' }, id.fp), ', and it cannot be recovered.'),
    el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: async (e) => {
        e.target.textContent = (await copy(key)) ? 'Copied ✓' : 'Copy failed';
      } }, 'Copy key'),
      el('a', { class: 'btn ghost', href: dl, download: `game-state-${id.fp}-key.txt` }, 'Download key'),
    ),
  ));
}
