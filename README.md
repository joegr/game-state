# 🎲 game-state

**simple state-based tournaments** — a lightweight, serverless tournament engine
that lives entirely as static files and JSON on GitHub Pages.

No database, no backend, no accounts, no tokens. The tournament *is* a state
machine: its stage is driven by the clock, and its bracket is a handful of JSON
files. The **organizer** is the only privileged role, and the only thing that
makes them the organizer is possession of one private key.

- **Time-based stage** — registration → group stage → knockouts → final is a
  *pure function of the clock* versus the phase boundaries in
  [`config/tournament.json`](config/tournament.json). Every visitor computes the
  same stage from the same static config.
- **Anonymous, encrypted, key-only** — captains register from the page; each
  entry is sealed to the organizer's public key with WebCrypto (ECDH P-256 →
  HKDF → AES-GCM). There are no names: a team is a random **four-character code**
  (`A–Z0–9`) derived from its key. Submissions are sealed blobs you send the
  organizer through your own channel (Discord, chat, email) — nothing is posted
  publicly and no third-party service is involved.
- **Three views:**
  - **Public bracket** (`bracket.html`) — the anonymized tree by team code,
    updated as matches close.
  - **Captain view** (`captain.html`) — a captain loads their key and decrypts
    *only their own* fixture, and reports their score. No captain can enumerate
    the field.
  - **Organizer console** (`admin.html`) — unlocked with the organizer private
    key; decrypts blobs, runs the draw, confirms results, exports the JSON.
- **Triple-confirmation results** — a match advances only when **both captains**
  independently report **matching** scores (each report is authenticated with
  the captain's key, so neither can forge the other) **and** the organizer
  confirms. Disagreements are flagged for manual resolution.

> An Elo-tracking module is planned to sit alongside this; for now the focus is
> the time-based state machine and its static, key-only operation.

---

## How it fits together

```
Browser (static, GitHub Pages)
├─ index.html    dispatcher → organizer's device goes to admin; everyone else gets
│                a one-line, one-button anonymous sign-up          (js/home.js)
├─ bracket.html  public anonymized bracket + live stage + roadmap  (js/tournament.js)
├─ captain.html  sign up (seal a blob) · captain view · report score (js/app.js …)
└─ admin.html    organizer console — the whole engine, client-side  (js/admin.js)

js/
├─ engine.js   the PURE tournament engine (draw, advance, consensus) — no I/O
├─ crypto.js   sealed + authenticated boxes, team codes, passphrase vault
└─ …           the SAME engine.js / crypto.js run in the browser AND in Node

config/                        the tournament, as JSON
├─ tournament.json   schedule + phase boundaries + organizer PUBLIC key   (you set)
├─ public.json       anonymized bracket, updated per match                (exported)
├─ bracket.json      per-captain ENCRYPTED views                          (exported)
└─ queue.json        two-captain score-consensus queue                    (exported)

tools/  (OPTIONAL CLI — the console does all this in the browser)
├─ keygen.mjs          generate the organizer keypair
├─ decrypt-signups.mjs committed signups/ blobs → state/teams.json
└─ advance.mjs         draw · result · tally · sim · purge · status

test/   node:test suite (npm test) — engine + crypto
.github/workflows/
├─ deploy.yml   publish the static site to GitHub Pages (on push)
└─ engine.yml   OPTIONAL manual workflow_dispatch to run the CLI engine in CI
```

No build step — vanilla ES modules, served as-is.

---

## Set it up

1. **Create the repo** from these files. Name it **`game-state`** so the site
   publishes at `https://<user>.github.io/game-state/`. (All paths are relative,
   so any name works — the name only sets the URL.)
2. **Generate your organizer keypair:**
   ```bash
   cd tools && node keygen.mjs
   ```
   Paste the **public** key into `config/tournament.json → organizerPublicKey`.
   Keep the **private** key safe — you load it into the console (below); it is
   never committed. (`node keygen.mjs --json > organizer.keys.json` is gitignored
   and can be uploaded directly in `admin.html`.)
3. **Configure the tournament** in `config/tournament.json`: `name`, `teamCount`,
   and the `phases` with their UTC `start` times.
4. **Enable Pages:** *Settings → Pages → Source = GitHub Actions*, then push.
   Registration opens automatically when the clock passes the `signup` phase.

---

## Run a tournament

Everything the organizer does happens in the **console at `admin.html`** — no
token, no server.

1. **Unlock** — first visit, upload/paste your organizer private key and choose a
   passphrase. The key is encrypted under the passphrase and stored only in your
   browser; after that, the "login" is just the passphrase. On your device,
   `index.html` then routes you straight to the console.
2. **Collect signups** — captains send you their sealed entry blob through your
   channel. Paste them into the **Inbox**; each becomes an anonymous team.
3. **Draw** — once registration closes, hit **Run the draw** (optionally with a
   seed; publish it and anyone can verify the bracket).
4. **Confirm results** — captains report scores (also as sealed blobs). Paste
   them into the Inbox; when both captains of a match agree, it appears under
   **Ready to confirm**. Click **Confirm & advance**. Disputes get a manual
   override; no-shows get a walkover.
5. **Publish** — hit **Prepare exports**, download `public.json`, `bracket.json`,
   `queue.json`, drop them into `config/`, and `git commit && git push`. Pages
   redeploys on push and the public bracket + captain views update.

The captain's side (`captain.html`): register → save your key + get your 4-char
code → later, load your key to see your next fixture and **report your score**,
which produces a sealed blob you send the organizer.

### Optional: run the engine in CI

The same engine is available as a CLI for local use or CI. Commit sealed blobs
under `signups/` and `scores/`, then either run `tools/advance.mjs` locally or
trigger *Actions → “game-state engine” → Run workflow* (needs an
`ORGANIZER_PRIVATE_KEY` repo secret). This path is entirely optional — the
browser console is the primary flow.

### Try it locally

```bash
npm test                                   # engine + crypto suite

cd tools
node keygen.mjs --json > organizer.keys.json   # gitignored; put publicKey in config
node make-fake-signups.mjs 32                   # fake sealed entries
node decrypt-signups.mjs
node advance.mjs draw --seed my-seed
node make-fake-scores.mjs --dispute r16-m2      # fake authenticated score reports
node advance.mjs tally                          # build the consensus queue
node advance.mjs sim                            # play to a champion, then purge
```

Serve the site with any static server (e.g. `python3 -m http.server`) and open
`index.html`.

---

## Privacy & integrity model

- Signups and score reports are sealed to the organizer's public key — only the
  holder of the private key can read them.
- There is no team name to leak: a team is a random 4-char code derived from its
  key. Public files only ever contain codes.
- A captain's fixture is sealed to *their* key; nobody else can decrypt it.
- Score reports are **authenticated** to the reporting captain (the report can
  only be produced with that captain's private key), so a result needs genuine
  two-captain agreement plus organizer sign-off to advance.
- The organizer private key never leaves the organizer's browser (encrypted at
  rest under the passphrase); no GitHub token is ever used.
- The draw is a **seeded** shuffle: publish the seed and anyone can verify the
  bracket was not rigged.

---

## Roadmap

- **Elo module** — track ratings across tournaments, seed draws by rating.
