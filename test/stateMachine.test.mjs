// game-state — stage lookup tests (node:test, zero deps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentPhase, isSignupOpen } from '../js/stateMachine.js';

const config = (activePhase) => ({
  activePhase,
  phases: [
    { id: 'signup', kind: 'signup', label: 'Registration' },
    { id: 'r16', kind: 'knockout', label: 'Round of 16' },
    { id: 'complete', kind: 'complete', label: 'Champion Crowned' },
  ],
});

test('currentPhase: looks up activePhase by id, falls back to the first phase', () => {
  assert.equal(currentPhase(config('r16')).label, 'Round of 16');
  assert.equal(currentPhase(config('nonexistent')).label, 'Registration');
});

test('isSignupOpen: false outside the signup phase, regardless of capacity', () => {
  assert.equal(isSignupOpen(config('r16')), false);
  assert.equal(isSignupOpen(config('r16'), { full: false }), false);
});

test('isSignupOpen: open in the signup phase with no published progress yet', () => {
  assert.equal(isSignupOpen(config('signup')), true);
  assert.equal(isSignupOpen(config('signup'), undefined), true);
});

test('isSignupOpen: closes once the published roster reports full', () => {
  assert.equal(isSignupOpen(config('signup'), { full: false }), true);
  assert.equal(isSignupOpen(config('signup'), { full: true }), false);
});
