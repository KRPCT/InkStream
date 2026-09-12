import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { evidenceDirectory, repository, runBounded, writeEvidence } from './process.mjs';

// Real large-document/CodeMirror tests must not compete with hundreds of jsdom
// workers. Keep each test's own deadline; bound the complete run separately.
const directory = evidenceDirectory('tests');
const benchmarks = ['src/editor/livepreview/blockField.performance.test.ts', 'src/editor/livepreview/perf.test.ts'];
const phases = [
  { name: 'functional', args: benchmarks.flatMap((file) => ['--exclude', file]), timeoutMs: 780000 },
  { name: 'performance', args: [...benchmarks, '--pool=forks', '--execArgv=--expose-gc'], timeoutMs: 60000 },
];
const results = [];
function completeBenchmarks(report) {
  return report?.numPendingTests === 0 && benchmarks.every((file) => {
    const matches = (report.testResults ?? []).filter((result) => result.name.replaceAll('\\', '/').endsWith(`/${file}`));
    return matches.length === 1 && matches[0].assertionResults.length > 0 &&
      matches[0].assertionResults.every((assertion) => assertion.status === 'passed');
  });
}
for (const phase of phases) {
  const reportPath = join(directory, `${phase.name}.json`);
  const execution = await runBounded(process.execPath, [
    join(repository, 'node_modules/vitest/vitest.mjs'), 'run', ...phase.args,
    '--maxWorkers=1', '--fileParallelism=false',
    '--reporter=default', '--reporter=json', `--outputFile.json=${reportPath}`,
  ], { directory, label: phase.name, timeoutMs: phase.timeoutMs });
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
  results.push({ name: phase.name, execution, report,
    passed: execution.code === 0 && execution.record.cleanupVerified === true && report?.success === true && report.numTotalTests > 0 &&
      (phase.name !== 'performance' || completeBenchmarks(report)) });
  if (execution.record.cleanupVerified !== true) break;
}
const passed = results.length === phases.length && results.every((result) => result.passed);
const sum = (key) => results.reduce((total, result) => total + (result.report?.[key] ?? 0), 0);
const report = { ...results[0].report, success: passed,
  testResults: results.flatMap((result) => result.report?.testResults ?? []),
  ...Object.fromEntries(['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests',
    'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites'].map((key) => [key, sum(key)])),
};
writeEvidence(directory, 'vitest.json', report);
writeEvidence(directory, 'tests-summary.json', {
  platform: process.platform, node: process.version, passed,
  total: report?.numTotalTests ?? 0, passedTests: report?.numPassedTests ?? 0,
  failedTests: report?.numFailedTests ?? null, pendingTests: report?.numPendingTests ?? null,
  phases: results.map(({ name, passed, execution }) => ({ name, passed, exitCode: execution.code })),
  cleanupVerified: results.every(({ execution }) => execution.record.cleanupVerified),
});
console.log(`Frontend test evidence: ${directory}`);
process.exitCode = passed ? 0 : results.find((result) => !result.passed)?.execution.code || 1;
