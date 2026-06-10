import { describe, expect, it, vi } from 'vitest';
import {
  PREPARATION_PACK_MISMATCH_MESSAGE,
  PREPARATION_PACK_MISSING_MESSAGE,
  buildScheduleDayPreparationClinicalViewModel,
  buildScheduleDayPreparationForm,
  buildScheduleDayPreparationReadiness,
  fetchScheduleDayPreparationDetails,
  getPreparationPackIdentityError,
  handleScheduleDayPreparationSuccess,
  saveScheduleDayPreparation,
  type ScheduleDayPreparationForm,
} from './schedule-day-preparation';
import type { VisitPreparationPack, VisitSchedule } from './day-view.shared';

const completeForm: ScheduleDayPreparationForm = {
  medication_changes_reviewed: true,
  carry_items_confirmed: true,
  previous_issues_reviewed: true,
  route_confirmed: true,
  offline_synced: true,
};

type PreparationPackOverrides = Omit<
  Partial<VisitPreparationPack>,
  | 'patient'
  | 'visit'
  | 'handoff'
  | 'facility_mode'
  | 'workload'
  | 'medication_period'
  | 'intake_context'
> & {
  patient?: Partial<VisitPreparationPack['patient']>;
  visit?: Partial<VisitPreparationPack['visit']>;
  handoff?: Partial<VisitPreparationPack['handoff']>;
  facility_mode?: Partial<VisitPreparationPack['facility_mode']>;
  workload?: Partial<VisitPreparationPack['workload']>;
  medication_period?: Partial<VisitPreparationPack['medication_period']>;
  intake_context?: Partial<VisitPreparationPack['intake_context']>;
};

function buildPreparationPack(overrides: PreparationPackOverrides = {}): VisitPreparationPack {
  const base: VisitPreparationPack = {
    patient: {
      id: 'patient_1',
      name: '患者A',
      address: '東京都千代田区1-1',
    },
    visit: {
      id: 'schedule_1',
      scheduled_date: '2026-04-09',
      time_window_start: '2026-04-09T09:00:00.000Z',
      time_window_end: '2026-04-09T10:00:00.000Z',
      visit_type: 'regular',
      schedule_status: 'in_preparation',
      priority: 'normal',
      confirmed_at: '2026-04-08T09:00:00.000Z',
    },
    site: {
      id: 'site_1',
      name: '中央薬局',
      address: '東京都千代田区2-2',
    },
    handoff: {
      assignment_mode: 'primary',
      summary: '',
    },
    readiness_blockers: [],
    previous_visit: null,
    open_tasks: [],
    recent_contact_logs: [],
    facility_mode: {
      label: null,
      same_day_patient_count: 1,
      same_day_patient_names: ['患者A'],
      route_orders: [],
    },
    facility_parallel_context: null,
    workload: {
      same_day_visit_count: 1,
    },
    care_team: [],
    conference_context: [],
    billing_blockers: [],
    prescription_changes: null,
    medication_period: {
      schedule_start_date: null,
      schedule_end_date: null,
      prescription_start_date: null,
      prescription_end_date: null,
    },
    home_care_feature_highlights: [],
    visit_brief: {
      patient: { id: 'patient_1', name: '患者A' },
      context: 'schedule',
      generated_at: '2026-04-09T08:00:00.000Z',
      last_prescribed_date: null,
      baseline_context: null,
      medication_changes: [],
      medications: [],
      dispensing_items: [],
      delivery_status: [],
      dosage_form_support: [],
      multidisciplinary_updates: [],
      jahis_supplemental_records: [],
      unresolved_items: [],
      must_check_today: [],
      rule_summary: {
        generation_id: 'rule_1',
        headline: '確認事項なし',
        bullets: [],
        must_check_today: [],
        source_refs: [],
        generated_at: '2026-04-09T08:00:00.000Z',
      },
      ai_summary: {
        generation_id: 'ai_1',
        provider: 'rule',
        requested_provider: 'rule',
        is_fallback: true,
        model: null,
        fallback_reason: null,
        headline: '確認事項なし',
        bullets: [],
        must_check_today: [],
        source_refs: [],
        generated_at: '2026-04-09T08:00:00.000Z',
        duration_ms: null,
        recent_generation_count_24h: 0,
        recent_failure_count_24h: 0,
        recent_failure_rate_24h: null,
      },
      conference_summary: null,
      facility_context: null,
      drug_cautions: [],
    },
    onboarding_readiness: {
      consent_obtained: true,
      emergency_contact_set: true,
      first_visit_doc_delivered: true,
      management_plan_approved: true,
      primary_physician_set: true,
    },
    intake_context: {
      initial_transition_management_expected: false,
    },
    emergency_contacts: [],
    first_visit_document: null,
  };

  return {
    ...base,
    ...overrides,
    patient: { ...base.patient, ...overrides.patient },
    visit: { ...base.visit, ...overrides.visit },
    site: overrides.site === undefined ? base.site : overrides.site,
    handoff: { ...base.handoff, ...overrides.handoff },
    facility_mode: { ...base.facility_mode, ...overrides.facility_mode },
    workload: { ...base.workload, ...overrides.workload },
    medication_period: { ...base.medication_period, ...overrides.medication_period },
    intake_context: { ...base.intake_context, ...overrides.intake_context },
  };
}

describe('schedule day preparation helpers', () => {
  it('builds preparation checklist form defaults from missing preparation', () => {
    expect(buildScheduleDayPreparationForm(null)).toEqual({
      medication_changes_reviewed: false,
      carry_items_confirmed: false,
      previous_issues_reviewed: false,
      route_confirmed: false,
      offline_synced: false,
    });
  });

  it('builds preparation checklist form from an existing preparation', () => {
    expect(
      buildScheduleDayPreparationForm({
        id: 'prep_1',
        prepared_at: null,
        medication_changes_reviewed: true,
        carry_items_confirmed: false,
        previous_issues_reviewed: true,
        route_confirmed: false,
        offline_synced: true,
        checklist: {},
      }),
    ).toEqual({
      medication_changes_reviewed: true,
      carry_items_confirmed: false,
      previous_issues_reviewed: true,
      route_confirmed: false,
      offline_synced: true,
    });
  });

  it('detects preparation pack identity mismatches before accepting fetched details', () => {
    const schedule = {
      id: 'schedule_1',
      case_: {
        patient: {
          id: 'patient_1',
        },
      },
    } as VisitSchedule;

    expect(getPreparationPackIdentityError(schedule, buildPreparationPack())).toBeNull();
    expect(
      getPreparationPackIdentityError(
        schedule,
        buildPreparationPack({
          patient: {
            id: 'patient_other',
            name: '別患者',
            address: '東京都千代田区1-1',
          },
        }),
      ),
    ).toBe(PREPARATION_PACK_MISMATCH_MESSAGE);
    expect(
      getPreparationPackIdentityError(
        schedule,
        buildPreparationPack({ visit: { id: 'schedule_other' } }),
      ),
    ).toBe(PREPARATION_PACK_MISMATCH_MESSAGE);
  });

  it('builds all-clear preparation readiness from a complete checklist and pack', () => {
    expect(
      buildScheduleDayPreparationReadiness({
        form: completeForm,
        pack: buildPreparationPack(),
        loadError: null,
        identityError: null,
        loading: false,
        hasTarget: true,
        saving: false,
      }),
    ).toMatchObject({
      completedChecklistCount: 5,
      incompleteChecklistLabels: [],
      unresolvedReadinessBlockers: [],
      contextBlockerCount: 0,
      contextBlockerCategories: [],
      packStatusError: null,
      status: 'ready',
      summaryText: 'ready に進める状態です。',
      markReadyDisabled: false,
    });
  });

  it('blocks ready when the latest pack is missing, loading, or mismatched', () => {
    expect(
      buildScheduleDayPreparationReadiness({
        form: completeForm,
        pack: null,
        loadError: null,
        identityError: null,
        loading: false,
        hasTarget: true,
        saving: false,
      }),
    ).toMatchObject({
      status: 'error',
      packStatusError: PREPARATION_PACK_MISSING_MESSAGE,
      summaryText: PREPARATION_PACK_MISSING_MESSAGE,
      markReadyDisabled: true,
    });

    expect(
      buildScheduleDayPreparationReadiness({
        form: completeForm,
        pack: buildPreparationPack(),
        loadError: null,
        identityError: null,
        loading: true,
        hasTarget: true,
        saving: false,
      }),
    ).toMatchObject({
      status: 'loading',
      summaryText: '最新の訪問準備情報を読み込み中です。',
      markReadyDisabled: true,
    });

    expect(
      buildScheduleDayPreparationReadiness({
        form: completeForm,
        pack: buildPreparationPack(),
        loadError: null,
        identityError: PREPARATION_PACK_MISMATCH_MESSAGE,
        loading: false,
        hasTarget: true,
        saving: false,
      }),
    ).toMatchObject({
      status: 'error',
      packStatusError: PREPARATION_PACK_MISMATCH_MESSAGE,
      markReadyDisabled: true,
    });
  });

  it('surfaces checklist, onboarding, and billing blockers as ready-stop categories', () => {
    const readiness = buildScheduleDayPreparationReadiness({
      form: {
        ...completeForm,
        carry_items_confirmed: false,
      },
      pack: buildPreparationPack({
        readiness_blockers: ['持参薬・物品確認'],
        onboarding_readiness: null,
        billing_blockers: [
          {
            key: 'missing_evidence',
            reason: '算定根拠が未確認です',
            severity: 'high',
            evidence_id: 'evidence_1',
            visit_record_id: 'record_1',
            action_href: '/billing/evidence_1',
            action_label: '算定根拠を確認',
          },
        ],
      }),
      loadError: null,
      identityError: null,
      loading: false,
      hasTarget: true,
      saving: false,
    });

    expect(readiness).toMatchObject({
      status: 'blocked',
      summaryText: '出発前に解決が必要な項目があります。',
      markReadyDisabled: true,
      unresolvedReadinessBlockers: ['持参薬・物品確認'],
      onboardingReadinessUnknown: true,
      contextBlockerCategories: ['訪問前提 1件', '導入準備 不明', '算定確認 1件'],
    });
  });

  it('treats unresolved onboarding warnings as ready blockers', () => {
    const readiness = buildScheduleDayPreparationReadiness({
      form: completeForm,
      pack: buildPreparationPack({
        onboarding_readiness: {
          consent_obtained: false,
          emergency_contact_set: true,
          first_visit_doc_delivered: false,
          management_plan_approved: true,
          primary_physician_set: true,
        },
      }),
      loadError: null,
      identityError: null,
      loading: false,
      hasTarget: true,
      saving: false,
    });

    expect(readiness.status).toBe('blocked');
    expect(readiness.contextBlockerCategories).toEqual(['導入準備 2件']);
    expect(readiness.onboardingReadinessWarnings.map((warning) => warning.label)).toEqual([
      '同意未取得',
      '初回文書未交付',
    ]);
  });

  it('builds incomplete checklist readiness without pack-level blockers', () => {
    const readiness = buildScheduleDayPreparationReadiness({
      form: {
        ...completeForm,
        offline_synced: false,
      },
      pack: buildPreparationPack(),
      loadError: null,
      identityError: null,
      loading: false,
      hasTarget: true,
      saving: false,
    });

    expect(readiness).toMatchObject({
      status: 'incomplete',
      incompleteChecklistLabels: ['オフライン同期確認'],
      summaryText: '出発前チェックリストに未完了項目があります。',
      markReadyDisabled: true,
    });
  });

  it('builds clinical readiness items from visit type, transition context, and billing blockers', () => {
    const clinical = buildScheduleDayPreparationClinicalViewModel(
      buildPreparationPack({
        visit: { visit_type: 'initial' },
        intake_context: { initial_transition_management_expected: true },
        billing_blockers: [
          {
            key: 'missing_billing_evidence',
            reason: '請求根拠が不足しています',
            severity: 'urgent',
            evidence_id: 'evidence_1',
            visit_record_id: 'record_1',
            action_href: '/billing/evidence_1',
            action_label: '算定根拠を確認',
          },
        ],
      }),
    );

    expect(clinical.visitTypeLabel).toBe('初回訪問');
    expect(clinical.requiredItems.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        'medication_review',
        'initial_transition_environment',
        'initial_transition_medication_risk',
        'initial_transition_summary',
        'billing_blocker:missing_billing_evidence',
      ]),
    );
    expect(clinical.requiredOpenItems.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        'medication_review',
        'initial_transition_environment',
        'billing_blocker:missing_billing_evidence',
      ]),
    );
  });

  it('fetches preparation details with org scope', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: {
          preparation: null,
          pack: null,
        },
      }),
    );

    await expect(
      fetchScheduleDayPreparationDetails({
        orgId: 'org_1',
        scheduleId: 'schedule_1',
        fetchImpl,
      }),
    ).resolves.toEqual({
      preparation: null,
      pack: null,
    });

    expect(fetchImpl).toHaveBeenCalledWith('/api/visit-preparations/schedule_1', {
      headers: { 'x-org-id': 'org_1' },
    });
  });

  it('throws the legacy generic fetch error when preparation details cannot be fetched', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ message: 'ignored' }), { status: 500 }),
    );

    await expect(
      fetchScheduleDayPreparationDetails({
        orgId: 'org_1',
        scheduleId: 'schedule_1',
        fetchImpl,
      }),
    ).rejects.toThrow('訪問準備情報の取得に失敗しました');
  });

  it('saves preparation checklist without ready transition', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: { id: 'prep_1' } }));

    await expect(
      saveScheduleDayPreparation({
        orgId: 'org_1',
        request: {
          scheduleId: 'schedule_1',
          form: completeForm,
          markReady: false,
        },
        fetchImpl,
      }),
    ).resolves.toEqual({ data: { id: 'prep_1' } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/api/visit-preparations/schedule_1', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': 'org_1',
      },
      body: JSON.stringify({
        checklist: completeForm,
        ...completeForm,
      }),
    });
  });

  it('saves preparation then marks the schedule ready when requested', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: { id: 'prep_1' } }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'schedule_1' } }));

    await saveScheduleDayPreparation({
      orgId: 'org_1',
      request: {
        scheduleId: 'schedule_1',
        form: completeForm,
        markReady: true,
      },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/visit-schedules/schedule_1', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': 'org_1',
      },
      body: JSON.stringify({
        schedule_status: 'ready',
      }),
    });
  });

  it('propagates save and ready-transition server messages', async () => {
    await expect(
      saveScheduleDayPreparation({
        orgId: 'org_1',
        request: {
          scheduleId: 'schedule_1',
          form: completeForm,
          markReady: false,
        },
        fetchImpl: vi.fn(
          async () =>
            new Response(JSON.stringify({ message: 'チェックリストが古いです' }), {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            }),
        ),
      }),
    ).rejects.toThrow('チェックリストが古いです');

    await expect(
      saveScheduleDayPreparation({
        orgId: 'org_1',
        request: {
          scheduleId: 'schedule_1',
          form: completeForm,
          markReady: true,
        },
        fetchImpl: vi
          .fn()
          .mockResolvedValueOnce(Response.json({ data: { id: 'prep_1' } }))
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ message: 'ready にできません' }), {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
      }),
    ).rejects.toThrow('ready にできません');
  });

  it('notifies, closes the dialog, and refreshes preparation-dependent queries after save', async () => {
    const notifySuccess = vi.fn();
    const closeDialog = vi.fn();
    const invalidateQueries = vi.fn(async () => undefined);

    await handleScheduleDayPreparationSuccess({
      orgId: 'org_1',
      markReady: true,
      notifySuccess,
      closeDialog,
      invalidateQueries,
    });

    expect(notifySuccess).toHaveBeenCalledWith('訪問準備を保存し、ready へ進めました');
    expect(closeDialog).toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['visit-schedules', 'week-board', 'org_1'],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['tasks', 'org_1'],
    });
  });
});
