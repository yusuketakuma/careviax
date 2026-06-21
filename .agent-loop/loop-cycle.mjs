#!/usr/bin/env node
// @ts-check
/**
 * loop-cycle.mjs — the claude-lead / codex-lead agent loop, expressed as code.
 *
 * LOOP_POLICY.md (§1–§16) is the prose SSOT; this script is its executable form:
 * the cycle state machine, the objective gate suite (§6 / GATE_CONFIG.md), and the
 * §14/§15/§16 decision procedure are encoded here so the loop is deterministic and
 * runnable instead of re-interpreted from prose each turn. It is a *shared* tool —
 * pick the running supervisor with `--agent` (or `LOOP_AGENT`); default `claude`.
 *
 * Dependency-free (Node 20+, ESM). Read-only except for running gate commands
 * and (with `advance`) rewriting the STATE.md cycle counter / next_action.
 *
 * Usage:
 *   node .agent-loop/loop-cycle.mjs status [--agent claude|codex]
 *   node .agent-loop/loop-cycle.mjs phases
 *   node .agent-loop/loop-cycle.mjs next [--agent claude|codex]
 *   node .agent-loop/loop-cycle.mjs gates [names...]   # default = cheap per-slice gates
 *   node .agent-loop/loop-cycle.mjs gates --full        # cheap + test + build (done/merge)
 *   node .agent-loop/loop-cycle.mjs gates --tests <paths...>  # targeted vitest run
 *   node .agent-loop/loop-cycle.mjs advance "<note>"    # bump current_cycle + set next_action
 *
 * Exit code: 0 ok; 1 a gate failed / usage / write error.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const LOOP_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = dirname(LOOP_DIR);
const STATE_PATH = join(LOOP_DIR, 'STATE.md');

// ── Cycle state machine (§1–§16). Each phase: governing policy + exit rule. ──
const PHASES = [
  {
    id: 'bootstrap',
    policy: '§7/§8 + memory',
    exit: 'SSOT (guidelines, migration-map, gbrain) consulted',
  },
  {
    id: 'discover',
    policy: '§16',
    exit: 'highest-value non-conflicting task picked from queue/matrix/diff',
  },
  {
    id: 'plan',
    policy: 'require_plan_before_edit',
    exit: 'sliced PLAN drafted (grounded; reuse-first)',
  },
  { id: 'plan_review', policy: 'maker/checker', exit: 'peer PLAN_REVIEW_RESULT = approved' },
  { id: 'lock', policy: '§2', exit: 'own paths LOCKed over agmsg, no overlap with peer locks' },
  { id: 'implement', policy: '§1/§4', exit: 'change complete, own-lane files only' },
  { id: 'verify', policy: '§6', exit: 'objective gates GREEN' },
  { id: 'patch_review', policy: 'maker/checker', exit: 'peer PATCH_REVIEW_RESULT = approved' },
  { id: 'land', policy: '§3/§4', exit: 'inbox drained; own files staged; committed' },
  { id: 'writeback', policy: '§13', exit: 'reusable learnings + ledgers updated' },
  // → loops back to discover (§16: repeat on drain)
];

// ── Objective gates (§6). Names map to package.json scripts. ──
const GATES = {
  lint: 'lint',
  typecheck: 'typecheck',
  'typecheck:no-unused': 'typecheck:no-unused',
  'format:check': 'format:check',
  test: 'test',
  build: 'build',
};
// Per-slice cheap gates (GATE_CONFIG.md): no full Vitest / build here.
const CHEAP_GATES = ['typecheck', 'typecheck:no-unused', 'lint', 'format:check'];
// Done/merge/periodic broad validation: cheap + full suite + build.
const FULL_GATES = [...CHEAP_GATES, 'test', 'build'];

// Per-agent lane maps (§1). Shared tool → classify dirty files by the running agent.
const LANES = {
  claude: [/^src\/app\/\(dashboard\)\//, /^src\/components\//, /^docs\//],
  codex: [
    /^src\/lib\//,
    /^src\/server\//,
    /^src\/app\/api\//,
    /^tools\//,
    /^prisma\//,
    /^\.codex\//,
    /^CODEX_GOAL_PROGRESS\.md$/,
  ],
};
// Jointly-owned ledgers: either supervisor may edit (under LOCK). Generated state is shared.
const JOINT = [/^\.agent-loop\//, /^\.harness-mem\//];
const AGENTS = Object.keys(LANES);

// Strip the global `--agent <value>` from argv before command-specific parsing,
// so it never leaks into `gates`/`--tests` argument lists. Falls back to LOOP_AGENT.
function extractAgent(args) {
  const rest = [...args];
  let a = process.env.LOOP_AGENT;
  const i = rest.indexOf('--agent');
  if (i >= 0) {
    a = rest[i + 1];
    rest.splice(i, 2);
  }
  return { agent: AGENTS.includes(a ?? '') ? a : 'claude', rest };
}

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: REPO_DIR, encoding: 'utf8', ...opts });
}

function parseState() {
  let text = '';
  try {
    text = readFileSync(STATE_PATH, 'utf8');
  } catch {
    return {};
  }
  const m = text.match(/```yaml\n([\s\S]*?)\n```/);
  const block = m ? m[1] : text;
  /** @type {Record<string,string>} */
  const state = {};
  for (const line of block.split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) continue;
    const v = kv[2];
    if (v.startsWith("'") || v.startsWith('"')) {
      // quote-aware: read the scalar to its closing quote ('' = literal ') and ignore any trailing #comment.
      const q = v[0];
      let out = '';
      for (let i = 1; i < v.length; i++) {
        if (v[i] === q) {
          if (q === "'" && v[i + 1] === "'") {
            out += "'";
            i++;
            continue;
          }
          break;
        }
        out += v[i];
      }
      state[kv[1]] = out;
    } else {
      state[kv[1]] = v.replace(/\s*#.*$/, '').trim();
    }
  }
  return state;
}

function gitDirty(agent) {
  const other = agent === 'claude' ? 'codex' : 'claude';
  const r = sh('git', ['status', '--porcelain']);
  const files = (r.stdout || '')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3));
  const match = (f, res) => res.some((re) => re.test(f));
  return {
    own: files.filter((f) => match(f, LANES[agent])),
    joint: files.filter((f) => match(f, JOINT)),
    peer: files.filter((f) => match(f, LANES[other])),
    other: files.filter(
      (f) => !match(f, LANES[agent]) && !match(f, JOINT) && !match(f, LANES[other]),
    ),
  };
}

function printStatus(agent) {
  const s = parseState();
  const d = gitDirty(agent);
  console.log(`── loop state (STATE.md) · running as ${agent} ──`);
  for (const k of [
    'current_cycle',
    'active_task_id',
    'claude_status',
    'codex_status',
    'zero_actionable_count',
    'last_gate_result',
  ]) {
    if (s[k]) console.log(`  ${k}: ${s[k]}`);
  }
  console.log(`  next_action: ${s.next_action ?? '(unset)'}`);
  console.log('── git working tree ──');
  console.log(`  ${agent}-lane dirty (${d.own.length}): ${d.own.join(', ') || '(clean)'}`);
  console.log(`  joint ledgers dirty (${d.joint.length}): ${d.joint.join(', ') || '(clean)'}`);
  console.log(`  peer-lane dirty (${d.peer.length}): ${d.peer.join(', ') || '(clean)'}`);
  if (d.other.length)
    console.log(`  unclassified dirty (${d.other.length}): ${d.other.join(', ')}`);
}

function printPhases() {
  console.log('── cycle state machine (LOOP_POLICY §1–§16) ──');
  PHASES.forEach((p, i) => console.log(`  ${i + 1}. ${p.id.padEnd(13)} [${p.policy}] → ${p.exit}`));
  console.log('  ↺ writeback → discover  (§16 continuous loop: repeat on drain)');
}

const INFLIGHT = /review|patch_ready|implementing|peer|discovering|planning/;

// Deterministic §14/§15/§16 decision from git + STATE (yield-first always).
function printNext(agent) {
  const s = parseState();
  const d = gitDirty(agent);
  console.log(
    '§15 step 1 — YIELD FIRST: drain agmsg inbox; handle inbound review/lock/URGENT before new work.\n',
  );
  if (d.own.length + d.joint.length > 0) {
    console.log(`PHASE: implement/verify (${agent}-lane / joint changes uncommitted).`);
    if (d.own.length) console.log(`  ${agent}-lane dirty: ${d.own.join(', ')}`);
    if (d.joint.length)
      console.log(`  joint dirty (LOCK required; skip any peer-locked): ${d.joint.join(', ')}`);
    console.log(
      '  → run `loop-cycle.mjs gates`; if GREEN send PATCH_REVIEW_REQUEST, else fix the failing gate.',
    );
    console.log(
      '  → stage ONLY your-lane files + joint ledgers YOU edited under your own LOCK (§2/§4);',
    );
    console.log(
      '    never blanket add, never a peer-locked joint file or peer-lane path. Leave untouched:',
    );
    console.log(`     peer/other dirty: ${[...d.peer, ...d.other].join(', ') || '(none)'}`);
    return;
  }
  // clean tree → §15 overlap if either supervisor is still in-flight, else §16 drain.
  const bothStatus = `${s.claude_status ?? ''} ${s.codex_status ?? ''}`;
  if (INFLIGHT.test(bothStatus)) {
    console.log('PHASE: §15 overlap (work in-flight / awaiting peer review; tree clean).');
    console.log(`  statuses: claude=${s.claude_status ?? '?'} codex=${s.codex_status ?? '?'}`);
    console.log('  → do NOT passive-wait. Start the next non-conflicting §14-ladder item:');
    console.log(
      '     read-only recon · next-task scope/plan · SSOT/docs · gbrain writeback · hygiene · independent-file slice under fresh LOCK.',
    );
    return;
  }
  console.log('PHASE: §16 Discover (drain — start the next cycle, do not stop).');
  console.log(
    '  → scan FEATURE_QUEUE.md / UI_AUDIT_MATRIX.md / recent diff for the next highest-value non-conflicting task.',
  );
  console.log('  → scope/plan-ground if it needs a PLAN; LOCK + implement if it is a ready slice.');
  console.log('  → `loop-cycle.mjs advance "<cycle note>"` after picking, then begin.');
}

function runGates(args) {
  // `--tests <paths...>` → targeted vitest; `--full` → broad; else named or cheap default.
  if (args.includes('--tests')) {
    const paths = args.slice(args.indexOf('--tests') + 1).filter((a) => !a.startsWith('--'));
    if (!paths.length) {
      console.log('gates --tests requires at least one path/pattern');
      return false;
    }
    console.log(`── targeted vitest: ${paths.join(' ')} ──`);
    const r = sh('pnpm', ['exec', 'vitest', 'run', ...paths], { stdio: 'inherit' });
    const ok = r.status === 0;
    console.log(ok ? '── targeted tests GREEN ──' : '── targeted tests RED ──');
    return ok;
  }
  const named = args.filter((a) => !a.startsWith('--'));
  const list = args.includes('--full') ? FULL_GATES : named.length ? named : CHEAP_GATES;
  let allOk = true;
  console.log(`── objective gates (§6): ${list.join(', ')} ──`);
  for (const name of list) {
    const script = GATES[name];
    if (!script) {
      console.log(`  ? ${name}: unknown gate (known: ${Object.keys(GATES).join(', ')})`);
      allOk = false;
      continue;
    }
    const start = Date.now();
    const r = sh('pnpm', ['run', '--silent', script], { stdio: ['ignore', 'ignore', 'inherit'] });
    const ok = r.status === 0;
    allOk = allOk && ok;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name} (${Math.round((Date.now() - start) / 1000)}s)`);
  }
  console.log(allOk ? '── gates GREEN ──' : '── gates RED ──');
  return allOk;
}

// YAML single-quoted scalar: wrap and double internal single quotes.
function yamlScalar(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function advance(note) {
  let text = readFileSync(STATE_PATH, 'utf8');
  if (!/^current_cycle:\s*\d+/m.test(text)) {
    console.error('advance: current_cycle field not found in STATE.md; aborting.');
    process.exit(1);
  }
  if (note && !/^next_action:\s*/m.test(text)) {
    console.error('advance: next_action field not found in STATE.md; aborting.');
    process.exit(1);
  }
  const cur = parseState();
  const nextCycle = Number(cur.current_cycle || '0') + 1;
  text = text.replace(/^(current_cycle:\s*)\d+(.*)$/m, `$1${nextCycle}$2`);
  if (note) {
    // Replace the whole next_action value with a safely-quoted scalar (drops any inline comment).
    text = text.replace(
      /^next_action:\s*.*$/m,
      `next_action: ${yamlScalar(note.replace(/\n/g, ' '))}`,
    );
  }
  writeFileSync(STATE_PATH, text);
  console.log(`advanced to cycle ${nextCycle}${note ? '; next_action set' : ''}`);
}

// ── CLI ──
const { agent: RUN_AGENT, rest: argv } = extractAgent(process.argv.slice(2));
const [cmd, ...rest] = argv;
switch (cmd) {
  case 'status':
    printStatus(RUN_AGENT);
    break;
  case 'phases':
    printPhases();
    break;
  case 'next':
    printNext(RUN_AGENT);
    break;
  case 'gates':
    process.exit(runGates(rest) ? 0 : 1);
    break;
  case 'advance':
    advance(rest.join(' '));
    break;
  default:
    console.log(
      'usage: loop-cycle.mjs <status|phases|next|gates [names|--full|--tests <paths>]|advance "<note>"> [--agent claude|codex]',
    );
    process.exit(cmd ? 1 : 0);
}
