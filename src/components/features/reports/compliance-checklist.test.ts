import { describe, expect, it } from 'vitest';
import { deriveReportComplianceChecks } from './compliance-checklist';
import type { PhysicianReportContent } from '@/types/care-report-content';

describe('deriveReportComplianceChecks', () => {
  it('flags physician report billing gaps independently from generation warnings', () => {
    const content: PhysicianReportContent = {
      patient: { name: '山田太郎', birth_date: '1940-01-01', gender: 'male' },
      report_date: '2026-04-21',
      visit_date: '2026-04-20',
      pharmacist_name: '薬剤師',
      prescriber: { name: '佐藤医師', institution: '佐藤医院' },
      prescriptions: [],
      medication_management: {
        compliance_summary: '',
        adherence_score: 0,
        self_management: '',
        calendar_used: false,
      },
      adverse_events: { has_events: false, events: [] },
      functional_assessment: {
        sleep: '',
        cognition: '',
        diet_oral: '',
        mobility: '',
        excretion: '',
      },
      residual_medications: [],
      assessment: '',
      plan: '',
      physician_communication: '',
      warnings: [],
    };

    const checks = deriveReportComplianceChecks('physician_report', content);

    expect(checks.some((item) => item.key === 'prescriptions' && !item.passed)).toBe(true);
    expect(checks.some((item) => item.key === 'medication_status' && !item.passed)).toBe(true);
  });
});
