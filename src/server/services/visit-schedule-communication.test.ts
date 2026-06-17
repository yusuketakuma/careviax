import { describe, expect, it } from 'vitest';
import {
  buildVisitScheduleContactFollowupTask,
  buildVisitScheduleCommunicationTargets,
  buildVisitScheduleContactTaskKey,
  buildVisitScheduleReproposalNeededTask,
  buildVisitScheduleReproposalTaskKey,
  resolveVisitScheduleCommunicationChannel,
  toVisitScheduleCommunicationEventChannel,
} from './visit-schedule-communication';

describe('visit-schedule-communication', () => {
  it('builds the shared contact followup dedupe key', () => {
    expect(buildVisitScheduleContactTaskKey('proposal_1')).toBe(
      'visit-contact-followup:proposal_1',
    );
  });

  it('builds the shared reproposal-needed dedupe key', () => {
    expect(buildVisitScheduleReproposalTaskKey('proposal_1')).toBe(
      'visit-reproposal-needed:proposal_1',
    );
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
      }),
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

  it('builds the shared reproposal-needed task payload', () => {
    expect(
      buildVisitScheduleReproposalNeededTask({
        orgId: 'org_1',
        proposalId: 'proposal_1',
        caseId: 'case_1',
        patientId: 'patient_1',
        assignedTo: 'pharmacist_1',
        dueAt: new Date('2026-04-02T09:00:00.000Z'),
        description: '患者の変更希望に合わせて候補を再生成してください。',
      }),
    ).toEqual({
      orgId: 'org_1',
      taskType: 'visit_schedule_reproposal_needed',
      title: '変更希望に合わせた再提案が必要です',
      description: '患者の変更希望に合わせて候補を再生成してください。',
      priority: 'high',
      assignedTo: 'pharmacist_1',
      dueDate: new Date('2026-04-02T09:00:00.000Z'),
      slaDueAt: new Date('2026-04-02T09:00:00.000Z'),
      dedupeKey: 'visit-reproposal-needed:proposal_1',
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

    // recipient_role は正規タクソノミー(physician/care_manager/visiting_nurse/facility/family/mcs)。
    // 旧 suffixed 値(family_share 等)は廃止し、返信フローの正規化と突合できる値を書き込む。
    expect(targets).toEqual([
      {
        key: 'family',
        recipientRole: 'family',
        recipientName: '家族A',
        contact: 'family-primary@example.com',
      },
      {
        key: 'facility',
        recipientRole: 'facility',
        recipientName: '施設担当',
        contact: '090-0000-0002',
      },
      {
        key: 'nurse',
        recipientRole: 'visiting_nurse',
        recipientName: '看護師B',
        contact: 'nurse@example.com',
      },
      {
        key: 'care_manager',
        recipientRole: 'care_manager',
        recipientName: 'ケアマネC',
        contact: '090-0000-0004',
      },
      {
        key: 'mcs',
        recipientRole: 'mcs',
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
