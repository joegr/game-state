// game-state — identity tests (node --test, zero deps). No keys anywhere:
// exercises the token/hash properties that stand in for them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  randomToken, hashToken, fingerprint, randomPin, pinHash, isPin, isCode,
} from '../js/identity.js';

test('randomToken: distinct on every call', () => {
  assert.notEqual(randomToken(), randomToken());
});

test('hashToken: deterministic, token-specific', async () => {
  const a = randomToken(), b = randomToken();
  assert.equal(await hashToken(a), await hashToken(a));
  assert.notEqual(await hashToken(a), await hashToken(b));
});

test('fingerprint: 4 uppercase alphanumerics, deterministic, input-specific', async () => {
  const a = randomToken(), b = randomToken();
  const fa = await fingerprint(a);
  assert.match(fa, /^[A-Z0-9]{4}$/);
  assert.equal(fa, await fingerprint(a));
  assert.notEqual(fa, await fingerprint(b));
});

test('a token cannot be recovered from its hash or its team code', async () => {
  const token = randomToken();
  const hash = await hashToken(token);
  const code = await fingerprint(token);
  assert.notEqual(hash, token);
  assert.notEqual(code, token);
});

test('randomPin: always exactly 4 digits, and actually varies', () => {
  const pins = Array.from({ length: 500 }, randomPin);
  assert.ok(pins.every((p) => /^\d{4}$/.test(p)));
  assert.ok(new Set(pins).size > 400);
  assert.ok(pins.some((p) => p.startsWith('0')), 'leading zeros are kept, not dropped');
});

test('pinHash: deterministic, and salted by team code', async () => {
  assert.equal(await pinHash('AB12', '0420'), await pinHash('AB12', '0420'));
  assert.notEqual(await pinHash('AB12', '0420'), await pinHash('AB12', '0421'));
  assert.notEqual(await pinHash('AB12', '0420'), await pinHash('CD34', '0420'), 'same PIN, different team, different hash');
});

test('isPin / isCode', () => {
  assert.ok(isPin('0420') && !isPin('420') && !isPin('04200') && !isPin('04a0') && !isPin(null));
  assert.ok(isCode('AB12') && !isCode('ab12') && !isCode('AB1') && !isCode('AB-2'));
});
