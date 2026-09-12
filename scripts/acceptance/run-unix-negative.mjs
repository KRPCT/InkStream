import { mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import console from 'node:console';
import process from 'node:process';
import { evidenceDirectory, repository, runBounded, writeEvidence } from './process.mjs';

const directory = evidenceDirectory('unix-negative');
let scratch;
try {
  if (process.platform === 'win32') throw new Error('This isolated negative control requires Unix; Windows is not a passing result.');
  scratch = mkdtempSync(join(tmpdir(), 'inkstream-unix-permission-negative-'));
  const executable = join(scratch, 'legacy-mode-probe');
  const compilation = await runBounded('rustc', [
    '--edition=2021', join(repository, 'scripts/acceptance/unix-permission-negative.rs'), '-o', executable,
  ], { directory, label: 'compile-fixture', timeoutMs: 90000 });
  if (compilation.code !== 0) throw new Error(`Fixture compilation failed (${compilation.code}); not an expected negative.`);
  const result = await runBounded(executable, [scratch], { directory, label: 'legacy-strategy', timeoutMs: 10000 });
  const confirmed = result.code === 42 && result.record.cleanupVerified && result.output.includes('NEGATIVE_CONTROL_CONFIRMED:');
  writeEvidence(directory, 'negative-control-summary.json', {
    kind: 'isolated-legacy-filesystem-strategy', confirmed, expectedExitCode: 42, actualExitCode: result.code,
    oldApplicationBinaryExecuted: false, productionPermissionTestReplaced: false,
    explanation: 'Only the former successful-write File::create/sync/rename strategy is reproduced in owned temporary files. Production files.rs assertions execute separately.',
  });
  if (!confirmed) throw new Error('Expected permission violation was not demonstrated; inspect the fixture output.');
  console.log(`Isolated legacy negative confirmed; production assertions remain separate. Evidence: ${directory}`);
} catch (error) {
  writeEvidence(directory, 'negative-control-error.json', { message: error.message, confirmed: false });
  console.error(error);
  process.exitCode = 1;
} finally {
  if (scratch) {
    const target = resolve(scratch);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('inkstream-unix-permission-negative-')) {
      const message = 'Unexpected scratch path; cleanup refused without replacing the original failure.';
      writeEvidence(directory, 'cleanup-error.json', { message, target });
      console.error(message);
      process.exitCode = process.exitCode || 1;
    } else {
      try { rmSync(target, { recursive: true, force: true }); }
      catch (error) {
        writeEvidence(directory, 'cleanup-error.json', { message: error.message, target });
        console.error(`Scratch cleanup failed: ${error.message}`);
        process.exitCode = process.exitCode || 1;
      }
    }
  }
}
