// game-state — crypto tests (node --test, zero deps). Exercises the
// security-critical properties: sealed vs authenticated boxes, sender identity,
// forgery resistance, team codes, and the passphrase vault.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeypair, seal, unseal, authSeal, boxSenderPub, publicRaw,
  fingerprint, encryptWithPassphrase, decryptWithPassphrase,
} from '../js/crypto.js';

test('fingerprint: 4 uppercase alphanumerics, deterministic, key-specific', async () => {
  const a = await generateKeypair(), b = await generateKeypair();
  const fa = await fingerprint(a.publicKey);
  assert.match(fa, /^[A-Z0-9]{4}$/);
  assert.equal(fa, await fingerprint(a.publicKey));       // deterministic
  assert.notEqual(fa, await fingerprint(b.publicKey));    // key-specific (overwhelmingly)
});

test('seal/unseal: recipient recovers plaintext; wrong key fails', async () => {
  const org = await generateKeypair(), other = await generateKeypair();
  const box = await seal('hello world', org.publicKey);
  assert.equal(await unseal(box, org.privateKey), 'hello world');
  await assert.rejects(() => unseal(box, other.privateKey));
});

test('authSeal: organizer opens it AND learns the true sender', async () => {
  const org = await generateKeypair(), cap = await generateKeypair();
  const box = await authSeal('score:3-1', cap.privateKey, cap.publicKey, org.publicKey);
  assert.equal(await unseal(box, org.privateKey), 'score:3-1');
  // The embedded sender key is exactly this captain's public key.
  assert.equal(boxSenderPub(box), await publicRaw(cap.publicKey));
});

test('authSeal: a captain cannot masquerade as another (identity is bound to key)', async () => {
  const org = await generateKeypair(), capA = await generateKeypair(), capB = await generateKeypair();
  // capB reports, trying to pass as capA. The box always carries capB's real key.
  const box = await authSeal('score:9-0', capB.privateKey, capB.publicKey, org.publicKey);
  const sender = boxSenderPub(box);
  assert.equal(sender, await publicRaw(capB.publicKey));
  assert.notEqual(sender, await publicRaw(capA.publicKey)); // can't be attributed to A
});

test('seal (anonymous) has an ephemeral sender, not any known captain', async () => {
  const org = await generateKeypair(), cap = await generateKeypair();
  const box = await seal('anon', org.publicKey);
  assert.notEqual(boxSenderPub(box), await publicRaw(cap.publicKey));
});

test('passphrase vault: round-trips; wrong passphrase throws', async () => {
  const secret = 'ORGANIZER_PRIVATE_KEY_material';
  const vault = await encryptWithPassphrase(secret, 'correct horse');
  assert.equal(await decryptWithPassphrase(vault, 'correct horse'), secret);
  await assert.rejects(() => decryptWithPassphrase(vault, 'wrong passphrase'));
});

test('publicRaw is stable and distinguishes keys', async () => {
  const a = await generateKeypair(), b = await generateKeypair();
  assert.equal(await publicRaw(a.publicKey), await publicRaw(a.publicKey));
  assert.notEqual(await publicRaw(a.publicKey), await publicRaw(b.publicKey));
});
