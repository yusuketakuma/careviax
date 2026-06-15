import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { DESIGN_SCREENS, type DesignScreenEntry } from '../tests/helpers/design-screen-map';

const DEFAULT_PORT = 3012;
const DEFAULT_HEAP_MB = 12_288;
const STARTUP_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;
const READY_CHECK_TIMEOUT_MS = 5_000;
const LOCAL_DATABASE_URL = 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public';
const LOCAL_AUTH_SECRET = 'ph-os-local-auth-secret';

type ChunkName = 'new' | 'p1' | 'p0-a' | 'p0-b' | 'p0-c' | 'p0-all' | 'smoke';

type ChunkDefinition = {
  name: ChunkName;
  screenIds: string[];
};

type RunnerOptions = {
  chunks: string[];
  baseUrl: string;
  port: string;
  heapMb: number;
  dryRun: boolean;
  reuseServer: boolean;
};

let appProcess: ChildProcess | null = null;
let appExited = false;

function maybeUnrefTimeout(timeout: ReturnType<typeof setTimeout>): void {
  if (typeof timeout === 'object' && timeout && 'unref' in timeout) {
    (timeout as { unref?: () => void }).unref?.();
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    maybeUnrefTimeout(timeout);
  });
}

function p0Number(screenId: string): number | null {
  const match = /^p0_(\d+)/.exec(screenId);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function buildChunkDefinitions(screens: Pick<DesignScreenEntry, 'screenId'>[]) {
  const ids = screens.map((screen) => screen.screenId);
  const p0Ids = ids.filter((id) => id.startsWith('p0_'));

  return [
    { name: 'new', screenIds: ids.filter((id) => id.startsWith('new_')) },
    { name: 'p1', screenIds: ids.filter((id) => id.startsWith('p1_')) },
    {
      name: 'p0-a',
      screenIds: p0Ids.filter((id) => {
        const n = p0Number(id);
        return n !== null && n <= 21;
      }),
    },
    {
      name: 'p0-b',
      screenIds: p0Ids.filter((id) => {
        const n = p0Number(id);
        return n !== null && n >= 22 && n <= 35;
      }),
    },
    {
      name: 'p0-c',
      screenIds: p0Ids.filter((id) => {
        const n = p0Number(id);
        return n !== null && n >= 36;
      }),
    },
    { name: 'p0-all', screenIds: p0Ids },
    {
      name: 'smoke',
      screenIds: [
        'p0_08_card_detail_workspace',
        'p0_47_print_preview',
        'p0_48_mobile_evidence_capture',
      ].filter((id) => ids.includes(id)),
    },
  ] satisfies ChunkDefinition[];
}

function usage() {
  return `Run design-fidelity captures in restartable chunks.

Usage:
  pnpm exec tsx tools/scripts/run-design-fidelity-chunks.ts [options]

Options:
  --chunks <names>      Comma-separated chunk names. Default: new,p1,p0-a,p0-b,p0-c
                        Available: new,p1,p0-a,p0-b,p0-c,p0-all,smoke
  --base-url <url>      App URL. Default: http://localhost:3012
  --port <number>       Dev server port. Default: 3012
  --heap-mb <number>    NODE_OPTIONS max-old-space-size for each chunk. Default: 12288
  --reuse-server        Do not start/stop Next dev; run all chunks against an existing server.
  --dry-run             Print chunk screen IDs without starting a server or Playwright.
  --help                Print this help.
`;
}

function parseArgs(argv: string[]): RunnerOptions {
  const options: RunnerOptions = {
    chunks: ['new', 'p1', 'p0-a', 'p0-b', 'p0-c'],
    baseUrl: `http://localhost:${DEFAULT_PORT}`,
    port: String(DEFAULT_PORT),
    heapMb: Number.parseInt(process.env.DESIGN_FIDELITY_HEAP_MB ?? '', 10) || DEFAULT_HEAP_MB,
    dryRun: false,
    reuseServer: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--reuse-server') {
      options.reuseServer = true;
      continue;
    }
    if (arg === '--chunks') {
      options.chunks = (argv[++i] ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      continue;
    }
    if (arg === '--base-url') {
      options.baseUrl = argv[++i] ?? options.baseUrl;
      options.port = new URL(options.baseUrl).port || options.port;
      continue;
    }
    if (arg === '--port') {
      options.port = argv[++i] ?? options.port;
      options.baseUrl = `http://localhost:${options.port}`;
      continue;
    }
    if (arg === '--heap-mb') {
      const heapMb = Number.parseInt(argv[++i] ?? '', 10);
      if (!Number.isFinite(heapMb) || heapMb < 1024) {
        throw new Error('--heap-mb must be a number >= 1024');
      }
      options.heapMb = heapMb;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.chunks.length === 0) {
    throw new Error('--chunks must include at least one chunk name');
  }

  return options;
}

function resolveChunks(names: string[], definitions: ChunkDefinition[]): ChunkDefinition[] {
  return names.map((name) => {
    const chunk = definitions.find((definition) => definition.name === name);
    if (!chunk) {
      throw new Error(
        `Unknown chunk "${name}". Available chunks: ${definitions
          .map((definition) => definition.name)
          .join(', ')}`,
      );
    }
    if (chunk.screenIds.length === 0) {
      throw new Error(`Chunk "${name}" resolved to no screens`);
    }
    return chunk;
  });
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with ${signal ?? code}`));
    });
  });
}

function createRequestAbort(timeoutMs = READY_CHECK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  maybeUnrefTimeout(timeout);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

async function waitForApp(baseUrl: string) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (appExited) {
      throw new Error('Next dev server exited before it became ready');
    }

    const abort = createRequestAbort();
    try {
      const response = await fetch(`${baseUrl}/login`, {
        redirect: 'manual',
        signal: abort.signal,
      });
      if (response.status < 500) return;
    } catch {
      // The server is still starting.
    } finally {
      abort.clear();
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function startDevServer(options: RunnerOptions) {
  appExited = false;
  appProcess = spawn('pnpm', ['exec', 'next', 'dev', '--webpack', '--port', options.port], {
    env: {
      ...process.env,
      NODE_OPTIONS: `--max-old-space-size=${options.heapMb}`,
      DATABASE_URL: LOCAL_DATABASE_URL,
      DIRECT_URL: LOCAL_DATABASE_URL,
      PLAYWRIGHT: '1',
      AUTH_SECRET: LOCAL_AUTH_SECRET,
      NEXTAUTH_SECRET: LOCAL_AUTH_SECRET,
      NEXTAUTH_URL: options.baseUrl,
      NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM: '1',
      NEXT_FONT_GOOGLE_MOCKED_RESPONSES: `${process.cwd()}/tools/tests/helpers/next-font-google-mocked-responses.cjs`,
    },
    stdio: 'inherit',
  });
  appProcess.once('exit', () => {
    appExited = true;
  });
  await waitForApp(options.baseUrl);
}

async function stopDevServer() {
  if (
    !appProcess ||
    appProcess.killed ||
    appProcess.exitCode !== null ||
    appProcess.signalCode !== null
  ) {
    appProcess = null;
    return;
  }

  appProcess.kill('SIGTERM');
  const timeout = setTimeout(() => {
    appProcess?.kill('SIGKILL');
  }, 5_000);
  maybeUnrefTimeout(timeout);
  await once(appProcess, 'exit').catch(() => null);
  clearTimeout(timeout);
  appProcess = null;
}

async function runChunk(chunk: ChunkDefinition, options: RunnerOptions) {
  console.log(`\n[design-fidelity] chunk=${chunk.name} screens=${chunk.screenIds.length}`);
  console.log(`[design-fidelity] ${chunk.screenIds.join(',')}`);

  if (!options.reuseServer) {
    await startDevServer(options);
  }

  try {
    await run(
      'pnpm',
      [
        'exec',
        'playwright',
        'test',
        '--config',
        'playwright.local.config.ts',
        'tools/tests/ui-design-fidelity.spec.ts',
        '--project=chromium',
      ],
      {
        ...process.env,
        DATABASE_URL: LOCAL_DATABASE_URL,
        DIRECT_URL: LOCAL_DATABASE_URL,
        PLAYWRIGHT_REUSE_SERVER: '1',
        PLAYWRIGHT_BASE_URL: options.baseUrl,
        DESIGN_SCREEN_IDS: chunk.screenIds.join(','),
      },
    );
  } finally {
    if (!options.reuseServer) {
      await stopDevServer();
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const chunks = resolveChunks(options.chunks, buildChunkDefinitions(DESIGN_SCREENS));

  for (const chunk of chunks) {
    console.log(`[design-fidelity] plan ${chunk.name}: ${chunk.screenIds.join(',')}`);
  }

  if (options.dryRun) return;

  process.on('SIGINT', () => {
    void stopDevServer().finally(() => process.exit(130));
  });
  process.on('SIGTERM', () => {
    void stopDevServer().finally(() => process.exit(143));
  });

  for (const chunk of chunks) {
    await runChunk(chunk, options);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(async (error) => {
    await stopDevServer();
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
