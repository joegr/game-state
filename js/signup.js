// game-state — anonymous encrypted signup.
//
// Everything here happens in the browser. The captain's identity is a freshly
// generated keypair that never leaves their device except as a public key inside
// an encrypted-to-the-organizer blob. The organizer learns the team name only
// after decrypting with their private key; the public site never sees it.

import { el, clear, keyStore, copy } from './util.js';
import { generateKeypair, seal, fingerprint } from './crypto.js';

export async function renderSignup(root, tournament) {
  clear(root);

  if (!tournament.organizerPublicKey) {
    root.append(el('div', { class: 'card' },
      el('h2', {}, 'Registration not open yet'),
      el('p', { class: 'muted' }, 'The organizer has not published a signup key for this tournament. Check back soon.'),
    ));
    return;
  }

  const existing = keyStore.load(tournament.name);

  if (existing) {
    root.append(el('div', { class: 'card' },
      el('h2', {}, 'You are registered'),
      el('p', { class: 'muted' }, 'Your captain key is stored on this device. Use the Captain view to track your run.'),
      el('p', {}, el('code', { class: 'mono' }, existing.fingerprint)),
      el('button', { class: 'btn ghost', onclick: () => { if (confirm('Forget this captain key? You cannot recover it.')) { keyStore.clear(tournament.name); renderSignup(root, tournament); } } }, 'Forget key on this device'),
    ));
    return;
  }

  const form = el('form', { class: 'card' },
    el('h2', {}, 'Register your team'),
    el('p', { class: 'muted' }, 'No name to pick, no account, no email. We generate a private captain key on your device and assign your team a random four-character code — that anonymous code is your team throughout the tournament.'),
    el('button', { type: 'submit', class: 'btn' }, 'Create my anonymous team'),
  );
  const out = el('div', { class: 'signup-out' });
  root.append(form, out);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelector('button').disabled = true;

    const captain = await generateKeypair();
    const fp = await fingerprint(captain.publicKey); // the 4-char team code
    const payload = JSON.stringify({
      v: 1, captainPublicKey: captain.publicKey, ts: new Date().toISOString(),
    });
    const sealed = await seal(payload, tournament.organizerPublicKey);

    keyStore.save(tournament.name, { ...captain, fingerprint: fp, teamName: fp });

    renderSubmission(out, tournament, { sealed, fp, captain });
  });
}

function renderSubmission(out, tournament, { sealed, fp, captain }) {
  clear(out);
  const body = `game-state signup\nteam: ${fp}\n\n\`\`\`\n${sealed}\n\`\`\`\n`;
  const repo = tournament.signup?.repo || 'your-org/your-tournament';
  const issueUrl = `https://github.com/${repo}/issues/new?title=${encodeURIComponent((tournament.signup?.issueTitlePrefix || 'signup') + ': ' + fp)}&body=${encodeURIComponent(body)}`;

  const backup = JSON.stringify({ tournament: tournament.name, ...captain, fingerprint: fp }, null, 2);
  const dl = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));

  out.append(el('div', { class: 'card success' },
    el('h3', {}, 'Entry sealed ✓'),
    el('p', {}, 'Your team code: ', el('code', { class: 'mono big' }, fp)),
    el('p', { class: 'warn' }, '⚠ Save your captain key now. It is the ONLY way to view your progress and it cannot be recovered.'),
    el('div', { class: 'row' },
      el('a', { class: 'btn', href: dl, download: `game-state-${fp}.key.json` }, 'Download captain key'),
      el('button', { class: 'btn ghost', onclick: async (e) => { e.target.textContent = (await copy(backup)) ? 'Copied ✓' : 'Copy failed'; } }, 'Copy key'),
    ),
    el('hr', {}),
    el('h4', {}, 'Submit your entry'),
    el('p', { class: 'muted' }, 'Send the encrypted blob to the organizer via a GitHub issue (opens pre-filled):'),
    el('div', { class: 'row' },
      el('a', { class: 'btn', href: issueUrl, target: '_blank', rel: 'noopener' }, 'Open pre-filled GitHub issue'),
      el('button', { class: 'btn ghost', onclick: async (e) => { e.target.textContent = (await copy(sealed)) ? 'Copied ✓' : 'Copy failed'; } }, 'Copy encrypted blob'),
    ),
    el('details', {}, el('summary', {}, 'Show encrypted entry'), el('pre', { class: 'blob' }, sealed)),
  ));
}
