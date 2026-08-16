#!/usr/bin/env node
// game-state — collect signup issues into signups/.
//
// Signups arrive as GitHub issues (the browser opens a pre-filled one). This
// pulls every open issue labeled `signup`, extracts the sealed blob from its
// body, writes it to signups/issue-<n>.txt, then labels the issue `collected`
// and closes it. Runs in CI where `gh` is authenticated via GITHUB_TOKEN.
//
// Usage:  node collect-issues.mjs [--label signup]

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { p } from './lib.mjs';

const label = (() => { const i = process.argv.indexOf('--label'); return i >= 0 ? process.argv[i + 1] : 'signup'; })();

function gh(args) { return execSync(`gh ${args}`, { encoding: 'utf8' }); }

let issues;
try {
  issues = JSON.parse(gh(`issue list --state open --label ${label} --json number,body --limit 500`));
} catch (e) {
  console.error('Could not list issues (is `gh` authenticated?):', e.message); process.exit(1);
}
if (!issues.length) { console.log('No open signup issues.'); process.exit(0); }

mkdirSync(p('signups'), { recursive: true });
let collected = 0;
for (const issue of issues) {
  const m = (issue.body || '').match(/```\s*([A-Za-z0-9_-]{80,})\s*```/) || (issue.body || '').match(/([A-Za-z0-9_-]{120,})/);
  if (!m) { console.log(`#${issue.number}: no sealed blob found, skipping.`); continue; }
  writeFileSync(p('signups', `issue-${issue.number}.txt`), m[1] + '\n');
  try {
    gh(`issue edit ${issue.number} --add-label collected`);
    gh(`issue close ${issue.number} --comment "Entry collected by game-state. Your fixtures will appear in the Captain view."`);
  } catch { /* labeling/closing is best-effort */ }
  collected++;
}
console.log(`Collected ${collected} signup(s) into signups/.`);
