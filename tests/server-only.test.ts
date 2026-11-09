import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('server exports are poisoned in an ordinary client module environment', () => {
  for (const name of ['auth', 'config', 'mcp']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `await import('@weight-tracker/${name}/server')`], {
      encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot be imported from a Client Component module/);
  }
});

