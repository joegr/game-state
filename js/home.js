// game-state — index.html dispatcher.
//
// • Organizer's device (admin access was set up here → an encrypted vault exists
//   in localStorage) → go straight to the admin dashboard.
// • Everyone else → a clean one-line, one-button anonymous captain sign-up.
//
// The vault check is just routing convenience, not security: the dashboard is
// still gated by the passphrase + organizer key regardless of where you land.

import { loadTournament } from './config.js';
import { el, clear, keyStore } from './util.js';
import { generateKeypair, seal, fingerprint } from './crypto.js';
import { renderSubmission } from './signup.js';

const ADMIN_VAULT = 'game-state:admin:vault';
const app = document.getElementById('app');

if (localStorage.getItem(ADMIN_VAULT)) {
  location.replace('admin.html');
} else {
  boot();
}

async function boot() {
  let tournament;
  try {
    tournament = await loadTournament();
  } catch (e) {
    app.append(el('div', { class: 'card danger' }, 'Config error: ' + e.message));
    return;
  }
  document.getElementById('tourney-name').textContent = tournament.name;
  document.title = `${tournament.name} · game-state`;
  render(tournament);
}

function footer() {
  return el('p', { class: 'muted sm center' },
    el('a', { href: 'bracket.html' }, 'Public bracket'), ' · ',
    el('a', { href: 'captain.html#/captain' }, 'Captain view'));
}

function render(tournament) {
  clear(app);
  const existing = keyStore.load(tournament.name);

  // Already registered on this device → show the team code + a way in.
  if (existing) {
    app.append(
      el('div', { class: 'card center hero' },
        el('p', { class: 'muted' }, 'You are registered as'),
        el('p', { class: 'mono big' }, existing.fingerprint),
        el('a', { class: 'btn', href: 'captain.html#/captain' }, 'Open captain view'),
      ),
      footer());
    return;
  }

  // Registration not configured/open yet.
  if (!tournament.organizerPublicKey) {
    app.append(el('div', { class: 'card center hero' }, el('p', { class: 'muted' }, 'Registration is not open yet.')), footer());
    return;
  }

  // The clean single-line, single-button sign-up.
  const out = el('div', {});
  const btn = el('button', { class: 'btn', onclick: async () => {
    btn.disabled = true;
    const captain = await generateKeypair();
    const fp = await fingerprint(captain.publicKey); // 4-char team code
    const payload = JSON.stringify({ v: 1, captainPublicKey: captain.publicKey, ts: new Date().toISOString() });
    const sealed = await seal(payload, tournament.organizerPublicKey);
    keyStore.save(tournament.name, { ...captain, fingerprint: fp, teamName: fp });
    clear(app);
    app.append(out, footer());
    renderSubmission(out, tournament, { sealed, fp, captain });
  } }, 'Create my anonymous team');

  app.append(
    el('div', { class: 'card center hero' },
      el('p', { class: 'lead' }, 'Join the tournament — anonymous, encrypted, no account.'),
      btn,
    ),
    out,
    footer());
}
