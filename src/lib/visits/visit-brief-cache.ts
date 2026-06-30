import { parseJsonOrNull, readJsonObject } from '@/lib/db/json';
import {
  normalizePatientArchiveSummary,
  type PatientArchiveSummary,
} from '@/lib/patient/archive-summary';

export type CachedVisitBriefCard = {
  scheduleId: string;
  patientId: string;
  patientName: string;
  patientArchive?: PatientArchiveSummary | null;
  scheduledDate: string;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  priority: 'normal' | 'urgent' | 'emergency';
  facilityLabel: string | null;
  siteName: string | null;
  headline: string;
  mustCheckToday: string[];
  latestLabs: string[];
  sourceRefs: string[];
  generatedAt: string;
  provider: 'rule' | 'openai';
  isFallback: boolean;
};

type CachedVisitBriefPriority = CachedVisitBriefCard['priority'];
type CachedVisitBriefProvider = CachedVisitBriefCard['provider'];

const VISIT_PRIORITIES = new Set<string>(['normal', 'urgent', 'emergency']);
const VISIT_BRIEF_PROVIDERS = new Set<string>(['rule', 'openai']);

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

function isCachedVisitBriefPriority(value: unknown): value is CachedVisitBriefPriority {
  return typeof value === 'string' && VISIT_PRIORITIES.has(value);
}

function isCachedVisitBriefProvider(value: unknown): value is CachedVisitBriefProvider {
  return typeof value === 'string' && VISIT_BRIEF_PROVIDERS.has(value);
}

function readPriority(value: unknown): CachedVisitBriefPriority | null {
  return isCachedVisitBriefPriority(value) ? value : null;
}

function readProvider(value: unknown): CachedVisitBriefProvider | null {
  return isCachedVisitBriefProvider(value) ? value : null;
}

export function normalizeCachedVisitBriefCard(value: unknown): CachedVisitBriefCard | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const scheduleId = readNonEmptyString(object.scheduleId);
  const patientId = readNonEmptyString(object.patientId);
  const patientName = readNonEmptyString(object.patientName);
  const hasPatientArchive = object.patientArchive !== undefined && object.patientArchive !== null;
  const patientArchive = hasPatientArchive
    ? normalizePatientArchiveSummary(object.patientArchive)
    : null;
  const scheduledDate = readNonEmptyString(object.scheduledDate);
  const timeWindowStart = readNullableString(object.timeWindowStart);
  const timeWindowEnd = readNullableString(object.timeWindowEnd);
  const priority = readPriority(object.priority);
  const facilityLabel = readNullableString(object.facilityLabel);
  const siteName = readNullableString(object.siteName);
  const headline = readNonEmptyString(object.headline);
  const mustCheckToday = readStringArray(object.mustCheckToday);
  const latestLabs = object.latestLabs === undefined ? [] : readStringArray(object.latestLabs);
  const sourceRefs = readStringArray(object.sourceRefs);
  const generatedAt = readNonEmptyString(object.generatedAt);
  const provider = readProvider(object.provider);

  if (
    !scheduleId ||
    !patientId ||
    !patientName ||
    (hasPatientArchive && patientArchive === null) ||
    !scheduledDate ||
    !priority ||
    !headline ||
    !mustCheckToday ||
    !latestLabs ||
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
    ...(patientArchive ? { patientArchive } : {}),
    scheduledDate,
    timeWindowStart,
    timeWindowEnd,
    priority,
    facilityLabel,
    siteName,
    headline,
    mustCheckToday,
    latestLabs,
    sourceRefs,
    generatedAt,
    provider,
    isFallback: object.isFallback,
  };
}

export function parseCachedVisitBriefCardPayload(raw: string | null | undefined) {
  return normalizeCachedVisitBriefCard(parseJsonOrNull(raw));
}
