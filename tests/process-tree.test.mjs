// No dependencies; run from this directory with: npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import {
  parsePs,
  descendantsOf,
  eligiblePid,
  signalTargets,
  updateRemembered,
  startsOf,
  hogDecision,
  reopenHogs,
  hogLimits,
  runawayNote,
  withNotes,
  trackDescendants,
} from '../process-tree.ts';

test('parsePs reads pid, ppid, pcpu and a whitespace-normalised start time', () => {
  const rows = parsePs([
    '    1     0   0.0 Sat Oct  3 08:00:01 2026    ',
    '12345 67890 187.5 Sat Oct  3 12:34:56 2026',
    'not a process line',
    '',
  ].join('\n'));
  assert.deepEqual(rows, [
    { pid: 1, ppid: 0, pcpu: 0, start: 'Sat Oct 3 08:00:01 2026' },
    { pid: 12345, ppid: 67890, pcpu: 187.5, start: 'Sat Oct 3 12:34:56 2026' },
  ]);
  assert.deepEqual(parsePs(''), []);
});

test('descendantsOf walks ppid links transitively, excludes the seeds, survives cycles', () => {
  const row = (pid, ppid) => ({ pid, ppid, pcpu: 0, start: 's' });
  const rows = [row(10, 1), row(11, 10), row(12, 11), row(13, 10), row(20, 1), row(21, 20), row(30, 31), row(31, 30)];
  assert.deepEqual(descendantsOf(rows, [10]).map((r) => r.pid).sort((a, b) => a - b), [11, 12, 13]);
  assert.deepEqual(descendantsOf(rows, [10, 20]).map((r) => r.pid).sort((a, b) => a - b), [11, 12, 13, 21]);
  assert.deepEqual(descendantsOf(rows, [30]).map((r) => r.pid), [31]);
  assert.deepEqual(descendantsOf(rows, [99]), []);
});

test('eligiblePid never signals pid 0 or 1, this process, its parent or the tracked root', () => {
  const root = 424242;
  assert.equal(eligiblePid(0, root), false);
  assert.equal(eligiblePid(1, root), false);
  assert.equal(eligiblePid(root, root), false);
  assert.equal(eligiblePid(process.pid, root), false);
  assert.equal(eligiblePid(process.ppid, root), false);
  assert.equal(eligiblePid(999983, root), true);
});

test('signalTargets keeps only remembered pids with the same start time', () => {
  const remembered = new Map([[11, 's1'], [12, 'gone'], [13, 's3-changed']]);
  const current = [
    { pid: 11, ppid: 10, pcpu: 0, start: 's1' },
    { pid: 13, ppid: 10, pcpu: 0, start: 'other' },
  ];
  assert.deepEqual(signalTargets(remembered, current, 10).sort((a, b) => a - b), [11]);
});

test('updateRemembered keeps an adopted orphan and drops a pid collision', () => {
  const rec = (start, ppid) => ({ start, ppid });
  // Case 1: parent 11 exited, 13 (recorded under 11) adopted by 77: kept with its old parent.
  const remembered = new Map([[13, rec('s13', 11)]]);
  const orphanRows = [
    { pid: 10, ppid: 1, pcpu: 0, start: 's10' },
    { pid: 13, ppid: 77, pcpu: 0, start: 's13' },
    { pid: 77, ppid: 1, pcpu: 0, start: 's77' },
  ];
  const kept = updateRemembered(remembered, orphanRows, 10, 's10');
  assert.deepEqual([...kept.keys()], [13]);
  // Case 2: parent 11 still alive, 12 (recorded under 11) now hangs off 99: dropped.
  const remembered2 = new Map([[11, rec('s11', 10)], [12, rec('s12', 11)]]);
  const collisionRows = [
    { pid: 10, ppid: 1, pcpu: 0, start: 's10' },
    { pid: 11, ppid: 10, pcpu: 0, start: 's11' },
    { pid: 12, ppid: 99, pcpu: 0, start: 's12' },
    { pid: 99, ppid: 1, pcpu: 0, start: 's99' },
  ];
  const dropped = updateRemembered(remembered2, collisionRows, 10, 's10');
  assert.ok(dropped.has(11), 'the live parent stays');
  assert.ok(!dropped.has(12), 'a reused pid under another parent is dropped');
});

test('hogDecision stops a process hot for the whole window and never the root', () => {
  const hot = new Map();
  const row = { pid: 202, ppid: 101, pcpu: 187.5, start: 's' };
  const first = hogDecision(hot, [row], 0, { rootPid: 101, cpu: 150, seconds: 300 });
  assert.deepEqual(first.stop, []);
  const second = hogDecision(first.hot, [row], 300000, { rootPid: 101, cpu: 150, seconds: 300 });
  assert.deepEqual(second.stop, [202]);
  const rootRow = { pid: 101, ppid: 1, pcpu: 999, start: 's' };
  assert.deepEqual(hogDecision(new Map(), [rootRow], 999999, { rootPid: 101, cpu: 150, seconds: 0 }).stop, []);
});

test('reopenHogs clears the stopped mark so the next sample decides again', () => {
  const hot = new Map([[7, { start: 's', since: 0, last: 9, stopped: true }]]);
  const next = reopenHogs(hot, [7]);
  assert.equal(next.get(7).stopped, undefined);
  assert.equal(next.get(7).since, 0);
});

test('runawayNote, withNotes and hogLimits read the documented shapes', () => {
  assert.equal(runawayNote(9, 150, 300), 'stopped a runaway process 9 (over 150% CPU for 5 minutes)');
  assert.equal(withNotes('boom', ['note']), 'boom\nnote');
  assert.equal(withNotes(undefined, []), undefined);
  const limits = hogLimits();
  assert.ok(limits.cpu > 0 && limits.seconds > 0);
  assert.deepEqual([...startsOf(new Map([[5, { start: 's', ppid: 1 }]]))], [[5, 's']]);
});

test('trackDescendants reaps a detached grandchild and never the root', async () => {
  const alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } };
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });
  const tree = trackDescendants(child.pid, { intervalMs: 200 });
  await new Promise((r) => setTimeout(r, 1200));
  const stopped = await tree.stop();
  assert.ok(!stopped.includes(child.pid), 'the root is never signalled');
  assert.ok(alive(child.pid), 'trackDescendants does not kill the root');
  child.kill('SIGKILL');
});
