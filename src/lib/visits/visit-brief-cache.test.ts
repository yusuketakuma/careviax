import { describe, expect, it } from 'vitest';
import {
  normalizeCachedVisitBriefCard,
  parseCachedVisitBriefCardPayload,
  type CachedVisitBriefCard,
} from './visit-brief-cache';

const validCard: CachedVisitBriefCard = {
  scheduleId: 'schedule_1',
  patientId: 'patient_1',
  patientName: '山田花子',
  scheduledDate: '2026-05-31',
  timeWindowStart: '2026-05-31T09:00:00.000Z',
  timeWindowEnd: '2026-05-31T10:00:00.000Z',
  priority: 'normal',
  facilityLabel: '東京都千代田区1-1-1',
  siteName: '本店',
  headline: '前回の血圧変動を確認',
  mustCheckToday: ['血圧記録', '残薬'],
  latestLabs: ['eGFR 38 / 測定日 2026-05-20 / 異常 L'],
  sourceRefs: ['前回訪問', '処方歴'],
  generatedAt: '2026-05-31T08:00:00.000Z',
  provider: 'openai',
  isFallback: false,
};

describe('visit brief cache helpers', () => {
  it('parses a valid cached visit brief payload', () => {
    expect(parseCachedVisitBriefCardPayload(JSON.stringify(validCard))).toEqual(validCard);
  });

  it('accepts legacy payloads without latest lab excerpts', () => {
    const legacy: Partial<CachedVisitBriefCard> = { ...validCard };
    delete legacy.latestLabs;

    expect(parseCachedVisitBriefCardPayload(JSON.stringify(legacy))).toEqual({
      ...validCard,
      latestLabs: [],
    });
  });

  it('rejects malformed roots and unsafe enum/date values', () => {
    expect(parseCachedVisitBriefCardPayload('{bad-json')).toBeNull();
    expect(normalizeCachedVisitBriefCard(['not', 'an', 'object'])).toBeNull();
    expect(normalizeCachedVisitBriefCard({ ...validCard, priority: 'high' })).toBeNull();
    expect(normalizeCachedVisitBriefCard({ ...validCard, generatedAt: 'not-a-date' })).toBeNull();
    expect(normalizeCachedVisitBriefCard({ ...validCard, isFallback: 'false' })).toBeNull();
  });

  it('rejects malformed string-array entries', () => {
    expect(
      normalizeCachedVisitBriefCard({
        ...validCard,
        mustCheckToday: ['血圧', 123, null],
        sourceRefs: ['前回訪問', false],
      }),
    ).toBeNull();
    expect(
      normalizeCachedVisitBriefCard({
        ...validCard,
        latestLabs: ['eGFR', 123],
      }),
    ).toBeNull();
  });
});
