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
// only this hash, never the token itself, and 24 random bytes is far too much
// entropy to brute-force from a published hash.
export async function hashToken(token) {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(token));
  return bytesToB64url(new Uint8Array(digest));
}

// The team's anonymous name/ID: four random-looking uppercase alphanumerics
// (A-Z, 0-9), derived from the SHA-256 of the token (or any string — the same
// function derives a team's public bracket views). Stable and reproducible
// from the token, so a captain who kept their token can always re-derive it.
// (36^4 ~= 1.68M combos - collisions across ~32 teams are ~0.03%; the admin
// console warns if two tokens ever map to the same code.)
const TEAM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export async function fingerprint(input) {
  const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(input)));
  let code = '';
  for (let i = 0; i < 4; i++) code += TEAM_ALPHABET[digest[i] % 36];
  return code;
}

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
