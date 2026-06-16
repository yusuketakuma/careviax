import { describe, expect, it } from 'vitest';
import {
  buildDocumentReceiptRows,
  buildFirstVisitDocumentPrintSummary,
  buildFirstVisitPrintCopyUrl,
  buildMedicationCalendarDocument,
  buildMedicationLabelCards,
  buildSetInstructionDocument,
  buildVisitReportDocument,
  deriveCalendarSlots,
  firstVisitPrintBlockReason,
  formatPrintDate,
  formatSlotLabel,
  parsePrintDocumentType,
  pickIntakeForCycle,
  pickPrintSetPlan,
  pickVisitReportForPrint,
  PRINT_DOCUMENT_TYPES,
  summarizeFirstVisitPrintReadiness,
  type CareReportForPrint,
  type FirstVisitDocumentForPrint,
  type FirstVisitPrintReadinessForPrint,
  type PrescriptionIntakeForPrint,
  type SetPlanForPrint,
} from './print-hub.shared';

// ─── フィクスチャ(seed-design-demo の形に揃える)──────────────────────────

function makePlan(overrides: Partial<SetPlanForPrint> = {}): SetPlanForPrint {
  return {
    id: 'plan_tanaka',
    cycle_id: 'cycle_tanaka',
    target_period_start: '2026-06-01T12:00:00+09:00',
    target_period_end: '2026-06-28T12:00:00+09:00',
    set_method: 'facility_calendar',
    packaging_summary_snapshot: null,
    notes: '残薬充当あり / 中止薬回収あり',
    created_at: '2026-05-30T10:00:00+09:00',
    packaging_method_ref: null,
    cycle: {
      id: 'cycle_tanaka',
      patient_id: 'patient_tanaka',
      case_: { patient: { id: 'patient_tanaka', name: '田中 一郎', name_kana: 'タナカ イチロウ' } },
    },
    audits: [],
    ...overrides,
  };
}

function makeIntake(
  overrides: Partial<PrescriptionIntakeForPrint> = {},
): PrescriptionIntakeForPrint {
  return {
    id: 'intake_tanaka',
    cycle_id: 'cycle_tanaka',
    prescribed_date: '2026-06-01T12:00:00+09:00',
    prescriber_name: '佐藤 太郎',
    prescriber_institution: 'サンプル在宅クリニック',
    lines: [
      {
        id: 'line_1',
        line_number: 1,
        drug_name: 'アムロジピン 5mg',
        dose: '1錠',
        frequency: '朝',
        days: 28,
        quantity: 28,
        unit: '錠',
        notes: null,
      },
      {
        id: 'line_2',
        line_number: 2,
        drug_name: 'オキシコドン 5mg',
        dose: '1錠(1日2回まで)',
        frequency: '疼痛時',
        days: 14,
        quantity: 14,
        unit: '錠',
        notes: '疼痛時頓用。1日2回まで',
      },
      {
        id: 'line_3',
        line_number: 3,
        drug_name: 'インスリン グラルギン',
        dose: '8単位',
        frequency: '夕',
        days: 28,
        quantity: 1,
        unit: '本',
        notes: null,
      },
    ],
    ...overrides,
  };
}

function makeReport(overrides: Partial<CareReportForPrint> = {}): CareReportForPrint {
  return {
    id: 'report_kato',
    patient_id: 'patient_kato',
    patient_name: '加藤 ミサ',
    report_type: 'care_manager_report',
    status: 'sent',
    content: {
      title: 'ケアマネへの服薬状況報告',
      report_date: '2026-06-10T12:00:00+09:00',
      medication_management_summary: {
        compliance_summary: '朝・夕は服用できています。',
        self_management: '一部介助',
        calendar_used: true,
      },
      residual_status: { summary: 'マグミット錠が約10日分残っています。' },
      care_service_coordination: { medication_assistance: '昼分の声かけをお願いします。' },
      next_visit_plan: { date: '2026-06-18T12:00:00+09:00', followup_items: ['残薬数を確認'] },
    },
    created_at: '2026-06-10T15:30:00+09:00',
    delivery_records: [
      {
        id: 'delivery_1',
        channel: 'fax',
        recipient_name: 'ケアマネ 中島 桜',
        status: 'response_waiting',
        sent_at: '2026-06-10T15:30:00+09:00',
      },
    ],
    ...overrides,
  };
}

// ─── 帳票種別 ────────────────────────────────────────────────────────────────

describe('parsePrintDocumentType', () => {
  it('6 種別すべてのキーをそのまま返す', () => {
    for (const type of PRINT_DOCUMENT_TYPES) {
      expect(parsePrintDocumentType(type.key)).toBe(type.key);
    }
  });

  it('未指定・不正値はセット指示書へ倒す', () => {
    expect(parsePrintDocumentType(null)).toBe('set_instruction');
    expect(parsePrintDocumentType(undefined)).toBe('set_instruction');
    expect(parsePrintDocumentType('unknown_doc')).toBe('set_instruction');
  });

  it('target の並び順(セット指示書 → 契約・同意控え)を保持する', () => {
    expect(PRINT_DOCUMENT_TYPES.map((type) => type.label)).toEqual([
      'セット指示書',
      '服薬カレンダー',
      '訪問報告書',
      '文書交付控え',
      '薬袋ラベル',
      '契約・同意控え',
    ]);
  });

  it('初回訪問文書の印刷控えURLを患者・文書ID付きで作る', () => {
    expect(
      buildFirstVisitPrintCopyUrl({ patientId: 'patient_1', documentId: 'doc_contract_1' }),
    ).toBe(
      '/reports/print?type=first_visit_documents&patient_id=patient_1&document_id=doc_contract_1&copy=1',
    );
  });
});

// ─── プラン選択 ──────────────────────────────────────────────────────────────

describe('pickPrintSetPlan', () => {
  it('対象期間が最も長いプラン(在宅28日分)を当日1日分の施設プランより優先する', () => {
    const facilityPlan = makePlan({
      id: 'plan_facility',
      target_period_start: '2026-06-13T12:00:00+09:00',
      target_period_end: '2026-06-13T12:00:00+09:00',
      created_at: '2026-06-13T08:00:00+09:00',
    });
    const tanakaPlan = makePlan();
    expect(pickPrintSetPlan([facilityPlan, tanakaPlan])?.id).toBe('plan_tanaka');
    expect(pickPrintSetPlan([tanakaPlan, facilityPlan])?.id).toBe('plan_tanaka');
  });

  it('期間が同じなら作成が新しい方を選ぶ', () => {
    const older = makePlan({ id: 'plan_old', created_at: '2026-05-01T10:00:00+09:00' });
    const newer = makePlan({ id: 'plan_new', created_at: '2026-06-01T10:00:00+09:00' });
    expect(pickPrintSetPlan([older, newer])?.id).toBe('plan_new');
  });

  it('空配列は null', () => {
    expect(pickPrintSetPlan([])).toBeNull();
  });
});

describe('pickIntakeForCycle', () => {
  it('プランのサイクルに一致する処方受付を選ぶ', () => {
    const other = makeIntake({ id: 'intake_other', cycle_id: 'cycle_other' });
    const target = makeIntake();
    expect(pickIntakeForCycle([other, target], 'cycle_tanaka')?.id).toBe('intake_tanaka');
  });

  it('一致がなければ先頭(最新)へフォールバックする', () => {
    const latest = makeIntake({ id: 'intake_latest', cycle_id: 'cycle_x' });
    expect(pickIntakeForCycle([latest], 'cycle_tanaka')?.id).toBe('intake_latest');
    expect(pickIntakeForCycle([], 'cycle_tanaka')).toBeNull();
  });
});

// ─── 用法 → スロット ─────────────────────────────────────────────────────────

describe('deriveCalendarSlots', () => {
  it('単一スロットの用法を判定する', () => {
    expect(deriveCalendarSlots('朝')).toEqual(['morning']);
    expect(deriveCalendarSlots('昼食後')).toEqual(['noon']);
    expect(deriveCalendarSlots('夕')).toEqual(['evening']);
    expect(deriveCalendarSlots('眠前')).toEqual(['bedtime']);
  });

  it('複合用法(毎食後・朝夕)を複数スロットへ展開する', () => {
    expect(deriveCalendarSlots('毎食後')).toEqual(['morning', 'noon', 'evening']);
    expect(deriveCalendarSlots('朝夕')).toEqual(['morning', 'evening']);
  });

  it('頓用系(疼痛時など)は prn として扱う', () => {
    expect(deriveCalendarSlots('疼痛時')).toEqual(['prn']);
    expect(deriveCalendarSlots('便秘時 頓用')).toEqual(['prn']);
  });

  it('判定不能・空は空配列(表示は「—」)', () => {
    expect(deriveCalendarSlots(null)).toEqual([]);
    expect(deriveCalendarSlots('')).toEqual([]);
    expect(formatSlotLabel([])).toBe('—');
    expect(formatSlotLabel(['morning', 'evening'])).toBe('朝・夕');
  });
});

// ─── セット指示書 ────────────────────────────────────────────────────────────

describe('buildSetInstructionDocument', () => {
  it('田中一郎の SetPlan + 処方明細を帳票行へ射影する', () => {
    const document = buildSetInstructionDocument(makePlan(), makeIntake());
    expect(document).not.toBeNull();
    expect(document?.patientName).toBe('田中 一郎');
    expect(document?.setMethodLabel).toBe('施設カレンダー');
    expect(document?.auditLabel).toBe('監査前');
    expect(document?.notes).toBe('残薬充当あり / 中止薬回収あり');
    expect(document?.rows).toHaveLength(3);
    expect(document?.rows[0]).toMatchObject({
      drugName: 'アムロジピン 5mg',
      usageLabel: '1錠 朝',
      slotLabel: '朝',
      quantityLabel: '28錠(28日分)',
    });
    expect(document?.rows[1].slotLabel).toBe('頓用');
  });

  it('監査結果と配薬方法スナップショットを反映する', () => {
    const document = buildSetInstructionDocument(
      makePlan({
        audits: [{ id: 'audit_1', result: 'approved', audited_at: '2026-06-12T10:00:00+09:00' }],
        packaging_summary_snapshot: {
          packaging_method_name: '一包化',
          special_instructions: ['粉砕不可'],
          tag_labels: ['麻薬'],
        },
      }),
      makeIntake(),
    );
    expect(document?.auditLabel).toBe('監査承認済み');
    expect(document?.packagingLabel).toBe('一包化');
    expect(document?.specialInstructions).toEqual(['粉砕不可']);
  });

  it('プランが無ければ null(プレビューは「データなし」)', () => {
    expect(buildSetInstructionDocument(null, makeIntake())).toBeNull();
  });
});

// ─── 初回訪問文書・契約控え ─────────────────────────────────────────────────

describe('buildFirstVisitDocumentPrintSummary', () => {
  it('初回訪問文書の交付状況・最新履歴・緊急連絡先を帳票データへ射影する', () => {
    const documents: FirstVisitDocumentForPrint[] = [
      {
        id: 'doc_1',
        case_id: 'case_1',
        document_url: '/api/visit-records/record_1/pdf',
        delivered_at: '2026-06-16T10:00:00+09:00',
        delivered_to: '長女 田中花子',
        created_at: '2026-06-15T10:00:00+09:00',
        updated_at: '2026-06-16T10:00:00+09:00',
        emergency_contacts: [
          {
            id: 'contact_1',
            name: '田中 花子',
            relation: '長女',
            organization_name: '田中家',
            department: null,
            phone: '090-0000-0000',
            email: null,
            fax: null,
            is_primary: true,
            is_emergency_contact: true,
          },
        ],
        history: [
          {
            id: 'audit_old',
            action: 'generated',
            document_type: 'contract',
            template_name: '居宅療養管理指導契約書',
            template_version: 'v1.0',
            storage_location: 'store',
            reason: null,
            note: null,
            actor_id: 'user_1',
            created_at: '2026-06-15T10:00:00+09:00',
          },
          {
            id: 'audit_printed',
            action: 'printed',
            document_type: 'contract',
            template_name: '居宅療養管理指導契約書',
            template_version: 'v1.1',
            print_batch_id: 'print_20260616T013000Z_batch1',
            storage_location: 'headquarters',
            reason: null,
            note: '印刷ハブから印刷',
            actor_id: 'user_1',
            created_at: '2026-06-16T10:30:00+09:00',
          },
          {
            id: 'audit_new',
            action: 'recovered',
            document_type: 'contract',
            template_name: '居宅療養管理指導契約書',
            template_version: 'v1.1',
            storage_location: 'headquarters',
            reason: null,
            note: null,
            actor_id: 'user_1',
            created_at: '2026-06-16T11:00:00+09:00',
          },
        ],
      },
    ];

    const summary = buildFirstVisitDocumentPrintSummary('田中 一郎', documents);

    expect(summary.patientName).toBe('田中 一郎');
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]).toMatchObject({
      deliveredToLabel: '長女 田中花子',
      documentUrlLabel: '控えあり',
      latestActionLabel: '回収',
      latestPrintedAtLabel: '2026/6/16',
      latestStorageLabel: '本部',
      latestTemplateLabel: '居宅療養管理指導契約書 v1.1',
    });
    expect(summary.contacts).toEqual([
      {
        contactId: 'contact_1',
        name: '田中 花子',
        relationLabel: '長女',
        organizationLabel: '田中家',
        contactLabel: '090-0000-0000',
        priorityLabel: '主連絡先',
      },
    ]);
  });
});

describe('summarizeFirstVisitPrintReadiness', () => {
  function makeReadiness(
    overrides: Partial<FirstVisitPrintReadinessForPrint> = {},
  ): FirstVisitPrintReadinessForPrint {
    return {
      overall_status: 'ready',
      missing_required_count: 0,
      warning_count: 0,
      template_versions: [
        {
          document_type: 'contract',
          label: '契約書',
          template_name: '居宅療養管理指導契約書',
          template_version: 'v1.0',
          effective_from: '2026-06-01T00:00:00+09:00',
          effective_to: null,
        },
      ],
      checks: [
        {
          key: 'patient_profile',
          label: '患者基本情報',
          completed: true,
          severity: 'required',
          description: '氏名・生年月日を確認します。',
          action_href: '/patients/patient_1#patient-master',
          action_label: '基本情報へ',
        },
      ],
      ...overrides,
    };
  }

  it('必須項目不足は印刷ブロックとして要約する', () => {
    const summary = summarizeFirstVisitPrintReadiness(
      makeReadiness({
        overall_status: 'blocked',
        missing_required_count: 1,
        checks: [
          {
            key: 'care_insurance',
            label: '介護保険情報',
            completed: false,
            severity: 'required',
            description: '介護保険番号を確認します。',
            action_href: '/patients/patient_1#care-insurance',
            action_label: '保険情報へ',
          },
        ],
      }),
    );

    expect(summary.blocked).toBe(true);
    expect(summary.label).toBe('不足あり');
    expect(summary.message).toContain('介護保険情報');
    expect(summary.missingRequiredLabels).toEqual(['介護保険情報']);
  });

  it('warning は印刷可能だが確認ありとして要約する', () => {
    const summary = summarizeFirstVisitPrintReadiness(
      makeReadiness({
        overall_status: 'warning',
        warning_count: 1,
        checks: [
          {
            key: 'contact_channel',
            label: '連絡先',
            completed: false,
            severity: 'warning',
            description: '電話番号を確認します。',
            action_href: '/patients/patient_1#contacts',
            action_label: '連絡先へ',
          },
        ],
      }),
    );

    expect(summary.blocked).toBe(false);
    expect(summary.label).toBe('確認あり');
    expect(summary.warningLabels).toEqual(['連絡先']);
  });

  it('readiness 未取得は fail-closed で印刷ブロックする', () => {
    const summary = summarizeFirstVisitPrintReadiness(null);
    expect(summary.blocked).toBe(true);
    expect(summary.label).toBe('印刷前チェック未取得');
  });

  it('初回訪問文書が0件なら印刷対象なしとしてブロックする', () => {
    const summary = summarizeFirstVisitPrintReadiness(makeReadiness());

    expect(firstVisitPrintBlockReason({ readiness: summary, documentCount: 0 })).toBe(
      '印刷対象の契約・同意文書がありません。患者詳細で文書を作成してから印刷してください。',
    );
    expect(firstVisitPrintBlockReason({ readiness: summary, documentCount: 1 })).toBeNull();
  });

  it('readiness の必須不足は文書件数より優先してブロック理由にする', () => {
    const summary = summarizeFirstVisitPrintReadiness(
      makeReadiness({
        overall_status: 'blocked',
        missing_required_count: 1,
        checks: [
          {
            key: 'care_insurance',
            label: '介護保険情報',
            completed: false,
            severity: 'required',
            description: '介護保険番号を確認します。',
            action_href: '/patients/patient_1#care-insurance',
            action_label: '保険情報へ',
          },
        ],
      }),
    );

    expect(firstVisitPrintBlockReason({ readiness: summary, documentCount: 0 })).toContain(
      '介護保険情報',
    );
  });
});

// ─── 服薬カレンダー ──────────────────────────────────────────────────────────

describe('buildMedicationCalendarDocument', () => {
  it('定時薬はマトリクス行、頓用薬は頓用欄へ振り分ける', () => {
    const document = buildMedicationCalendarDocument(makePlan(), makeIntake());
    expect(document).not.toBeNull();
    expect(document?.rows.map((row) => row.drugName)).toEqual([
      'アムロジピン 5mg',
      'インスリン グラルギン',
    ]);
    expect(document?.rows[0].marks).toEqual({
      morning: true,
      noon: false,
      evening: false,
      bedtime: false,
    });
    expect(document?.rows[1].marks.evening).toBe(true);
    expect(document?.prnRows).toEqual([{ drugName: 'オキシコドン 5mg', conditionLabel: '疼痛時' }]);
  });

  it('明細が無い場合は null', () => {
    expect(buildMedicationCalendarDocument(makePlan(), null)).toBeNull();
    expect(buildMedicationCalendarDocument(makePlan(), makeIntake({ lines: [] }))).toBeNull();
  });
});

// ─── 訪問報告書 ──────────────────────────────────────────────────────────────

describe('pickVisitReportForPrint / buildVisitReportDocument', () => {
  it('下書きより確定済み(sent)の報告書を優先する', () => {
    const draft = makeReport({
      id: 'report_draft',
      status: 'draft',
      created_at: '2026-06-12T10:00:00+09:00',
      content: { title: '下書き', body: '記載中' },
      delivery_records: [],
    });
    const sent = makeReport();
    expect(pickVisitReportForPrint([draft, sent])?.id).toBe('report_kato');
    expect(pickVisitReportForPrint([])).toBeNull();
  });

  it('構造化 content から要約行を組み立てる', () => {
    const document = buildVisitReportDocument(makeReport());
    expect(document).not.toBeNull();
    expect(document?.patientName).toBe('加藤 ミサ');
    expect(document?.reportTypeLabel).toBe('ケアマネ向け報告書');
    expect(document?.statusLabel).toBe('送付済');
    expect(document?.items.map((item) => item.label)).toEqual([
      '服薬状況',
      '自己管理',
      '残薬状況',
      '連携のお願い',
      '次回確認',
    ]);
    expect(document?.items[4].value).toContain('残薬数を確認');
  });

  it('構造化フィールドが無い content は本文へフォールバックする', () => {
    const document = buildVisitReportDocument(
      makeReport({ content: { title: 'メモ', body: '自由記載の本文' }, delivery_records: [] }),
    );
    expect(document?.items).toEqual([{ label: '本文', value: '自由記載の本文' }]);
  });

  it('report が null なら null', () => {
    expect(buildVisitReportDocument(null)).toBeNull();
  });
});

// ─── 文書交付控え ────────────────────────────────────────────────────────────

describe('buildDocumentReceiptRows', () => {
  it('送達記録を交付控え行へ平坦化し、交付日時の新しい順に並べる', () => {
    const older = makeReport({
      id: 'report_old',
      patient_name: '伊藤 文',
      content: { title: '旧報告' },
      delivery_records: [
        {
          id: 'delivery_old',
          channel: 'email',
          recipient_name: '山本医院',
          status: 'confirmed',
          sent_at: '2026-06-01T09:00:00+09:00',
        },
      ],
    });
    const rows = buildDocumentReceiptRows([older, makeReport()]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      deliveryId: 'delivery_1',
      documentLabel: 'ケアマネへの服薬状況報告',
      patientName: '加藤 ミサ',
      recipientName: 'ケアマネ 中島 桜',
      channelLabel: 'FAX',
      statusLabel: '返信待ち',
    });
    expect(rows[1].channelLabel).toBe('メール');
  });

  it('送達記録が無ければ空配列(プレビューは「データなし」)', () => {
    expect(buildDocumentReceiptRows([makeReport({ delivery_records: [] })])).toEqual([]);
  });
});

// ─── 薬袋ラベル ──────────────────────────────────────────────────────────────

describe('buildMedicationLabelCards', () => {
  it('処方明細 1 行につき 1 ラベルを生成する', () => {
    const cards = buildMedicationLabelCards(makePlan(), makeIntake());
    expect(cards).toHaveLength(3);
    expect(cards[0]).toMatchObject({
      patientName: '田中 一郎',
      drugName: 'アムロジピン 5mg',
      usageLabel: '1錠 朝',
      quantityLabel: '28錠(28日分)',
    });
    expect(cards[1].note).toBe('疼痛時頓用。1日2回まで');
  });

  it('プラン・処方が無ければ空配列', () => {
    expect(buildMedicationLabelCards(null, makeIntake())).toEqual([]);
    expect(buildMedicationLabelCards(makePlan(), null)).toEqual([]);
  });
});

// ─── 日付整形 ────────────────────────────────────────────────────────────────

describe('formatPrintDate', () => {
  it('ISO 文字列を ja-JP 表記へ整形し、不正値は「—」', () => {
    expect(formatPrintDate('2026-06-10T12:00:00+09:00')).toBe('2026/6/10');
    expect(formatPrintDate(null)).toBe('—');
    expect(formatPrintDate('not-a-date')).toBe('—');
  });
});
