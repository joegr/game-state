// game-state — team identity.
//
// A team is born from a random TOKEN generated on the captain's device: the
// public four-character team code is a hash of it, and the public roster
// carries the token's hash. From then on, the captain proves who they are with
// the team code (public — identifies) plus a 4-digit PIN (secret — proves),
// checked by the intake workflow against a hash that lives only in the private
// tentative repo. The token itself never needs to leave the device again.

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

// ---- the captain's PIN ------------------------------------------------------
//
// The team code is PUBLIC — it is printed on the bracket — so it can only ever
// identify a team, never prove one. The proof is a 4-digit PIN, issued at
// registration and known only to the captain. Its hash lives in the PRIVATE
// tentative repo (signups.md), never in anything public: 10,000 possible PINs
// is trivially brute-forced offline from a published hash, so the defence is
// that nobody outside the private repo ever sees one, plus a lockout after
// MAX_PIN_ATTEMPTS wrong guesses at intake.

export function randomPin() {
  // Rejection sampling: 2^32 is not a multiple of 10,000, so a plain modulo
  // would make low PINs very slightly likelier.
  const limit = Math.floor(0x100000000 / 10000) * 10000;
  const buf = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buf); while (buf[0] >= limit);
  return String(buf[0] % 10000).padStart(4, '0');
}

// Salted with the team code so identical PINs on two teams hash differently.
export async function pinHash(fp, pin) {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(`game-state-pin:${fp}:${pin}`));
  return bytesToB64url(new Uint8Array(digest));
}

export const isPin = (v) => /^\d{4}$/.test(String(v ?? ''));
export const isCode = (v) => /^[A-Z0-9]{4}$/.test(String(v ?? ''));
