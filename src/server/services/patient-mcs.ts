import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '@/lib/db/client';
import { parseJsonObjectOrNull, parseJsonOrNull, readJsonObject } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import {
  buildMcsTimelinePayload,
  inferMcsProjectIdFromDocument,
  MCS_TIMELINE_SELECTORS,
  type ScrapedMcsTimeline,
  type ScrapedMcsTimelineArgs,
} from './patient-mcs-parser';
import {
  generatePatientMcsAiSummary,
  type PatientMcsSummaryMessage,
  type PatientMcsSummarySnapshot,
} from './patient-mcs-ai';
import { ALLOWED_MCS_HOSTS } from '@/lib/patient-mcs/source';

const execFileAsync = promisify(execFile);

const MCS_HOST = 'www.medical-care.net';
const DEFAULT_CDP_TARGET = '18800';
const DEFAULT_MAX_MESSAGES = 50;
export const PATIENT_MCS_MAX_MESSAGE_LIMIT = 100;
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;
const MCS_BROWSER_SYNC_DISABLED_MESSAGE = 'MCS 同期はローカル端末の開発環境でのみ有効です。';
const MCS_BROWSER_CONNECT_ERROR_MESSAGE =
  'MCS 連携用ブラウザに接続できません。ローカル端末で MCS にログインした Chrome を開いてから再試行してください。';
const MCS_BROWSER_SCRAPE_ERROR_MESSAGE =
  'MCS からデータを取得できませんでした。MCS を開き直してから再試行してください。';
export const PATIENT_MCS_PROFILE_TASK_TYPE = 'patient_mcs_profile';

export type PatientMcsLinkRecord = {
  id: string;
  source_url: string;
  mcs_patient_id: string | null;
  mcs_patient_url: string | null;
  mcs_project_id: string | null;
  mcs_project_url: string | null;
  project_title: string | null;
  project_memo: string | null;
  member_count: number | null;
  last_sync_attempt_at: Date | null;
  last_synced_at: Date | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
};

export type PatientMcsMessageRecord = {
  id: string;
  source_message_id: string;
  author_name: string;
  author_role: string | null;
  author_organization: string | null;
  author_descriptor: string | null;
  posted_at: Date | null;
  posted_at_label: string;
  body: string;
  reaction_count: number;
  reply_count: number;
  sort_order: number | null;
  source_url: string;
  synced_at: Date;
};

export type PatientMcsCheckLogRecord = {
  id: string;
  subject: string | null;
  content: string | null;
  counterpart_name: string | null;
  occurred_at: Date;
  created_at: Date;
};

export type PatientMcsProfileRecord = {
  linked_status: string | null;
  participation_status: string | null;
  pharmacy_participants: string[];
  counterpart_roles: string[];
  last_checked_at: Date | null;
  note: string | null;
  updated_at: Date | null;
};

export type PatientMcsOverview = {
  link: PatientMcsLinkRecord | null;
  profile: PatientMcsProfileRecord | null;
  summary: PatientMcsSummaryRecord | null;
  messages: PatientMcsMessageRecord[];
  checkLogs: PatientMcsCheckLogRecord[];
};

export type PatientMcsSyncResult = {
  link: PatientMcsLinkRecord;
  summary: PatientMcsSummaryRecord | null;
  importedCount: number;
  latestMessageAt: Date | null;
};

export type PatientMcsSummaryRecord = {
  id: string;
  generation_id: string;
  provider: string;
  requested_provider: string;
  is_fallback: boolean;
  model: string | null;
  fallback_reason: string | null;
  headline: string;
  bullets: string[];
  must_check_today: string[];
  suggested_actions: string[];
  source_refs: string[];
  message_count: number;
  other_professional_message_count: number;
  latest_posted_at: Date | null;
  generated_at: Date;
  duration_ms: number | null;
};

type PatientIdentityRecord = {
  id: string;
  name: string;
  name_kana: string;
};

type SyncPatientMcsTimelineArgs = {
  orgId: string;
  patientId: string;
  userId: string;
  sourceUrl?: string;
};

type SyncPatientMcsTimelineDependencies = {
  scrapeTimeline?: (sourceUrl: string) => Promise<ScrapedMcsTimelineWithContext>;
  now?: () => Date;
};

type PatientMcsSyncErrorKind = 'validation' | 'conflict' | 'external';

type ResolvedMcsProjectLink = {
  sourceUrl: string;
  patientId: string | null;
  patientUrl: string | null;
  projectId: string;
  projectUrl: string;
  patientName: string | null;
};

type ScrapedMcsTimelineWithContext = ScrapedMcsTimeline & {
  mcsPatientName: string | null;
};

type PreparedPatientMcsMessage = PatientMcsSummaryMessage & {
  authorDescriptor: string | null;
  reactionCount: number;
  replyCount: number;
  sortOrder: number | null;
  sourceUrl: string;
  rawPayload: ScrapedMcsTimeline['messages'][number];
};

export class PatientMcsSyncError extends Error {
  constructor(
    message: string,
    readonly kind: PatientMcsSyncErrorKind = 'external',
  ) {
    super(message);
    this.name = 'PatientMcsSyncError';
  }
}

function validationFailure(message: string) {
  return new PatientMcsSyncError(message, 'validation');
}

function conflictFailure(message: string) {
  return new PatientMcsSyncError(message, 'conflict');
}

function externalFailure(message: string) {
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

function toPatientMcsSyncError(error: unknown) {
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

async function connectMcsBrowser() {
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

async function openUrl(url: string) {
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

async function evaluateJson(script: string): Promise<Record<string, unknown>> {
  const output = await runAgentBrowser(['eval', script]);
  return parseAgentBrowserEvalJson(output);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function readFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function readNullableIsoDate(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizePatientMcsProfileRecord(
  task: { metadata: unknown; updated_at: Date } | null,
): PatientMcsProfileRecord | null {
  if (!task) return null;
  const metadata = readJsonObject(task.metadata);
  if (!metadata) return null;

  return {
    linked_status: isNullableString(metadata.linked_status) ? metadata.linked_status : null,
    participation_status: isNullableString(metadata.participation_status)
      ? metadata.participation_status
      : null,
    pharmacy_participants: readStringArray(metadata.pharmacy_participants),
    counterpart_roles: readStringArray(metadata.counterpart_roles),
    last_checked_at: readNullableIsoDate(metadata.last_checked_at),
    note: isNullableString(metadata.note) ? metadata.note : null,
    updated_at: task.updated_at,
  };
}

export function normalizeMcsActivationPayload(
  value: unknown,
): { projectId: string | null; currentUrl: string; patientName: string | null } | null {
  const object = readJsonObject(value);
  if (!object) return null;
  if (typeof object.currentUrl !== 'string') return null;
  if (!isNullableString(object.projectId)) return null;
  if (!isNullableString(object.patientName)) return null;
  const projectId = object.projectId;
  const patientName = object.patientName;
  if (projectId !== null && projectId.trim().length === 0) return null;

  return {
    projectId,
    currentUrl: object.currentUrl,
    patientName,
  };
}

function normalizeScrapedMcsMessage(value: unknown): ScrapedMcsTimeline['messages'][number] | null {
  const object = readJsonObject(value);
  if (!object) return null;
  if (typeof object.sourceMessageId !== 'string') return null;
  if (typeof object.authorName !== 'string') return null;
  if (!isNullableString(object.authorDescriptor)) return null;
  const authorDescriptor = object.authorDescriptor;
  if (typeof object.postedAtLabel !== 'string') return null;
  if (typeof object.body !== 'string') return null;
  const reactionCount = readFiniteNumber(object.reactionCount);
  const replyCount = readFiniteNumber(object.replyCount);
  const sortOrder = readFiniteNumber(object.sortOrder);
  if (reactionCount === null || replyCount === null || sortOrder === null) return null;
  if (typeof object.sourceUrl !== 'string') return null;

  return {
    sourceMessageId: object.sourceMessageId,
    authorName: object.authorName,
    authorDescriptor,
    postedAtLabel: object.postedAtLabel,
    body: object.body,
    reactionCount,
    replyCount,
    sortOrder,
    sourceUrl: object.sourceUrl,
  };
}

function isScrapedMcsMessage(
  value: ScrapedMcsTimeline['messages'][number] | null,
): value is ScrapedMcsTimeline['messages'][number] {
  return value !== null;
}

export function normalizeScrapedMcsTimelinePayload(value: unknown): ScrapedMcsTimeline | null {
  const object = readJsonObject(value);
  if (!object) return null;
  if (typeof object.sourceUrl !== 'string') return null;
  if (!isNullableString(object.mcsPatientId)) return null;
  if (!isNullableString(object.mcsPatientUrl)) return null;
  const mcsPatientId = object.mcsPatientId;
  const mcsPatientUrl = object.mcsPatientUrl;
  if (typeof object.mcsProjectId !== 'string') return null;
  if (typeof object.mcsProjectUrl !== 'string') return null;
  if (!isNullableString(object.projectTitle)) return null;
  if (!isNullableString(object.projectMemo)) return null;
  const projectTitle = object.projectTitle;
  const projectMemo = object.projectMemo;
  const memberCount = readFiniteNumber(object.memberCount);
  if (object.memberCount !== null && memberCount === null) return null;
  if (!Array.isArray(object.messages)) return null;

  const messages = object.messages.map(normalizeScrapedMcsMessage);
  if (!messages.every(isScrapedMcsMessage)) return null;

  return {
    sourceUrl: object.sourceUrl,
    mcsPatientId,
    mcsPatientUrl,
    mcsProjectId: object.mcsProjectId,
    mcsProjectUrl: object.mcsProjectUrl,
    projectTitle,
    projectMemo,
    memberCount,
    messages,
  };
}

function createTokyoDate(year: number, month: number, day: number, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - TOKYO_OFFSET_MS);
}

function getTokyoCalendarParts(now: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  const parts = formatter.formatToParts(now);
  const read = (type: 'year' | 'month' | 'day') =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
  };
}

export function normalizeMedicalCareStationUrl(input: string) {
  const normalized = new URL(input.trim());

  if (normalized.protocol !== 'https:' || !ALLOWED_MCS_HOSTS.has(normalized.hostname)) {
    throw validationFailure('Medical Care Station の URL を入力してください');
  }

  normalized.hash = '';
  return normalized;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractPathId(pathname: string, prefix: string) {
  const match = pathname.match(new RegExp(`^${escapeRegExp(prefix)}/([^/]+)`));
  return match?.[1] ?? null;
}

export function parseMcsAuthorDescriptor(descriptor: string | null | undefined) {
  if (!descriptor) {
    return {
      authorRole: null,
      authorOrganization: null,
      authorDescriptor: null,
    };
  }

  const normalized = descriptor.replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^(.+?)[（(](.+?)[）)]$/);

  return {
    authorRole: match?.[1]?.trim() ?? normalized,
    authorOrganization: match?.[2]?.trim() ?? null,
    authorDescriptor: normalized,
  };
}

export function parseMcsPostedAtLabel(label: string | null | undefined, now = new Date()) {
  if (!label) return null;

  const normalized = label.trim();
  const today = getTokyoCalendarParts(now);

  const monthDayTimeMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (monthDayTimeMatch) {
    const [, monthRaw, dayRaw, hourRaw, minuteRaw] = monthDayTimeMatch;
    let parsed = createTokyoDate(
      today.year,
      Number(monthRaw),
      Number(dayRaw),
      Number(hourRaw),
      Number(minuteRaw),
    );

    if (parsed.getTime() - now.getTime() > 1000 * 60 * 60 * 24 * 30) {
      parsed = createTokyoDate(
        today.year - 1,
        Number(monthRaw),
        Number(dayRaw),
        Number(hourRaw),
        Number(minuteRaw),
      );
    }

    return parsed;
  }

  const monthDayMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (monthDayMatch) {
    const [, monthRaw, dayRaw] = monthDayMatch;
    let parsed = createTokyoDate(today.year, Number(monthRaw), Number(dayRaw));

    if (parsed.getTime() - now.getTime() > 1000 * 60 * 60 * 24 * 30) {
      parsed = createTokyoDate(today.year - 1, Number(monthRaw), Number(dayRaw));
    }

    return parsed;
  }

  const timeOnlyMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (timeOnlyMatch) {
    const [, hourRaw, minuteRaw] = timeOnlyMatch;
    let parsed = createTokyoDate(
      today.year,
      today.month,
      today.day,
      Number(hourRaw),
      Number(minuteRaw),
    );

    if (parsed.getTime() - now.getTime() > 1000 * 60 * 60 * 12) {
      parsed = new Date(parsed.getTime() - 1000 * 60 * 60 * 24);
    }

    return parsed;
  }

  return null;
}

function normalizePatientIdentityText(value: string | null | undefined) {
  return (
    value
      ?.normalize('NFKC')
      .replace(/[｜|].*$/, '')
      .replace(/[：:].*$/, '')
      .replace(/[\s　()（）・･]/g, '')
      .trim()
      .toLowerCase() ?? ''
  );
}

export function extractPatientNameFromProjectTitle(projectTitle: string | null | undefined) {
  if (!projectTitle) {
    return null;
  }

  const [titleBeforeDivider] = projectTitle.split(/[|｜]/, 1);
  const [name] = titleBeforeDivider.split(/[：:]/, 1);
  const normalized = name?.trim();
  return normalized?.length ? normalized : null;
}

export function matchesPatientIdentity(
  patient: Pick<PatientIdentityRecord, 'name' | 'name_kana'>,
  candidates: Array<string | null | undefined>,
) {
  const localCandidates = [patient.name, patient.name_kana]
    .map((value) => normalizePatientIdentityText(value))
    .filter(Boolean);
  const remoteCandidates = candidates
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => normalizePatientIdentityText(value))
    .filter(Boolean);

  if (remoteCandidates.length === 0) {
    return false;
  }

  return localCandidates.some((localCandidate) =>
    remoteCandidates.some((remoteCandidate) => localCandidate === remoteCandidate),
  );
}

function assertPatientIdentityMatches(
  patient: PatientIdentityRecord,
  scraped: ScrapedMcsTimelineWithContext,
) {
  const mcsCandidateLabels = [
    scraped.mcsPatientName,
    extractPatientNameFromProjectTitle(scraped.projectTitle),
  ].filter((value): value is string => Boolean(value?.trim()));

  if (mcsCandidateLabels.length === 0) {
    throw conflictFailure(
      `MCS 上の患者名を確認できませんでした。対象患者「${patient.name}」に紐づく URL か確認してください`,
    );
  }

  if (!matchesPatientIdentity(patient, mcsCandidateLabels)) {
    throw conflictFailure(
      `MCS の患者名「${mcsCandidateLabels[0]}」が対象患者「${patient.name}」と一致しません`,
    );
  }
}

function assertAuthenticatedMcsUrl(currentUrl: string) {
  if (currentUrl.includes('/authentication/login')) {
    throw externalFailure(
      'Medical Care Station にログイン済みの Chrome セッションが見つかりません',
    );
  }
}

function assertTrustedMcsUrl(currentUrl: string) {
  normalizeMedicalCareStationUrl(currentUrl);
}

async function activateMedicalTimelineFromPatientPage() {
  const payload = await evaluateJson(
    `(async () => {
      const findProjectId = ${inferMcsProjectIdFromDocument.toString()};
      const normalize = (value) => value?.textContent?.replace(/\\s+/g, ' ').trim() || '';
      const nameLabel = Array.from(document.querySelectorAll('th, dt, label')).find((node) => {
        return normalize(node) === '名前';
      });
      const labeledCandidates = nameLabel
        ? [
            nameLabel.nextElementSibling,
            nameLabel.parentElement?.querySelector('td, dd, .value'),
            ...Array.from(nameLabel.parentElement?.children || []).filter((node) => node !== nameLabel),
          ]
        : [];
      const patientName =
        labeledCandidates.map((node) => normalize(node)).find(Boolean) ||
        normalize(document.querySelector('.patient_name')) ||
        normalize(document.querySelector('.profile_name')) ||
        normalize(document.querySelector('h1')) ||
        null;
      const link = Array.from(document.querySelectorAll('a')).find((anchor) => {
        const label = normalize(anchor);
        return label === '医療･介護側' || label === '医療・介護側';
      });

      if (link instanceof HTMLElement) {
        link.click();
      }

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let projectId = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await sleep(350);
        projectId = findProjectId(document);
        if (projectId && document.querySelectorAll(${JSON.stringify(MCS_TIMELINE_SELECTORS.messagePosts)}).length > 0) {
          break;
        }
      }

      return JSON.stringify({
        projectId,
        currentUrl: location.href,
        patientName,
      });
    })()`,
  );
  const normalized = normalizeMcsActivationPayload(payload);
  if (!normalized) {
    throw externalFailure(MCS_BROWSER_SCRAPE_ERROR_MESSAGE);
  }
  return normalized;
}

async function ensureMedicalProjectUrl(sourceUrl: string): Promise<ResolvedMcsProjectLink> {
  await connectMcsBrowser();

  const normalizedSource = normalizeMedicalCareStationUrl(sourceUrl);
  let currentUrl = await openUrl(normalizedSource.toString());
  assertAuthenticatedMcsUrl(currentUrl);
  assertTrustedMcsUrl(currentUrl);

  const patientId = extractPathId(normalizedSource.pathname, '/patients');
  const patientUrl = patientId ? normalizedSource.toString() : null;

  if (normalizedSource.pathname.startsWith('/projects/unavailable/')) {
    const projectId = extractPathId(normalizedSource.pathname, '/projects/unavailable');
    if (!projectId) {
      throw validationFailure('MCS の患者・利用者側 URL から project_id を判定できませんでした');
    }

    currentUrl = await openUrl(`https://${MCS_HOST}/projects/medical/${projectId}`);
  } else if (normalizedSource.pathname.startsWith('/patients/')) {
    const activated = await activateMedicalTimelineFromPatientPage();
    if (!activated.projectId) {
      throw validationFailure('医療・介護側タイムラインの project_id を判定できませんでした');
    }
    return {
      sourceUrl: normalizedSource.toString(),
      patientId,
      patientUrl,
      projectId: activated.projectId,
      projectUrl: `https://${MCS_HOST}/projects/medical/${activated.projectId}`,
      patientName: activated.patientName,
    };
  }

  assertAuthenticatedMcsUrl(currentUrl);
  assertTrustedMcsUrl(currentUrl);
  const resolved = new URL(currentUrl);
  const projectId = extractPathId(resolved.pathname, '/projects/medical');
  if (!projectId) {
    throw validationFailure('医療・介護側タイムラインを開けませんでした');
  }

  return {
    sourceUrl: normalizedSource.toString(),
    patientId,
    patientUrl,
    projectId,
    projectUrl: resolved.toString(),
    patientName: null,
  };
}

function buildTimelineScrapeScript(
  args: ScrapedMcsTimelineArgs,
  maxMessages = DEFAULT_MAX_MESSAGES,
) {
  return `(async () => {
    const selectors = ${JSON.stringify(MCS_TIMELINE_SELECTORS)};
    const args = ${JSON.stringify(args)};
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const messageSelector = selectors.messagePosts;
    await sleep(1200);

    let stagnant = 0;
    while (stagnant < 2) {
      const before = document.querySelectorAll(messageSelector).length;
      if (before >= ${maxMessages}) {
        break;
      }

      const wrapper = document.querySelector(selectors.scrollWrapper);
      if (wrapper instanceof HTMLElement) {
        wrapper.scrollTop = wrapper.scrollHeight;
      } else {
        window.scrollTo(0, document.body.scrollHeight);
      }

      await sleep(800);
      const after = document.querySelectorAll(messageSelector).length;
      stagnant = after <= before ? stagnant + 1 : 0;
    }

    const buildPayload = ${buildMcsTimelinePayload.toString()};
    return JSON.stringify(buildPayload(document, args, selectors));
  })()`;
}

async function scrapeMcsTimeline(sourceUrl: string): Promise<ScrapedMcsTimelineWithContext> {
  const resolved = await ensureMedicalProjectUrl(sourceUrl);
  const timelineArgs: ScrapedMcsTimelineArgs = {
    sourceUrl: resolved.sourceUrl,
    mcsPatientId: resolved.patientId,
    mcsPatientUrl: resolved.patientUrl,
    mcsProjectId: resolved.projectId,
    mcsProjectUrl: resolved.projectUrl,
  };
  const scrapedPayload = await evaluateJson(buildTimelineScrapeScript(timelineArgs));
  const scraped = normalizeScrapedMcsTimelinePayload(scrapedPayload);
  if (!scraped) {
    throw externalFailure(MCS_BROWSER_SCRAPE_ERROR_MESSAGE);
  }

  return {
    ...scraped,
    mcsPatientName: resolved.patientName,
  };
}

function buildPreparedMessages(messages: ScrapedMcsTimeline['messages']) {
  return messages.map((message) => {
    const parsedAuthor = parseMcsAuthorDescriptor(message.authorDescriptor);
    const postedAt = parseMcsPostedAtLabel(message.postedAtLabel);

    return {
      sourceMessageId: message.sourceMessageId,
      authorName: message.authorName,
      authorRole: parsedAuthor.authorRole,
      authorOrganization: parsedAuthor.authorOrganization,
      authorDescriptor: parsedAuthor.authorDescriptor,
      postedAt,
      postedAtLabel: message.postedAtLabel,
      body: message.body,
      reactionCount: message.reactionCount,
      replyCount: message.replyCount,
      sortOrder: message.sortOrder,
      sourceUrl: message.sourceUrl,
      rawPayload: message,
    };
  });
}

function selectPatientMcsSummaryRecord() {
  return {
    id: true,
    generation_id: true,
    provider: true,
    requested_provider: true,
    is_fallback: true,
    model: true,
    fallback_reason: true,
    headline: true,
    bullets: true,
    must_check_today: true,
    suggested_actions: true,
    source_refs: true,
    message_count: true,
    other_professional_message_count: true,
    latest_posted_at: true,
    generated_at: true,
    duration_ms: true,
  } as const;
}

function buildPatientMcsSummaryFields(summary: PatientMcsSummarySnapshot) {
  return {
    generation_id: summary.generation_id,
    provider: summary.provider,
    requested_provider: summary.requested_provider,
    is_fallback: summary.is_fallback,
    model: summary.model,
    fallback_reason: summary.fallback_reason,
    headline: summary.headline,
    bullets: summary.bullets,
    must_check_today: summary.must_check_today,
    suggested_actions: summary.suggested_actions,
    source_refs: summary.source_refs,
    message_count: summary.message_count,
    other_professional_message_count: summary.other_professional_message_count,
    latest_posted_at: summary.latest_posted_at ? new Date(summary.latest_posted_at) : null,
    generated_at: new Date(summary.generated_at),
    duration_ms: summary.duration_ms,
  };
}

export async function generatePatientMcsSummarySafely(args: {
  patientName: string;
  projectTitle: string | null;
  messages: Parameters<typeof generatePatientMcsAiSummary>[0]['messages'];
}) {
  try {
    return await generatePatientMcsAiSummary(args);
  } catch {
    logger.warn({
      event: 'patient_mcs_summary_fallback',
      externalProvider: 'patient_mcs_ai',
      code: 'unknown_error',
    });
    return null;
  }
}

export async function syncPatientMcsTimeline(
  { orgId, patientId, userId, sourceUrl }: SyncPatientMcsTimelineArgs,
  dependencies: SyncPatientMcsTimelineDependencies = {},
): Promise<PatientMcsSyncResult> {
  const scrapeTimeline = dependencies.scrapeTimeline ?? scrapeMcsTimeline;
  const now = dependencies.now ?? (() => new Date());

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, org_id: orgId },
    select: { id: true, name: true, name_kana: true },
  });
  if (!patient) {
    throw new Error('患者が見つかりません');
  }

  const existingLink = await prisma.patientMcsLink.findUnique({
    where: { patient_id: patientId },
    select: {
      id: true,
      source_url: true,
      mcs_patient_id: true,
      mcs_project_id: true,
    },
  });

  const effectiveSourceUrl = sourceUrl?.trim() || existingLink?.source_url;
  if (!effectiveSourceUrl) {
    throw validationFailure('MCS の患者 URL または医療・介護側タイムライン URL を入力してください');
  }

  try {
    const scraped = await scrapeTimeline(effectiveSourceUrl);
    if (
      existingLink?.mcs_patient_id &&
      scraped.mcsPatientId &&
      existingLink.mcs_patient_id !== scraped.mcsPatientId
    ) {
      throw conflictFailure('既存の MCS 連携先と異なる患者が指定されています');
    }
    assertPatientIdentityMatches(patient, scraped);
    const preparedMessages = buildPreparedMessages(scraped.messages);
    const summary = await generatePatientMcsSummarySafely({
      patientName: patient.name,
      projectTitle: scraped.projectTitle,
      messages: preparedMessages,
    });
    const syncedAt = now();

    const saved = await withOrgContext(orgId, async (tx) => {
      const txWithSummary = tx as typeof tx & {
        patientMcsSummary: typeof prisma.patientMcsSummary;
      };
      const buildLinkFields = () => ({
        source_url: scraped.sourceUrl,
        mcs_patient_id: scraped.mcsPatientId,
        mcs_patient_url: scraped.mcsPatientUrl,
        mcs_project_id: scraped.mcsProjectId,
        mcs_project_url: scraped.mcsProjectUrl,
        project_title: scraped.projectTitle,
        project_memo: scraped.projectMemo,
        member_count: scraped.memberCount,
        last_sync_attempt_at: syncedAt,
        last_synced_at: syncedAt,
        last_sync_status: 'success',
        last_sync_error: null,
        updated_by: userId,
      });

      const link = await tx.patientMcsLink.upsert({
        where: { patient_id: patientId },
        create: {
          org_id: orgId,
          patient_id: patientId,
          ...buildLinkFields(),
          created_by: userId,
        },
        update: buildLinkFields(),
        select: {
          id: true,
          source_url: true,
          mcs_patient_id: true,
          mcs_patient_url: true,
          mcs_project_id: true,
          mcs_project_url: true,
          project_title: true,
          project_memo: true,
          member_count: true,
          last_sync_attempt_at: true,
          last_synced_at: true,
          last_sync_status: true,
          last_sync_error: true,
        },
      });

      const buildMessageFields = (message: PreparedPatientMcsMessage) => {
        return {
          author_name: message.authorName,
          author_role: message.authorRole,
          author_organization: message.authorOrganization,
          author_descriptor: message.authorDescriptor,
          posted_at: message.postedAt,
          posted_at_label: message.postedAtLabel,
          body: message.body,
          reaction_count: message.reactionCount,
          reply_count: message.replyCount,
          sort_order: message.sortOrder,
          source_url: message.sourceUrl,
          raw_payload: message.rawPayload,
          synced_at: syncedAt,
        };
      };

      const UPSERT_CHUNK_SIZE = 10;
      for (let i = 0; i < preparedMessages.length; i += UPSERT_CHUNK_SIZE) {
        const chunk = preparedMessages.slice(i, i + UPSERT_CHUNK_SIZE);
        await Promise.all(
          chunk.map((message) =>
            tx.patientMcsMessage.upsert({
              where: {
                link_id_source_message_id: {
                  link_id: link.id,
                  source_message_id: message.sourceMessageId,
                },
              },
              create: {
                org_id: orgId,
                patient_id: patientId,
                link_id: link.id,
                source_message_id: message.sourceMessageId,
                ...buildMessageFields(message),
              },
              update: buildMessageFields(message),
            }),
          ),
        );
      }

      // MCS scraping is bounded and not authoritative for deletion. Preserve local
      // timeline history and only upsert messages observed in the latest scrape.

      if (summary) {
        await txWithSummary.patientMcsSummary.upsert({
          where: { patient_id: patientId },
          create: {
            org_id: orgId,
            patient_id: patientId,
            link_id: link.id,
            ...buildPatientMcsSummaryFields(summary),
          },
          update: {
            link_id: link.id,
            ...buildPatientMcsSummaryFields(summary),
          },
        });
      }
      // When summary generation fails or returns null, preserve the existing summary
      // rather than deleting it. Deletion only occurs on explicit user-initiated removal.

      const savedSummary = await txWithSummary.patientMcsSummary.findUnique({
        where: { patient_id: patientId },
        select: selectPatientMcsSummaryRecord(),
      });

      return {
        link,
        summary: savedSummary,
        importedCount: preparedMessages.length,
        latestMessageAt:
          preparedMessages
            .map((message) => message.postedAt)
            .filter((value): value is Date => value instanceof Date)
            .sort((left, right) => right.getTime() - left.getTime())[0] ?? null,
      };
    });

    return saved;
  } catch (error) {
    const syncError = toPatientMcsSyncError(error);
    const attemptedAt = now();

    await withOrgContext(orgId, async (tx) => {
      await tx.patientMcsLink.upsert({
        where: { patient_id: patientId },
        create: {
          org_id: orgId,
          patient_id: patientId,
          source_url: effectiveSourceUrl,
          last_sync_attempt_at: attemptedAt,
          last_sync_status: 'failed',
          last_sync_error: syncError.message,
          created_by: userId,
          updated_by: userId,
        },
        update: {
          source_url: effectiveSourceUrl,
          last_sync_attempt_at: attemptedAt,
          last_sync_status: 'failed',
          last_sync_error: syncError.message,
          updated_by: userId,
        },
      });
    }).catch(() => undefined);

    throw syncError;
  }
}

export async function getPatientMcsOverview(args: {
  orgId: string;
  patientId: string;
  limit?: number;
}): Promise<PatientMcsOverview> {
  return withOrgContext(args.orgId, async (tx) => {
    const messageLimit = normalizePatientMcsMessageLimit(args.limit);
    const txWithSummary = tx as typeof tx & {
      patientMcsSummary: typeof prisma.patientMcsSummary;
    };
    const link = await tx.patientMcsLink.findFirst({
      where: { patient_id: args.patientId },
      select: {
        id: true,
        source_url: true,
        mcs_patient_id: true,
        mcs_patient_url: true,
        mcs_project_id: true,
        mcs_project_url: true,
        project_title: true,
        project_memo: true,
        member_count: true,
        last_sync_attempt_at: true,
        last_synced_at: true,
        last_sync_status: true,
        last_sync_error: true,
      },
    });
    const [summary, messages, checkLogs, profileTask] = await Promise.all([
      link
        ? txWithSummary.patientMcsSummary.findFirst({
            where: { patient_id: args.patientId },
            select: selectPatientMcsSummaryRecord(),
          })
        : null,
      link && messageLimit !== 0
        ? tx.patientMcsMessage.findMany({
            where: { link_id: link.id },
            orderBy: [{ posted_at: 'desc' }, { sort_order: 'asc' }, { created_at: 'desc' }],
            take: messageLimit,
            select: {
              id: true,
              source_message_id: true,
              author_name: true,
              author_role: true,
              author_organization: true,
              author_descriptor: true,
              posted_at: true,
              posted_at_label: true,
              body: true,
              reaction_count: true,
              reply_count: true,
              sort_order: true,
              source_url: true,
              synced_at: true,
            },
          })
        : [],
      tx.communicationEvent.findMany({
        where: {
          org_id: args.orgId,
          patient_id: args.patientId,
          event_type: 'mcs_check',
        },
        orderBy: [{ occurred_at: 'desc' }, { created_at: 'desc' }],
        take: 5,
        select: {
          id: true,
          subject: true,
          content: true,
          counterpart_name: true,
          occurred_at: true,
          created_at: true,
        },
      }),
      tx.task.findFirst({
        where: {
          org_id: args.orgId,
          task_type: PATIENT_MCS_PROFILE_TASK_TYPE,
          related_entity_type: 'patient',
          related_entity_id: args.patientId,
        },
        orderBy: { updated_at: 'desc' },
        select: {
          metadata: true,
          updated_at: true,
        },
      }),
    ]);

    return {
      link,
      profile: normalizePatientMcsProfileRecord(profileTask),
      summary,
      messages,
      checkLogs,
    };
  });
}

export function normalizePatientMcsMessageLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_MAX_MESSAGES;
  return Math.min(Math.max(Math.trunc(limit), 0), PATIENT_MCS_MAX_MESSAGE_LIMIT);
}
