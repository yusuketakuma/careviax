export const REALTIME_READINESS_EVENT = 'realtime_readiness';

export type RealtimeChannel = 'org' | 'user' | 'presence';

export type RealtimeReadiness = {
  version: 1;
  org: boolean;
  user: boolean;
  presence: boolean;
};

const READINESS_KEYS = new Set(['version', 'org', 'user', 'presence']);

export function parseRealtimeReadiness(value: unknown): RealtimeReadiness | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== READINESS_KEYS.size || keys.some((key) => !READINESS_KEYS.has(key))) {
    return null;
  }
  if (
    record.version !== 1 ||
    typeof record.org !== 'boolean' ||
    typeof record.user !== 'boolean' ||
    typeof record.presence !== 'boolean'
  ) {
    return null;
  }

  return {
    version: 1,
    org: record.org,
    user: record.user,
    presence: record.presence,
  };
}

export function hasRequiredRealtimeReadiness(
  readiness: RealtimeReadiness | null,
  requiredChannels: readonly RealtimeChannel[],
) {
  return (
    readiness !== null &&
    requiredChannels.length > 0 &&
    requiredChannels.every((channel) => readiness[channel])
  );
}
