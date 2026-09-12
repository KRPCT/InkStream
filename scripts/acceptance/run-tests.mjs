import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { evidenceDirectory, repository, runBounded, writeEvidence } from './process.mjs';

// Real large-document/CodeMirror tests must not compete with hundreds of jsdom
// workers. Keep each test's own deadline; bound the complete run separately.
const directory = evidenceDirectory('tests');
const reportPath = join(directory, 'vitest.json');
const execution = await runBounded(process.execPath, [
  join(repository, 'node_modules/vitest/vitest.mjs'), 'run',
  '--maxWorkers=1', '--fileParallelism=false',
  '--reporter=default', '--reporter=json', `--outputFile.json=${reportPath}`,
], { directory, label: 'vitest', timeoutMs: 840000 });
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
const passed = execution.code === 0 && report?.success === true && report.numTotalTests > 0;
writeEvidence(directory, 'tests-summary.json', {
  platform: process.platform, node: process.version, passed,
  total: report?.numTotalTests ?? 0, passedTests: report?.numPassedTests ?? 0,
  failedTests: report?.numFailedTests ?? null, pendingTests: report?.numPendingTests ?? null,
  cleanupVerified: execution.record.cleanupVerified,
});
console.log(`Frontend test evidence: ${directory}`);
process.exitCode = passed ? 0 : execution.code || 1;
