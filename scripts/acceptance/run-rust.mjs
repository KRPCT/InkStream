import console from 'node:console';
import process from 'node:process';
import { evidenceDirectory, runBounded, writeEvidence } from './process.mjs';

const directory = evidenceDirectory('rust');
const execution = await runBounded('cargo', [
  'test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--all-targets', '--', '--test-threads=1',
], { directory, label: 'cargo-test', timeoutMs: 1200000 });
const unix = process.platform !== 'win32';
const permissionTest = 'files::tests::write_file_atomic_preserves_existing_unix_permissions';
const permissionPassed = execution.output.includes(`test ${permissionTest} ... ok`);
const passed = execution.code === 0 && (!unix || permissionPassed);
writeEvidence(directory, 'rust-summary.json', {
  kind: 'production-rust-all-target-tests', platform: process.platform,
  compiledTargets: 'all',
  libraryTestsPassed: execution.record.childExitCode === 0 && !execution.record.timedOut,
  unixPermissionAssertion: unix ? (permissionPassed ? 'passed' : 'not-observed-passing') : 'not-executed-on-windows',
  permissionTest, passed, fixtureUsedForProductionAssertions: false,
});
if (unix && !permissionPassed) console.error(`Required production Unix assertion was not observed passing: ${permissionTest}`);
console.log(`Production Rust evidence: ${directory}`);
process.exitCode = passed ? 0 : execution.code || 1;
