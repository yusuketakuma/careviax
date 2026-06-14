import { describe, expect, it } from 'vitest';
import type {
  CareManagerReportContent,
  PhysicianReportContent,
} from '@/types/care-report-content';
import {
  audienceKeyFromRecipientRole,
  buildAudienceShareSections,
  buildNextCheckTaskInput,
  buildShareAudienceCards,
  defaultAudienceForReportType,
  pickLatestAudienceReplyRequest,
  SHARE_SECTION_EMPTY_BODY,
  type ShareCommunicationRequest,
} from './interprofessional-share.helpers';

const CARE_MANAGER_CONTENT = {
  title: 'ケアマネへの服薬状況報告',
  patient: { name: '加藤 ミサ', birth_date: '1941-02-14' },
  care_manager: { name: '中島 桜', organization: 'きたきゅうケアプラン' },
  report_date: '2026-06-10',
  visit_date: '2026-06-10',
  pharmacist_name: '山田 花子',
  medication_management_summary: {
    total_drugs: 6,
    compliance_summary: '朝・夕は服用できています。昼分の飲み忘れが週2回ほどあります。',
    self_management: '一部介助(ヘルパー声かけあり)',
    calendar_used: true,
  },
  functional_impact: {
    sleep_impact: '影響なし',
    cognition_impact: '変化なし',
    diet_impact: '食欲やや低下',
    mobility_impact: 'ふらつきなし',
    excretion_impact: '便秘気味',
  },
  residual_status: {
    summary: 'マグミット錠が約10日分残っています。',
    reduction_proposals: ['次回処方で7日分の調整を提案予定'],
  },
  care_service_coordination: {
    medication_assistance: '昼分はヘルパー訪問時の声かけをお願いしたいです。',
    unit_dose_packaging: true,
    calendar_recommendation: true,
    other_items: '服薬カレンダーは継続使用中です。',
  },
  next_visit_plan: {
    date: '2026-06-18',
    followup_items: ['昼分の服薬状況を確認', '残薬(マグミット錠)の数を確認'],
  },
  warnings: [],
} satisfies CareManagerReportContent & { title: string };

const PHYSICIAN_CONTENT = {
  patient: { name: '田中 一郎', birth_date: '1949-05-01', gender: 'male' },
  report_date: '2026-06-12',
  visit_date: '2026-06-12',
  pharmacist_name: '山田 太郎',
  prescriber: { name: '山本 先生', institution: '山本クリニック' },
  prescriptions: [],
  medication_management: {
    compliance_summary: '夕食後の薬は家族声かけで服用できています。',
    adherence_score: 4,
    self_management: '一部介助',
    calendar_used: true,
  },
  adverse_events: { has_events: false, events: [] },
  functional_assessment: {
    sleep: '良好',
    cognition: '変化なし',
    diet_oral: '普通',
    mobility: '伝い歩き',
    excretion: '便秘気味',
  },
  residual_medications: [
    { drug_name: 'アムロジピン錠5mg', remaining_qty: 6, excess_days: 3, reduction_proposal: true },
  ],
  assessment: '服薬は安定。便秘傾向への対応が必要。',
  plan: '酸化マグネシウムの用量調整を検討。',
  prescription_proposals: '',
  physician_communication: '便秘症状について次回診察での評価をお願いします。',
  warnings: [],
} satisfies PhysicianReportContent;

describe('buildShareAudienceCards', () => {
  it('5 区分を固定順で返し、ケアチームと連絡先から該当者名を埋める', () => {
    const cards = buildShareAudienceCards(
      [
        { role: 'physician', name: '山本 健', organization_name: 'やまもと内科', is_primary: true },
        {
          role: 'care_manager',
          name: '中島 桜',
          organization_name: 'きたきゅうケアプラン',
          is_primary: true,
        },
        { role: 'nurse', name: '三浦 恵', organization_name: null, is_primary: false },
      ],
      [{ relation: 'child', name: '加藤 直子', organization_name: null, is_primary: true }],
    );

    expect(cards.map((card) => card.label)).toEqual([
      '主治医',
      'ケアマネ',
      '訪問看護',
      '施設',
      '家族',
    ]);
    expect(cards[0].memberLabel).toBe('山本 健(やまもと内科)');
    expect(cards[1].memberLabel).toBe('中島 桜(きたきゅうケアプラン)');
    expect(cards[2].memberLabel).toBe('三浦 恵');
    expect(cards[3].memberLabel).toBeNull(); // 施設は未登録
    expect(cards[4].memberLabel).toBe('加藤 直子'); // 家族は連絡先(長女)から
  });

  it('is_primary のメンバーを優先する', () => {
    const cards = buildShareAudienceCards(
      [
        { role: 'care_manager', name: '補助 太郎', organization_name: null, is_primary: false },
        { role: 'care_manager', name: '主担当 花子', organization_name: null, is_primary: true },
      ],
      [],
    );
    expect(cards[1].memberLabel).toBe('主担当 花子');
  });
});

describe('buildAudienceShareSections', () => {
  it('ケアマネ向け content を 5 セクション(服薬状況/残薬/お願い/次回確認/添付)へ射影する', () => {
    const sections = buildAudienceShareSections(CARE_MANAGER_CONTENT, 'care_manager', {
      hasPdf: true,
    });

    expect(sections.map((section) => section.title)).toEqual([
      '服薬状況',
      '残薬',
      '薬剤師からのお願い',
      '次回確認すること',
      '添付資料',
    ]);
    expect(sections[0].body).toContain('昼分の飲み忘れ');
    expect(sections[0].body).toContain('自己管理: 一部介助(ヘルパー声かけあり)');
    expect(sections[0].body).toContain('服薬カレンダー使用中');
    expect(sections[1].body).toContain('マグミット錠が約10日分');
    expect(sections[1].body).toContain('7日分の調整を提案予定');
    expect(sections[2].body).toContain('ヘルパー訪問時の声かけ');
    expect(sections[3].body).toContain('昼分の服薬状況を確認');
    expect(sections[4].body).toContain('訪問報告書PDF');
    expect(sections.every((section) => !section.isEmpty)).toBe(true);
  });

  it('主治医向けは physician_communication を「薬剤師からのお願い」に採用する', () => {
    const sections = buildAudienceShareSections(PHYSICIAN_CONTENT, 'physician', { hasPdf: true });

    expect(sections[1].body).toContain('アムロジピン錠5mg 残6(超過3日)');
    expect(sections[2].body).toContain('次回診察での評価');
    expect(sections[3].body).toContain('酸化マグネシウム');
  });

  it('医師向け content をケアマネが見る場合は依頼文へフォールバックする', () => {
    const sections = buildAudienceShareSections(PHYSICIAN_CONTENT, 'care_manager', {
      hasPdf: false,
    });
    expect(sections[2].body).toContain('次回診察での評価');
    expect(sections[4].body).toBe('添付資料はまだありません。');
    expect(sections[4].isEmpty).toBe(true);
  });

  it('旧形式 content({title, body})は本文を服薬状況に出し、他は未記載扱いにする', () => {
    const sections = buildAudienceShareSections(
      { title: '報告', body: '実施したこと → 観察したこと → 提案 の順に記載。' },
      'care_manager',
      { hasPdf: true },
    );
    expect(sections[0].body).toContain('実施したこと');
    expect(sections[1].body).toBe(SHARE_SECTION_EMPTY_BODY);
    expect(sections[1].isEmpty).toBe(true);
    expect(sections[2].body).toBe(SHARE_SECTION_EMPTY_BODY);
  });

  it('content が null でも 5 セクションを返す', () => {
    const sections = buildAudienceShareSections(null, 'family', { hasPdf: false });
    expect(sections).toHaveLength(5);
    expect(sections[0].body).toBe(SHARE_SECTION_EMPTY_BODY);
  });
});

describe('defaultAudienceForReportType', () => {
  it('報告書タイプから初期選択の相手を決める', () => {
    expect(defaultAudienceForReportType('care_manager_report')).toBe('care_manager');
    expect(defaultAudienceForReportType('physician_report')).toBe('physician');
    expect(defaultAudienceForReportType('nurse_share')).toBe('visiting_nurse');
    expect(defaultAudienceForReportType('facility_handoff')).toBe('facility');
    expect(defaultAudienceForReportType('family_share')).toBe('family');
    expect(defaultAudienceForReportType('internal_record')).toBe('care_manager');
    expect(defaultAudienceForReportType(null)).toBe('care_manager');
  });
});

describe('audienceKeyFromRecipientRole', () => {
  it('recipient_role(英語/日本語)を相手 5 区分へ正規化する', () => {
    expect(audienceKeyFromRecipientRole('care_manager')).toBe('care_manager');
    expect(audienceKeyFromRecipientRole('ケアマネ')).toBe('care_manager');
    expect(audienceKeyFromRecipientRole('physician')).toBe('physician');
    expect(audienceKeyFromRecipientRole('nurse')).toBe('visiting_nurse');
    expect(audienceKeyFromRecipientRole('facility_staff')).toBe('facility');
    expect(audienceKeyFromRecipientRole('家族')).toBe('family');
    // 処方元医療機関(連絡依頼の自動補完)は主治医列に突合する。
    expect(audienceKeyFromRecipientRole('処方元医療機関')).toBe('physician');
    expect(audienceKeyFromRecipientRole(null)).toBeNull();
  });

  it('旧 suffixed タクソノミー(永続化済み)も正規区分へ後方互換マップする', () => {
    // visit-schedule-communication 等が過去に書き込んだ ReportType 由来の値。
    expect(audienceKeyFromRecipientRole('family_share')).toBe('family');
    expect(audienceKeyFromRecipientRole('facility_handoff')).toBe('facility');
    expect(audienceKeyFromRecipientRole('nurse_share')).toBe('visiting_nurse');
    expect(audienceKeyFromRecipientRole('care_manager_report')).toBe('care_manager');
    // mcs_collaboration / internal は返信非表示区分のため null のまま。
    expect(audienceKeyFromRecipientRole('mcs_collaboration')).toBeNull();
    expect(audienceKeyFromRecipientRole('internal')).toBeNull();
  });

  it('正規 writer(buildVisitScheduleCommunicationTargets)の recipientRole は全て突合可能', () => {
    // 回帰防止: writer が emit する正規値が返信フローで必ず非 null に正規化されること
    // (mcs を除く。mcs は返信非表示区分)。
    for (const role of ['family', 'facility', 'visiting_nurse', 'care_manager']) {
      expect(audienceKeyFromRecipientRole(role)).not.toBeNull();
    }
  });
});

describe('pickLatestAudienceReplyRequest', () => {
  const requests: ShareCommunicationRequest[] = [
    {
      id: 'req_physician',
      recipient_name: '山本 健',
      recipient_role: 'physician',
      status: 'responded',
      subject: '医師への照会',
      requested_at: '2026-06-09T06:00:00.000Z',
      responses: [
        { id: 'res_phys', responder_name: '山本 健', responded_at: '2026-06-10T01:00:00.000Z' },
      ],
    },
    {
      id: 'req_cm_old',
      recipient_name: '中島 桜',
      recipient_role: 'care_manager',
      status: 'responded',
      subject: '前回の共有',
      requested_at: '2026-06-01T06:00:00.000Z',
      responses: [
        { id: 'res_cm_old', responder_name: '中島 桜', responded_at: '2026-06-02T01:00:00.000Z' },
      ],
    },
    {
      id: 'req_cm_new',
      recipient_name: '中島 桜',
      recipient_role: 'care_manager',
      status: 'responded',
      subject: '今回の共有',
      requested_at: '2026-06-09T06:00:00.000Z',
      responses: [
        { id: 'res_cm_new', responder_name: '中島 桜', responded_at: '2026-06-12T01:00:00.000Z' },
      ],
    },
    {
      id: 'req_cm_no_reply',
      recipient_name: '中島 桜',
      recipient_role: 'care_manager',
      status: 'sent',
      subject: '返信待ちの共有',
      requested_at: '2026-06-12T06:00:00.000Z',
      responses: [],
    },
  ];

  it('選択中の相手宛てで返信つきの最新依頼を選ぶ', () => {
    expect(pickLatestAudienceReplyRequest(requests, 'care_manager')?.id).toBe('req_cm_new');
    expect(pickLatestAudienceReplyRequest(requests, 'physician')?.id).toBe('req_physician');
  });

  it('該当宛先の返信が無ければ null を返す', () => {
    expect(pickLatestAudienceReplyRequest(requests, 'family')).toBeNull();
    expect(pickLatestAudienceReplyRequest([], 'care_manager')).toBeNull();
  });
});

describe('buildNextCheckTaskInput', () => {
  it('返信から POST /api/tasks の入力(重複防止キーつき)を組み立てる', () => {
    const input = buildNextCheckTaskInput({
      audience: 'care_manager',
      patientId: 'patient_1',
      patientName: '加藤 ミサ',
      reportId: 'report_1',
      requestId: 'req_1',
      response: {
        id: 'res_1',
        responder_name: '中島 桜(ケアマネ)',
        content: 'ヘルパーへ声かけ依頼済み。次回確認をお願いします。',
      },
    });

    expect(input.task_type).toBe('share_reply_followup');
    expect(input.title).toBe('次回訪問で確認: ケアマネからの返信(加藤 ミサ 様)');
    expect(input.description).toContain('ヘルパーへ声かけ依頼済み');
    expect(input.description).toContain('出典: ケアマネ(中島 桜(ケアマネ))からの返信');
    expect(input.priority).toBe('normal');
    expect(input.related_entity_type).toBe('patient');
    expect(input.related_entity_id).toBe('patient_1');
    expect(input.dedupe_key).toBe('share-reply-task:res_1');
    expect(input.metadata).toMatchObject({
      source: 'interprofessional_share',
      report_id: 'report_1',
      communication_request_id: 'req_1',
      communication_response_id: 'res_1',
      audience: 'care_manager',
    });
  });

  it('患者名が無くても 200 文字以内のタイトルを返す', () => {
    const input = buildNextCheckTaskInput({
      audience: 'family',
      patientId: 'patient_2',
      patientName: null,
      reportId: 'report_2',
      requestId: 'req_2',
      response: { id: 'res_2', responder_name: '加藤 直子', content: 'あ'.repeat(5000) },
    });
    expect(input.title).toBe('次回訪問で確認: 家族からの返信(対象患者)');
    expect(input.title.length).toBeLessThanOrEqual(200);
    expect(input.description.length).toBeLessThanOrEqual(4000);
  });
});
