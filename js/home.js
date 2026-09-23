// game-state — index.html: registration.
//
// Two generated fields, then one submit:
//   1. your team code — public; how the bracket shows you
//   2. your PIN       — secret, 4 digits; proves you are that team
// Register dispatches the intake workflow (js/api.js), which queues the
// registration in the private tentative repo. The organizer reviews it, and
// the roster is published when they close registration. Nothing about the
// captain is collected, and afterwards the device stays signed in as that team.

import { loadTournament, loadTournamentState } from './config.js';
import { gate } from './engine.js';
import { el, clear, identityStore, copy, confirmButton } from './util.js';
import { randomToken, generateCode, randomPin } from './identity.js';
import { submit, submitReady } from './api.js';
import { mountOrganizer } from './organizer.js';

const app = document.getElementById('app');
let tournament, record;

boot();

async function boot() {
  try {
    tournament = await loadTournament();
    record = await loadTournamentState(tournament);
  } catch (e) {
    app.append(el('div', { class: 'card danger' }, 'Config error: ' + e.message));
    return;
  }
  document.getElementById('tourney-name').textContent = tournament.name;
  document.title = `${tournament.name} · game-state`;
  render();
  mountOrganizer(tournament, record);
}

function footer() {
  return el('p', { class: 'muted sm center' },
    el('a', { href: 'bracket.html' }, 'Public bracket'), ' · ',
    el('a', { href: 'captain.html' }, 'Captain view · submit a score'));
}

function render() {
  clear(app);
  const me = identityStore.load(tournament.name);
  if (me?.fp && me?.pin) return app.append(renderSignedIn(me), footer());

  const open = gate('signup:intake', record.stage);
  if (!open.ok) {
    const why = record.stage === 'invalid' ? 'The tournament record is being corrected — check back shortly.'
      : record.stage === 'registration' ? '' : 'Registration is closed.';
    app.append(el('div', { class: 'card center hero' },
      el('p', { class: 'muted' }, why || open.error),
      el('p', { class: 'muted sm' }, 'Already registered? ', el('a', { href: 'captain.html' }, 'Sign in to the captain view'), '.'),
    ), footer());
    return;
  }
  if (!submitReady()) {
    app.append(el('div', { class: 'card center hero' },
      el('p', { class: 'muted' }, 'Registration opens as soon as the organizer finishes connecting submissions.'),
    ), footer());
    return;
  }
  app.append(renderForm(), footer());
}

function renderForm() {
  let token = null, pin = null;
  const codeField = el('input', { class: 'input mono big', readonly: '', placeholder: '————', 'aria-label': 'Team code' });
  const pinField = el('input', { class: 'input mono big', readonly: '', placeholder: '····', 'aria-label': 'PIN' });
  const out = el('div', {});

  const registerBtn = el('button', { class: 'btn', disabled: '' }, 'Register my team');
  const pinBtn = el('button', { class: 'btn ghost', disabled: '', onclick: () => {
    pin = randomPin();
    pinField.value = pin;
    registerBtn.disabled = false;
  } }, 'Generate my PIN');
  const codeBtn = el('button', { class: 'btn ghost', onclick: async () => {
    token = randomToken();
    codeField.value = await generateCode(token);
    pinBtn.disabled = false;
  } }, 'Generate my team code');

  registerBtn.addEventListener('click', async () => {
    registerBtn.disabled = true; codeBtn.disabled = true; pinBtn.disabled = true;
    clear(out);
    const progress = el('p', { class: 'muted sm' }, 'Sending…');
    out.append(progress, el('p', { class: 'muted sm' }, 'Registration runs through GitHub Actions and takes about half a minute. Keep this page open.'));
    const res = await submit('signup', { token, pin }, (label) => { progress.textContent = label; });
    clear(out);
    if (res.accepted) {
      identityStore.save(tournament.name, { fp: codeField.value, pin });
      render();
      return;
    }
    out.append(el('p', { class: 'sm danger' }, res.message));
    if (res.error) { registerBtn.disabled = false; codeBtn.disabled = false; pinBtn.disabled = false; return; }
    // Refused on the merits (code taken, registration closed): start fresh.
    codeField.value = ''; pinField.value = ''; token = null; pin = null;
    codeBtn.disabled = false;
  });

  return el('div', { class: 'card' },
    el('h2', {}, 'Register your team'),
    el('p', { class: 'muted' }, 'No name, no email, no account. Your team is a random code, and a PIN only you know proves it is yours.'),
    el('div', { class: 'field' },
      el('label', { class: 'field-label' }, '1 · Team code'),
      el('p', { class: 'muted sm' }, 'Public — this is how you appear on the bracket.'),
      codeField, el('div', { class: 'row' }, codeBtn)),
    el('hr', {}),
    el('div', { class: 'field' },
      el('label', { class: 'field-label' }, '2 · PIN'),
      el('p', { class: 'muted sm' }, 'Secret — you need it with your team code to submit scores. Write it down.'),
      pinField, el('div', { class: 'row' }, pinBtn)),
    el('hr', {}),
    el('div', { class: 'row' }, registerBtn),
    out,
  );
}

function renderSignedIn(me) {
  const published = record.roster.some((t) => t.fp === me.fp);
  const creds = `Team code: ${me.fp}\nPIN: ${me.pin}`;
  const pinShown = el('code', { class: 'mono big' }, '••••');
  const note = published
    ? 'Your team is on the published roster. Your match appears in the captain view once the draw runs.'
    : record.stage === 'registration'
      ? 'Your registration is in. The organizer reviews registrations and publishes the roster when registration closes.'
      : 'Your team is not on the published roster.';
  return el('div', { class: 'card' },
    el('div', { class: 'row spread' },
      el('h2', {}, 'You are registered'),
      el('span', { class: 'badge ' + (published ? 'good' : 'upcoming') }, published ? 'ON THE ROSTER' : 'REGISTERED')),
    el('p', { class: 'muted' }, note),
    el('div', { class: 'creds' },
      el('div', {}, el('div', { class: 'muted sm' }, 'Team code'), el('code', { class: 'mono big' }, me.fp)),
      el('div', {}, el('div', { class: 'muted sm' }, 'PIN'), pinShown,
        el('button', { class: 'btn ghost sm', onclick: (e) => {
          const hidden = pinShown.textContent === '••••';
          pinShown.textContent = hidden ? me.pin : '••••';
          e.target.textContent = hidden ? 'Hide' : 'Show';
        } }, 'Show'))),
    el('p', { class: 'warn sm' }, '⚠ Save your team code and PIN somewhere safe. On another device you sign in with both; only the organizer can issue a new PIN.'),
    el('div', { class: 'row' },
      el('a', { class: 'btn', href: 'captain.html' }, 'Open captain view'),
      el('button', { class: 'btn ghost', onclick: async (e) => { e.target.textContent = (await copy(creds)) ? 'Copied ✓' : 'Copy failed'; } }, 'Copy code + PIN'),
      confirmButton('Sign out · register another team', 'Tap again — have you saved your code and PIN?', () => {
        identityStore.clear(tournament.name);
        render();
      })),
  );
}
