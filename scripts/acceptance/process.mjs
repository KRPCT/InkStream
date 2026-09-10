import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function evidenceDirectory(kind) {
  const directory = join(repository, 'coverage/acceptance', `${kind}-${process.platform}-${Date.now()}-${process.pid}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function writeEvidence(directory, name, value) {
  writeFileSync(join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}

function inventory() {
  const windows = process.platform === 'win32';
  const command = windows ? 'powershell.exe' : 'ps';
  const args = windows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process | Select-Object @{n='pid';e={$_.ProcessId}},@{n='parentPid';e={$_.ParentProcessId}},@{n='command';e={$_.CommandLine}},@{n='started';e={if ($_.CreationDate) {$_.CreationDate.ToUniversalTime().ToString('o')} else {$null}}} | ConvertTo-Json -Compress"]
    : ['-e', '-ww', '-o', 'pid=,ppid=,pgid=,lstart=,args='];
  const started = new Date().toISOString();
  const probe = spawnSync(command, args, { cwd: repository, encoding: 'utf8', timeout: 10000, windowsHide: true });
  let processes = [];
  let parseError;
  try {
    if (windows && probe.stdout?.trim()) {
      const parsed = JSON.parse(probe.stdout);
      processes = (Array.isArray(parsed) ? parsed : [parsed]).map((entry) => ({ ...entry, cwd: null }));
    } else {
      processes = (probe.stdout ?? '').split('\n').flatMap((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/.exec(line);
        return match ? [{ pid: Number(match[1]), parentPid: Number(match[2]), group: Number(match[3]), started: match[4], command: match[5], cwd: null }] : [];
      });
    }
  } catch (error) { parseError = error.message; }
  if (!processes.length && !parseError) parseError = 'Empty process inventory';
  return {
    probe: { command, args, cwd: repository, parentPid: process.pid, pid: probe.pid ?? null, started,
      finished: new Date().toISOString(), code: probe.status, signal: probe.signal, timeoutMs: 10000,
      error: probe.error?.message ?? parseError ?? probe.stderr ?? '' },
    processes, cwdNote: 'CWD is not exposed by this portable OS inventory; recorded as unknown, never inferred.',
  };
}

function ownedDescendants(snapshot, rootPid, before) {
  if (!Number.isInteger(rootPid)) return [];
  const owned = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of snapshot.processes) {
      if (before.processes.some((previous) => previous.pid === entry.pid && previous.started === entry.started)) continue;
      if ((owned.has(entry.parentPid) || (entry.group !== undefined && entry.group === rootPid)) && !owned.has(entry.pid)) {
        owned.add(entry.pid);
        changed = true;
      }
    }
  }
  return snapshot.processes.filter((entry) => entry.pid !== rootPid && owned.has(entry.pid)
    && !before.processes.some((previous) => previous.pid === entry.pid && previous.started === entry.started));
}

function terminateOwned(pid, group) {
  if (group) {
    try { process.kill(-pid, 'SIGKILL'); return { group: pid, outcome: 'signal-sent' }; }
    catch (error) { return { group: pid, outcome: error.code === 'ESRCH' ? 'already-exited' : error.message }; }
  }
  const args = ['/PID', String(pid), '/T', '/F'];
  const started = new Date().toISOString();
  const result = spawnSync('taskkill.exe', args, { cwd: repository, encoding: 'utf8', timeout: 10000, windowsHide: true });
  return { command: 'taskkill.exe', args, targetPid: pid, pid: result.pid ?? null, parentPid: process.pid,
    cwd: repository, started, finished: new Date().toISOString(), timeoutMs: 10000,
    code: result.status, signal: result.signal, output: result.stdout, error: result.error?.message ?? result.stderr };
}

/** Direct argv, fixed deadline, no shell/watch. Timeout only kills this command's process tree. */
export function runBounded(command, args, { directory, label, timeoutMs }) {
  const before = inventory();
  writeEvidence(directory, `${label}-before.json`, before);
  if (before.probe.code !== 0 || before.probe.error) throw new Error(`Process inventory failed; ${label} was not launched.`);
  const log = join(directory, `${label}.log`);
  writeFileSync(log, '');
  const record = { command, args, cwd: repository, parentPid: process.pid, started: new Date().toISOString(), timeoutMs };
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: repository, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    record.pid = child.pid ?? null;
    writeEvidence(directory, `${label}-process.json`, record);
    console.log(`[bounded] ${command} PID=${record.pid}, hard timeout=${timeoutMs}ms, evidence=${directory}`);
    let output = '';
    let timedOut = false;
    let interrupted = false;
    let launchError;
    let lastOutput = Date.now();
    const receive = (chunk, destination) => {
      const text = chunk.toString();
      output += text;
      lastOutput = Date.now();
      appendFileSync(log, text);
      destination.write(chunk);
    };
    child.stdout.on('data', (chunk) => receive(chunk, process.stdout));
    child.stderr.on('data', (chunk) => receive(chunk, process.stderr));
    const killTree = () => {
      if (!child.pid) return;
      record.termination = terminateOwned(child.pid, process.platform !== 'win32');
    };
    const interrupt = () => { interrupted = true; killTree(); };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(`[bounded] Hard timeout; terminating owned PID ${child.pid}`);
      killTree();
    }, timeoutMs);
    const idleProbe = setInterval(() => {
      if (Date.now() - lastOutput < 60000) return;
      writeEvidence(directory, `${label}-idle-${Date.now()}.json`, inventory());
      console.error(`[bounded] No output for 60 seconds; recorded a process diagnostic for owned PID ${child.pid}.`);
    }, 60000);
    child.once('error', (error) => { launchError = error.message; });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      clearInterval(idleProbe);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
      let after = inventory();
      writeEvidence(directory, `${label}-after.json`, after);
      const remaining = ownedDescendants(after, child.pid, before);
      record.orphanCheck = { method: 'POSIX process group or Windows observed parent chain', observed: remaining,
        limitation: 'Intentionally detached or untraceable processes are not assumed owned and are never killed.' };
      if (remaining.length) {
        if (process.platform !== 'win32') record.orphanCleanup = [terminateOwned(child.pid, true)];
        else record.orphanCleanup = remaining.filter((entry) => !remaining.some((parent) => parent.pid === entry.parentPid)).map((entry) => terminateOwned(entry.pid, false));
        after = inventory();
        writeEvidence(directory, `${label}-after-cleanup.json`, after);
      }
      const cleanupVerified = after.probe.code === 0 && !after.probe.error && ownedDescendants(after, child.pid, before).length === 0;
      const exitCode = timedOut ? 124 : interrupted ? 130 : (code ?? 1) || (cleanupVerified ? 0 : 1);
      Object.assign(record, { finished: new Date().toISOString(), code: exitCode, childExitCode: code, signal, timedOut, interrupted, launchError, cleanupVerified });
      writeEvidence(directory, `${label}-process.json`, record);
      resolveRun({ code: exitCode, output, record });
    });
  });
}
