// game-state — phase lookup tests (node:test, zero deps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentPhase } from '../js/stateMachine.js';

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
