import { describe, expect, it } from 'vitest';
import {
  buildPatientShareCommunicationRequestInput,
  buildPatientShareSections,
  type PatientShareSnapshot,
} from './patient-share.helpers';

const SNAPSHOT: PatientShareSnapshot = {
  medications: [
    { drug_name: 'アムロジピン錠5mg', dose: '1錠', frequency: '朝食後' },
    { drug_name: 'マグミット錠330mg', dose: '1錠', frequency: '夕食後' },
  ],
  visits: [{ scheduled_date: '2026-06-20T09:00:00.000Z', schedule_status: 'planned' }],
  careReports: [
    {
      report_type: 'care_manager_report',
      created_at: '2026-06-10T08:00:00.000Z',
      status: 'sent',
    },
  ],
  selfReports: [
    {
      subject: '残薬が余っている',
      category: '残薬',
      content: 'マグミットが余っています',
      created_at: '2026-06-12T01:00:00.000Z',
    },
  ],
  hasShareableReport: true,
};

describe('buildPatientShareSections', () => {
  it('患者共有スナップショットを 5 セクションへ射影する', () => {
    const sections = buildPatientShareSections(SNAPSHOT, 'care_manager');

    expect(sections.map((section) => section.title)).toEqual([
      '服薬状況',
      '残薬',
      '薬剤師からのお願い',
      '次回確認すること',
      '添付資料',
    ]);
    expect(sections[0].body).toContain('服薬中 2剤');
    expect(sections[1].body).toContain('残薬が余っている');
    expect(sections[2].body).toContain('服薬状況・残薬');
    expect(sections[3].body).toContain('次回訪問予定');
    expect(sections[4].body).toContain('訪問報告書PDF');
  });

  it('家族向けは薬剤師からのお願いをやさしい表現へ切り替える', () => {
    const sections = buildPatientShareSections(SNAPSHOT, 'family');

    expect(sections[2].body).toContain('お気軽に薬局までご連絡ください');
  });
});

describe('buildPatientShareCommunicationRequestInput', () => {
  it('患者文脈の共有プレビューから POST /api/communication-requests の入力を組み立てる', () => {
    const sections = buildPatientShareSections(SNAPSHOT, 'care_manager');

    const input = buildPatientShareCommunicationRequestInput({
      audience: 'care_manager',
      patientId: 'patient_1',
      patientName: '佐藤 花子',
      recipientName: '田中 ケアマネ',
      recipientOrganizationName: '北区ケアプラン',
      sections,
    });

    expect(input).toMatchObject({
      patient_id: 'patient_1',
      request_type: 'patient_share_reply_request',
      template_key: 'patient_share_reply_request',
      recipient_name: '田中 ケアマネ',
      recipient_role: 'care_manager',
      related_entity_type: 'patient',
      related_entity_id: 'patient_1',
      status: 'sent',
      subject: '返信依頼: ケアマネ向け患者共有(佐藤 花子 様)',
      context_snapshot: {
        source: 'patient_external_share',
        patient_id: 'patient_1',
        audience: 'care_manager',
        recipient_organization_name: '北区ケアプラン',
      },
    });
    expect(input.context_snapshot.section_keys).toEqual([
      'medication_status',
      'residual',
      'pharmacist_request',
      'next_check',
      'attachments',
    ]);
    expect(input.content).toContain('ケアマネ向けに共有する患者情報です');
    expect(input.content).toContain('【服薬状況】');
    expect(input.content.length).toBeLessThanOrEqual(4000);
  });

  it('患者名・組織名が無くても安全な最小入力を返す', () => {
    const input = buildPatientShareCommunicationRequestInput({
      audience: 'family',
      patientId: 'patient_2',
      patientName: null,
      recipientName: '佐藤 太郎',
      recipientOrganizationName: null,
      sections: buildPatientShareSections(
        {
          ...SNAPSHOT,
          medications: [{ drug_name: 'あ'.repeat(5000), dose: null, frequency: null }],
        },
        'family',
      ),
    });

    expect(input.recipient_role).toBe('family');
    expect(input.subject).toBe('返信依頼: 家族向け患者共有(対象患者)');
    expect(input.context_snapshot).not.toHaveProperty('recipient_organization_name');
    expect(input.content.length).toBeLessThanOrEqual(4000);
  });
});
