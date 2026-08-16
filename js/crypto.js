// game-state — sealed-box encryption (WebCrypto).
//
// A "sealed box" lets anyone encrypt a message to a recipient's public key such
// that ONLY the holder of the matching private key can read it. The sender is
// anonymous: no sender key is required or revealed.
//
// Scheme (libsodium-style, all standard WebCrypto primitives):
//   1. Sender makes an ephemeral ECDH P-256 keypair.
//   2. Shared secret = ECDH(ephemeral_priv, recipient_pub).
//   3. AES-256-GCM key = HKDF-SHA256(shared secret, salt = ephemeral_pub bytes).
//   4. Output = ephemeral_pub || iv || ciphertext, base64url.
//
// The recipient re-derives the same AES key from (recipient_priv, ephemeral_pub)
// and decrypts. This module is a plain ES module usable in the browser and in
// Node (>=18, which exposes globalThis.crypto.subtle).

const subtle = globalThis.crypto.subtle;
const EC = { name: 'ECDH', namedCurve: 'P-256' };

// ---- base64url helpers -----------------------------------------------------

export function bytesToB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- keypairs --------------------------------------------------------------

// Returns { publicKey, privateKey } as base64url-encoded JWK strings so they can
// be stored in config / localStorage / downloaded as text.
export async function generateKeypair() {
  const pair = await subtle.generateKey(EC, true, ['deriveBits']);
  const pubJwk = await subtle.exportKey('jwk', pair.publicKey);
  const privJwk = await subtle.exportKey('jwk', pair.privateKey);
  return {
    publicKey: bytesToB64url(new TextEncoder().encode(JSON.stringify(pubJwk))),
    privateKey: bytesToB64url(new TextEncoder().encode(JSON.stringify(privJwk))),
  };
}

async function importPublic(pubStr) {
  const jwk = JSON.parse(new TextDecoder().decode(b64urlToBytes(pubStr)));
  return subtle.importKey('jwk', jwk, EC, false, []);
}

async function importPrivate(privStr) {
  const jwk = JSON.parse(new TextDecoder().decode(b64urlToBytes(privStr)));
  return subtle.importKey('jwk', jwk, EC, false, ['deriveBits']);
}

// ---- key agreement ---------------------------------------------------------

async function deriveAesKey(privateKey, publicKey, saltBytes) {
  const shared = await subtle.deriveBits(
    { name: 'ECDH', public: publicKey }, privateKey, 256,
  );
  const hkdfKey = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: new TextEncoder().encode('game-state/v1') },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---- sealed box ------------------------------------------------------------

// Encrypt `message` (string) to `recipientPubStr`. Returns a base64url string.
export async function seal(message, recipientPubStr) {
  const recipientPub = await importPublic(recipientPubStr);
  const eph = await subtle.generateKey(EC, true, ['deriveBits']);
  const ephPubRaw = new Uint8Array(await subtle.exportKey('raw', eph.publicKey)); // 65 bytes
  const aesKey = await deriveAesKey(eph.privateKey, recipientPub, ephPubRaw);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt(
    { name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(message),
  ));
  const out = new Uint8Array(ephPubRaw.length + iv.length + ct.length);
  out.set(ephPubRaw, 0);
  out.set(iv, ephPubRaw.length);
  out.set(ct, ephPubRaw.length + iv.length);
  return bytesToB64url(out);
}

// Decrypt a sealed box with the recipient's private key. Returns the string.
export async function unseal(sealedStr, recipientPrivStr) {
  const recipientPriv = await importPrivate(recipientPrivStr);
  const raw = b64urlToBytes(sealedStr);
  const ephPubRaw = raw.slice(0, 65);
  const iv = raw.slice(65, 77);
  const ct = raw.slice(77);
  const ephPub = await subtle.importKey('raw', ephPubRaw, EC, false, []);
  const aesKey = await deriveAesKey(recipientPriv, ephPub, ephPubRaw);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
  return new TextDecoder().decode(pt);
}

// Short opaque public fingerprint (for anonymous team IDs / display).
export async function fingerprint(pubStr) {
  const digest = await subtle.digest('SHA-256', b64urlToBytes(pubStr));
  return bytesToB64url(new Uint8Array(digest).slice(0, 6));
}
