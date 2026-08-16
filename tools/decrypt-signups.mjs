#!/usr/bin/env node
// game-state — decrypt collected signups into an ANONYMIZED team list.
//
// Reads every sealed blob under signups/ (one per file; the collect workflow
// drops issue bodies here), decrypts with the organizer private key, and writes
// state/teams.json holding ONLY { fp, captainPublicKey } per team.
//
// The plaintext team name is intentionally discarded: the organizer never needs
// it (teams are opaque fingerprints everywhere), and the captain already holds
// their own name locally. Nothing that could deanonymize a captain is persisted.
//
// Usage:  node decrypt-signups.mjs

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { unseal, fingerprint } from '../js/crypto.js';
import { p, organizerPrivateKey } from './lib.mjs';

const priv = organizerPrivateKey();
const dir = p('signups');
if (!existsSync(dir)) { console.log('No signups/ directory — nothing to decrypt.'); process.exit(0); }

const files = readdirSync(dir).filter((f) => !f.startsWith('.'));
const byFp = new Map();
let ok = 0, bad = 0;

for (const f of files) {
  const raw = readFileSync(p('signups', f), 'utf8');
  // Accept a raw blob or a fenced ```blob``` from an issue body.
  const m = raw.match(/```\s*([A-Za-z0-9_-]{80,})\s*```/) || raw.match(/([A-Za-z0-9_-]{80,})/);
  if (!m) { bad++; continue; }
  try {
    const payload = JSON.parse(await unseal(m[1], priv));
    const fp = await fingerprint(payload.captainPublicKey);
    byFp.set(fp, { fp, captainPublicKey: payload.captainPublicKey }); // dedupe by fp
    ok++;
  } catch { bad++; }
}

const teams = [...byFp.values()];
mkdirSync(p('state'), { recursive: true });
writeFileSync(p('state', 'teams.json'), JSON.stringify({ generatedAt: new Date().toISOString(), teamCount: teams.length, teams }, null, 2) + '\n');
console.log(`Decrypted ${ok} signup(s), ${bad} unreadable. Wrote state/teams.json with ${teams.length} unique team(s).`);
