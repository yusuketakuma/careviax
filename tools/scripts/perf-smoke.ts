import process from 'node:process';

type Args = {
  baseUrl: string;
  requests: number;
  concurrency: number;
  targetMs: number;
  method: string;
  paths: string[];
  headers: Record<string, string>;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    baseUrl: process.env.PERF_BASE_URL ?? 'http://127.0.0.1:3000',
    requests: Number(process.env.PERF_REQUESTS ?? '40'),
    concurrency: Number(process.env.PERF_CONCURRENCY ?? '4'),
    targetMs: Number(process.env.PERF_TARGET_MS ?? '500'),
    method: process.env.PERF_METHOD ?? 'GET',
    paths: ['/api/health'],
    headers: {},
  };

  let hasExplicitPath = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === '--base-url' && next) args.baseUrl = next;
    if (value === '--requests' && next) args.requests = Number(next);
    if (value === '--concurrency' && next) args.concurrency = Number(next);
    if (value === '--target-ms' && next) args.targetMs = Number(next);
    if (value === '--method' && next) args.method = next.toUpperCase();
    if (value === '--path' && next) {
      if (!hasExplicitPath) {
        args.paths = [];
        hasExplicitPath = true;
      }
      args.paths.push(next);
    }
    if (value === '--header' && next) {
      const separator = next.indexOf(':');
      if (separator > 0) {
        const key = next.slice(0, separator).trim();
        const headerValue = next.slice(separator + 1).trim();
        args.headers[key] = headerValue;
      }
    }
  }

  args.paths = args.paths.filter((item, index, list) => list.indexOf(item) === index);
  return args;
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const durations: number[] = [];
  let errorCount = 0;
  let cursor = 0;

  const jobs = Array.from({ length: Math.max(1, args.concurrency) }, async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= args.requests) return;

      const path = args.paths[current % args.paths.length]!;
      const target = new URL(path, args.baseUrl).toString();
      const startedAt = performance.now();

      try {
        const response = await fetch(target, {
          method: args.method,
          headers: args.headers,
        });
        durations.push(Math.round(performance.now() - startedAt));
        if (!response.ok) {
          errorCount += 1;
        }
      } catch {
        durations.push(Math.round(performance.now() - startedAt));
        errorCount += 1;
      }
    }
  });

  await Promise.all(jobs);

  const p50 = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  const max = durations.length > 0 ? Math.max(...durations) : 0;
  const average =
    durations.length > 0
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : 0;

  console.log(JSON.stringify({
    base_url: args.baseUrl,
    requests: args.requests,
    concurrency: args.concurrency,
    target_ms: args.targetMs,
    method: args.method,
    paths: args.paths,
    average_ms: average,
    p50_ms: p50,
    p95_ms: p95,
    max_ms: max,
    error_count: errorCount,
    target_met: p95 <= args.targetMs && errorCount === 0,
  }, null, 2));

  if (p95 > args.targetMs || errorCount > 0) {
    process.exitCode = 1;
  }
}

void main();
