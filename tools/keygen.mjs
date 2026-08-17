#!/usr/bin/env node
// game-state — organizer key generator.
//
// Produces the organizer keypair. The PUBLIC key goes into
// config/tournament.json (so captains can encrypt signups + scores to you). The
// PRIVATE key is your only privileged credential: load it into the admin console
// (admin.html), where it is encrypted under your passphrase in your browser.
// Keep it out of the repo. (Only needed as an ORGANIZER_PRIVATE_KEY secret if you
// also use the optional CLI/CI path.)
//
// Usage:
//   node keygen.mjs            human-readable banner
//   node keygen.mjs --json     pure JSON to stdout (e.g. > organizer.keys.json)

import { generateKeypair } from '../js/crypto.js';

const { publicKey, privateKey } = await generateKeypair();

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify({ publicKey, privateKey }, null, 2) + '\n');
} else {
  console.log('\n=== game-state organizer keypair ===\n');
  console.log('PUBLIC KEY  (paste into config/tournament.json -> organizerPublicKey):\n');
  console.log(publicKey + '\n');
  console.log('PRIVATE KEY (SECRET — never commit; load into admin.html to unlock the console):\n');
  console.log(privateKey + '\n');
  console.log('Tip:  node keygen.mjs --json > organizer.keys.json   (gitignored; upload this file in admin.html)\n');
}
