import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { groups, scenarios } from './bindings.mjs';
import { evidenceDirectory, repository, runBounded, writeEvidence } from './process.mjs';

const directory = evidenceDirectory('vitest');
try {
  const checks = groups.flatMap((group) => group.tests.map(([id, title]) => ({ id, title, file: group.file })));
  if (new Set(checks.map((check) => check.id)).size !== checks.length) throw new Error('Duplicate acceptance check id');
  for (const group of groups) if (!existsSync(join(repository, group.file))) throw new Error(`Missing test file: ${group.file}`);
  for (const scenario of scenarios) {
    const feature = readFileSync(join(repository, scenario.file), 'utf8');
    if (!feature.includes(`Scenario: ${scenario.name}`) && !feature.includes(`Scenario Outline: ${scenario.name}`)) throw new Error(`Stale manual scenario mapping: ${scenario.id}`);
    if (scenario.checks.some((id) => !checks.some((check) => check.id === id))) throw new Error(`Unknown check in ${scenario.id}`);
  }
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = `(?:^| )(?:${checks.map((check) => escape(check.title)).join('|')})$`;
  const reportPath = join(directory, 'vitest.json');
  console.log(`Running ${checks.length} manually selected checks; Gherkin is not interpreted. BDD completion remains false.`);
  const execution = await runBounded(process.execPath, [
    join(repository, 'node_modules/vitest/vitest.mjs'), 'run', ...groups.map((group) => group.file),
    '--maxWorkers=1', '--fileParallelism=false', '--testNamePattern', pattern,
    '--reporter=default', '--reporter=json', `--outputFile.json=${reportPath}`,
  ], { directory, label: 'vitest', timeoutMs: 300000 });
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
  const results = checks.map((check) => {
    const file = report?.testResults?.find((suite) => resolve(suite.name) === resolve(repository, check.file));
    const matching = file?.assertionResults?.filter((test) => test.title === check.title) ?? [];
    return { ...check, status: matching.length === 1 ? matching[0].status : 'missing-or-ambiguous' };
  });
  const passed = execution.code === 0 && report?.success === true && results.every((check) => check.status === 'passed');
  writeEvidence(directory, 'acceptance-summary.json', {
    schemaVersion: 1, kind: 'manual-vitest-bindings', gherkinExecuted: false, bddCompletion: false,
    selectedChecksPassed: passed, checks: results, scenarios,
    evidenceBoundary: 'Real application modules with the boundary substitutes declared by each test; not native WebView, OS filesystem, real watcher, or external-service acceptance.',
  });
  console.log(`Selected checks: ${passed ? 'passed' : 'FAILED'}. Partial/pending BDD scenarios remain unchanged. Evidence: ${directory}`);
  process.exitCode = passed ? 0 : execution.code || 1;
} catch (error) {
  writeEvidence(directory, 'runner-error.json', { message: error.message, bddCompletion: false });
  console.error(error);
  process.exitCode = 1;
}
