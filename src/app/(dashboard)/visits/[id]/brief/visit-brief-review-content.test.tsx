// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { jsonResponse } from '@/test/fetch-test-utils';
import type { VisitBrief } from '@/types/visit-brief';
import { VisitBriefReviewContent } from './visit-brief-review-content';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function buildBrief(): VisitBrief {
  return {
    patient: {
      id: 'patient_1',
      name: '患者A',
    },
    context: 'patient',
    generated_at: '2026-04-09T00:00:00.000Z',
    last_prescribed_date: '2026-04-08T00:00:00.000Z',
    baseline_context: null,
    medication_changes: [],
    patient_changes: [],
    medications: [],
    dispensing_items: [],
    delivery_status: [],
    dosage_form_support: [],
    multidisciplinary_updates: [],
    jahis_supplemental_records: [],
    latest_labs: [],
    unresolved_items: [],
    must_check_today: [],
    rule_summary: {
      generation_id: 'rule_1',
      headline: 'ルール要約',
      bullets: [],
      must_check_today: [],
      source_refs: [],
      generated_at: '2026-04-09T00:00:00.000Z',
    },
    ai_summary: {
      generation_id: 'ai_1',
      provider: 'rule',
      requested_provider: 'disabled',
      is_fallback: true,
      model: null,
      fallback_reason: 'provider_unavailable',
      headline: 'AI要約',
      bullets: [],
      must_check_today: [],
      source_refs: [],
      generated_at: '2026-04-09T00:00:00.000Z',
      duration_ms: null,
      recent_failure_rate_24h: null,
      recent_failure_count_24h: 0,
      recent_generation_count_24h: 0,
    },
    conference_summary: null,
    facility_context: null,
    drug_cautions: [],
  };
}

describe('VisitBriefReviewContent', () => {
  it('routes patient visit brief fetches through the shared patient API path helper', async () => {
    const patientId = 'pt/1?tab=x#frag';
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    vi.mocked(buildPatientApiPath).mockReturnValueOnce('/api/patients/__helper_pt__/visit-brief');

    let briefQueryFn: (() => Promise<unknown>) | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        if (config.queryKey[0] === 'visit-brief-review-patient') {
          return { data: { patientId }, isLoading: false, error: null };
        }
        if (config.queryKey[0] === 'patient-visit-brief') {
          briefQueryFn = config.queryFn;
        }
        return { data: undefined, isLoading: true, error: null };
      },
    );

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: null }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<VisitBriefReviewContent visitId="visit_1" />);
      await briefQueryFn?.();

      expect(buildPatientApiPath).toHaveBeenCalledWith(patientId, '/visit-brief');
      expect(fetchMock).toHaveBeenCalledWith('/api/patients/__helper_pt__/visit-brief', {
        headers: { 'x-org-id': 'org_1' },
      });
      expect(fetchMock).not.toHaveBeenCalledWith(
        `/api/patients/${patientId}/visit-brief`,
        expect.anything(),
      );
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('surfaces API messages from the patient visit brief read query', async () => {
    const patientId = 'pt_1';
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    let briefQueryFn: (() => Promise<unknown>) | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        if (config.queryKey[0] === 'visit-brief-review-patient') {
          return { data: { patientId }, isLoading: false, error: null };
        }
        if (config.queryKey[0] === 'patient-visit-brief') {
          briefQueryFn = config.queryFn;
        }
        return { data: undefined, isLoading: true, error: null };
      },
    );

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: 'API側の訪問前まとめエラー' }, 502));
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<VisitBriefReviewContent visitId="visit_1" />);

      await expect(briefQueryFn?.()).rejects.toThrow('API側の訪問前まとめエラー');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('keeps API messages from visit brief confirmation feedback failures', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    let feedbackMutationFn:
      | ((input: { choice: 'correct'; feedback: { rating: 'helpful' } }) => Promise<unknown>)
      | undefined;

    useMutationMock.mockImplementation(
      (config: {
        mutationFn: (input: {
          choice: 'correct';
          feedback: { rating: 'helpful' };
        }) => Promise<unknown>;
      }) => {
        feedbackMutationFn = config.mutationFn;
        return { mutate: vi.fn(), isPending: false };
      },
    );
    useQueryMock.mockImplementation((config: { queryKey: unknown[] }) => {
      if (config.queryKey[0] === 'visit-brief-review-patient') {
        return { data: { patientId: 'patient_1' }, isPending: false, isSuccess: true, error: null };
      }
      if (config.queryKey[0] === 'patient-visit-brief') {
        return {
          data: { data: buildBrief() },
          isPending: false,
          isSuccess: true,
          error: null,
        };
      }
      return { data: undefined, isPending: false, isSuccess: true, error: null };
    });

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: '薬剤師確認の記録権限がありません' }), {
        status: 403,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<VisitBriefReviewContent visitId="visit_1" />);

      await expect(
        feedbackMutationFn?.({ choice: 'correct', feedback: { rating: 'helpful' } }),
      ).rejects.toThrow('薬剤師確認の記録権限がありません');
      expect(fetchMock).toHaveBeenCalledWith('/api/visit-brief-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
        body: JSON.stringify({
          patient_id: 'patient_1',
          context: 'patient',
          generation_id: 'rule_1',
          summary_kind: 'rule',
          rating: 'helpful',
          provider: 'rule',
          requested_provider: 'rule',
          model: null,
          is_fallback: false,
        }),
      });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });
});
