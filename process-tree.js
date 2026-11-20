// Generated from process-tree.ts by node:module stripTypeScriptTypes; edit the .ts file.
import { execFile } from "node:child_process";
import * as os from "node:os";
import { performance } from "node:perf_hooks";

/** One `ps` row: pid, parent pid, CPU percent and the process start time (the pid-reuse guard). */
                        
	            
	             
	             
	              
 

const PS_TIMEOUT_MS = 5000;
const PS_RETRY_MS = 500;
const KILL_GRACE_MS = 3000;
const DEFAULT_HOG_CPU = 150;
const DEFAULT_HOG_SECONDS = 300;
const DEFAULT_NICE = 10;

/** Parse `ps -A -o pid=,ppid=,pcpu=,lstart=` output. `lstart` is five words
 *  ("Sat Oct  3 12:34:56 2026"); whitespace is collapsed so equal start times
 *  compare equal across samples. Unparseable lines are skipped. */
export function parsePs(output        )          {
	const rows          = [];
	for (const line of output.split("\n")) {
		const match = /^\s*(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\S.*?)\s*$/.exec(line);
		if (!match) continue;
		rows.push({ pid: Number(match[1]), ppid: Number(match[2]), pcpu: Number(match[3]), start: match[4].replace(/\s+/g, " ") });
	}
	return rows;
}

/** Every transitive child of the seed pids by ppid; the seeds themselves are excluded. */
export function descendantsOf(rows         , seeds          )          {
	const children = new Map                 ();
	for (const row of rows) {
		const siblings = children.get(row.ppid);
		if (siblings) siblings.push(row);
		else children.set(row.ppid, [row]);
	}
	const seen = new Set        (seeds);
	const found          = [];
	const queue = [...seeds];
	while (queue.length > 0) {
		for (const child of children.get(queue.shift() ) ?? []) {
			if (seen.has(child.pid)) continue;
			seen.add(child.pid);
			found.push(child);
			queue.push(child.pid);
		}
	}
	return found;
}

/** A pid this module may ever signal: never pid 0 or 1, this process, its parent or the tracked root
 *  (the worker CLI keeps its own signalling). */
export function eligiblePid(pid        , rootPid        )          {
	return pid > 1 && pid !== rootPid && pid !== process.pid && pid !== process.ppid;
}

/** Identity re-check against a fresh sample: remembered pids that exist now with the SAME
 *  start time (a reused pid has a different one) and are eligible to be signalled. A pid
 *  absent from `current` is never returned. */
export function signalTargets(remembered                     , current         , rootPid        )           {
	const targets           = [];
	for (const row of current) {
		if (!eligiblePid(row.pid, rootPid)) continue;
		if (remembered.get(row.pid) === row.start) targets.push(row.pid);
	}
	return targets;
}

/** A remembered descendant: its start time (identity) and the parent it was last attached to. */
                             
	              
	             
 

/**
 * Next remembered map after one successful sample. `lstart` has one-second resolution, so
 * (pid, start) alone is not proof of identity; a remembered pid is kept only if it was present
 * in this sample with the same start time AND it is still attached to the tracked tree: its
 * parent chain leads, through tracked processes, to the root (while the root is the same live
 * process) or to pid 1, OR the parent it was recorded under has left the sample (exited, or the
 * pid now belongs to another process). The last case covers an orphan adopted by a pid other than
 * 1 (a Linux subreaper such as `systemd --user`, or a container init): it is kept whatever its
 * new ppid is, and keeps its recorded parent so the rule still holds on later samples. A pid whose
 * recorded parent is still alive but which now hangs off another parent is a pid collision and is
 * dropped. A pid that vanished from a sample is dropped and treated as a different process if it
 * reappears. New descendants are added only while the root is alive, so a pid first seen after the
 * root exited (or never a descendant at all) is never added.
 */
export function updateRemembered(
	remembered                         ,
	rows         ,
	rootPid        ,
	rootStart                    ,
)                          {
	const byPid = new Map(rows.map((row) => [row.pid, row]));
	const rootAlive = rootStart !== undefined && byPid.get(rootPid)?.start === rootStart;
	const present = new Set        ();
	for (const [pid, record] of remembered) {
		if (eligiblePid(pid, rootPid) && byPid.get(pid)?.start === record.start) present.add(pid);
	}
	/** The recorded parent is gone: absent from the sample, or its pid now shows another start time. */
	const parentLeft = (record            )          => {
		const parent = byPid.get(record.ppid);
		if (!parent) return true;
		const known = record.ppid === rootPid ? rootStart : remembered.get(record.ppid)?.start;
		return known !== undefined && parent.start !== known;
	};
	const linked = (pid        )          => {
		const seen = new Set        ([pid]);
		for (let current = pid; ; ) {
			const ppid = byPid.get(current) .ppid;
			if (ppid === 1 || (rootAlive && ppid === rootPid) || parentLeft(remembered.get(current) )) return true;
			if (!present.has(ppid) || seen.has(ppid)) return false;
			seen.add(ppid);
			current = ppid;
		}
	};
	const next = new Map                    ();
	for (const pid of present) {
		if (!linked(pid)) continue;
		const record = remembered.get(pid) ;
		next.set(pid, { start: record.start, ppid: parentLeft(record) ? record.ppid : byPid.get(pid) .ppid });
	}
	if (rootAlive) {
		for (const row of descendantsOf(rows, [rootPid, ...next.keys()])) {
			if (eligiblePid(row.pid, rootPid) && !next.has(row.pid)) next.set(row.pid, { start: row.start, ppid: row.ppid });
		}
	}
	return next;
}

/** The pid -> start time view of a remembered map, the identity `signalTargets` checks. */
export function startsOf(remembered                         )                      {
	return new Map([...remembered].map(([pid, record]) => [pid, record.start]                    ));
}

/** Hot-since record for one process: `since` starts the current streak, `last` is the latest hot
 *  sample; `stopped` marks one that already got its SIGTERM. Times are milliseconds on a monotonic clock. */
                           
	              
	              
	             
	                  
 

/**
 * Runaway rule. `rows` are the candidate descendants of one sample taken at `now` (ms, monotonic).
 * A process whose pcpu is at or above `cpu` on every sample is stopped once its hot
 * streak reaches `seconds`; a dip below the threshold resets the clock, a changed start
 * time is a different process, the root is exempt, and a process that already got its
 * signal is remembered (not signalled again) until it leaves the sample.
 * With `maxGapMs`, a streak is made of consecutive samples only: if more than `maxGapMs`
 * separates two hot samples (a stalled `ps`, a suspended host) the streak restarts there.
 * Returns the next hot map (pids missing from `rows` are dropped) and the pids to stop now,
 * which are already marked stopped: call `reopenHogs` for any the signal did not reach.
 */
export function hogDecision(
	hot                       ,
	rows         ,
	now        ,
	{ rootPid, cpu, seconds, maxGapMs }                                                                      ,
)                                                 {
	const next = new Map                  ();
	const stop           = [];
	for (const row of rows) {
		if (row.pid === rootPid || row.pid <= 1) continue;
		const prior = hot.get(row.pid);
		const known = prior && prior.start === row.start ? prior : undefined;
		if (known?.stopped) {
			next.set(row.pid, known);
			continue;
		}
		if (row.pcpu < cpu) continue;
		const continuous = known !== undefined && (maxGapMs === undefined || now - known.last <= maxGapMs);
		const since = continuous ? known.since : now;
		if (now - since >= seconds * 1000) {
			stop.push(row.pid);
			next.set(row.pid, { start: row.start, since, last: now, stopped: true });
		} else {
			next.set(row.pid, { start: row.start, since, last: now });
		}
	}
	return { hot: next, stop };
}

/** Undo the stopped mark of pids whose SIGTERM did not go out, so the next sample decides again
 *  (their hot streak is kept). */
export function reopenHogs(hot                       , pids          )                        {
	const next = new Map(hot);
	for (const pid of pids) {
		const entry = next.get(pid);
		if (entry?.stopped) next.set(pid, { start: entry.start, since: entry.since, last: entry.last });
	}
	return next;
}

function positiveNumber(raw                    , fallback        )         {
	const value = Number(raw);
	return raw !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Runaway thresholds: `PI_WORKER_HOG_CPU` (default 150 percent) and
 *  `PI_WORKER_HOG_SECONDS` (default 300), read at call time. */
export function hogLimits()                                   {
	return {
		cpu: positiveNumber(process.env.PI_WORKER_HOG_CPU, DEFAULT_HOG_CPU),
		seconds: positiveNumber(process.env.PI_WORKER_HOG_SECONDS, DEFAULT_HOG_SECONDS),
	};
}

function describeDuration(seconds        )         {
	if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? "" : "s"}`;
	return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/** The receipt line for a stopped runaway. */
export function runawayNote(pid        , cpu        , seconds        )         {
	return `stopped a runaway process ${pid} (over ${cpu}% CPU for ${describeDuration(seconds)})`;
}

/** Append tracker notes to a stderr tail for a receipt. Notes are kept out of the
 *  stderr text the workers classify, because a pid can contain digits such as 401
 *  that the failure classifiers read as an HTTP status. */
export function withNotes(stderr                    , notes          )                     {
	const joined = [stderr, ...notes].filter(Boolean).join("\n");
	return joined || undefined;
}

/** Lower the worker CLI's scheduling priority right after spawn; children it forks later
 *  inherit it. `PI_WORKER_NICE` overrides the default 10, and `0` (or a non-positive or
 *  invalid value) disables it. Failures are swallowed. */
export function lowerPriority(pid                    )       {
	if (!pid) return;
	const raw = process.env.PI_WORKER_NICE;
	const nice = raw === undefined ? DEFAULT_NICE : Math.min(19, Math.trunc(Number(raw)));
	if (!(nice > 0)) return;
	try {
		os.setPriority(pid, nice);
	} catch {
		// the child already exited, or the platform refuses
	}
}

function readProcesses()                   {
	return new Promise((resolve) => {
		try {
			execFile("/bin/ps", ["-A", "-o", "pid=,ppid=,pcpu=,lstart="], { timeout: PS_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
				resolve(error ? [] : parsePs(stdout));
			});
		} catch {
			resolve([]);
		}
	});
}

/** Signal each pid; returns those the signal actually reached (a failed `kill` is swallowed). */
function signalAll(pids          , signal                )           {
	const reached           = [];
	for (const pid of pids) {
		try {
			process.kill(pid, signal);
			reached.push(pid);
		} catch {
			// already gone, or not ours to signal
		}
	}
	return reached;
}

                               
	                    
	                                                                                    
	                     
	                                                                      
	                
	                    
	                                             
	                                
	                                                                                                        
	                                                 
	                                       
	                 
 

/**
 * Remember every descendant of `rootPid` (with its start time) while the worker's
 * CLI runs, stop any descendant that stays over the CPU threshold for the whole hog
 * window, and signal the survivors in `stop()`. Group signalling reaches only the
 * CLI's own process group; a grandchild in another group or session (for example a
 * shell tool's `python -c ...`) outlives the CLI unless it is tracked here.
 * Identity is (pid, start time), re-read from a fresh sample immediately before every
 * signal (SIGTERM, the delayed SIGKILL and the runaway SIGTERM); a pid that is absent
 * or shows another start time is not signalled. Only processes observed as descendants
 * of the root while it was alive are tracked (see `updateRemembered`), and pid <= 1,
 * this process, its parent and the root are never signalled.
 * Sampling is a poll: a descendant that starts and ends between two samples is
 * never seen, and neither is one whose parent exited before the first sample saw it.
 * The root is never signalled by the runaway rule. The runaway clock is monotonic
 * (`performance.now()`) and a streak is made of samples no more than three intervals apart,
 * so a suspended host or a stalled `ps` cannot add up to the threshold; a runaway is marked
 * stopped (and noted) only once its SIGTERM was actually sent. A failed `ps` read right before
 * a signal is retried once. No-op on win32. Every `ps` or `kill` failure is swallowed.
 */
export function trackDescendants(
	rootPid                    ,
	{ intervalMs = 3000, killGraceMs = KILL_GRACE_MS, hogCpu, hogSeconds, onNote, readProcesses: read = readProcesses, retryMs = PS_RETRY_MS }               = {},
)                                {
	if (process.platform === "win32" || !rootPid) return { stop: async () => [] };
	const limits = { cpu: hogCpu ?? hogLimits().cpu, seconds: hogSeconds ?? hogLimits().seconds };
	let remembered = new Map                    ();
	let rootStart                    ;
	let hot = new Map                  ();
	let sampling = false;
	let stopped = false;

	/** Re-read ps (once more after a short wait if the read failed) and signal only pids whose
	 *  (pid, start time) identity still matches; returns those the signal reached. */
	const signalIfSame = async (identities                     , signal                )                    => {
		let rows = await read();
		if (rows.length === 0) {
			await new Promise((resolve) => setTimeout(resolve, retryMs));
			rows = await read();
		}
		return signalAll(signalTargets(identities, rows, rootPid), signal);
	};

	// One successful sample: update the remembered set and, for the periodic tick, the runaway clocks.
	const sample = async (checkHogs         )                => {
		const rows = await read();
		if (rows.length === 0) return; // ps failed: change nothing, so a failure is never read as "disappeared"
		const now = performance.now();
		rootStart ??= rows.find((row) => row.pid === rootPid)?.start;
		remembered = updateRemembered(remembered, rows, rootPid, rootStart);
		if (!checkHogs) return;
		const live = new Set(signalTargets(startsOf(remembered), rows, rootPid));
		const decision = hogDecision(hot, rows.filter((row) => live.has(row.pid)), now, { rootPid, ...limits, maxGapMs: 3 * intervalMs });
		hot = decision.hot;
		if (decision.stop.length === 0) return;
		const identities = new Map(decision.stop.map((pid) => [pid, hot.get(pid) .start]                    ));
		const reached = await signalIfSame(identities, "SIGTERM");
		// Only a pid the signal reached stays stopped (and gets its note); the rest decide again on the next sample.
		hot = reopenHogs(hot, decision.stop.filter((pid) => !reached.includes(pid)));
		for (const pid of reached) {
			try {
				onNote?.(runawayNote(pid, limits.cpu, limits.seconds));
			} catch {
				// a note sink must not break tracking
			}
		}
	};

	let inflight                = Promise.resolve();
	const tick = () => {
		if (sampling || stopped) return;
		sampling = true;
		inflight = sample(true)
			.catch(() => {})
			.finally(() => {
				sampling = false;
			});
	};
	tick();
	const timer = setInterval(tick, intervalMs);
	timer.unref();

	let stopping                               ;
	return {
		stop() {
			stopping ??= (async () => {
				stopped = true;
				clearInterval(timer);
				await inflight; // never apply two samples out of order
				await sample(false);
				const sent = startsOf(remembered);
				const targets = await signalIfSame(sent, "SIGTERM");
				if (targets.length > 0) {
					setTimeout(() => {
						// Fresh identity check again: the pid may have been reused during the grace period.
						void signalIfSame(new Map(targets.map((pid) => [pid, sent.get(pid) ]                    )), "SIGKILL");
					}, killGraceMs).unref();
				}
				return targets;
			})();
			return stopping;
		},
	};
}

/**
 * One call for a freshly spawned worker CLI: lower its priority, then track its
 * descendants. Call `stop()` when the child closes for any reason.
 */
export function guardWorkerChild(pid                    , onNote                         )                                {
	lowerPriority(pid);
	return trackDescendants(pid, { onNote });
}
