import { afterEach, beforeEach, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { useUIStore } from '@/lib/stores/ui-store';
import { buildPatientHref } from '@/lib/patient/navigation';
import type {
  PatientBoardCard,
  PatientBoardFacets,
  PatientBoardPageResponse,
  PatientBoardRail,
} from '@/types/patient-board';

setupDomTestEnv();

const { useRealtimeQueryMock, refetchMock, clientLogWarnMock } = vi.hoisted(() => ({
  useRealtimeQueryMock: vi.fn(),
  refetchMock: vi.fn(),
  clientLogWarnMock: vi.fn(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

vi.mock('@/lib/utils/client-log', () => ({
  clientLog: { warn: clientLogWarnMock },
}));

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

import {
  PatientsBoard,
  fetchPatientBoard,
  formatNextVisitLabel,
  selectVisibleSafetyTags,
} from '../patients-board';
import { PatientBoardLoadingShell } from '../patient-board-loading';

function latestRealtimeQueryOptions() {
  const options = useRealtimeQueryMock.mock.calls.at(-1)?.[0] as
    | {
        queryKey?: readonly unknown[];
        invalidateOn?: readonly unknown[];
        enabled?: boolean;
        staleTime?: unknown;
      }
    | undefined;
  if (!options) throw new Error('useRealtimeQuery options are required');
  return options;
}

function localIso(hours: number, minutes = 0) {
  return new Date(2026, 5, 12, hours, minutes).toISOString();
}

function card(overrides: Partial<PatientBoardCard>): PatientBoardCard {
  const result: PatientBoardCard = {
    patient_id: 'pt_default',
    name: '患者 既定',
    age: 80,
    residence_kind: 'home',
    residence_label: '在宅',
    attention: 'steady',
    safety_tags: [],
    next_visit_date: null,
    next_visit_time: null,
    next_visit_label: null,
    current_step: 'set',
    status_text: 'セット作成中(通常レーン)',
    status_tone: 'neutral',
    operation_summary: ['連絡先未設定', '駐車未確認'],
    foundation_summary: {
      status: 'needs_confirmation',
      label: '未確認2件',
      items: ['連絡先未設定', '駐車未確認'],
    },
    foundation_issue_keys: ['missing_contact', 'missing_consent_plan', 'missing_parking'],
    foundation_href: '/patients/pt_default#patient-foundation',
    link_label: 'セットへ',
    link_href: '/set',
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'foundation_href')) {
    result.foundation_href = `${buildPatientHref(result.patient_id)}#patient-foundation`;
  }
  return result;
}

type PatientBoardFixtureOverrides = {
  data?: PatientBoardCard[];
  meta?: Partial<Omit<PatientBoardPageResponse['meta'], 'facets' | 'rail'>> & {
    facets?: Partial<PatientBoardFacets> & {
      chip_counts?: Partial<PatientBoardFacets['chip_counts']>;
      foundation_issue_counts?: Partial<PatientBoardFacets['foundation_issue_counts']>;
    };
    rail?: Partial<PatientBoardRail>;
  };
};

function buildFixture(overrides: PatientBoardFixtureOverrides = {}): PatientBoardPageResponse {
  const cards = overrides.data ?? [
    card({
      patient_id: 'pt_tanaka',
      name: '田中 一郎',
      age: 84,
      attention: 'urgent_now',
      safety_tags: ['narcotic', 'cold_storage', 'unit_dose', 'renal'],
      next_visit_date: '2026-06-12',
      next_visit_time: '14:00',
      current_step: 'audit',
      status_text: '麻薬監査 期限12:00 — 持参薬が未確定',
      status_tone: 'critical',
      operation_summary: ['連絡先あり', '駐車場なし', '要介護 3'],
      foundation_summary: {
        status: 'ready',
        label: '安全確認あり',
        items: ['安全タグ4件'],
      },
      foundation_issue_keys: [],
      foundation_href: '/patients/pt_tanaka#patient-foundation',
      link_label: '監査へ',
      link_href: '/audit',
    }),
    card({
      patient_id: 'pt_sasaki',
      name: '佐々木 ハル',
      age: 79,
      attention: 'wait_release',
      safety_tags: ['renal'],
      next_visit_date: '2026-06-13',
      next_visit_time: '10:00',
      current_step: 'decision',
      status_text: '照会回答が届きました(09:31) — 調剤を再開できます',
      status_tone: 'positive',
      link_label: '調剤へ',
      link_href: '/dispense',
    }),
    card({
      patient_id: 'pt_suzuki',
      name: '鈴木 新',
      age: 76,
      attention: 'acceptance',
      next_visit_label: '未定(調整中)',
      current_step: null,
      status_text: '受入の返答待ち — 訪問枠を調整中',
      status_tone: 'caution',
      link_label: 'スケジュールへ',
      link_href: '/schedules',
    }),
    card({
      patient_id: 'pt_ito',
      name: '伊藤 キヨ',
      age: 88,
      attention: 'visit_today',
      safety_tags: ['swallowing'],
      next_visit_date: '2026-06-12',
      next_visit_time: '10:30',
      current_step: 'visit',
      status_text: '準備完了 — パケット・ルート・セット✓',
      status_tone: 'info',
      link_label: '訪問へ',
      link_href: '/visits',
    }),
    card({
      patient_id: 'pt_yoshida',
      name: '吉田 進',
      age: 80,
      residence_kind: 'hospital',
      residence_label: '入院中',
      attention: 'paused',
      next_visit_label: '退院連絡待ち',
      current_step: null,
      status_text: '入院中 — 退院時共同指導の対象',
      status_tone: 'neutral',
      link_label: '算定チェックへ',
      link_href: '/billing',
    }),
  ];
  const facets = {
    chip_counts: { urgent_now: 1, external_wait: 0, visit_today: 1, paused: 1 },
    foundation_issue_counts: {
      needs_confirmation: 4,
      missing_contact: 4,
      missing_consent_plan: 4,
      missing_parking: 4,
      missing_care_level: 0,
      missing_insurance: 0,
      missing_care_team: 0,
    },
    today_facility_patient_count: 12,
    today_visit_count: 3,
    safety_tagged_count: 9,
  };
  const rail = {
    next_action: {
      patient_name: '田中 一郎',
      due_at: localIso(12, 0),
      has_narcotic: true,
    },
    blocked_reasons: [
      {
        id: 'ex_1',
        label: 'ご家族の同意待ち(新規契約)',
        severity: 'warning',
        category: '患者',
        age_minutes: 24 * 60,
        action_label: '再連絡する →',
        action_href: '/communications/requests',
      },
      {
        id: 'ex_2',
        label: '送付先の確認(やまもと内科)',
        severity: 'warning',
        category: '事務',
        age_minutes: 30,
        action_label: '状況を見る →',
        action_href: '/admin/contact-profiles',
      },
    ],
  } satisfies PatientBoardRail;
  return {
    data: cards,
    meta: {
      generated_at: localIso(9, 42),
      scope: 'mine',
      limit: 60,
      returned_count: cards.length,
      has_more: false,
      next_cursor: null,
      total_count: cards.length,
      count_basis: {
        total_count: 'filtered_result_exact',
        chip_counts: 'scope_search_foundation_exact',
        foundation_issue_counts: 'scope_search_without_active_foundation_issue_exact',
        board_summary: 'scope_search_foundation_exact',
      },
      filters_applied: {
        scope: 'mine',
        q_present: false,
        foundation_issue: null,
        card_filter: 'all',
        sort: 'priority',
      },
      assigned_total: 28,
      ...overrides.meta,
      facets: {
        ...facets,
        ...overrides.meta?.facets,
        chip_counts: {
          ...facets.chip_counts,
          ...overrides.meta?.facets?.chip_counts,
        },
        foundation_issue_counts: {
          ...facets.foundation_issue_counts,
          ...overrides.meta?.facets?.foundation_issue_counts,
        },
      },
      rail: {
        ...rail,
        ...overrides.meta?.rail,
      },
    },
  };
}

export function getPatientsBoardTestSupport() {
  return {
    buildFixture,
    buildPatientHref,
    card,
    clientLogWarnMock,
    fetchPatientBoard,
    formatNextVisitLabel,
    latestRealtimeQueryOptions,
    PatientBoardLoadingShell,
    PatientsBoard,
    refetchMock,
    selectVisibleSafetyTags,
    useRealtimeQueryMock,
    useUIStore,
  };
}

export function registerPatientsBoardHooks() {
  beforeEach(() => {
    useUIStore.setState({ workspaceRailOpen: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 12, 9, 42));
    refetchMock.mockClear();
    clientLogWarnMock.mockClear();
    useRealtimeQueryMock.mockReturnValue({
      data: buildFixture(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });
}
