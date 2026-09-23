// game-state — the captain view: where your team stands, and the ONE place a
// score is submitted.
//
// The device stays signed in as a team (code + PIN, from registration or from
// signing in here). The page offers only the matches this team may report
// right now: the current round, both sides known, no published winner. The
// same rule is enforced again by the intake workflow, which checks the PIN
// too. That's why signing in here is only saved on this device: the first
// submission is what proves the PIN.

import { el, clear, identityStore, confirmButton } from './util.js';
import { roundOpenMatches, gate } from './engine.js';
import { isCode, isPin } from './identity.js';
import { submit, submitReady } from './api.js';

let tournament, record, root;
const sentKey = (matchId) => `game-state:sent:${tournament.name}:${matchId}`;
const recall = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const remember = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export function renderCaptain(rootEl, t, r) {
  root = rootEl; tournament = t; record = r;
  const me = identityStore.load(tournament.name);
  if (me?.fp && me?.pin) renderTeam(me);
  else renderSignIn();
}

// ---- signing in: the only text fields, and only when the device has no team ----

function renderSignIn(message) {
  clear(root);
  const code = el('input', { class: 'input mono big', maxlength: '4', placeholder: 'CODE', autocomplete: 'username', autocapitalize: 'characters', 'aria-label': 'Team code' });
  const pin = el('input', { class: 'input mono big', maxlength: '4', inputmode: 'numeric', placeholder: 'PIN', type: 'password', autocomplete: 'current-password', 'aria-label': 'PIN' });
  const out = el('div', {});
  const go = () => {
    const fp = code.value.trim().toUpperCase();
    clear(out);
    if (!isCode(fp) || !isPin(pin.value)) return out.append(el('p', { class: 'sm danger' }, 'Enter your 4-character team code and 4-digit PIN.'));
    identityStore.save(tournament.name, { fp, pin: pin.value });
    renderTeam({ fp, pin: pin.value });
  };
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

  root.append(el('div', { class: 'card' },
    el('h2', {}, 'Sign in as your team'),
    el('p', { class: 'muted' }, 'Use the team code and PIN you got when you registered. Not registered? ', el('a', { href: 'index.html' }, 'Register here'), '.'),
    message ? el('p', { class: 'sm danger' }, message) : null,
    el('div', { class: 'creds-input' }, code, pin),
    el('div', { class: 'row' }, el('button', { class: 'btn', onclick: go }, 'Sign in')),
    out,
  ));
  code.focus();
}

// ---- signed in ------------------------------------------------------------------

function renderTeam(me) {
  clear(root);
  root.append(el('div', { class: 'card' },
    el('div', { class: 'row spread' },
      el('div', {}, el('div', { class: 'muted sm' }, 'Signed in as'), el('div', { class: 'mono big' }, me.fp)),
      confirmButton('Sign out', 'Tap again to sign out', () => {
        identityStore.clear(tournament.name);
        renderSignIn();
      }, 'btn ghost sm')),
  ));

  if (record.stage === 'invalid') return root.append(note('Scores are paused', 'The tournament record is being corrected by the organizer. Check back shortly.'));
  if (record.stage === 'registration' || record.stage === 'closed') {
    const onRoster = record.roster.some((t) => t.fp === me.fp);
    return root.append(note(record.stage === 'registration' ? 'Registration is open' : 'Registration is closed',
      onRoster ? 'You are on the published roster. Your first match appears here once the organizer runs the draw.'
        : 'The organizer publishes the roster when registration closes, and your match appears here after the draw.'));
  }
  if (!record.roster.some((t) => t.fp === me.fp)) return root.append(note('Not on the roster', `${me.fp} is not on the published roster for this tournament.`));
  if (record.stage === 'complete') {
    return root.append(note(record.state.champion === me.fp ? '🏆 You won the tournament' : 'The tournament is over',
      record.state.champion === me.fp ? 'Well played.' : `${record.state.champion} took it.`));
  }

  const open = [...roundOpenMatches(record)].filter(([, s]) => s.a === me.fp || s.b === me.fp);
  if (!open.length) return root.append(note(...whyNothingOpen(me.fp)));
  for (const [matchId, sides] of open) root.append(renderMatch(me, matchId, sides));
}

function renderMatch(me, matchId, sides) {
  const opponent = sides.a === me.fp ? sides.b : sides.a;
  const sent = recall(sentKey(matchId));
  const status = el('div', {});
  const out = el('div', {});
  const mineIn = el('input', { class: 'input mono score', type: 'number', min: '0', step: '1', inputmode: 'numeric', 'aria-label': 'Your score', value: sent?.my ?? '' });
  const theirsIn = el('input', { class: 'input mono score', type: 'number', min: '0', step: '1', inputmode: 'numeric', 'aria-label': `${opponent}'s score`, value: sent?.opp ?? '' });

  const showSent = (s) => {
    clear(status);
    if (s) status.append(el('div', { class: 'queued' }, el('span', { class: 'badge good' }, 'IN THE QUEUE'), ' ', s.message));
  };
  showSent(sent);

  const button = el('button', { class: 'btn', onclick: async () => {
    clear(out);
    const my = Number(mineIn.value), opp = Number(theirsIn.value);
    if (mineIn.value === '' || theirsIn.value === '' || !Number.isInteger(my) || !Number.isInteger(opp) || my < 0 || opp < 0) {
      return out.append(el('p', { class: 'sm danger' }, 'Enter both scores as whole numbers.'));
    }
    if (my === opp) return out.append(el('p', { class: 'sm danger' }, 'A tie cannot decide a knockout match. Enter the decisive score.'));
    button.disabled = true; mineIn.disabled = true; theirsIn.disabled = true;
    const progress = el('p', { class: 'muted sm' }, 'Sending…');
    out.append(progress, el('p', { class: 'muted sm' }, 'This runs through GitHub Actions and takes about half a minute. Keep the page open.'));
    const res = await submit('score', { code: me.fp, pin: me.pin, match: matchId, my: String(my), opp: String(opp) }, (l) => { progress.textContent = l; });
    button.disabled = false; mineIn.disabled = false; theirsIn.disabled = false;
    clear(out);
    if (res.accepted) {
      const s = { my, opp, message: res.message };
      remember(sentKey(matchId), s);
      showSent(s);
      button.textContent = 'Resubmit';
      return;
    }
    // A credential problem won't fix itself on retry: sign out and ask again.
    if (/Wrong PIN|locked|No team is registered/.test(res.message)) {
      identityStore.clear(tournament.name);
      return renderSignIn(res.message);
    }
    out.append(el('p', { class: 'sm danger' }, res.message));
  } }, sent ? 'Resubmit' : 'Submit score');
  if (!submitReady() || !gate('score:intake', record.stage).ok) button.disabled = true;

  return el('div', { class: 'card' },
    el('div', { class: 'row spread' }, el('h3', {}, `Round ${record.round} · ${sides.label}`), el('span', { class: 'muted sm mono' }, matchId)),
    el('div', { class: 'match versus' },
      el('div', {}, el('div', { class: 'muted sm' }, 'You'), el('code', { class: 'mono big' }, me.fp), mineIn),
      el('span', { class: 'muted' }, 'vs'),
      el('div', {}, el('div', { class: 'muted sm' }, 'Opponent'), el('code', { class: 'mono big' }, opponent), theirsIn)),
    el('p', { class: 'muted sm' }, 'You and your opponent each submit the final score. The organizer compares the two, accepts the result, and publishes the whole round when it is done.'),
    el('div', { class: 'row' }, button),
    status,
    out,
    submitReady() ? null : el('p', { class: 'muted sm' }, 'Submissions are not connected yet.'),
  );
}

function whyNothingOpen(fp) {
  const all = record.state.rounds.flatMap((r) => r.matches);
  const mine = all.filter((m) => m.a === fp || m.b === fp);
  if (mine.some((m) => m.winner && m.winner !== fp)) return ['You have been eliminated', 'Your run is over. Thanks for playing.'];
  if (mine.some((m) => m.winner === fp && (m.a && m.b)) || mine.every((m) => m.winner === fp)) {
    return ['Through to the next round', `Your result is in. Round ${record.round} is still being completed — your next match opens when the organizer advances the round.`];
  }
  return ['Nothing open right now', 'Your next match opens when the organizer advances the round.'];
}

function note(title, body) {
  return el('div', { class: 'card' }, el('h3', {}, title), el('p', { class: 'muted' }, body));
}
