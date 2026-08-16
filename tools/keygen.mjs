#!/usr/bin/env node
// game-state — organizer key generator.
//
// Produces the organizer keypair. The PUBLIC key goes into
// config/tournament.json (so browsers can encrypt signups to you). The PRIVATE
// key is your secret — keep it out of the repo. Store it as a GitHub Actions
// secret (ORGANIZER_PRIVATE_KEY) if you process signups in CI, and/or in a local
// file you never commit.
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
  console.log('PRIVATE KEY (SECRET — never commit; store as ORGANIZER_PRIVATE_KEY):\n');
  console.log(privateKey + '\n');
  console.log('Tip:  node keygen.mjs --json > organizer.keys.json   (add to .gitignore)\n');
}
