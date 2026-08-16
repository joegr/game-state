// game-state — shared helpers for the organizer CLI.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const p = (...s) => join(ROOT, ...s);

// The organizer private key: from env (CI secret) or a local gitignored file.
export function organizerPrivateKey() {
  if (process.env.ORGANIZER_PRIVATE_KEY) return process.env.ORGANIZER_PRIVATE_KEY.trim();
  const f = p('tools', 'organizer.keys.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')).privateKey;
  throw new Error('No organizer private key. Set ORGANIZER_PRIVATE_KEY or create tools/organizer.keys.json (node keygen.mjs --json > organizer.keys.json).');
}

// Deterministic PRNG (mulberry32) seeded from a string — makes the "stochastic"
// draw reproducible and auditable from a published seed.
export function seededRng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
