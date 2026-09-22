// game-state — identity tests (node --test, zero deps). No keys anywhere:
// exercises the token/hash properties that stand in for them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  randomToken, hashToken, fingerprint, encodeBlob, decodeBlob,
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

test('encodeBlob/decodeBlob: round-trips a plain object, no key involved', () => {
  const obj = { code: 'AB12', matchId: 'r8-m1', myScore: 3, oppScore: 1 };
  const blob = encodeBlob(obj);
  assert.notEqual(blob, JSON.stringify(obj)); // it's encoded, not literal JSON
  assert.deepEqual(decodeBlob(blob), obj);
});

test('decodeBlob rejects garbage rather than silently returning junk', () => {
  assert.throws(() => decodeBlob('not-a-real-blob!!'));
});
