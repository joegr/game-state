// game-state — team identity.
//
// A captain's identity is a single random TOKEN, generated on their device.
// Their team code is a hash of that token. Proving "I am this team" later — to
// report a score — means presenting the token again; anyone holding the roster
// checks it by re-hashing and comparing against the published hash.
//
// Everything published is meant to be readable; what it has to be is
// unforgeable.

const subtle = globalThis.crypto.subtle;

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

// ---- token identity ---------------------------------------------------------

// A fresh 24-byte random token, base64url-encoded. This is the captain's whole
// credential — whoever holds it can act as that team. Generated once, on the
// captain's device, and never derived from anything else.
export function randomToken() {
  return bytesToB64url(globalThis.crypto.getRandomValues(new Uint8Array(24)));
}

// SHA-256 of a token, base64url-encoded. Safe to publish: the roster carries
// only this hash, never the token, and 24 random bytes is far too much entropy
// to brute-force from a published hash.
export async function hashToken(token) {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(token));
  return bytesToB64url(new Uint8Array(digest));
}

// The one shared code generator. Both sides of the hand-off use this exact
// function: signup displays the code derived from its token, and the organizer
// derives the same code when the entry is ingested. Keeping this in one module
// prevents the two paths from drifting apart.
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export async function generateCode(input) {
  const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(input)));
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[digest[i] % CODE_ALPHABET.length];
  return code;
}

// Backwards-compatible name used by published bracket and roster code.
export const fingerprint = generateCode;

// ---- blobs for paste-and-copy transport ------------------------------------
//
// Signups and score reports move around as one copyable string: paste into a
// chat, paste into the organizer's Inbox. A stable, URL-safe encoding is all
// that takes.

export function encodeBlob(obj) {
  return bytesToB64url(new TextEncoder().encode(JSON.stringify(obj)));
}

export function decodeBlob(str) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(str)));
}
