import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OperationEnvelopeSchema, OperationReceiptSchema, TrackerScopeSchema } from '@weight-tracker/contracts';
import { ConfigurationError, parseFoundationConfig } from '@weight-tracker/config';

const operationKey = 'f54ced07-d5b0-47c7-8d80-c2e6e5f3374a';
const freeConfig = {
  environment: 'test', additionalMonthlyBudget: 0, hostingPlan: 'vercel-hobby',
  databasePlan: 'supabase-free', mcpOAuthPlan: 'auth0-free', timezone: 'Australia/Melbourne',
};

test('operation envelope rejects acting identities, unknown fields and malformed keys', () => {
  const valid = { operationKey, contractVersion: 1 };
  assert.deepEqual(OperationEnvelopeSchema.parse(valid), valid);
  for (const input of [
    { ...valid, userId: operationKey }, { ...valid, principal: { userId: operationKey } },
    { ...valid, operationKey: 'request-1' }, { ...valid, contractVersion: 2 },
  ]) assert.equal(OperationEnvelopeSchema.safeParse(input).success, false);
});

test('receipts require a valid instant and known outcome; scopes reject unknown authority', () => {
  const valid = { operationKey, receiptId: operationKey, committedAt: '2026-11-09T12:00:00+11:00', outcome: 'created' };
  assert.equal(OperationReceiptSchema.safeParse(valid).success, true);
  for (const input of [{ ...valid, committedAt: '2026-11-09' }, { ...valid, outcome: 'saved-maybe' }]) {
    assert.equal(OperationReceiptSchema.safeParse(input).success, false);
  }
  assert.equal(TrackerScopeSchema.safeParse('admin:*').success, false);
});

test('configuration only accepts the approved no-charge plans and Melbourne timezone', () => {
  assert.deepEqual(parseFoundationConfig(freeConfig), freeConfig);
  for (const change of [
    { additionalMonthlyBudget: 1 }, { hostingPlan: 'vercel-pro' },
    { databasePlan: 'supabase-pro' }, { mcpOAuthPlan: 'auth0-trial' },
    { timezone: 'UTC' }, { environment: 'unknown' },
  ]) assert.throws(() => parseFoundationConfig({ ...freeConfig, ...change }), ConfigurationError);
  assert.throws(() => parseFoundationConfig({}), ConfigurationError);
});

test('invalid configuration errors never expose supplied values', () => {
  const syntheticSecret = 'synthetic-do-not-echo-token';
  assert.throws(() => parseFoundationConfig({ ...freeConfig, unexpectedToken: syntheticSecret }), error => {
    assert(error instanceof ConfigurationError);
    assert(!error.message.includes(syntheticSecret));
    assert(!error.message.includes('unexpectedToken'));
    return true;
  });
});
