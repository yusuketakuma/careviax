import { readJsonObject } from '@/lib/db/json';

const VISIT_PRIORITIES = new Set(['normal', 'urgent', 'emergency']);
const VISIT_BRIEF_PROVIDERS = new Set(['rule', 'openai']);

export type CachedVisitBriefCard = {
  scheduleId: string;
  patientId: string;
  patientName: string;
  scheduledDate: string;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  priority: 'normal' | 'urgent' | 'emergency';
  facilityLabel: string | null;
  siteName: string | null;
  headline: string;
  mustCheckToday: string[];
  sourceRefs: string[];
  generatedAt: string;
  provider: 'rule' | 'openai';
  isFallback: boolean;
};

function readNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readNullableString(value: unknown) {
  return value === null || typeof value === 'string' ? value : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value.every((item): item is string => typeof item === 'string') ? value : null;
}

function isValidIsoDate(value: string) {
  return Number.isFinite(new Date(value).getTime());
}

function readPriority(value: unknown): CachedVisitBriefCard['priority'] | null {
  return typeof value === 'string' && VISIT_PRIORITIES.has(value)
    ? (value as CachedVisitBriefCard['priority'])
    : null;
}

function readProvider(value: unknown): CachedVisitBriefCard['provider'] | null {
  return typeof value === 'string' && VISIT_BRIEF_PROVIDERS.has(value)
    ? (value as CachedVisitBriefCard['provider'])
    : null;
}

export function normalizeCachedVisitBriefCard(value: unknown): CachedVisitBriefCard | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const scheduleId = readNonEmptyString(object.scheduleId);
  const patientId = readNonEmptyString(object.patientId);
  const patientName = readNonEmptyString(object.patientName);
  const scheduledDate = readNonEmptyString(object.scheduledDate);
  const timeWindowStart = readNullableString(object.timeWindowStart);
  const timeWindowEnd = readNullableString(object.timeWindowEnd);
  const priority = readPriority(object.priority);
  const facilityLabel = readNullableString(object.facilityLabel);
  const siteName = readNullableString(object.siteName);
  const headline = readNonEmptyString(object.headline);
  const mustCheckToday = readStringArray(object.mustCheckToday);
  const sourceRefs = readStringArray(object.sourceRefs);
  const generatedAt = readNonEmptyString(object.generatedAt);
  const provider = readProvider(object.provider);

  if (
    !scheduleId ||
    !patientId ||
    !patientName ||
    !scheduledDate ||
    !priority ||
    !headline ||
    !mustCheckToday ||
    !sourceRefs ||
    !generatedAt ||
    !provider ||
    typeof object.isFallback !== 'boolean' ||
    !isValidIsoDate(generatedAt) ||
    (timeWindowStart !== null && !isValidIsoDate(timeWindowStart)) ||
    (timeWindowEnd !== null && !isValidIsoDate(timeWindowEnd))
  ) {
    return null;
  }

  return {
    scheduleId,
    patientId,
    patientName,
    scheduledDate,
    timeWindowStart,
    timeWindowEnd,
    priority,
    facilityLabel,
    siteName,
    headline,
    mustCheckToday,
    sourceRefs,
    generatedAt,
    provider,
    isFallback: object.isFallback,
  };
}

export function parseCachedVisitBriefCardPayload(raw: string | null | undefined) {
  if (!raw) return null;

  try {
    return normalizeCachedVisitBriefCard(JSON.parse(raw));
  } catch {
    return null;
  }
}
