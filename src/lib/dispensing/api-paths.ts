import { encodePathSegment } from '@/lib/http/path-segment';

export function buildDispenseTaskApiPath(taskId: string, suffix = '') {
  return `/api/dispense-tasks/${encodePathSegment(taskId)}${suffix}`;
}

export function buildPrescriptionLineApiPath(lineId: string, suffix = '') {
  return `/api/prescription-lines/${encodePathSegment(lineId)}${suffix}`;
}

export function buildSetPlanApiPath(planId: string, suffix = '') {
  return `/api/set-plans/${encodePathSegment(planId)}${suffix}`;
}
