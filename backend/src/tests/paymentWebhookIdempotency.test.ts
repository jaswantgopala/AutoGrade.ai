import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIdempotencyKey,
  resolveWebhookEventId,
  shouldIgnoreDuplicateCapture,
  shouldIgnoreDuplicateWebhookEvent,
} from '../services/paymentIdempotencyService';

test('normalizeIdempotencyKey trims and rejects empty', () => {
  assert.equal(normalizeIdempotencyKey('  abc-123  '), 'abc-123');
  assert.equal(normalizeIdempotencyKey('   '), undefined);
  assert.equal(normalizeIdempotencyKey(undefined), undefined);
});

test('resolveWebhookEventId uses provided event id', () => {
  assert.equal(resolveWebhookEventId('evt_001'), 'evt_001');
});

test('resolveWebhookEventId generates local id when missing', () => {
  const resolved = resolveWebhookEventId(undefined);
  assert.match(resolved, /^local-/);
});

test('shouldIgnoreDuplicateWebhookEvent is true when event exists', () => {
  assert.equal(shouldIgnoreDuplicateWebhookEvent({ eventId: 'evt_01' }), true);
  assert.equal(shouldIgnoreDuplicateWebhookEvent(null), false);
});

test('shouldIgnoreDuplicateCapture only ignores captured events on already-paid orders', () => {
  assert.equal(shouldIgnoreDuplicateCapture('payment.captured', 'paid'), true);
  assert.equal(shouldIgnoreDuplicateCapture('payment.captured', 'created'), false);
  assert.equal(shouldIgnoreDuplicateCapture('payment.failed', 'paid'), false);
  assert.equal(shouldIgnoreDuplicateCapture(undefined, 'paid'), false);
});
