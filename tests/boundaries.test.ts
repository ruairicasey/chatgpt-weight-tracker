import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { inspectBoundaries } from '../scripts/boundaries.js';

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'tracker-boundaries-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'apps'), { recursive: true });
  mkdirSync(join(root, 'packages'), { recursive: true });
  function pkg(name: string, dependencies: string[], content: string) {
    const directory = join(root, name === 'web' ? 'apps' : 'packages', name);
    mkdirSync(join(directory, 'src'), { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: `@weight-tracker/${name}`, dependencies: Object.fromEntries(dependencies.map(dep => [`@weight-tracker/${dep}`, 'workspace:*'])) }));
    writeFileSync(join(directory, 'src/index.ts'), content);
  }
  return { root, pkg };
}

test('boundary checker rejects cyclic layer dependencies', t => {
  const h = fixture(t);
  h.pkg('contracts', ['db'], '');
  h.pkg('db', [], '');
  assert(inspectBoundaries(h.root).some(problem => problem.includes('forbidden dependency')));
});

test('client cannot reach server packages through an intermediary', t => {
  const h = fixture(t);
  h.pkg('web', ['domain'], "'use client'; import '@weight-tracker/domain';");
  h.pkg('domain', ['auth'], "import '@weight-tracker/auth';");
  h.pkg('auth', [], '');
  const problems = inspectBoundaries(h.root);
  assert(problems.some(problem => problem.includes('server package domain')));
  assert(problems.some(problem => problem.includes('server package auth')));
});

test('boundary checker rejects package escapes and undeclared workspace imports', t => {
  const h = fixture(t);
  h.pkg('web', [], "import '../../../references/phase0/src/probe'; import '@weight-tracker/db';");
  h.pkg('db', [], '');
  const problems = inspectBoundaries(h.root);
  assert(problems.some(problem => problem.includes('escapes package')));
  assert(problems.some(problem => problem.includes('undeclared workspace import')));
});

test('approved contracts are safe for a client; active workspace passes boundaries', t => {
  const h = fixture(t);
  h.pkg('web', ['contracts'], "'use client'; import '@weight-tracker/contracts';");
  h.pkg('contracts', [], '');
  assert.deepEqual(inspectBoundaries(h.root), []);
  assert.deepEqual(inspectBoundaries(process.cwd()), []);
});
