// game-state — anonymous signup.
//
// A captain's identity is a random token generated on their device. The
// published roster carries only its hash, so a captain who kept their token is
// the only one who can later report a score as that team.

import { el, clear, identityStore, copy } from './util.js';
import { randomToken, fingerprint } from './identity.js';
import { isSignupOpen } from './stateMachine.js';

export async function renderSignup(root, tournament, pub) {
  clear(root);

  const existing = identityStore.load(tournament.name);

  if (existing) {
    root.append(el('div', { class: 'card' },
      el('h2', {}, 'You are registered'),
      el('p', { class: 'muted' }, 'Your token is stored on this device. Use the Captain view to track your run.'),
      el('p', {}, el('code', { class: 'mono' }, existing.fp)),
      el('button', { class: 'btn ghost', onclick: () => { if (confirm('Forget this token? You cannot recover it.')) { identityStore.clear(tournament.name); renderSignup(root, tournament, pub); } } }, 'Forget token on this device'),
    ));
    return;
  }

  if (!isSignupOpen(tournament, pub)) {
    root.append(el('div', { class: 'card' },
      el('h2', {}, pub?.full ? 'Registration is full' : 'Registration is not open yet'),
      el('p', { class: 'muted' }, pub?.full
        ? 'Every group has its full complement of teams — thanks for your interest!'
        : 'The organizer hasn\'t opened signups yet. Check back soon.'),
    ));
    return;
  }

  const form = el('form', { class: 'card' },
    el('h2', {}, 'Register your team'),
    el('p', { class: 'muted' }, 'No name to pick, no account, no email. We generate a random token on your device and assign your team a random four-character code — that anonymous code is your team throughout the tournament.'),
    el('button', { type: 'submit', class: 'btn' }, 'Create my anonymous team'),
  );
  const out = el('div', { class: 'signup-out' });
  root.append(form, out);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelector('button').disabled = true;

    const token = randomToken();
    const fp = await fingerprint(token); // the 4-char team code

    identityStore.save(tournament.name, { fp, token });

    renderSubmission(out, tournament, { fp, token });
  });
}

export function renderSubmission(out, tournament, { fp, token }) {
  clear(out);
  const backup = JSON.stringify({ tournament: tournament.name, fp, token }, null, 2);
  const dl = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));
  const entry = `${fp}:${token}`;

  out.append(el('div', { class: 'card success' },
    el('h3', {}, 'Registered ✓'),
    el('p', {}, 'Your team code: ', el('code', { class: 'mono big' }, fp)),
    el('p', { class: 'warn' }, '⚠ Save your token now. It is the ONLY way to prove you are this team, and it cannot be recovered.'),
    el('div', { class: 'row' },
      el('a', { class: 'btn', href: dl, download: `game-state-${fp}.token.json` }, 'Download token'),
      el('button', { class: 'btn ghost', onclick: async (e) => { e.target.textContent = (await copy(backup)) ? 'Copied ✓' : 'Copy failed'; } }, 'Copy token'),
    ),
    el('hr', {}),
    el('h4', {}, 'Submit your entry'),
    el('p', { class: 'muted' }, 'Send your team code and token to the organizer through your tournament channel (Discord, chat, email). This repo is public, so send it privately — anyone who has your token can act as your team.'),
    el('pre', { class: 'blob' }, entry),
    el('button', { class: 'btn', onclick: async (e) => { e.target.textContent = (await copy(entry)) ? 'Copied ✓' : 'Copy failed'; } }, 'Copy code + token'),
  ));
}
