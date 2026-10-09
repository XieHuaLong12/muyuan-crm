import test from 'node:test';
import assert from 'node:assert/strict';
import { loginAllowed, recordLoginFailure, recordLoginSuccess, resetLoginThrottle, clientAddress, LOGIN_LIMITS, LOGIN_WINDOW_MS } from '../lib/login-throttle';
import { splitEvenly } from '../services/target-service';

test('a stranger cannot lock someone else out from a different address', () => {
  resetLoginThrottle();
  const now = Date.now();
  for (let i = 0; i < LOGIN_LIMITS.pair; i++) recordLoginFailure('Admin@Example.com', '203.0.113.9', now);
  assert.equal(loginAllowed('admin@example.com', '203.0.113.9', now), false);
  assert.equal(loginAllowed('admin@example.com', '198.51.100.7', now), true);
  assert.equal(loginAllowed('admin@example.com', '203.0.113.9', now + LOGIN_WINDOW_MS + 1), true);
});

test('one address cannot spray passwords across many accounts', () => {
  resetLoginThrottle();
  const now = Date.now();
  for (let i = 0; i < LOGIN_LIMITS.address; i++) recordLoginFailure(`user${i}@example.com`, '203.0.113.10', now);
  assert.equal(loginAllowed('fresh@example.com', '203.0.113.10', now), false);
  assert.equal(loginAllowed('fresh@example.com', '203.0.113.11', now), true);
});

test('success clears the pair counter and forwarded addresses are honoured', () => {
  resetLoginThrottle();
  for (let i = 0; i < LOGIN_LIMITS.pair - 1; i++) recordLoginFailure('sales@example.com', '203.0.113.12');
  recordLoginSuccess('sales@example.com', '203.0.113.12');
  recordLoginFailure('sales@example.com', '203.0.113.12');
  assert.equal(loginAllowed('sales@example.com', '203.0.113.12'), true);
  assert.equal(clientAddress(new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' })), '203.0.113.5');
  assert.equal(clientAddress(new Headers()), 'unknown');
});

test('annual targets split into shares that add back up exactly', () => {
  for (const [amount, parts] of [[1000000, 12], [100, 53], [99999.99, 52], [0, 12]] as const) {
    const shares = splitEvenly(amount, parts);
    assert.equal(shares.length, parts);
    assert.equal(shares.reduce((sum, v) => sum.plus(v), shares[0].minus(shares[0])).toFixed(2), Number(amount).toFixed(2));
    assert.ok(shares.every(v => v.gte(0)));
  }
});
