#!/usr/bin/env node
// TEST HELPER — generate N fake encrypted signups into signups/ for local demos.
// Not used in production. Usage: node make-fake-signups.mjs [count]
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateKeypair, seal, fingerprint } from '../js/crypto.js';
import { p } from './lib.mjs';

const n = Number(process.argv[2] || 8);
const pub = JSON.parse(await import('node:fs').then((m) => m.readFileSync(p('config', 'tournament.json'), 'utf8'))).organizerPublicKey;
mkdirSync(p('signups'), { recursive: true });
const saved = [];
for (let i = 0; i < n; i++) {
  const k = await generateKeypair();
  const fp = await fingerprint(k.publicKey);
  const payload = JSON.stringify({ v: 1, teamName: `Team ${i + 1}`, captainPublicKey: k.publicKey, ts: new Date().toISOString() });
  const sealed = await seal(payload, pub);
  writeFileSync(p('signups', `${fp}.txt`), '```\n' + sealed + '\n```\n');
  saved.push({ fp, ...k });
}
mkdirSync(p('state'), { recursive: true });
writeFileSync(p('tools', 'fake-captains.json'), JSON.stringify(saved, null, 2));
console.log(`Wrote ${n} fake signups to signups/ and their keys to tools/fake-captains.json`);
