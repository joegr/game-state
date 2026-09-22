// game-state — index.html dispatcher.
//
// • Organizer's device (admin access was set up here → a console PIN exists in
//   localStorage) → go straight to the admin dashboard.
// • Everyone else → a clean one-line, one-button anonymous captain sign-up.
//
// The PIN check is just routing convenience, not security: it's a local
// device lock, not a credential — see js/admin.js.

import { loadTournament, loadTournamentState } from './config.js';
import { isSignupOpen } from './stateMachine.js';
import { el, clear, identityStore } from './util.js';
import { randomToken, fingerprint } from './identity.js';
import { renderSubmission } from './signup.js';

const ADMIN_PIN = 'game-state:admin:pin';
const app = document.getElementById('app');

if (localStorage.getItem(ADMIN_PIN)) {
  location.replace('admin.html');
} else {
  boot();
}

async function boot() {
  let tournament, progress;
  try {
    tournament = await loadTournament();
    ({ progress } = await loadTournamentState(tournament));
  } catch (e) {
    app.append(el('div', { class: 'card danger' }, 'Config error: ' + e.message));
    return;
  }
  document.getElementById('tourney-name').textContent = tournament.name;
  document.title = `${tournament.name} · game-state`;
  render(tournament, progress);
}

function footer() {
  return el('p', { class: 'muted sm center' },
    el('a', { href: 'bracket.html' }, 'Public bracket'), ' · ',
    el('a', { href: 'captain.html#/captain' }, 'Captain view'));
}

function render(tournament, progress) {
  clear(app);
  const existing = identityStore.load(tournament.name);

  // Already registered on this device → show the team code + a way in.
  if (existing) {
    app.append(
      el('div', { class: 'card center hero' },
        el('p', { class: 'muted' }, 'You are registered as'),
        el('p', { class: 'mono big' }, existing.fp),
        el('a', { class: 'btn', href: 'captain.html#/captain' }, 'Open captain view'),
      ),
      footer());
    return;
  }

  // Signup phase over, or every group already full.
  if (!isSignupOpen(tournament, progress)) {
    const msg = progress?.full ? 'Registration is full — thanks for your interest!' : 'Registration is not open yet.';
    app.append(el('div', { class: 'card center hero' }, el('p', { class: 'muted' }, msg)), footer());
    return;
  }

  // The clean single-line, single-button sign-up.
  const out = el('div', {});
  const btn = el('button', { class: 'btn', onclick: async () => {
    btn.disabled = true;
    const token = randomToken();
    const fp = await fingerprint(token); // 4-char team code
    identityStore.save(tournament.name, { fp, token });
    clear(app);
    app.append(out, footer());
    renderSubmission(out, tournament, { fp, token });
  } }, 'Create my anonymous team');

  app.append(
    el('div', { class: 'card center hero' },
      el('p', { class: 'lead' }, 'Join the tournament — anonymous, no account.'),
      btn,
    ),
    out,
    footer());
}
