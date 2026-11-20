// Demo behind the README quick start: parse, decide, and reap a real grandchild.
import { spawn } from 'node:child_process';
import {
  parsePs,
  descendantsOf,
  hogDecision,
  trackDescendants,
} from '../../process-tree.ts';

const rows = parsePs('  101   1   0.0 Sat Oct  3 08:00:01 2026\n  202 101 187.5 Sat Oct  3 12:34:56 2026\n  303 202   0.1 Sat Oct  3 12:35:01 2026\njunk line\n');
console.log('parsed=' + rows.length, 'descendantsOf([101])=' + descendantsOf(rows, [101]).map((r) => r.pid).join(','));
const first = hogDecision(new Map(), [{ pid: 202, ppid: 101, pcpu: 187.5, start: 's' }], 0, { rootPid: 101, cpu: 150, seconds: 300 });
console.log('hog: stop=' + JSON.stringify(first.stop) + ' (streak just started)');

const alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } };
const child = spawn(process.execPath, ['-e',
  `const g = require('node:child_process').spawn('sleep', ['60'], { detached: true, stdio: 'ignore' }); g.unref(); setInterval(() => {}, 1000);`],
  { stdio: 'ignore' });
const tree = trackDescendants(child.pid, { intervalMs: 200 });
await new Promise((r) => setTimeout(r, 1500));
const stopped = await tree.stop();
console.log('live: root=' + child.pid, 'grandchild-reaped=' + stopped.length, 'root-alive-after-stop=' + alive(child.pid));
child.kill('SIGKILL');
for (const pid of stopped) { try { process.kill(pid, 'SIGKILL'); } catch {} }
