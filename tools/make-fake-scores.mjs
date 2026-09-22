#!/usr/bin/env node
// TEST HELPER — generate fake score reports into scores/, for local demos.
// Not used in production. Mirrors what a captain's browser produces.
//
//   node make-fake-scores.mjs [--dispute <matchId>]
//
// For every pending first-level match (both teams known, no winner) it writes
// two mirrored reports (team A wins 2-1). For --dispute <id>, team B lies.
// Reads tools/fake-captains.json (from make-fake-roster.mjs) for tokens.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { encodeBlob } from '../js/identity.js';
import { p } from './lib.mjs';

const disputeId = (() => { const i = process.argv.indexOf('--dispute'); return i >= 0 ? process.argv[i + 1] : null; })();
const pub = JSON.parse(readFileSync(p('config', 'public.json'), 'utf8'));
const caps = JSON.parse(readFileSync(p('tools', 'fake-captains.json'), 'utf8'));
const byFp = new Map(caps.map((c) => [c.fp, c]));

mkdirSync(p('scores'), { recursive: true });
let n = 0;
for (const round of pub.rounds) {
  for (const m of round.matches) {
    if (!m.a || !m.b || m.winner) continue;
    const a = byFp.get(m.a), b = byFp.get(m.b);
    if (!a || !b) continue;
    // A wins 2-1 (mirrored reports).
    const aRep = { v: 1, fp: a.fp, token: a.token, matchId: m.id, myScore: 2, oppScore: 1, ts: new Date().toISOString() };
    const bRep = { v: 1, fp: b.fp, token: b.token, matchId: m.id, myScore: 1, oppScore: 2, ts: new Date().toISOString() };
    if (disputeId === m.id) bRep.myScore = 5; // B claims a different, non-mirroring score
    writeFileSync(p('scores', `${m.id}-a.txt`), encodeBlob(aRep) + '\n');
    writeFileSync(p('scores', `${m.id}-b.txt`), encodeBlob(bRep) + '\n');
    n += 2;
  }
}
console.log(`Wrote ${n} fake score report(s) to scores/${disputeId ? ` (disputed: ${disputeId})` : ''}`);
