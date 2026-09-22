#!/usr/bin/env node
// game-state — INTAKE. Runs once per captain submission, in the private
// tentative repo's intake.yml workflow (dispatched by the browser).
//
// Decides with js/pipeline.js → decideIntake: stage gate, PIN and lockout,
// admitted team, open match. An accepted submission becomes one NEW file in
// inbox/ (a wrong PIN becomes an attempt file), never an edit to a shared
// file, so concurrent submissions cannot overwrite each other.
//
// The verdict goes out as a check annotation, titled ACCEPTED or REJECTED,
// which is what the captain's page polls for. The run itself succeeds either
// way. A failed run means the service broke, not that the captain was refused.
//
// Inputs — the workflow_dispatch inputs:
//   receipt  random id from the browser; also the run's name
//   kind     signup | score
//   payload  URL-encoded fields: token,pin | code,pin,match,my,opp
//
// In Actions they are read from the event file (GITHUB_EVENT_PATH), NEVER
// passed as step env: Actions prints a step's env block in the run log
// before any code runs, and those logs are readable with the public submit
// token. Passing the payload as env would publish every PIN. Offline
// rehearsals, with no event file, use INPUT_RECEIPT / INPUT_KIND / INPUT_PAYLOAD.
import { appendFileSync, readFileSync } from 'node:fs';
import { decideIntake } from '../js/pipeline.js';
import { loadConfig, loadPublic, loadQueue, rand } from './context.mjs';
import { tentativeCreate } from './lib.mjs';

const inputs = process.env.GITHUB_EVENT_PATH
  ? (JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).inputs || {})
  : { receipt: process.env.INPUT_RECEIPT, kind: process.env.INPUT_KIND, payload: process.env.INPUT_PAYLOAD };
const receipt = String(inputs.receipt || '');
const kind = String(inputs.kind || '');
const fields = Object.fromEntries(new URLSearchParams(String(inputs.payload || '')));

// Nothing below may ever print the PIN or token.
for (const secret of [fields.pin, fields.token]) if (secret) console.log(`::add-mask::${secret}`);

const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
function verdict(accepted, message, extra = '') {
  console.log(`::${accepted ? 'notice' : 'error'} title=${accepted ? 'ACCEPTED' : 'REJECTED'}${extra}::${esc(message)}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**${accepted ? 'Accepted' : 'Rejected'}** (${kind}) — ${message}\n`);
}

if (!/^[a-z0-9]{8,40}$/.test(receipt)) { verdict(false, 'Malformed receipt.'); process.exit(0); }

const { tournament } = loadConfig();
const { record } = loadPublic(tournament);
const queue = loadQueue(tournament);

const ctx = {
  record, signups: queue.signups, scores: queue.scores, attempts: queue.attempts,
  admitted: queue.admitted, accepted: queue.accepted,
  inboxNames: queue.inboxNames, now: new Date().toISOString(), receipt, rand: rand(),
};
const fieldsFor = kind === 'score'
  ? { code: fields.code, pin: fields.pin, matchId: fields.match, myScore: fields.my, oppScore: fields.opp }
  : { token: fields.token, pin: fields.pin };

const d = await decideIntake(kind, fieldsFor, ctx);
for (const e of d.entries) tentativeCreate(tournament, e.name, e.text, `intake: ${e.name.replace(/^inbox\//, '')}`);
verdict(d.accepted, d.message);
console.log(`${d.accepted ? 'accepted' : 'rejected'} ${kind} (receipt ${receipt}), stage ${record.stage}, ${d.entries.length} inbox file(s) written`);
