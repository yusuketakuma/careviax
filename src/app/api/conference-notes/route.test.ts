import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  withOrgContextMock,
  conferenceNoteFindManyMock,
  conferenceNoteCreateMock,
  careCaseFindManyMock,
  // sync-related mocks
  taskUpsertMock,
  billingCandidateUpsertMock,
  visitScheduleProposalFindFirstMock,
  visitScheduleProposalCreateMock,
  careReportFindFirstMock,
  careReportCreateMock,
  medicationIssueCreateMock,
  careCaseFindFirstMock,
  consentRecordFindFirstMock,
  managementPlanFindFirstMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  conferenceNoteFindManyMock: vi.fn(),
  conferenceNoteCreateMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  taskUpsertMock: vi.fn(),
  billingCandidateUpsertMock: vi.fn(),
  visitScheduleProposalFindFirstMock: vi.fn(),
  visitScheduleProposalCreateMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  careReportCreateMock: vi.fn(),
  medicationIssueCreateMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  consentRecordFindFirstMock: vi.fn(),
  managementPlanFindFirstMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
    handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>
  ) => {
    withAuthMock.mockImplementation(handler);
    return handler;
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest({
  method = 'GET',
  url = 'http://localhost/api/conference-notes',
  body,
}: {
  method?: 'GET' | 'POST';
  url?: string;
  body?: unknown;
}) {
  return {
    method,
    orgId: 'org_1',
    userId: 'user_1',
    url,
    json: async () => body,
    headers: {
      get: () => null,
    },
  } as unknown as NextRequest & { orgId: string; userId: string };
}

/** Build a tx mock that covers all the Prisma models used by ConferenceSyncService */
function buildTxMock() {
  return {
    conferenceNote: {
      findMany: conferenceNoteFindManyMock,
      create: conferenceNoteCreateMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
      findFirst: careCaseFindFirstMock,
    },
    task: {
      upsert: taskUpsertMock,
    },
    billingCandidate: {
      upsert: billingCandidateUpsertMock,
    },
    visitScheduleProposal: {
      findFirst: visitScheduleProposalFindFirstMock,
      create: visitScheduleProposalCreateMock,
    },
    careReport: {
      findFirst: careReportFindFirstMock,
      create: careReportCreateMock,
    },
    medicationIssue: {
      create: medicationIssueCreateMock,
    },
    consentRecord: {
      findFirst: consentRecordFindFirstMock,
    },
    managementPlan: {
      findFirst: managementPlanFindFirstMock,
    },
  };
}

describe('/api/conference-notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withOrgContextMock.mockImplementation(async (_orgId: string, callback: (tx: unknown) => unknown) =>
      callback(buildTxMock())
    );

    // default happy-path mocks
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      patient_id: 'patient_1',
      primary_pharmacist_id: 'pharm_1',
    });
    taskUpsertMock.mockResolvedValue({ id: 'task_new' });
    billingCandidateUpsertMock.mockResolvedValue({ id: 'billing_new' });
    visitScheduleProposalFindFirstMock.mockResolvedValue(null);
    visitScheduleProposalCreateMock.mockResolvedValue({ id: 'proposal_new' });
    careReportFindFirstMock.mockResolvedValue(null);
    careReportCreateMock.mockResolvedValue({ id: 'report_new' });
    medicationIssueCreateMock.mockResolvedValue({ id: 'issue_new' });
    consentRecordFindFirstMock.mockResolvedValue({ id: 'consent_1' });
    managementPlanFindFirstMock.mockResolvedValue({ id: 'plan_1' });
  });

  // ─── GET ─────────────────────────────────────────────────────────────────

  it('returns expanded conference notes including type, structured content, and metadata', async () => {
    conferenceNoteFindManyMock.mockResolvedValue([
      {
        id: 'note_1',
        org_id: 'org_1',
        case_id: 'case_1',
        note_type: 'pre_discharge',
        title: '退院前カンファ',
        content: '退院背景: 週内退院予定',
        structured_content: {
          template: 'pre_discharge',
          sections: [{ key: 'discharge_background', label: '退院背景', body: '週内退院予定' }],
        },
        metadata: {
          billing: {
            link_status: 'candidate',
            label: '退院時共同指導',
            points: 600,
          },
          visit_brief: {
            patient_id: 'patient_1',
          },
        },
        participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
        conference_date: new Date('2026-03-28T01:00:00.000Z'),
        action_items: [],
        created_at: new Date('2026-03-28T02:00:00.000Z'),
        updated_at: new Date('2026-03-28T02:00:00.000Z'),
      },
    ]);
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        patient_id: 'patient_1',
        patient: {
          name: '山田 太郎',
        },
      },
    ]);

    const response = await GET(
      createRequest({
        url: 'http://localhost/api/conference-notes?limit=20',
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'note_1',
          note_type: 'pre_discharge',
          structured_content: expect.objectContaining({
            template: 'pre_discharge',
          }),
          metadata: expect.objectContaining({
            billing: expect.objectContaining({
              label: '退院時共同指導',
              points: 600,
            }),
          }),
        }),
      ],
    });
  });

  it('creates a structured conference note and synthesizes summary metadata defaults', async () => {
    conferenceNoteCreateMock.mockResolvedValue({
      id: 'note_2',
      case_id: null,
      note_type: 'pre_discharge',
      title: '退院前カンファ',
      conference_date: new Date('2026-03-28T01:00:00.000Z'),
      participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
      structured_content: null,
      metadata: null,
      action_items: null,
    });

    const response = await POST(
      createRequest({
        method: 'POST',
        body: {
          note_type: 'pre_discharge',
          title: '退院前カンファ',
          structured_content: {
            sections: [
              {
                key: 'discharge_background',
                label: '退院背景',
                body: '来週火曜に退院予定',
              },
              {
                key: 'team_roles',
                label: '退院後の役割分担',
                body: '初回訪問は薬局が担当',
              },
            ],
          },
          participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
          conference_date: '2026-03-28T01:00:00.000Z',
        },
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(conferenceNoteCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        note_type: 'pre_discharge',
        title: '退院前カンファ',
        content:
          '退院背景: 来週火曜に退院予定\n退院後の役割分担: 初回訪問は薬局が担当',
        structured_content: expect.objectContaining({
          template: 'pre_discharge',
          sections: expect.arrayContaining([
            expect.objectContaining({
              key: 'discharge_background',
              label: '退院背景',
              body: '来週火曜に退院予定',
            }),
          ]),
        }),
        metadata: expect.objectContaining({
          billing: expect.objectContaining({
            link_status: 'candidate',
            label: '退院時共同指導',
            points: 600,
          }),
        }),
      }),
    });
  });

  // ─── Sync: pre_discharge ─────────────────────────────────────────────────

  describe('POST pre_discharge — sync side-effects', () => {
    const preDischargeSectionsBody = {
      note_type: 'pre_discharge',
      case_id: 'case_1',
      title: '退院前カンファレンス',
      structured_content: {
        sections: [
          { key: 'discharge_background', label: '退院背景', body: '来週火曜に退院予定' },
          { key: 'next_visit_plan', label: '次回訪問計画', body: '退院翌週に初回訪問予定' },
          { key: 'team_roles', label: '役割分担', body: '薬局担当: 服薬確認' },
        ],
      },
      participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
      conference_date: '2026-03-28T01:00:00.000Z',
      action_items: [
        { title: '服薬管理計画書を作成する', assignee: '薬剤師' },
        { title: 'かかりつけ医に連絡する', assignee: '薬剤師' },
      ],
    };

    beforeEach(() => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_pre1',
        case_id: 'case_1',
        note_type: 'pre_discharge',
        title: '退院前カンファレンス',
        conference_date: new Date('2026-03-28T01:00:00.000Z'),
        participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
        structured_content: {
          template: 'pre_discharge',
          sections: [
            { key: 'discharge_background', label: '退院背景', body: '来週火曜に退院予定' },
            { key: 'next_visit_plan', label: '次回訪問計画', body: '退院翌週に初回訪問予定' },
          ],
        },
        metadata: null,
        action_items: [
          { title: '服薬管理計画書を作成する', assignee: '薬剤師' },
          { title: 'かかりつけ医に連絡する', assignee: '薬剤師' },
        ],
      });
    });

    it('creates tasks from action_items on POST pre_discharge', async () => {
      const response = await POST(
        createRequest({ method: 'POST', body: preDischargeSectionsBody })
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      // Two action items → two task upsert calls
      expect(taskUpsertMock).toHaveBeenCalledTimes(2);
      expect(taskUpsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            org_id_dedupe_key: {
              org_id: 'org_1',
              dedupe_key: 'conference-action-item:note_pre1:0',
            },
          },
          create: expect.objectContaining({
            org_id: 'org_1',
            task_type: 'conference_action_item',
            title: '服薬管理計画書を作成する',
          }),
        })
      );
      expect(taskUpsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            org_id_dedupe_key: {
              org_id: 'org_1',
              dedupe_key: 'conference-action-item:note_pre1:1',
            },
          },
          create: expect.objectContaining({
            title: 'かかりつけ医に連絡する',
          }),
        })
      );
    });

    it('creates BillingCandidate with 600 points on POST pre_discharge', async () => {
      const response = await POST(
        createRequest({ method: 'POST', body: preDischargeSectionsBody })
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      expect(billingCandidateUpsertMock).toHaveBeenCalledTimes(1);
      expect(billingCandidateUpsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            org_id_dedupe_key: {
              org_id: 'org_1',
              dedupe_key: 'conference-billing:note_pre1',
            },
          },
          create: expect.objectContaining({
            org_id: 'org_1',
            patient_id: 'patient_1',
            billing_code: 'B011-6',
            billing_name: '退院時共同指導料（薬局）',
            points: 600,
            status: 'candidate',
          }),
        })
      );
    });

    it('creates VisitScheduleProposal when next_visit_plan section exists on POST pre_discharge', async () => {
      const response = await POST(
        createRequest({ method: 'POST', body: preDischargeSectionsBody })
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      expect(visitScheduleProposalCreateMock).toHaveBeenCalledTimes(1);
      expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            org_id: 'org_1',
            case_id: 'case_1',
            visit_type: 'regular',
            priority: 'normal',
            proposal_status: 'proposed',
            proposed_pharmacist_id: 'pharm_1',
            proposal_reason: 'conference-visit-proposal:note_pre1',
          }),
        })
      );
    });

    it('does NOT create VisitScheduleProposal when next_visit_plan section is absent', async () => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_pre_novp',
        case_id: 'case_1',
        note_type: 'pre_discharge',
        title: '退院前カンファ（訪問計画なし）',
        conference_date: new Date('2026-03-28T01:00:00.000Z'),
        participants: [],
        structured_content: {
          template: 'pre_discharge',
          sections: [
            { key: 'discharge_background', label: '退院背景', body: '退院予定' },
          ],
        },
        metadata: null,
        action_items: null,
      });

      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'pre_discharge',
            case_id: 'case_1',
            title: '退院前カンファ（訪問計画なし）',
            structured_content: {
              sections: [
                { key: 'discharge_background', label: '退院背景', body: '退院予定' },
              ],
            },
            participants: [],
            conference_date: '2026-03-28T01:00:00.000Z',
          },
        })
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    });

    it('creates CareReport draft with report_type physician_report on POST pre_discharge', async () => {
      const response = await POST(
        createRequest({ method: 'POST', body: preDischargeSectionsBody })
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      expect(careReportCreateMock).toHaveBeenCalledTimes(1);
      expect(careReportCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            org_id: 'org_1',
            patient_id: 'patient_1',
            case_id: 'case_1',
            report_type: 'physician_report',
            status: 'draft',
            created_by: 'user_1',
            content: expect.objectContaining({
              conference_note_id: 'note_pre1',
              note_type: 'pre_discharge',
            }),
          }),
        })
      );
    });

    it('exposes sync result in the response body', async () => {
      const response = await POST(
        createRequest({ method: 'POST', body: preDischargeSectionsBody })
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      const body = await response.json();

      expect(body).toHaveProperty('sync');
      expect(body.sync).toMatchObject({
        tasks_created: 2,
        billing_candidate_id: 'billing_new',
        visit_proposal_id: 'proposal_new',
        report_draft_ids: ['report_new'],
      });
    });
  });

  // ─── Sync: death_conference ───────────────────────────────────────────────

  describe('POST death_conference — sync side-effects', () => {
    beforeEach(() => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_death1',
        case_id: 'case_1',
        note_type: 'death_conference',
        title: 'デスカンファレンス',
        conference_date: new Date('2026-03-25T01:00:00.000Z'),
        participants: [{ name: '田中薬剤師', role: '薬剤師' }],
        structured_content: {
          template: 'death_conference',
          sections: [
            {
              key: 'billing_confirmation',
              label: '請求根拠確認',
              body: 'ターミナルケア管理料算定要件を確認。在宅での最期を患者・家族が希望し、薬剤師が継続支援した記録あり。',
            },
          ],
        },
        metadata: null,
        action_items: null,
      });
    });

    it('creates BillingCandidate with 2500 points on POST death_conference', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'death_conference',
            case_id: 'case_1',
            title: 'デスカンファレンス',
            structured_content: {
              sections: [
                {
                  key: 'billing_confirmation',
                  label: '請求根拠確認',
                  body: 'ターミナルケア管理料算定要件を確認。',
                },
              ],
            },
            participants: [{ name: '田中薬剤師', role: '薬剤師' }],
            conference_date: '2026-03-25T01:00:00.000Z',
          },
        })
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      expect(billingCandidateUpsertMock).toHaveBeenCalledTimes(1);
      expect(billingCandidateUpsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            org_id_dedupe_key: {
              org_id: 'org_1',
              dedupe_key: 'conference-billing:note_death1',
            },
          },
          create: expect.objectContaining({
            org_id: 'org_1',
            patient_id: 'patient_1',
            billing_code: 'C013',
            billing_name: 'ターミナルケア管理料（在宅ターミナルケア加算）',
            points: 2500,
            status: 'candidate',
          }),
        })
      );
    });

    it('creates CareReport draft with report_type internal_record on POST death_conference', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'death_conference',
            case_id: 'case_1',
            title: 'デスカンファレンス',
            structured_content: {
              sections: [
                {
                  key: 'billing_confirmation',
                  label: '請求根拠確認',
                  body: 'ターミナルケア管理料算定要件を確認。',
                },
              ],
            },
            participants: [{ name: '田中薬剤師', role: '薬剤師' }],
            conference_date: '2026-03-25T01:00:00.000Z',
          },
        })
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      expect(careReportCreateMock).toHaveBeenCalledTimes(1);
      expect(careReportCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            org_id: 'org_1',
            patient_id: 'patient_1',
            report_type: 'internal_record',
            status: 'draft',
            content: expect.objectContaining({
              conference_note_id: 'note_death1',
              note_type: 'death_conference',
            }),
          }),
        })
      );
    });

    it('does NOT create VisitScheduleProposal for death_conference', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'death_conference',
            case_id: 'case_1',
            title: 'デスカンファレンス',
            structured_content: {
              sections: [
                { key: 'billing_confirmation', label: '請求根拠確認', body: '算定要件確認済み' },
              ],
            },
            participants: [],
            conference_date: '2026-03-25T01:00:00.000Z',
          },
        })
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    });
  });

  // ─── Sync: care_team ─────────────────────────────────────────────────────

  describe('POST care_team — sync side-effects', () => {
    beforeEach(() => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_care1',
        case_id: 'case_1',
        note_type: 'care_team',
        title: '薬剤師間カンファレンス',
        conference_date: new Date('2026-03-29T01:00:00.000Z'),
        participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
        structured_content: {
          template: 'care_team',
          sections: [
            {
              key: 'medication_issues',
              label: '薬学的課題',
              body: 'アドヒアランス低下を確認\nポリファーマシー対応が必要',
            },
          ],
        },
        metadata: null,
        action_items: null,
      });
    });

    it('creates MedicationIssues from medication_issues section on POST care_team', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'care_team',
            case_id: 'case_1',
            title: '薬剤師間カンファレンス',
            structured_content: {
              sections: [
                {
                  key: 'medication_issues',
                  label: '薬学的課題',
                  body: 'アドヒアランス低下を確認\nポリファーマシー対応が必要',
                },
              ],
            },
            participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
            conference_date: '2026-03-29T01:00:00.000Z',
          },
        })
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      // Two issue titles from the newline-separated body
      expect(medicationIssueCreateMock).toHaveBeenCalledTimes(2);
      expect(medicationIssueCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            org_id: 'org_1',
            patient_id: 'patient_1',
            case_id: 'case_1',
            title: 'アドヒアランス低下を確認',
            status: 'open',
            priority: 'medium',
            identified_by: 'user_1',
          }),
        })
      );
      expect(medicationIssueCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'ポリファーマシー対応が必要',
          }),
        })
      );
    });

    it('creates CareReport draft with report_type internal_record on POST care_team', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'care_team',
            case_id: 'case_1',
            title: '薬剤師間カンファレンス',
            structured_content: {
              sections: [
                {
                  key: 'medication_issues',
                  label: '薬学的課題',
                  body: 'アドヒアランス低下を確認',
                },
              ],
            },
            participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
            conference_date: '2026-03-29T01:00:00.000Z',
          },
        })
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      expect(careReportCreateMock).toHaveBeenCalledTimes(1);
      expect(careReportCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            report_type: 'internal_record',
            status: 'draft',
            content: expect.objectContaining({
              conference_note_id: 'note_care1',
              note_type: 'care_team',
            }),
          }),
        })
      );
    });

    it('does NOT create MedicationIssues when medication_issues section is absent', async () => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_care_nomi',
        case_id: 'case_1',
        note_type: 'care_team',
        title: '薬剤師間カンファレンス（課題なし）',
        conference_date: new Date('2026-03-29T01:00:00.000Z'),
        participants: [],
        structured_content: {
          template: 'care_team',
          sections: [{ key: 'discussion', label: '討議', body: '情報共有のみ' }],
        },
        metadata: null,
        action_items: null,
      });

      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'care_team',
            case_id: 'case_1',
            title: '薬剤師間カンファレンス（課題なし）',
            structured_content: {
              sections: [{ key: 'discussion', label: '討議', body: '情報共有のみ' }],
            },
            participants: [],
            conference_date: '2026-03-29T01:00:00.000Z',
          },
        })
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(medicationIssueCreateMock).not.toHaveBeenCalled();
    });

    it('does NOT create BillingCandidate for care_team note type', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'care_team',
            case_id: 'case_1',
            title: '薬剤師間カンファレンス',
            structured_content: {
              sections: [
                { key: 'medication_issues', label: '薬学的課題', body: '課題あり' },
              ],
            },
            participants: [],
            conference_date: '2026-03-29T01:00:00.000Z',
          },
        })
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(billingCandidateUpsertMock).not.toHaveBeenCalled();
    });
  });

  // ─── Deduplication guard ─────────────────────────────────────────────────

  it('does not create a duplicate VisitScheduleProposal when one already exists', async () => {
    conferenceNoteCreateMock.mockResolvedValue({
      id: 'note_dup1',
      case_id: 'case_1',
      note_type: 'pre_discharge',
      title: '退院前カンファ（重複）',
      conference_date: new Date('2026-03-28T01:00:00.000Z'),
      participants: [],
      structured_content: {
        template: 'pre_discharge',
        sections: [
          { key: 'next_visit_plan', label: '次回訪問計画', body: '退院翌週に初回訪問' },
        ],
      },
      metadata: null,
      action_items: null,
    });

    // Simulate that a proposal already exists for this note
    visitScheduleProposalFindFirstMock.mockResolvedValue({ id: 'existing_proposal' });

    const response = await POST(
      createRequest({
        method: 'POST',
        body: {
          note_type: 'pre_discharge',
          case_id: 'case_1',
          title: '退院前カンファ（重複）',
          structured_content: {
            sections: [
              { key: 'next_visit_plan', label: '次回訪問計画', body: '退院翌週に初回訪問' },
            ],
          },
          participants: [],
          conference_date: '2026-03-28T01:00:00.000Z',
        },
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);

    // findFirst found existing → create must NOT be called
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.sync.visit_proposal_id).toBe('existing_proposal');
  });
});
