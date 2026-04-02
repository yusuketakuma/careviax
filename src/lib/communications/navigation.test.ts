import { describe, expect, it } from 'vitest';
import {
  buildCommunicationRequestsHref,
  resolveCommunicationEntityLink,
} from './navigation';

describe('communication navigation helpers', () => {
  it('builds filtered communication request URLs', () => {
    expect(
      buildCommunicationRequestsHref({
        relatedEntityType: 'care_report',
        relatedEntityId: 'report_1',
      })
    ).toBe('/communications/requests?related_entity_type=care_report&related_entity_id=report_1');

    expect(
      buildCommunicationRequestsHref({
        status: 'responded',
        patientId: 'patient_1',
      })
    ).toBe('/communications/requests?status=responded&patient_id=patient_1');
  });

  it('maps supported related entities to reachable UI destinations', () => {
    expect(
      resolveCommunicationEntityLink({
        entityType: 'care_report',
        entityId: 'report_1',
      })
    ).toEqual({
      href: '/reports/report_1',
      label: '報告書詳細',
    });

    expect(
      resolveCommunicationEntityLink({
        entityType: 'tracing_report',
        entityId: 'tracing_1',
      })
    ).toEqual({
      href: '/reports#tracing-reports',
      label: 'トレーシング一覧',
    });
  });

  it('returns null for unsupported or incomplete entities', () => {
    expect(
      resolveCommunicationEntityLink({
        entityType: 'unknown_entity',
        entityId: 'entity_1',
      })
    ).toBeNull();

    expect(
      resolveCommunicationEntityLink({
        entityType: 'patient',
        entityId: null,
      })
    ).toBeNull();
  });
});
