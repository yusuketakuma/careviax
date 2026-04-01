import { describe, expect, it } from 'vitest';
import {
  buildVisitScheduleContactFollowupTask,
  buildVisitScheduleCommunicationTargets,
  buildVisitScheduleContactTaskKey,
  resolveVisitScheduleCommunicationChannel,
  toVisitScheduleCommunicationEventChannel,
} from './visit-schedule-communication';

describe('visit-schedule-communication', () => {
  it('builds the shared contact followup dedupe key', () => {
    expect(buildVisitScheduleContactTaskKey('proposal_1')).toBe('visit-contact-followup:proposal_1');
  });

  it('builds the shared visit contact followup task payload', () => {
    expect(
      buildVisitScheduleContactFollowupTask({
        orgId: 'org_1',
        proposalId: 'proposal_1',
        caseId: 'case_1',
        patientId: 'patient_1',
        assignedTo: 'pharmacist_1',
        dueAt: new Date('2026-04-02T09:00:00.000Z'),
        description: '折り返し対応が必要です。',
      })
    ).toEqual({
      orgId: 'org_1',
      taskType: 'visit_contact_followup',
      title: '患者への再架電が必要です',
      description: '折り返し対応が必要です。',
      priority: 'high',
      assignedTo: 'pharmacist_1',
      dueDate: new Date('2026-04-02T09:00:00.000Z'),
      slaDueAt: new Date('2026-04-02T09:00:00.000Z'),
      dedupeKey: 'visit-contact-followup:proposal_1',
      relatedEntityType: 'visit_schedule_proposal',
      relatedEntityId: 'proposal_1',
      metadata: {
        case_id: 'case_1',
        patient_id: 'patient_1',
      },
    });
  });

  it('maps intake preferred contact methods onto the effective channel', () => {
    expect(resolveVisitScheduleCommunicationChannel('phone', 'fax')).toBe('fax');
    expect(resolveVisitScheduleCommunicationChannel('email', 'mcs')).toBe('collaboration');
    expect(resolveVisitScheduleCommunicationChannel('phone', 'other')).toBe('phone');
    expect(resolveVisitScheduleCommunicationChannel('in_person', null)).toBe('in_person');
  });

  it('builds communication targets in priority order and adds mcs when linked', () => {
    const targets = buildVisitScheduleCommunicationTargets({
      channel: 'email',
      contacts: [
        {
          name: '家族A',
          relation: 'spouse',
          phone: '090-0000-0001',
          email: 'family-primary@example.com',
          fax: null,
          is_primary: true,
        },
        {
          name: '施設担当',
          relation: 'facility_staff',
          phone: '090-0000-0002',
          email: null,
          fax: '03-0000-0002',
          is_primary: false,
        },
      ],
      careTeamLinks: [
        {
          role: 'nurse',
          name: '看護師B',
          phone: '090-0000-0003',
          email: 'nurse@example.com',
          fax: null,
          is_primary: true,
        },
        {
          role: 'care_manager',
          name: 'ケアマネC',
          phone: '090-0000-0004',
          email: null,
          fax: null,
          is_primary: true,
        },
      ],
      schedulingPreference: {
        preferredContactMethod: 'email',
        visitBeforeContactRequired: false,
        mcsLinked: true,
        pharmacyDecisionDueDate: null,
      },
    });

    expect(targets).toEqual([
      {
        key: 'family',
        recipientRole: 'family_share',
        recipientName: '家族A',
        contact: 'family-primary@example.com',
      },
      {
        key: 'facility',
        recipientRole: 'facility_handoff',
        recipientName: '施設担当',
        contact: '090-0000-0002',
      },
      {
        key: 'nurse',
        recipientRole: 'nurse_share',
        recipientName: '看護師B',
        contact: 'nurse@example.com',
      },
      {
        key: 'care_manager',
        recipientRole: 'care_manager_report',
        recipientName: 'ケアマネC',
        contact: '090-0000-0004',
      },
      {
        key: 'mcs',
        recipientRole: 'mcs_collaboration',
        recipientName: 'MCS連携',
        contact: null,
      },
    ]);
  });

  it('maps collaboration events to the persisted event channel', () => {
    expect(toVisitScheduleCommunicationEventChannel('collaboration')).toBe('email');
    expect(toVisitScheduleCommunicationEventChannel('in_person')).toBe('in_person');
    expect(toVisitScheduleCommunicationEventChannel('fax')).toBe('fax');
  });
});
