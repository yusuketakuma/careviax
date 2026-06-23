import { beforeEach, describe, expect, it, vi } from 'vitest';

// Wrap the shared helpers as actual-backed spies so we can both (a) assert
// resolveCommunicationEntityLink DELEGATES to them (regression teeth against a
// reintroduced local builder) and (b) keep real-helper integration behavior for
// the encoding / dot-guard tests below. clearAllMocks (not reset) keeps the impl.
vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});
vi.mock('@/lib/reports/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/reports/navigation')>();
  return { ...actual, buildReportHref: vi.fn(actual.buildReportHref) };
});
vi.mock('@/lib/visits/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/visits/navigation')>();
  return { ...actual, buildVisitHref: vi.fn(actual.buildVisitHref) };
});

import { buildPatientHref } from '@/lib/patient/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
import { buildVisitHref } from '@/lib/visits/navigation';
import { buildCommunicationRequestsHref, resolveCommunicationEntityLink } from './navigation';

describe('communication navigation helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds filtered communication request URLs', () => {
    expect(
      buildCommunicationRequestsHref({
        relatedEntityType: 'care_report',
        relatedEntityId: 'report_1',
      }),
    ).toBe('/communications/requests?related_entity_type=care_report&related_entity_id=report_1');

    expect(
      buildCommunicationRequestsHref({
        status: 'responded',
        patientId: 'patient_1',
      }),
    ).toBe('/communications/requests?status=responded&patient_id=patient_1');
  });

  it('maps supported related entities to reachable UI destinations', () => {
    expect(
      resolveCommunicationEntityLink({
        entityType: 'care_report',
        entityId: 'report_1',
      }),
    ).toEqual({
      href: '/reports/report_1',
      label: '報告書詳細',
    });

    expect(
      resolveCommunicationEntityLink({
        entityType: 'tracing_report',
        entityId: 'tracing_1',
      }),
    ).toEqual({
      href: '/reports#tracing-reports',
      label: 'トレーシング一覧',
    });
  });

  it.each([
    ['patient', '/patients', '患者詳細'],
    ['care_report', '/reports', '報告書詳細'],
    ['visit_record', '/visits', '訪問詳細'],
  ])('encodes %s entity ids as a single path segment', (entityType, basePath, label) => {
    const hostileEntityId = '../settings?x=1#frag';

    expect(
      resolveCommunicationEntityLink({
        entityType,
        entityId: hostileEntityId,
      }),
    ).toEqual({
      href: `${basePath}/${encodeURIComponent(hostileEntityId)}`,
      label,
    });
  });

  it.each([
    ['tracing_report', '/reports#tracing-reports', 'トレーシング一覧'],
    ['visit_schedule', '/schedules', 'スケジュール'],
    ['conference_note', '/conferences', 'カンファレンス'],
    ['patient_self_report', '/external', '外部共有'],
  ])('keeps %s static destinations independent of entity ids', (entityType, href, label) => {
    expect(
      resolveCommunicationEntityLink({
        entityType,
        entityId: '../settings?x=1#frag',
      }),
    ).toEqual({
      href,
      label,
    });
  });

  it('returns null for unsupported or incomplete entities', () => {
    expect(
      resolveCommunicationEntityLink({
        entityType: 'unknown_entity',
        entityId: 'entity_1',
      }),
    ).toBeNull();

    expect(
      resolveCommunicationEntityLink({
        entityType: null,
        entityId: 'entity_1',
      }),
    ).toBeNull();

    expect(
      resolveCommunicationEntityLink({
        entityType: 'patient',
        entityId: null,
      }),
    ).toBeNull();
  });

  it.each([
    ['patient', '/patients', '患者詳細'],
    ['care_report', '/reports', '報告書詳細'],
    ['visit_record', '/visits', '訪問詳細'],
  ])('converges %s dynamic links onto the shared guarded helper', (entityType, basePath, label) => {
    expect(
      resolveCommunicationEntityLink({
        entityType,
        entityId: 'entity_1',
      }),
    ).toEqual({
      href: `${basePath}/entity_1`,
      label,
    });
  });

  it.each([
    ['patient', '.'],
    ['patient', '..'],
    ['care_report', '.'],
    ['care_report', '..'],
    ['visit_record', '.'],
    ['visit_record', '..'],
  ])(
    'returns null for %s when the entity id is the dot segment "%s" (shared guard caught at the query boundary)',
    (entityType, dotEntityId) => {
      expect(
        resolveCommunicationEntityLink({
          entityType,
          entityId: dotEntityId,
        }),
      ).toBeNull();
    },
  );

  it('keeps a static destination for a present, normal entity id', () => {
    expect(
      resolveCommunicationEntityLink({
        entityType: 'visit_schedule',
        entityId: 'schedule_1',
      }),
    ).toEqual({
      href: '/schedules',
      label: 'スケジュール',
    });
  });

  it('delegates dynamic hrefs to the shared guarded helpers (not a local builder)', () => {
    expect(
      resolveCommunicationEntityLink({ entityType: 'patient', entityId: 'patient_42' }),
    ).toEqual({ href: '/patients/patient_42', label: '患者詳細' });
    expect(vi.mocked(buildPatientHref)).toHaveBeenCalledWith('patient_42');

    expect(
      resolveCommunicationEntityLink({ entityType: 'care_report', entityId: 'report_42' }),
    ).toEqual({ href: '/reports/report_42', label: '報告書詳細' });
    expect(vi.mocked(buildReportHref)).toHaveBeenCalledWith('report_42');

    expect(
      resolveCommunicationEntityLink({ entityType: 'visit_record', entityId: 'visit_42' }),
    ).toEqual({ href: '/visits/visit_42', label: '訪問詳細' });
    expect(vi.mocked(buildVisitHref)).toHaveBeenCalledWith('visit_42');
  });

  it.each([
    ['tracing_report', '/reports#tracing-reports', 'トレーシング一覧'],
    ['visit_schedule', '/schedules', 'スケジュール'],
    ['conference_note', '/conferences', 'カンファレンス'],
    ['patient_self_report', '/external', '外部共有'],
  ])(
    'keeps %s static destination even when entityId is a dot segment (no over-broad pre-switch guard)',
    (entityType, href, label) => {
      for (const dotEntityId of ['.', '..']) {
        expect(resolveCommunicationEntityLink({ entityType, entityId: dotEntityId })).toEqual({
          href,
          label,
        });
      }
    },
  );
});
