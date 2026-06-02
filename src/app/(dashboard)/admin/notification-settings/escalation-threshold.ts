import { ESCALATION_THRESHOLD_HOURS_MAX } from '@/lib/validations/escalation-rule';

export function parseEscalationThresholdHoursInput(value: string) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;

  const thresholdHours = Number(normalized);
  if (
    !Number.isSafeInteger(thresholdHours) ||
    thresholdHours < 1 ||
    thresholdHours > ESCALATION_THRESHOLD_HOURS_MAX
  ) {
    return null;
  }

  return thresholdHours;
}
