import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PatientOverview, PatientWorkspace } from './patient-detail.types';
import {
  buildCaseRiskCommandPanelModel,
  buildPatientCommandCenterModel,
  formatActivityTime,
} from './patient-command-center-model';

function buildWorkspace(overrides: Partial<PatientWorkspace> = {}): PatientWorkspace {
  return {
    cycle_id: 'cycle_1',
    overall_status: 'dispensed',
    exception_status: null,
    action_context: {
      patient_id: 'patient_1',
      prescription_intake_id: 'intake_1',
      visit_schedule_id: 'schedule_1',
      visit_record_id: null,
      report_id: null,
    },
    current_intake: {
      id: 'intake_1',
      prescribed_date: '2026-07-04T00:00:00+09:00',
      prescription_category: 'regular',
    },
    safety: {
      allergy: null,
      renal: null,
      handling_tags: [],
      swallowing: null,
      cautions: [],
    },
    prescription_lines: [],
    recent_activities: [
      {
        id: 'inquiry_1',
        type: 'inquiry',
        label: '疑義照会 回答受領',
        actor: null,
        at: '2026-07-05T09:30:00+09:00',
        href: '/communications/requests?status=responded&patient_id=patient_1',
      },
    ],
    today_tasks: [
      {
        id: 'task_1',
        tone: 'deadline',
        time_label: '期限 12:00',
        label: '麻薬監査',
        href: '/audit',
        action_label: '監査へ',
        due_time: '12:00',
      },
    ],
    open_exceptions: [
      {
        id: 'exception_1',
        exception_type: 'awaiting_reply',
        description: '医療機関からの返信待ち',
        severity: 'warning',
        created_at: '2026-07-04T09:00:00+09:00',
      },
    ],
    medication_changes: [],
    previous_medication: null,
    current_medication: null,
    set_plan: null,
    prescription_document_url: '/files/prescription-image-1',
    ...overrides,
  };
}

function buildPatient(overrides: Partial<PatientOverview> = {}): PatientOverview {
  return {
    id: 'patient_1',
    lab_summary: [
      {
        analyte_code: 'egfr',
        value_numeric: 42,
        measured_at: '2026-07-01T00:00:00.000Z',
        unit: 'mL/min/1.73m2',
        abnormal_flag: null,
      },
    ],
    visit_brief: {
      unresolved_items: [
        {
          source_type: 'billing',
          title: '請求 blocker の確認待ち',
          summary: '報告書送付が未完了',
          severity: 'high',
          href: '/billing?patient_id=patient_1',
        },
      ],
    },
    ...overrides,
  } as PatientOverview;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-05T10:00:00+09:00'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('buildPatientCommandCenterModel', () => {
  it('derives the process, deadline-aware next action, blockers, and evidence for a patient command center', () => {
    const model = buildPatientCommandCenterModel({
      patient: buildPatient(),
      patientId: 'patient_1',
      workspace: buildWorkspace(),
    });

    expect(model.currentStep).toBe('audit');
    expect(model.currentStepLabel).toBe('監査');
    expect(model.processLabel).toBe('工程: 監査(いまここ)');
    expect(model.nextAction).toMatchObject({
      actionLabel: '調剤鑑査を始める — 12:00期限',
      actionHref: '/audit',
    });
    expect(model.blockedReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'exception_1',
          label: '返信待ち — 再確認できます',
          categoryLabel: '医療機関',
          severity: 'warning',
          actionLabel: '状況を見る →',
          actionHref: '/communications/requests?status=sent&patient_id=patient_1',
        }),
        expect.objectContaining({
          id: 'billing-0',
          categoryLabel: '事務',
          severity: 'critical',
          actionHref: '/billing?patient_id=patient_1',
        }),
      ]),
    );
    expect(JSON.stringify(model.blockedReasons)).not.toContain('医療機関からの返信待ち');
    expect(model.evidence).toEqual([
      expect.objectContaining({
        id: 'prescription-image',
        label: '処方せん画像',
        meta: '7/4',
        href: '/files/prescription-image-1',
      }),
      expect.objectContaining({
        id: 'medication-notebook',
        href: '/patients/patient_1#patient-profile-summary',
      }),
      expect.objectContaining({
        id: 'inquiry-response',
        meta: '09:30',
      }),
      expect.objectContaining({
        id: 'lab-trend',
        meta: 'eGFR',
        href: '/patients/patient_1#patient-profile-summary',
      }),
    ]);
    expect(model.recentActivities).toEqual([
      {
        id: 'inquiry_1',
        type: 'inquiry',
        label: '疑義照会 回答受領',
        meta: '09:30',
        href: '/communications/requests?status=responded&patient_id=patient_1',
      },
    ]);
  });

  it('adds Case Risk Cockpit summary and task/non-task next actions without using finding text', () => {
    const model = buildPatientCommandCenterModel({
      patient: buildPatient(),
      patientId: 'patient_1',
      workspace: buildWorkspace(),
      caseRiskCockpit: {
        overall: {
          status: 'blocked',
          blocking_count: 1,
          urgent_count: 2,
          warning_count: 3,
        },
        next_actions: [
          {
            task_id: 'task_1',
            label: '同意更新タスクを確認',
            priority: 'high',
            due_at: '2026-07-07T00:00:00.000Z',
            action_href: '/tasks/task_1',
          },
          {
            task_id: null,
            label: '正本を確認',
            priority: 'normal',
            due_at: null,
            action_href: '/patients/patient_1#patient-profile-summary',
          },
        ],
      },
    });

    expect(model.caseRiskSummary).toEqual({
      status: 'blocked',
      statusLabel: '停止中',
      blockingCount: 1,
      urgentCount: 2,
      warningCount: 3,
    });
    expect(model.caseRiskActions).toEqual([
      {
        id: 'task_1',
        taskId: 'task_1',
        label: '同意更新タスクを確認',
        priority: 'high',
        dueAt: '2026-07-07T00:00:00.000Z',
        actionHref: '/tasks/task_1',
      },
      {
        id: 'normal:1:/patients/patient_1#patient-profile-summary',
        taskId: null,
        label: '正本を確認',
        priority: 'normal',
        dueAt: null,
        actionHref: '/patients/patient_1#patient-profile-summary',
      },
    ]);
    expect(JSON.stringify(model)).not.toContain('山田花子');
    expect(JSON.stringify(model)).not.toContain('東京都千代田区');
  });

  it('falls back to safe labels for unknown workflow exceptions and unknown activity dates', () => {
    const model = buildPatientCommandCenterModel({
      patient: buildPatient({ lab_summary: [] }),
      patientId: 'patient_1',
      workspace: buildWorkspace({
        overall_status: 'unknown_status',
        current_intake: null,
        recent_activities: [],
        today_tasks: [],
        open_exceptions: [
          {
            id: 'exception_unknown',
            exception_type: 'unmapped_exception',
            description: '未分類の停止理由',
            severity: 'critical',
            created_at: 'not-a-date',
          },
        ],
        prescription_document_url: null,
      }),
    });

    expect(model.currentStep).toBeNull();
    expect(model.processLabel).toBeNull();
    expect(model.nextAction).toBeUndefined();
    expect(model.blockedReasons[0]).toMatchObject({
      label: '確認事項があります — 詳細確認が必要です',
      categoryLabel: '事務',
      actionLabel: '状況を見る →',
      actionHref: '/workflow',
      ageLabel: undefined,
    });
    expect(JSON.stringify(model.blockedReasons)).not.toContain('未分類の停止理由');
    expect(model.evidence).toEqual([
      expect.objectContaining({ id: 'medication-notebook' }),
      expect.objectContaining({ id: 'lab-trend', meta: undefined }),
    ]);
    expect(formatActivityTime('not-a-date')).toBe('not-a-date');
  });

  it('returns an empty Case Risk Command model when cockpit data is absent', () => {
    expect(buildCaseRiskCommandPanelModel(null)).toEqual({
      caseRiskSummary: null,
      caseRiskActions: [],
    });
  });
});
