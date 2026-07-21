import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseJsonObjectOrNull, parseJsonOrNull } from '@/lib/db/json';

const execFileAsync = promisify(execFile);
const DEFAULT_CDP_TARGET = '18800';
const MCS_BROWSER_SYNC_DISABLED_MESSAGE = 'MCS 同期はローカル端末の開発環境でのみ有効です。';
const MCS_BROWSER_CONNECT_ERROR_MESSAGE =
  'MCS 連携用ブラウザに接続できません。ローカル端末で MCS にログインした Chrome を開いてから再試行してください。';
export const MCS_BROWSER_SCRAPE_ERROR_MESSAGE =
  'MCS からデータを取得できませんでした。MCS を開き直してから再試行してください。';

type PatientMcsSyncErrorKind = 'validation' | 'conflict' | 'external';

export class PatientMcsSyncError extends Error {
  constructor(
    message: string,
    readonly kind: PatientMcsSyncErrorKind = 'external',
  ) {
    super(message);
    this.name = 'PatientMcsSyncError';
  }
}

export function validationFailure(message: string) {
  return new PatientMcsSyncError(message, 'validation');
}

export function conflictFailure(message: string) {
  return new PatientMcsSyncError(message, 'conflict');
}

export function externalFailure(message: string) {
  return new PatientMcsSyncError(message, 'external');
}

function getAgentBrowserBinary() {
  return process.env.MCS_AGENT_BROWSER_BIN?.trim() || 'agent-browser';
}

function getMcsCdpTarget() {
  return process.env.MCS_BROWSER_CDP_TARGET?.trim() || DEFAULT_CDP_TARGET;
}

function isHostedRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_EXECUTION_ENV);
}

export function isPatientMcsBrowserSyncEnabled() {
  return process.env.PATIENT_MCS_BROWSER_SYNC_ENABLED === 'true' && !isHostedRuntime();
}

export function sanitizePatientMcsExternalErrorMessage(message: string | null | undefined) {
  const normalized = message?.trim() ?? '';

  if (normalized.includes('ログイン済みの Chrome セッションが見つかりません')) {
    return 'Medical Care Station にログイン済みの Chrome セッションが見つかりません';
  }

  if (normalized.includes('ローカル端末の開発環境でのみ有効')) {
    return MCS_BROWSER_SYNC_DISABLED_MESSAGE;
  }

  if (/agent-browser|chrome|browser|cdp|econnrefused|spawn|enoent|connect/i.test(normalized)) {
    return MCS_BROWSER_CONNECT_ERROR_MESSAGE;
  }

  return MCS_BROWSER_SCRAPE_ERROR_MESSAGE;
}

export function toPatientMcsSyncError(error: unknown) {
  if (error instanceof PatientMcsSyncError) {
    if (error.kind !== 'external') {
      return error;
    }

    return externalFailure(sanitizePatientMcsExternalErrorMessage(error.message));
  }

  return externalFailure(
    sanitizePatientMcsExternalErrorMessage(error instanceof Error ? error.message : null),
  );
}

function extractMeaningfulOutput(stdout: string) {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('✓'))
    .join('\n')
    .trim();
}

async function runAgentBrowser(args: string[]) {
  try {
    const { stdout } = await execFileAsync(getAgentBrowserBinary(), args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    });
    return extractMeaningfulOutput(stdout);
  } catch (error) {
    const message =
      error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
        ? error.stderr.trim() || error.message
        : error instanceof Error
          ? error.message
          : 'agent-browser の実行に失敗しました';
    throw externalFailure(sanitizePatientMcsExternalErrorMessage(message));
  }
}

export async function connectMcsBrowser() {
  if (!isPatientMcsBrowserSyncEnabled()) {
    throw externalFailure(MCS_BROWSER_SYNC_DISABLED_MESSAGE);
  }

  await runAgentBrowser(['connect', getMcsCdpTarget()]);
}

async function getCurrentUrl() {
  return runAgentBrowser(['get', 'url']);
}

function extractUrlFromAgentBrowserOutput(output: string) {
  const candidates = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const candidate of candidates.toReversed()) {
    try {
      return new URL(candidate).toString();
    } catch {
      continue;
    }
  }

  return null;
}

export async function openUrl(url: string) {
  const output = await runAgentBrowser(['open', url]);
  return extractUrlFromAgentBrowserOutput(output) ?? getCurrentUrl();
}

export function parseAgentBrowserEvalJson(output: string): Record<string, unknown> {
  const encodedPayload = parseJsonOrNull(output);
  if (typeof encodedPayload !== 'string') {
    throw externalFailure(MCS_BROWSER_SCRAPE_ERROR_MESSAGE);
  }

  const object = parseJsonObjectOrNull(encodedPayload);
  if (!object) {
    throw externalFailure(MCS_BROWSER_SCRAPE_ERROR_MESSAGE);
  }

  return object;
}

export async function evaluateJson(script: string): Promise<Record<string, unknown>> {
  const output = await runAgentBrowser(['eval', script]);
  return parseAgentBrowserEvalJson(output);
}
