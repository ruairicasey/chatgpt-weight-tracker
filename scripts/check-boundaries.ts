import { inspectBoundaries } from './boundaries.js';

const problems = inspectBoundaries(process.cwd());
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Workspace dependencies, client/server boundaries and reference isolation pass.');
}
