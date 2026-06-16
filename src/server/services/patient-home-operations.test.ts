import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPatientHomeOperationsData } from './patient-home-operations';

afterEach(() => {
  vi.useRealTimers();
});

function createDb(overrides: Record<string, unknown> = {}) {
  const db = {
    patient: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'patient_1',
        billing_support_flag: true,
        cases: [{ id: 'case_1', status: 'active' }],
      }),
    },
    visitRecord: {
      findMany: vi.fn().mockResolvedValue([{ id: 'visit_1' }]),
    },
    medicationCycle: {
      findMany: vi.fn().mockResolvedValue([{ id: 'cycle_1' }]),
    },
    firstVisitDocument: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'doc_contract',
          document_url: 's3://doc.pdf',
          delivered_at: null,
          delivered_to: null,
          created_at: new Date('2026-06-01T00:00:00.000Z'),
          updated_at: new Date('2026-06-02T00:00:00.000Z'),
        },
      ]),
    },
    auditLog: {
      findMany: vi.fn().mockResolvedValue([
        {
          target_id: 'doc_contract',
          action: 'first_visit_document.printed',
          changes: {
            document_action: {
              action: 'printed',
              document_type: 'contract',
              template_name: '居宅療養管理指導契約書 2026年版',
              template_version: 'v1',
              print_batch_id: 'print_20260603T000000Z_batch1',
              storage_location: 'store',
            },
          },
          created_at: new Date('2026-06-03T00:00:00.000Z'),
        },
        {
          target_id: 'doc_contract',
          action: 'first_visit_document.generated',
          changes: {
            document_action: {
              action: 'generated',
              document_type: 'contract',
              template_name: '居宅療養管理指導契約書 2026年版',
              template_version: 'v1',
              storage_location: 'store',
            },
          },
          created_at: new Date('2026-06-02T00:00:00.000Z'),
        },
      ]),
    },
    template: {
      findMany: vi.fn().mockResolvedValue([
        {
          template_type: 'contract_document',
          name: '居宅療養管理指導契約書 2026年版',
          version: 1,
          effective_from: new Date('2026-04-01T00:00:00.000Z'),
          effective_to: null,
        },
        {
          template_type: 'important_matters',
          name: '重要事項説明書 2026年版',
          version: 2,
          effective_from: new Date('2026-04-01T00:00:00.000Z'),
          effective_to: null,
        },
        {
          template_type: 'privacy_consent',
          name: '個人情報使用同意書 2026年版',
          version: 1,
          effective_from: new Date('2026-04-01T00:00:00.000Z'),
          effective_to: null,
        },
        {
          template_type: 'consent_form',
          name: '在宅サービス同意書 2026年版',
          version: 1,
          effective_from: new Date('2026-04-01T00:00:00.000Z'),
          effective_to: null,
        },
      ]),
    },
    patientMcsLink: {
      findFirst: vi.fn().mockResolvedValue({
        source_url: 'https://www.medical-care.net/patients/2463520',
        mcs_patient_url: 'https://www.medical-care.net/patients/2463520',
        mcs_project_url: 'https://www.medical-care.net/projects/medical/57886227',
        project_title: '田中一郎 在宅チーム',
        last_synced_at: new Date('2026-06-03T00:00:00.000Z'),
        last_sync_attempt_at: new Date('2026-06-03T00:00:00.000Z'),
        last_sync_status: 'success',
        last_sync_error: null,
        updated_at: new Date('2026-06-03T00:00:00.000Z'),
      }),
    },
    prescriptionIntake: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'intake_1',
        cycle_id: 'cycle_1',
        source_type: 'fax',
        prescribed_date: new Date('2026-06-09T00:00:00.000Z'),
        prescription_expiry_date: new Date('2099-06-12T00:00:00.000Z'),
        original_collected_at: null,
        original_collected_by: null,
        original_document_url: null,
        prescriber_name: '山本医師',
        prescriber_institution: 'やまもと内科',
        created_at: new Date('2026-06-09T00:00:00.000Z'),
        updated_at: new Date('2026-06-09T00:00:00.000Z'),
        cycle: { overall_status: 'dispensing' },
      }),
    },
    inquiryRecord: {
      count: vi.fn().mockResolvedValue(0),
    },
    billingCandidate: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'candidate_1',
          billing_month: new Date('2026-06-01T00:00:00.000Z'),
          billing_name: '居宅療養管理指導',
          points: 518,
          status: 'candidate',
          exclusion_reason: null,
          calculation_breakdown: {
            collection: {
              status: 'partial',
              billed_amount: 3240,
              collected_amount: 2160,
              unpaid_amount: 1080,
              payer_name: '長女',
              scheduled_collection_at: '2026-06-25T00:00:00.000Z',
              receipt_number: 'R20260616-001',
              receipt_issue_status: 'issued',
              invoice_issue_status: 'not_issued',
              save_receipt_copy: true,
              save_invoice_copy: false,
              receipt_copy_url: '/api/billing-candidates/candidate_1/documents/pdf?kind=receipt',
              invoice_copy_url: null,
            },
          },
          updated_at: new Date('2026-06-10T00:00:00.000Z'),
        },
      ]),
    },
    conferenceNote: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([
        {
          note_type: 'pre_discharge',
          title: '退院前カンファ',
          conference_date: new Date('2026-06-01T00:00:00.000Z'),
          follow_up_date: new Date('2026-06-05T00:00:00.000Z'),
          follow_up_completed: false,
          generated_report_id: null,
          metadata: {
            conference_operation: {
              location: 'MCS 山田太郎さん在宅チーム',
              agenda: '退院後の服薬支援と訪問頻度を調整する',
              pharmacy_participants: ['鈴木薬剤師', '田中事務'],
              participant_count: 4,
            },
            sync_summary: {
              report_draft_ids: ['report_1'],
              billing_candidate_id: 'candidate_1',
              visit_proposal_id: 'proposal_1',
              tasks_created: 2,
              medication_issues_created: 1,
            },
          },
          action_items: [
            {
              title: '報告書作成',
              assignee: '薬剤師',
              converted_task_id: 'task_1',
            },
            {
              title: '次回訪問日をケアマネへ連絡',
              assignee: '薬剤師',
            },
          ],
          updated_at: new Date('2026-06-01T00:00:00.000Z'),
        },
      ]),
    },
    careReport: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    task: {
      count: vi.fn().mockResolvedValue(1),
      findFirst: vi
        .fn()
        .mockResolvedValueOnce({
          metadata: {
            linked_status: 'linked',
            participation_status: 'joined',
            pharmacy_participants: ['佐藤薬剤師'],
            main_counterpart_roles: ['医師', '訪看'],
            last_checked_at: '2099-06-15T00:00:00.000Z',
            note: '家族も参加',
          },
        })
        .mockResolvedValueOnce({
          metadata: {
            payer_type: 'family',
            payer_name: '長女',
            payer_relation: '長女',
            billing_address_mode: 'same_as_patient',
            payment_method: 'bank_transfer',
            collection_timing: 'month_end',
            receipt_issue: 'paper',
            invoice_issue: 'yes',
            unpaid_tolerance: 'one_month',
            note: '月末に長女へ請求',
          },
        })
        .mockResolvedValueOnce({
          metadata: {
            reconciliation_result: 'matched',
            storage_location: 'store',
            e_prescription_acquired_status: 'not_applicable',
            dispensing_result_registration: 'registered',
          },
        }),
    },
  };
  return {
    ...db,
    ...overrides,
    conferenceNote: {
      ...db.conferenceNote,
      ...((overrides.conferenceNote as Record<string, unknown> | undefined) ?? {}),
    },
  };
}

describe('getPatientHomeOperationsData', () => {
  it('summarizes the five home-care operation domains from existing patient records', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T00:00:00.000Z'));
    const db = createDb({
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'report_1',
            delivery_records: [
              {
                recipient_name: '田中ケアマネ',
                status: 'draft',
              },
              {
                recipient_name: '山本医師',
                status: 'sent',
              },
            ],
          },
        ]),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.map((item) => item.key)).toEqual([
      'documents',
      'mcs',
      'prescription',
      'billing',
      'conference',
    ]);
    expect(result?.attention_count).toBe(4);
    expect(result?.top_alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'documents',
          label: '契約・同意・書類',
          message: '契約書の回収が未記録です',
          href: '/patients/patient_1#patient-documents',
          action_label: '文書状態へ',
        }),
        expect.objectContaining({
          key: 'prescription',
          label: '処方せん',
          message: 'FAX受信から7日経過しても原本到着が未記録です',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
        }),
        expect.objectContaining({
          key: 'billing',
          label: '請求・集金',
          message: '未処理の算定候補が1件あります',
          href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
          action_label: '請求候補を確認',
        }),
        expect.objectContaining({
          key: 'conference',
          label: 'カンファレンス',
          message: '会議後フォローアップ期限を過ぎています',
          href: '/conferences?patient_id=patient_1&case_id=case_1&focus=notes&context=patient_detail',
          action_label: '会議要点へ',
        }),
      ]),
    );
    expect(result?.top_alerts[0]?.key).toBe('documents');
    expect(result?.items.find((item) => item.key === 'documents')).toMatchObject({
      status: '0/4件整備',
      alerts: expect.arrayContaining([
        '契約書の回収が未記録です',
        '重要事項説明書が未作成です',
        '個人情報同意書が未作成です',
        '同意書が未作成です',
      ]),
      metrics: expect.arrayContaining([
        { label: 'PDF/画像', value: '1/4件保存' },
        { label: '回収/画像', value: '0/4件完了' },
        { label: '最終印刷', value: '2026/06/03 / print_20260603T000000Z_batch1' },
        {
          label: '最新テンプレート',
          value: '重要事項説明書 2026年版 v2 / 2026/04/01適用 他3件',
        },
        { label: '契約書', value: '印刷済み / 居宅療養管理指導契約書 2026年版 v1' },
        { label: '重要事項説明書', value: '未作成 / 重要事項説明書 2026年版 v2' },
        { label: '個人情報同意書', value: '未作成 / 個人情報使用同意書 2026年版 v1' },
        { label: '同意書', value: '未作成 / 在宅サービス同意書 2026年版 v1' },
      ]),
    });
    expect(result?.items.find((item) => item.key === 'mcs')).toMatchObject({
      status: '連携あり',
      tone: 'ok',
      action_label: 'MCS連携を管理',
      external_href: 'https://www.medical-care.net/projects/medical/57886227',
      external_action_label: 'MCSを開く',
      metrics: expect.arrayContaining([
        { label: '最終確認', value: '2099/06/15' },
        { label: '参加状況', value: '参加済' },
        { label: '薬局側参加者', value: '佐藤薬剤師' },
        { label: '主な連携先', value: '医師 / 訪看' },
      ]),
      quick_actions: [
        {
          key: 'record_mcs_check_log',
          label: 'MCS確認ログを記録',
          resource_id: 'patient_1',
        },
      ],
    });
    expect(result?.items.find((item) => item.key === 'prescription')).toMatchObject({
      status: '原本未着',
      alerts: expect.arrayContaining([
        'FAX受信から7日経過しても原本到着が未記録です',
        '処方せん画像/PDFが未保存です',
      ]),
      metrics: expect.arrayContaining([
        { label: '期限', value: '2099/06/12 / 残り26659日' },
        { label: '原本到着日', value: '未設定' },
        { label: '原本受領者', value: '未記録' },
        { label: 'FAX経過', value: '7日未着' },
        { label: '照合', value: '一致' },
        { label: '保管', value: '店舗保管' },
        { label: '結果登録', value: '登録済み' },
      ]),
      quick_actions: [
        {
          key: 'mark_fax_original_collected',
          label: '原本到着を記録',
          resource_id: 'intake_1',
        },
        {
          key: 'save_prescription_document',
          label: '画像/PDFを保存',
          resource_id: 'intake_1',
        },
        {
          key: 'record_prescription_original_management',
          label: '原本管理を更新',
          resource_id: 'intake_1',
        },
      ],
    });
    expect(result?.items.find((item) => item.key === 'billing')).toMatchObject({
      status: '確認待ち',
      href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
      action_label: '請求候補を確認',
      metrics: expect.arrayContaining([
        { label: '支払設定', value: '家族' },
        { label: '支払方法', value: '振込' },
        { label: '集金タイミング', value: '月末' },
        { label: '今月請求額', value: '3,240円' },
        { label: '未収額', value: '1,080円' },
        { label: '次回集金予定', value: '2026/06/25' },
        { label: '支払者', value: '長女' },
        { label: '領収証', value: 'R20260616-001' },
        { label: '領収証状態', value: '発行済み' },
        { label: '請求書状態', value: '未発行' },
        { label: '領収証控え', value: '保存済み' },
        { label: '請求書控え', value: '未保存' },
        { label: '請求書控えコード', value: 'no' },
        {
          label: '領収証控えURL',
          value: '/api/billing-candidates/candidate_1/documents/pdf?kind=receipt',
        },
        { label: '領収証発行', value: '紙' },
        { label: '請求書発行', value: 'あり' },
        { label: '未収許容', value: '1か月' },
      ]),
      alerts: expect.arrayContaining([
        '未処理の算定候補が1件あります',
        '未収額 1,080円 があります',
      ]),
      quick_actions: [
        {
          key: 'record_billing_payment_profile',
          label: '支払設定を更新',
          resource_id: 'patient_1',
        },
        {
          key: 'record_billing_collection',
          label: '集金記録を更新',
          resource_id: 'candidate_1',
        },
      ],
    });
    expect(result?.items.find((item) => item.key === 'conference')).toMatchObject({
      status: '後処理あり',
      href: '/conferences?patient_id=patient_1&case_id=case_1&focus=notes&context=patient_detail',
      alerts: expect.arrayContaining([
        '会議後フォローアップが未完了です',
        '会議関連タスクが1件残っています',
      ]),
      metrics: expect.arrayContaining([
        { label: '報告書', value: 'ドラフト1件' },
        { label: '送付先', value: '2件 / 待ち1件' },
        { label: '送付済み', value: '1/2件' },
        { label: '送付失敗', value: 'なし' },
        { label: '送付先名', value: '田中ケアマネ / 山本医師' },
        { label: '予定連動', value: '訪問提案あり' },
        { label: '議題', value: '退院後の服薬支援と訪問頻度を調整する' },
        { label: '場所', value: 'MCS 山田太郎さん在宅チーム' },
        { label: '参加者', value: '4名' },
        { label: '自動生成', value: '2件' },
        { label: '薬剤課題', value: '1件' },
        { label: '薬局タスク', value: '2/2件変換' },
      ]),
      quick_actions: [
        {
          key: 'open_visit_proposal',
          label: '予定候補を確認',
          resource_id: 'proposal_1',
        },
        {
          key: 'record_conference_note',
          label: '会議要点を追記',
          resource_id: 'case_1',
        },
      ],
    });
    expect(result?.items.find((item) => item.key === 'conference')?.alerts).not.toContain(
      '会議後の報告書が未作成です',
    );
    expect(db.billingCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ cycle_id: { in: ['cycle_1'] } }]),
        }),
      }),
    );
    expect(vi.mocked(db.billingCandidate.findMany).mock.calls[0]?.[0]).not.toHaveProperty('take');
    expect(vi.mocked(db.conferenceNote.findMany).mock.calls[0]?.[0]).toHaveProperty('take', 16);
    expect(db.careReport.findMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        id: { in: ['report_1'] },
      },
      select: {
        id: true,
        delivery_records: {
          select: {
            recipient_name: true,
            status: true,
          },
        },
      },
    });
  });

  it('raises conference report delivery alerts when generated drafts still need sending or failed', async () => {
    const db = createDb({
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'report_1',
            delivery_records: [
              { recipient_name: '田中ケアマネ', status: 'draft' },
              { recipient_name: '山本医師', status: 'failed' },
              { recipient_name: '佐藤訪看', status: 'confirmed' },
            ],
          },
        ]),
      },
      task: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            metadata: {
              linked_status: 'linked',
              participation_status: 'joined',
              last_checked_at: '2099-06-15T00:00:00.000Z',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              payer_type: 'family',
              payment_method: 'bank_transfer',
            },
          })
          .mockResolvedValueOnce(null),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'conference')).toMatchObject({
      alerts: expect.arrayContaining([
        '会議報告書の送付ドラフトが1件残っています',
        '会議報告書の送付失敗が1件あります',
      ]),
      metrics: expect.arrayContaining([
        { label: '送付先', value: '3件 / 待ち1件' },
        { label: '送付済み', value: '1/3件' },
        { label: '送付失敗', value: '1件' },
        { label: '送付先名', value: '田中ケアマネ / 山本医師 / 佐藤訪看' },
      ]),
    });
  });

  it('returns null without loading operational rows when the patient is not visible', async () => {
    const firstVisitDocumentFindMany = vi.fn();
    const db = createDb({
      patient: { findFirst: vi.fn().mockResolvedValue(null) },
      firstVisitDocument: { findMany: firstVisitDocumentFindMany },
    });

    await expect(
      getPatientHomeOperationsData(db as never, {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      }),
    ).resolves.toBeNull();
    expect(firstVisitDocumentFindMany).not.toHaveBeenCalled();
  });

  it('raises a document alert when first-visit default templates are missing', async () => {
    const db = createDb({
      template: {
        findMany: vi.fn().mockResolvedValue([
          {
            template_type: 'consent_form',
            name: '在宅サービス同意書 2026年版',
            version: 1,
            effective_from: new Date('2026-04-01T00:00:00.000Z'),
            effective_to: null,
          },
        ]),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'documents')).toMatchObject({
      metrics: expect.arrayContaining([
        { label: '最終印刷', value: '2026/06/03 / print_20260603T000000Z_batch1' },
        { label: '契約書', value: '印刷済み / 居宅療養管理指導契約書 2026年版 v1' },
        { label: '重要事項説明書', value: '未作成 / 既定テンプレート未設定' },
        { label: '同意書', value: '未作成 / 在宅サービス同意書 2026年版 v1' },
      ]),
      alerts: expect.arrayContaining([
        '既定テンプレート未設定: 契約書 / 重要事項説明書 / 個人情報同意書',
      ]),
    });
  });

  it('raises an MCS alert when the last checked date is older than seven days', async () => {
    const db = createDb({
      task: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            metadata: {
              linked_status: 'linked',
              participation_status: 'joined',
              last_checked_at: '2020-06-01T00:00:00.000Z',
              pharmacy_participants: ['佐藤薬剤師'],
              main_counterpart_roles: ['医師'],
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              payer_type: 'family',
              payment_method: 'bank_transfer',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              reconciliation_result: 'matched',
              storage_location: 'store',
              e_prescription_acquired_status: 'not_applicable',
              dispensing_result_registration: 'registered',
            },
          }),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'mcs')).toMatchObject({
      tone: 'attention',
      alerts: expect.arrayContaining(['MCS最終確認日から7日以上経過しています']),
      metrics: expect.arrayContaining([{ label: '最終確認', value: '2020/06/01' }]),
    });
  });

  it('reads MCS counterpart roles from the saved profile metadata key', async () => {
    const db = createDb({
      task: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            metadata: {
              linked_status: 'linked',
              participation_status: 'joined',
              last_checked_at: '2099-06-15T00:00:00.000Z',
              pharmacy_participants: ['佐藤薬剤師'],
              counterpart_roles: ['care_manager', 'family'],
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              payer_type: 'family',
              payment_method: 'bank_transfer',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              reconciliation_result: 'matched',
              storage_location: 'store',
              e_prescription_acquired_status: 'not_applicable',
              dispensing_result_registration: 'registered',
            },
          }),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'mcs')).toMatchObject({
      metrics: expect.arrayContaining([{ label: '主な連携先', value: 'CM / 家族' }]),
    });
  });

  it('raises an MCS alert when the profile is explicitly marked unlinked', async () => {
    const db = createDb({
      task: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            metadata: {
              linked_status: 'unlinked',
              participation_status: 'not_joined',
              last_checked_at: '2099-06-15T00:00:00.000Z',
              pharmacy_participants: [],
              main_counterpart_roles: [],
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              payer_type: 'family',
              payment_method: 'bank_transfer',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              reconciliation_result: 'matched',
              storage_location: 'store',
              e_prescription_acquired_status: 'not_applicable',
              dispensing_result_registration: 'registered',
            },
          }),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'mcs')).toMatchObject({
      status: '連携なし',
      tone: 'attention',
      alerts: expect.arrayContaining(['MCS連携なしとして記録されています']),
      metrics: expect.arrayContaining([
        { label: '連携状態', value: '連携なし' },
        { label: '参加状況', value: '未参加' },
      ]),
    });
  });

  it('does not return an external MCS action when the saved URL is invalid', async () => {
    const db = createDb({
      patientMcsLink: {
        findFirst: vi.fn().mockResolvedValue({
          source_url: 'https://www.evilmedical-care.net/patients/2463520',
          mcs_patient_url: null,
          mcs_project_url: 'http://www.medical-care.net/projects/medical/57886227',
          project_title: '田中一郎 在宅チーム',
          last_synced_at: new Date('2026-06-03T00:00:00.000Z'),
          last_sync_attempt_at: new Date('2026-06-03T00:00:00.000Z'),
          last_sync_status: 'success',
          last_sync_error: null,
          updated_at: new Date('2026-06-03T00:00:00.000Z'),
        }),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'mcs')).toMatchObject({
      href: '/patients/patient_1/mcs',
      action_label: 'MCS連携を管理',
      external_href: null,
      external_action_label: null,
    });
  });

  it('raises a prescription alert when an undispensed prescription expires within 24 hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T00:00:00.000Z'));
    const db = createDb({
      prescriptionIntake: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'intake_expiring',
          cycle_id: 'cycle_expiring',
          source_type: 'paper',
          prescribed_date: new Date('2026-06-16T00:00:00.000Z'),
          prescription_expiry_date: new Date('2026-06-16T12:00:00.000Z'),
          original_collected_at: new Date('2026-06-16T00:00:00.000Z'),
          original_document_url: 's3://prescription.pdf',
          prescriber_name: '山本医師',
          prescriber_institution: 'やまもと内科',
          created_at: new Date('2026-06-16T00:00:00.000Z'),
          updated_at: new Date('2026-06-16T00:00:00.000Z'),
          cycle: { overall_status: 'dispensing' },
        }),
      },
      task: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            metadata: {
              linked_status: 'linked',
              participation_status: 'joined',
              last_checked_at: '2099-06-15T00:00:00.000Z',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              payer_type: 'family',
              payment_method: 'bank_transfer',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              reconciliation_result: 'matched',
              reconciliation_checked_at: '2026-06-15T09:30:00.000Z',
              reconciliation_checked_by: 'user_1',
              storage_location: 'store',
              e_prescription_acquired_status: 'not_applicable',
              dispensing_result_registration: 'pending',
            },
          }),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'prescription')).toMatchObject({
      status: '期限間近',
      tone: 'attention',
      alerts: expect.arrayContaining(['処方せん有効期限が24時間以内です']),
      metrics: expect.arrayContaining([{ label: '期限', value: '2026/06/16 / 残り12時間' }]),
      quick_actions: [
        {
          key: 'record_prescription_original_management',
          label: '原本管理を更新',
          resource_id: 'intake_expiring',
        },
      ],
    });
  });

  it('raises a prescription alert when an inquiry remains unresolved', async () => {
    const db = createDb({
      prescriptionIntake: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'intake_inquiry',
          cycle_id: 'cycle_inquiry',
          source_type: 'fax',
          prescribed_date: new Date('2026-06-15T00:00:00.000Z'),
          prescription_expiry_date: new Date('2099-06-18T00:00:00.000Z'),
          original_collected_at: new Date('2026-06-15T00:00:00.000Z'),
          original_document_url: 's3://prescription.pdf',
          prescriber_name: '山本医師',
          prescriber_institution: 'やまもと内科',
          created_at: new Date('2026-06-15T00:00:00.000Z'),
          updated_at: new Date('2026-06-15T00:00:00.000Z'),
          cycle: { overall_status: 'inquiry_pending' },
        }),
      },
      inquiryRecord: {
        count: vi.fn().mockResolvedValue(6),
      },
      task: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            metadata: {
              linked_status: 'linked',
              participation_status: 'joined',
              last_checked_at: '2099-06-15T00:00:00.000Z',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              payer_type: 'family',
              payment_method: 'bank_transfer',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              reconciliation_result: 'matched',
              reconciliation_checked_at: '2026-06-15T09:30:00.000Z',
              reconciliation_checked_by: 'user_1',
              storage_location: 'store',
              e_prescription_acquired_status: 'not_applicable',
              dispensing_result_registration: 'pending',
            },
          }),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'prescription')).toMatchObject({
      status: '疑義照会中',
      tone: 'attention',
      alerts: ['疑義照会が未完了です (6件)'],
      metrics: expect.arrayContaining([
        { label: '原本照合日', value: '2026/06/15' },
        { label: '照合', value: '一致 / 2026/06/15' },
        { label: '疑義照会', value: '6件未完了' },
        { label: '工程', value: 'inquiry_pending' },
      ]),
    });
    expect(db.inquiryRecord.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cycle: {
            patient_id: 'patient_1',
            case_id: { in: ['case_1'] },
          },
          OR: [{ result: null }, { result: 'pending' }],
        }),
      }),
    );
  });

  it('keeps expiry as the primary prescription status while still surfacing unresolved inquiries', async () => {
    const db = createDb({
      prescriptionIntake: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'intake_expired_inquiry',
          cycle_id: 'cycle_expired_inquiry',
          source_type: 'fax',
          prescribed_date: new Date('2026-06-01T00:00:00.000Z'),
          prescription_expiry_date: new Date('2026-06-04T00:00:00.000Z'),
          original_collected_at: null,
          original_document_url: 's3://prescription.pdf',
          prescriber_name: '山本医師',
          prescriber_institution: 'やまもと内科',
          created_at: new Date('2026-06-01T00:00:00.000Z'),
          updated_at: new Date('2026-06-01T00:00:00.000Z'),
          cycle: { overall_status: 'inquiry_pending' },
        }),
      },
      inquiryRecord: {
        count: vi.fn().mockResolvedValue(1),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'prescription')).toMatchObject({
      status: '期限切れ',
      alerts: expect.arrayContaining([
        'FAX受信から15日経過しても原本到着が未記録です',
        '疑義照会が未完了です (1件)',
        '処方せん有効期限を過ぎています',
      ]),
      metrics: expect.arrayContaining([{ label: '疑義照会', value: '1件未完了' }]),
    });
  });

  it('does not expose raw prescription discrepancy notes in summary alerts', async () => {
    const db = createDb({
      task: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            metadata: {
              linked_status: 'linked',
              participation_status: 'joined',
              last_checked_at: '2099-06-15T00:00:00.000Z',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              payer_type: 'family',
              payment_method: 'bank_transfer',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              reconciliation_result: 'discrepancy',
              discrepancy_note: '田中一郎様のオキシコドン用量がFAXと原本で不一致',
              storage_location: 'store',
              e_prescription_acquired_status: 'not_applicable',
              dispensing_result_registration: 'registered',
            },
          }),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    const prescriptionItem = result?.items.find((item) => item.key === 'prescription');
    expect(prescriptionItem).toMatchObject({
      alerts: expect.arrayContaining(['FAX・原本差異があります']),
    });
    expect(JSON.stringify(prescriptionItem?.alerts)).not.toContain('田中一郎');
    expect(JSON.stringify(result?.top_alerts)).not.toContain('オキシコドン');
  });

  it('raises a billing alert when receipt issue is required but receipt number is missing after collection', async () => {
    const db = createDb({
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'candidate_collected',
            billing_month: new Date('2026-06-01T00:00:00.000Z'),
            billing_name: '居宅療養管理指導',
            points: 518,
            status: 'exported',
            exclusion_reason: null,
            calculation_breakdown: {
              collection: {
                status: 'collected',
                billed_amount: 3240,
                collected_amount: 3240,
                unpaid_amount: 0,
                payer_name: '長女',
                collected_at: '2026-06-16T00:00:00.000Z',
                receipt_number: null,
              },
            },
            updated_at: new Date('2026-06-16T00:00:00.000Z'),
          },
        ]),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'billing')).toMatchObject({
      status: '支援対象',
      tone: 'attention',
      alerts: ['領収証番号が未記録の入金記録が1件あります'],
      metrics: expect.arrayContaining([
        { label: '領収証', value: '未発行/未記録' },
        { label: '領収証発行', value: '紙' },
        { label: '未収額', value: '0円' },
      ]),
      quick_actions: [
        {
          key: 'record_billing_payment_profile',
          label: '支払設定を更新',
          resource_id: 'patient_1',
        },
        {
          key: 'record_billing_collection',
          label: '集金記録を更新',
          resource_id: 'candidate_collected',
        },
      ],
    });
  });

  it('raises a billing receipt alert from older or partial collections and routes the action to the missing receipt record', async () => {
    const db = createDb({
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'candidate_latest',
            billing_month: new Date('2026-07-01T00:00:00.000Z'),
            billing_name: '居宅療養管理指導',
            points: 518,
            status: 'exported',
            exclusion_reason: null,
            calculation_breakdown: {
              collection: {
                status: 'collected',
                billed_amount: 3240,
                collected_amount: 3240,
                unpaid_amount: 0,
                payer_name: '長女',
                collected_at: '2026-07-16T00:00:00.000Z',
                receipt_number: 'R20260716-001',
              },
            },
            updated_at: new Date('2026-07-16T00:00:00.000Z'),
          },
          {
            id: 'candidate_previous',
            billing_month: new Date('2026-06-01T00:00:00.000Z'),
            billing_name: '居宅療養管理指導',
            points: 518,
            status: 'exported',
            exclusion_reason: null,
            calculation_breakdown: {
              collection: {
                status: 'partial',
                billed_amount: 3240,
                collected_amount: 1000,
                unpaid_amount: 2240,
                payer_name: '長女',
                collected_at: '2026-06-16T00:00:00.000Z',
                receipt_number: null,
              },
            },
            updated_at: new Date('2026-06-16T00:00:00.000Z'),
          },
        ]),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'billing')).toMatchObject({
      status: '支援対象',
      href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
      tone: 'attention',
      alerts: ['領収証番号が未記録の入金記録が1件あります', '未収額 2,240円 があります'],
      metrics: expect.arrayContaining([
        { label: '領収証', value: 'R20260716-001' },
        { label: '未収額', value: '2,240円' },
      ]),
      quick_actions: expect.arrayContaining([
        {
          key: 'record_billing_collection',
          label: '集金記録を更新',
          resource_id: 'candidate_previous',
        },
      ]),
    });
  });

  it('does not raise a missing receipt number alert when receipt issue is not required', async () => {
    const db = createDb({
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'candidate_no_receipt',
            billing_month: new Date('2026-06-01T00:00:00.000Z'),
            billing_name: '居宅療養管理指導',
            points: 518,
            status: 'exported',
            exclusion_reason: null,
            calculation_breakdown: {
              collection: {
                status: 'collected',
                billed_amount: 3240,
                collected_amount: 3240,
                unpaid_amount: 0,
                payer_name: '長女',
                collected_at: '2026-06-16T00:00:00.000Z',
                receipt_number: null,
              },
            },
            updated_at: new Date('2026-06-16T00:00:00.000Z'),
          },
        ]),
      },
      task: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            metadata: {
              linked_status: 'linked',
              participation_status: 'joined',
              last_checked_at: '2099-06-15T00:00:00.000Z',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              payer_type: 'family',
              payer_name: '長女',
              payment_method: 'bank_transfer',
              receipt_issue: 'none',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              reconciliation_result: 'matched',
              storage_location: 'store',
              e_prescription_acquired_status: 'not_applicable',
              dispensing_result_registration: 'registered',
            },
          }),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'billing')).toMatchObject({
      status: '支援対象',
      tone: 'ok',
      alerts: [],
      metrics: expect.arrayContaining([
        { label: '領収証', value: '未発行/未記録' },
        { label: '領収証発行', value: '不要' },
      ]),
    });
  });

  it('does not count excluded billing candidates as unpaid collection work', async () => {
    const db = createDb({
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'candidate_excluded',
            billing_month: new Date('2026-06-01T00:00:00.000Z'),
            billing_name: '居宅療養管理指導',
            points: 518,
            status: 'excluded',
            exclusion_reason: '公費対象外確認済み',
            calculation_breakdown: {
              collection: {
                status: 'unpaid',
                billed_amount: 3240,
                collected_amount: 0,
                unpaid_amount: 3240,
                payer_name: '長女',
                receipt_number: null,
              },
            },
            updated_at: new Date('2026-06-16T00:00:00.000Z'),
          },
        ]),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'billing')).toMatchObject({
      status: '支援対象',
      tone: 'attention',
      alerts: ['除外・ブロック中の算定候補が1件あります'],
      metrics: expect.arrayContaining([{ label: '未収額', value: '0円' }]),
    });
  });

  it('raises a conference alert when pharmacy action items have not been task-synced', async () => {
    const db = createDb({
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          {
            note_type: 'service_manager',
            title: 'サービス担当者会議',
            conference_date: new Date('2026-06-01T00:00:00.000Z'),
            follow_up_date: null,
            follow_up_completed: false,
            generated_report_id: 'report_1',
            metadata: {
              sync_summary: {
                tasks_created: 0,
                medication_issues_created: 0,
              },
            },
            action_items: [{ title: '次回訪問日をケアマネへ連絡', assignee: '薬剤師' }],
            updated_at: new Date('2026-06-01T00:00:00.000Z'),
          },
        ]),
      },
      task: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            metadata: {
              linked_status: 'linked',
              participation_status: 'joined',
              last_checked_at: '2099-06-15T00:00:00.000Z',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              payer_type: 'family',
              payment_method: 'bank_transfer',
            },
          })
          .mockResolvedValueOnce(null),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'conference')).toMatchObject({
      alerts: ['薬局タスク1件が運用タスクへ未変換です'],
      metrics: expect.arrayContaining([{ label: '薬局タスク', value: '0/1件変換' }]),
    });
  });

  it('shows a future conference as scheduled instead of missing its post-meeting report', async () => {
    const db = createDb({
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          {
            note_type: 'pre_discharge',
            title: '退院前カンファ',
            conference_date: new Date('2099-06-20T00:00:00.000Z'),
            follow_up_date: null,
            follow_up_completed: false,
            generated_report_id: null,
            metadata: {
              sync_summary: {
                tasks_created: 1,
                medication_issues_created: 0,
                visit_proposal_id: 'proposal_1',
              },
            },
            action_items: [
              { title: '契約書持参', assignee: '薬剤師', converted_task_id: 'task_1' },
            ],
            updated_at: new Date('2099-06-01T00:00:00.000Z'),
          },
        ]),
      },
      task: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            metadata: {
              linked_status: 'linked',
              participation_status: 'joined',
              last_checked_at: '2099-06-15T00:00:00.000Z',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              payer_type: 'family',
              payment_method: 'bank_transfer',
            },
          })
          .mockResolvedValueOnce(null),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'conference')).toMatchObject({
      status: '予定あり',
      tone: 'attention',
      alerts: ['会議予定: 2099/06/20 退院前カンファ'],
      metrics: expect.arrayContaining([
        { label: '報告書', value: '予定前' },
        { label: '予定連動', value: '訪問提案あり' },
      ]),
    });
  });

  it('does not raise a missing-report alert for a conference scheduled later today', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T00:00:00.000Z'));

    const db = createDb({
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          {
            note_type: 'service_manager',
            title: 'サービス担当者会議',
            conference_date: new Date('2026-06-16T06:00:00.000Z'),
            follow_up_date: null,
            follow_up_completed: false,
            generated_report_id: null,
            metadata: {
              sync_summary: {
                tasks_created: 1,
                medication_issues_created: 0,
              },
            },
            action_items: [{ title: '資料確認', assignee: '薬剤師', converted_task_id: 'task_1' }],
            updated_at: new Date('2026-06-16T00:00:00.000Z'),
          },
        ]),
      },
      task: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            metadata: {
              linked_status: 'linked',
              participation_status: 'joined',
              last_checked_at: '2099-06-15T00:00:00.000Z',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              payer_type: 'family',
              payment_method: 'bank_transfer',
            },
          })
          .mockResolvedValueOnce(null),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'conference')).toMatchObject({
      status: '予定あり',
      alerts: ['会議予定: 2026/06/16 サービス担当者会議'],
      metrics: expect.arrayContaining([{ label: '報告書', value: '予定前' }]),
    });
  });

  it('keeps unresolved past conference work visible when a future conference is also scheduled', async () => {
    const db = createDb({
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          {
            note_type: 'pre_discharge',
            title: '次回退院前カンファ',
            conference_date: new Date('2099-06-20T00:00:00.000Z'),
            follow_up_date: null,
            follow_up_completed: false,
            generated_report_id: null,
            metadata: {
              sync_summary: {
                tasks_created: 1,
                medication_issues_created: 0,
              },
            },
            action_items: [{ title: '資料確認', assignee: '薬剤師', converted_task_id: 'task_1' }],
            updated_at: new Date('2099-06-01T00:00:00.000Z'),
          },
          {
            note_type: 'service_manager',
            title: '前回サービス担当者会議',
            conference_date: new Date('2026-06-01T00:00:00.000Z'),
            follow_up_date: null,
            follow_up_completed: false,
            generated_report_id: null,
            metadata: {
              sync_summary: {
                tasks_created: 1,
                medication_issues_created: 0,
              },
            },
            action_items: [
              { title: '報告書共有', assignee: '薬剤師', converted_task_id: 'task_1' },
            ],
            updated_at: new Date('2026-06-01T00:00:00.000Z'),
          },
        ]),
      },
      task: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            metadata: {
              linked_status: 'linked',
              participation_status: 'joined',
              last_checked_at: '2099-06-15T00:00:00.000Z',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              payer_type: 'family',
              payment_method: 'bank_transfer',
            },
          })
          .mockResolvedValueOnce(null),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'conference')).toMatchObject({
      status: '後処理あり',
      alerts: ['会議予定: 2099/06/20 次回退院前カンファ', '会議後の報告書が未作成です'],
      metrics: expect.arrayContaining([{ label: '報告書', value: '未作成' }]),
    });
  });

  it('raises a stronger conference alert when follow-up is overdue', async () => {
    const db = createDb({
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          {
            note_type: 'service_manager',
            title: 'サービス担当者会議',
            conference_date: new Date('2026-06-01T00:00:00.000Z'),
            follow_up_date: new Date('2026-06-05T00:00:00.000Z'),
            follow_up_completed: false,
            generated_report_id: 'report_1',
            metadata: {
              sync_summary: {
                tasks_created: 1,
                medication_issues_created: 0,
              },
            },
            action_items: [
              { title: '報告書共有', assignee: '薬剤師', converted_task_id: 'task_1' },
            ],
            updated_at: new Date('2026-06-01T00:00:00.000Z'),
          },
        ]),
      },
      task: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            metadata: {
              linked_status: 'linked',
              participation_status: 'joined',
              last_checked_at: '2099-06-15T00:00:00.000Z',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              payer_type: 'family',
              payment_method: 'bank_transfer',
            },
          })
          .mockResolvedValueOnce(null),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'conference')).toMatchObject({
      status: '後処理あり',
      tone: 'attention',
      alerts: ['会議後フォローアップ期限を過ぎています', '会議後フォローアップが未完了です'],
      metrics: expect.arrayContaining([{ label: 'フォロー', value: '期限超過' }]),
    });
  });

  it('uses the Tokyo business date when checking overdue conference follow-up', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T15:30:00.000Z'));

    const db = createDb({
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          {
            note_type: 'service_manager',
            title: 'サービス担当者会議',
            conference_date: new Date('2026-06-16T00:00:00.000Z'),
            follow_up_date: new Date('2026-06-16T00:00:00.000Z'),
            follow_up_completed: false,
            generated_report_id: 'report_1',
            metadata: {
              sync_summary: {
                tasks_created: 1,
                medication_issues_created: 0,
              },
            },
            action_items: [
              { title: '報告書共有', assignee: '薬剤師', converted_task_id: 'task_1' },
            ],
            updated_at: new Date('2026-06-16T00:00:00.000Z'),
          },
        ]),
      },
      task: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            metadata: {
              linked_status: 'linked',
              participation_status: 'joined',
              last_checked_at: '2099-06-15T00:00:00.000Z',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              payer_type: 'family',
              payment_method: 'bank_transfer',
            },
          })
          .mockResolvedValueOnce(null),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'conference')).toMatchObject({
      alerts: ['会議後フォローアップ期限を過ぎています', '会議後フォローアップが未完了です'],
      metrics: expect.arrayContaining([{ label: 'フォロー', value: '期限超過' }]),
    });
  });

  it('keeps future conference follow-up as open but not overdue', async () => {
    const db = createDb({
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          {
            note_type: 'service_manager',
            title: 'サービス担当者会議',
            conference_date: new Date('2099-06-01T00:00:00.000Z'),
            follow_up_date: new Date('2099-06-05T00:00:00.000Z'),
            follow_up_completed: false,
            generated_report_id: 'report_1',
            metadata: {
              sync_summary: {
                tasks_created: 1,
                medication_issues_created: 0,
              },
            },
            action_items: [
              { title: '報告書共有', assignee: '薬剤師', converted_task_id: 'task_1' },
            ],
            updated_at: new Date('2099-06-01T00:00:00.000Z'),
          },
        ]),
      },
      task: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            metadata: {
              linked_status: 'linked',
              participation_status: 'joined',
              last_checked_at: '2099-06-15T00:00:00.000Z',
            },
          })
          .mockResolvedValueOnce({
            metadata: {
              payer_type: 'family',
              payment_method: 'bank_transfer',
            },
          })
          .mockResolvedValueOnce(null),
      },
    });

    const result = await getPatientHomeOperationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(result?.items.find((item) => item.key === 'conference')).toMatchObject({
      status: '予定あり',
      tone: 'attention',
      alerts: ['会議予定: 2099/06/01 サービス担当者会議', '会議後フォローアップが未完了です'],
      metrics: expect.arrayContaining([{ label: 'フォロー', value: '未完了' }]),
    });
  });
});
