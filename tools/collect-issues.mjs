#!/usr/bin/env node
// game-state — collect submission issues into a directory.
//
// Signups and score reports both arrive as GitHub issues (the browser opens a
// pre-filled one). External captains can't set labels, so we match by TITLE
// keyword instead, extract the sealed blob from the body, save it, then label
// the issue `collected` and close it. Runs in CI where `gh` is authenticated.
//
// Usage:
//   node collect-issues.mjs --title signup --dir signups
//   node collect-issues.mjs --title score  --dir scores

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { p } from './lib.mjs';

const arg = (name, def) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; };
const title = arg('--title', 'signup');
const dir = arg('--dir', 'signups');

function gh(args) { return execSync(`gh ${args}`, { encoding: 'utf8' }); }

let issues;
try {
  // Match the keyword in the issue title; skip anything already collected.
  issues = JSON.parse(gh(`issue list --state open --search ${JSON.stringify(`${title} in:title -label:collected`)} --json number,title,body --limit 500`));
} catch (e) {
  console.error('Could not list issues (is `gh` authenticated?):', e.message); process.exit(1);
}
if (!issues.length) { console.log(`No open "${title}" issues.`); process.exit(0); }

mkdirSync(p(dir), { recursive: true });
let collected = 0;
for (const issue of issues) {
  const m = (issue.body || '').match(/```\s*([A-Za-z0-9_-]{100,})\s*```/) || (issue.body || '').match(/([A-Za-z0-9_-]{120,})/);
  if (!m) { console.log(`#${issue.number}: no sealed blob found, skipping.`); continue; }
  writeFileSync(p(dir, `issue-${issue.number}.txt`), m[1] + '\n');
  try {
    gh(`issue edit ${issue.number} --add-label collected`);
    gh(`issue close ${issue.number} --comment "Collected by game-state."`);
  } catch { /* labeling/closing is best-effort (label may not exist yet) */ }
  collected++;
}
console.log(`Collected ${collected} "${title}" submission(s) into ${dir}/.`);
