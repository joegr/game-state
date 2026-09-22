#!/usr/bin/env node
// TEST HELPER — generate N fake tokens + a roster.md for local demos.
// Not used in production. Usage: node make-fake-roster.mjs [count]
//
// Writes tools/fake-roster.md (point ROSTER_FILE at it for advance.mjs) and
// tools/fake-captains.json (the raw tokens, so make-fake-scores.mjs can act
// as those captains).

import { writeFileSync } from 'node:fs';
import { randomToken, hashToken, fingerprint } from '../js/identity.js';
import { formatRosterMd } from '../js/engine.js';
import { p } from './lib.mjs';

const n = Number(process.argv[2] || 8);
const teams = [];
for (let i = 0; i < n; i++) {
  const token = randomToken();
  teams.push({ fp: await fingerprint(token), tokenHash: await hashToken(token), registeredAt: new Date().toISOString(), token });
}

writeFileSync(p('tools', 'fake-roster.md'), formatRosterMd(teams));
writeFileSync(p('tools', 'fake-captains.json'), JSON.stringify(teams, null, 2));
console.log(`Wrote ${n} fake team(s) to tools/fake-roster.md and their tokens to tools/fake-captains.json`);
console.log('Use it locally with: ROSTER_FILE=tools/fake-roster.md node advance.mjs draw');
