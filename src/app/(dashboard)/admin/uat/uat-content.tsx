'use client';

import { useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Square, Send } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SegmentError, SegmentLoading } from '@/components/ui/segment-state';
import { SegmentedProgressBar } from '@/components/ui/segmented-progress-bar';
import { Separator } from '@/components/ui/separator';
import { readApiJson, type ApiJsonSchema } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { UAT_CHECKLIST, UAT_PRIORITY_OPTIONS, UAT_STATUS_OPTIONS } from '@/lib/constants/uat';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { messageFromError } from '@/lib/utils/error-message';
import {
  createUatFeedbackDraft,
  isUatFeedbackDraftDirty,
  mergeUatFeedbackDraft,
  type UatFeedbackDraft,
} from '@/lib/uat-feedback';

const UAT_FEEDBACK_REQUIRED_MESSAGE = 'フィードバック内容を入力してください';
const UAT_FEEDBACK_HELP_MESSAGE = 'フィードバック内容を入力すると送信できます。';
const UAT_FEEDBACK_HELP_ID = 'uat-feedback-help';
const UAT_FEEDBACK_ERROR_ID = 'uat-feedback-error';
const UAT_FEEDBACK_LIST_LIMIT = 100;
const UAT_FEEDBACK_LIST_ERROR = 'UAT フィードバックの取得に失敗しました';
const UAT_FEEDBACK_FORM_DEFAULTS = {
  priority: 'medium',
  feedback: '',
} satisfies UatFeedbackForm;

function LoadingRows({ label, rows = 3 }: { label: string; rows?: number }) {
  return <SegmentLoading label={label} rows={rows} cols={2} size="compact" />;
}

type UatFeedbackItem = {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'triaged' | 'in_progress' | 'resolved' | 'deferred';
  owner_user_id: string | null;
  feedback: string;
  checklist_progress: string | null;
  checked_items: string[];
  source: string | null;
  linked_work_item: string | null;
  due_date: string | null;
  resolved_at: string | null;
  created_at: string;
};

type UatFeedbackForm = {
  priority: UatFeedbackItem['priority'];
  feedback: string;
};

type PilotReadinessData = {
  generated_at: string;
  case_summary: {
    active_case_count: number;
    facility_linked_case_count: number;
    non_facility_case_count: number;
    facility_count: number;
    set_pilot_case_count: number;
    set_pilot_without_facility_count: number;
  };
  uat_summary: {
    total_feedback: number;
    critical_count: number;
    high_count: number;
    medium_count: number;
    low_count: number;
    blocker_count: number;
    recent_feedback: Array<{
      id: string;
      priority: string;
      feedback: string;
      checklist_progress: string | null;
      source: string | null;
      created_at: string;
    }>;
  };
  decisions: {
    facility_batching: 'ready' | 'phase2_candidate';
    medication_set_workflow: 'ready' | 'phase2_candidate';
    phase2_entry: 'ready' | 'blocked';
  };
  recommendations: string[];
};

type CollaboratorOption = {
  id: string;
  name: string;
  role: string;
};

function dedupeCollaboratorOptions(items: CollaboratorOption[]) {
  const uniqueItems = new Map<string, CollaboratorOption>();
  for (const item of items) {
    if (!uniqueItems.has(item.id)) {
      uniqueItems.set(item.id, item);
    }
  }
  return Array.from(uniqueItems.values());
}

type UatFeedbackSummaryData = {
  generated_at: string;
  total_feedback: number;
  priorities: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  blocker_count: number;
  action_items: Array<{
    id: string;
    priority: string;
    status: string;
    feedback: string;
    checklist_progress: string | null;
    source: string | null;
    created_at: string;
  }>;
  checklist_coverage: Array<{
    item_id: string;
    label: string;
    checked_count: number;
  }>;
  recommendations: string[];
};

type PilotOrgAuditData = {
  generated_at: string;
  org_structure: {
    site_count: number;
    active_member_count: number;
    role_counts: Record<string, number>;
    site_breakdown: Array<{
      site_id: string;
      site_name: string;
      active_member_count: number;
      service_area_count: number;
      has_geo: boolean;
    }>;
  };
  pilot_targets: {
    active_case_count: number;
    facility_linked_case_count: number;
    set_pilot_case_count: number;
  };
  coverage: {
    total_primary_residences: number;
    flagged_patient_count: number;
    flagged_patients_truncated: boolean;
    service_area_covered_count: number;
    radius_16km_covered_count: number;
    uncovered_count: number;
    review_required_count: number;
    flagged_patients: Array<{
      patient_id: string;
      patient_name: string;
      address: string;
      reason: string;
      nearest_site_name: string | null;
      nearest_site_distance_km: number | null;
    }>;
  };
  recommendations: string[];
};

type PilotLaunchDossierData = {
  generated_at: string;
  recommendations: string[];
  readiness: {
    decisions: {
      facility_batching: 'ready' | 'phase2_candidate';
      medication_set_workflow: 'ready' | 'phase2_candidate';
      phase2_entry: 'ready' | 'blocked';
    };
  };
  org_audit: {
    coverage: {
      uncovered_count: number;
      review_required_count: number;
      flagged_patient_count: number;
      flagged_patients_truncated: boolean;
    };
  };
  uat_summary: {
    total_feedback: number;
    blocker_count: number;
  };
  external_readiness: {
    pmda: {
      ready_for_import_test: boolean;
    };
    backup: {
      ready_for_live_drill: boolean;
      recorded_runs: Array<{
        date: string;
      }>;
    };
    isms: {
      ready_for_quote_request: boolean;
      comparison_table_started: boolean;
      decision_memo_started: boolean;
    };
  };
};

const uatFeedbackItemSchema = z.object({
  id: z.string(),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  status: z.enum(['open', 'triaged', 'in_progress', 'resolved', 'deferred']),
  owner_user_id: z.string().nullable(),
  feedback: z.string(),
  checklist_progress: z.string().nullable(),
  checked_items: z.array(z.string()),
  source: z.string().nullable(),
  linked_work_item: z.string().nullable(),
  due_date: z.string().nullable(),
  resolved_at: z.string().nullable(),
  created_at: z.string(),
});

const recentFeedbackSchema = z.object({
  id: z.string(),
  priority: z.string(),
  feedback: z.string(),
  checklist_progress: z.string().nullable(),
  source: z.string().nullable(),
  created_at: z.string(),
});

const pilotDecisionSchema = z.enum(['ready', 'phase2_candidate']);
const pilotReadinessResponseSchema = z.object({
  data: z.object({
    generated_at: z.string(),
    case_summary: z.object({
      active_case_count: z.number(),
      facility_linked_case_count: z.number(),
      non_facility_case_count: z.number(),
      facility_count: z.number(),
      set_pilot_case_count: z.number(),
      set_pilot_without_facility_count: z.number(),
    }),
    uat_summary: z.object({
      total_feedback: z.number(),
      critical_count: z.number(),
      high_count: z.number(),
      medium_count: z.number(),
      low_count: z.number(),
      blocker_count: z.number(),
      recent_feedback: z.array(recentFeedbackSchema),
    }),
    decisions: z.object({
      facility_batching: pilotDecisionSchema,
      medication_set_workflow: pilotDecisionSchema,
      phase2_entry: z.enum(['ready', 'blocked']),
    }),
    recommendations: z.array(z.string()),
  }),
});

const uatFeedbackSummaryResponseSchema = z.object({
  data: z.object({
    generated_at: z.string(),
    total_feedback: z.number(),
    priorities: z.object({
      critical: z.number(),
      high: z.number(),
      medium: z.number(),
      low: z.number(),
    }),
    blocker_count: z.number(),
    action_items: z.array(
      z.object({
        id: z.string(),
        priority: z.string(),
        status: z.string(),
        feedback: z.string(),
        checklist_progress: z.string().nullable(),
        source: z.string().nullable(),
        created_at: z.string(),
      }),
    ),
    checklist_coverage: z.array(
      z.object({ item_id: z.string(), label: z.string(), checked_count: z.number() }),
    ),
    recommendations: z.array(z.string()),
  }),
});

const collaboratorOptionsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string(), name: z.string(), role: z.string() })),
});

const pilotOrgAuditResponseSchema = z.object({
  data: z.object({
    generated_at: z.string(),
    org_structure: z.object({
      site_count: z.number(),
      active_member_count: z.number(),
      role_counts: z.record(z.string(), z.number()),
      site_breakdown: z.array(
        z.object({
          site_id: z.string(),
          site_name: z.string(),
          active_member_count: z.number(),
          service_area_count: z.number(),
          has_geo: z.boolean(),
        }),
      ),
    }),
    pilot_targets: z.object({
      active_case_count: z.number(),
      facility_linked_case_count: z.number(),
      set_pilot_case_count: z.number(),
    }),
    coverage: z.object({
      total_primary_residences: z.number(),
      flagged_patient_count: z.number(),
      flagged_patients_truncated: z.boolean(),
      service_area_covered_count: z.number(),
      radius_16km_covered_count: z.number(),
      uncovered_count: z.number(),
      review_required_count: z.number(),
      flagged_patients: z.array(
        z.object({
          patient_id: z.string(),
          patient_name: z.string(),
          address: z.string(),
          reason: z.string(),
          nearest_site_name: z.string().nullable(),
          nearest_site_distance_km: z.number().nullable(),
        }),
      ),
    }),
    recommendations: z.array(z.string()),
  }),
});

const pilotLaunchDossierResponseSchema = z.object({
  data: z.object({
    generated_at: z.string(),
    recommendations: z.array(z.string()),
    readiness: pilotReadinessResponseSchema.shape.data.pick({ decisions: true }),
    org_audit: z.object({
      coverage: pilotOrgAuditResponseSchema.shape.data.shape.coverage.pick({
        uncovered_count: true,
        review_required_count: true,
        flagged_patient_count: true,
        flagged_patients_truncated: true,
      }),
    }),
    uat_summary: z.object({ total_feedback: z.number(), blocker_count: z.number() }),
    external_readiness: z.object({
      pmda: z.object({ ready_for_import_test: z.boolean() }),
      backup: z.object({
        ready_for_live_drill: z.boolean(),
        recorded_runs: z.array(z.object({ date: z.string() })),
      }),
      isms: z.object({
        ready_for_quote_request: z.boolean(),
        comparison_table_started: z.boolean(),
        decision_memo_started: z.boolean(),
      }),
    }),
  }),
});

const uatFeedbackListResponseSchema = z
  .object({
    data: z.array(uatFeedbackItemSchema).max(UAT_FEEDBACK_LIST_LIMIT),
    meta: z
      .object({
        generated_at: z.string().datetime({ offset: true }),
        limit: z.literal(UAT_FEEDBACK_LIST_LIMIT),
        has_more: z.boolean(),
        next_cursor: z.string().trim().min(1).nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ meta }, context) => {
    if (meta.has_more && !meta.next_cursor) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'next_cursor'],
        message: 'next_cursor is required when has_more is true',
      });
    }
    if (!meta.has_more && meta.next_cursor) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'next_cursor'],
        message: 'next_cursor must be null when has_more is false',
      });
    }
  });
const uatFeedbackResponseSchema = z.object({ data: uatFeedbackItemSchema });
type UatFeedbackListPage = z.infer<typeof uatFeedbackListResponseSchema>;

function hasRepeatedUatFeedbackCursor(
  pages: readonly UatFeedbackListPage[],
  pageParams: readonly unknown[],
) {
  const lastPage = pages.at(-1);
  if (!lastPage?.meta.has_more || !lastPage.meta.next_cursor) return false;

  const consumedCursors = new Set(
    pageParams.flatMap((pageParam) =>
      typeof pageParam === 'string' && pageParam ? [pageParam] : [],
    ),
  );
  const priorOfferedCursors = new Set(
    pages.slice(0, -1).flatMap((page) => (page.meta.next_cursor ? [page.meta.next_cursor] : [])),
  );
  return (
    consumedCursors.has(lastPage.meta.next_cursor) ||
    priorOfferedCursors.has(lastPage.meta.next_cursor)
  );
}

function getNextUatFeedbackCursor(
  lastPage: UatFeedbackListPage,
  allPages: UatFeedbackListPage[],
  _lastPageParam: string | null,
  allPageParams: Array<string | null>,
) {
  if (!lastPage.meta.has_more) return undefined;

  const nextCursor = lastPage.meta.next_cursor;
  if (!nextCursor) throw new Error(UAT_FEEDBACK_LIST_ERROR);
  if (hasRepeatedUatFeedbackCursor(allPages, allPageParams)) return undefined;
  return nextCursor;
}

function buildUatRequestHeaders(orgId: string, headers?: HeadersInit): Record<string, string> {
  if (!headers) return buildOrgHeaders(orgId);
  if (headers instanceof Headers) return buildOrgHeaders(orgId, Object.fromEntries(headers));
  if (Array.isArray(headers)) return buildOrgHeaders(orgId, Object.fromEntries(headers));
  return buildOrgHeaders(orgId, headers);
}

async function fetchOrgJson<T>(
  orgId: string,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  fallbackMessage: string,
  schema: ApiJsonSchema<T>,
) {
  const response = await fetch(input, {
    ...init,
    headers: buildUatRequestHeaders(orgId, init?.headers),
  });

  return readApiJson<T>(response, { fallbackMessage, schema });
}

export function UatContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const {
    clearErrors: clearFeedbackFormErrors,
    control: feedbackFormControl,
    getValues: getFeedbackFormValues,
    handleSubmit: handleSubmitFeedbackForm,
    register: registerFeedbackField,
    resetField: resetFeedbackField,
    formState: { errors: feedbackFormErrors },
  } = useForm<UatFeedbackForm>({
    defaultValues: UAT_FEEDBACK_FORM_DEFAULTS,
  });
  const watchedFeedback = useWatch({
    control: feedbackFormControl,
    name: 'feedback',
    defaultValue: UAT_FEEDBACK_FORM_DEFAULTS.feedback,
  });
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, UatFeedbackDraft>>({});
  const feedbackContinuationInFlightRef = useRef(false);

  const feedbackQuery = useInfiniteQuery({
    queryKey: ['uat-feedback', orgId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchOrgJson<UatFeedbackListPage>(
        orgId,
        pageParam
          ? `/api/admin/uat-feedback?cursor=${encodeURIComponent(pageParam)}`
          : '/api/admin/uat-feedback',
        undefined,
        UAT_FEEDBACK_LIST_ERROR,
        uatFeedbackListResponseSchema,
      ),
    getNextPageParam: getNextUatFeedbackCursor,
    enabled: !!orgId,
  });
  const readinessQuery = useQuery({
    queryKey: ['pilot-readiness', orgId],
    queryFn: () =>
      fetchOrgJson<{ data: PilotReadinessData }>(
        orgId,
        '/api/admin/pilot-readiness',
        undefined,
        'pilot readiness の取得に失敗しました',
        pilotReadinessResponseSchema,
      ),
    enabled: !!orgId,
  });
  const summaryQuery = useQuery({
    queryKey: ['uat-feedback-summary', orgId],
    queryFn: () =>
      fetchOrgJson<{ data: UatFeedbackSummaryData }>(
        orgId,
        '/api/admin/uat-feedback/summary',
        undefined,
        'UAT 集計の取得に失敗しました',
        uatFeedbackSummaryResponseSchema,
      ),
    enabled: !!orgId,
  });
  const collaboratorsQuery = useQuery({
    queryKey: ['uat-feedback-collaborators', orgId],
    queryFn: () =>
      fetchOrgJson<{ data: CollaboratorOption[] }>(
        orgId,
        '/api/pharmacists?include_collaborators=true',
        undefined,
        '担当候補の取得に失敗しました',
        collaboratorOptionsResponseSchema,
      ),
    enabled: !!orgId,
  });
  const orgAuditQuery = useQuery({
    queryKey: ['pilot-org-audit', orgId],
    queryFn: () =>
      fetchOrgJson<{ data: PilotOrgAuditData }>(
        orgId,
        '/api/admin/pilot-org-audit',
        undefined,
        'pilot org audit の取得に失敗しました',
        pilotOrgAuditResponseSchema,
      ),
    enabled: !!orgId,
  });
  const dossierQuery = useQuery({
    queryKey: ['pilot-launch-dossier', orgId],
    queryFn: () =>
      fetchOrgJson<{ data: PilotLaunchDossierData }>(
        orgId,
        '/api/admin/pilot-launch-dossier',
        undefined,
        'pilot launch dossier の取得に失敗しました',
        pilotLaunchDossierResponseSchema,
      ),
    enabled: !!orgId,
  });

  const feedbackItems: UatFeedbackItem[] = [];
  const feedbackIds = new Set<string>();
  for (const page of feedbackQuery.data?.pages ?? []) {
    for (const item of page.data) {
      if (feedbackIds.has(item.id)) continue;
      feedbackIds.add(item.id);
      feedbackItems.push(item);
    }
  }
  const feedbackInitialError = feedbackQuery.isError && feedbackItems.length === 0;
  const feedbackCursorCycle = hasRepeatedUatFeedbackCursor(
    feedbackQuery.data?.pages ?? [],
    feedbackQuery.data?.pageParams ?? [],
  );
  const feedbackStatusText =
    feedbackItems.length === 0
      ? ''
      : feedbackQuery.hasNextPage && !feedbackCursorCycle
        ? `${feedbackItems.length}件読み込み済みです。未読込があります。`
        : `保存済みフィードバックを${feedbackItems.length}件読み込みました。`;

  const requestNextFeedbackPage = () => {
    if (feedbackContinuationInFlightRef.current) return;

    feedbackContinuationInFlightRef.current = true;
    const releaseContinuation = () => {
      feedbackContinuationInFlightRef.current = false;
    };
    try {
      void Promise.resolve(feedbackQuery.fetchNextPage()).then(
        releaseContinuation,
        releaseContinuation,
      );
    } catch {
      releaseContinuation();
    }
  };

  const submitMutation = useMutation({
    mutationFn: () => {
      const currentFeedbackForm = getFeedbackFormValues();
      return fetchOrgJson<{ data: UatFeedbackItem }>(
        orgId,
        '/api/admin/uat-feedback',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            priority: currentFeedbackForm.priority,
            feedback: currentFeedbackForm.feedback.trim(),
            checklist_progress: `${checkedCount}/${totalItems}`,
            checked_items: Array.from(checked),
            source: 'pilot_pharmacy',
          }),
        },
        'UAT フィードバックの送信に失敗しました',
        uatFeedbackResponseSchema,
      );
    },
    onSuccess: async () => {
      toast.success('フィードバックを保存しました');
      resetFeedbackField('feedback');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['uat-feedback', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['uat-feedback-summary', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['pilot-readiness', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['pilot-launch-dossier', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, 'UAT フィードバックの送信に失敗しました'));
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: UatFeedbackDraft }) =>
      fetchOrgJson<{ data: UatFeedbackItem }>(
        orgId,
        `/api/admin/uat-feedback/${id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: draft.status,
            owner_user_id: draft.owner_user_id || null,
            linked_work_item: draft.linked_work_item.trim() || null,
            due_date: draft.due_date ? new Date(draft.due_date).toISOString() : null,
          }),
        },
        'UAT フィードバックの更新に失敗しました',
        uatFeedbackResponseSchema,
      ),
    onSuccess: async () => {
      toast.success('フィードバックの triage 状態を更新しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['uat-feedback', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['uat-feedback-summary', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['pilot-readiness', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['pilot-launch-dossier', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, 'UAT フィードバックの更新に失敗しました'));
    },
  });

  const totalItems = UAT_CHECKLIST.reduce((acc, s) => acc + s.items.length, 0);
  const checkedCount = checked.size;
  const readiness = readinessQuery.data?.data;
  const summary = summaryQuery.data?.data;
  const orgAudit = orgAuditQuery.data?.data;
  const dossier = dossierQuery.data?.data;
  const collaborators = dedupeCollaboratorOptions(collaboratorsQuery.data?.data ?? []);
  const feedbackError =
    typeof feedbackFormErrors.feedback?.message === 'string'
      ? feedbackFormErrors.feedback.message
      : null;
  const feedbackIsBlank = !watchedFeedback.trim();
  const feedbackDescriptionId = feedbackError
    ? UAT_FEEDBACK_ERROR_ID
    : feedbackIsBlank
      ? UAT_FEEDBACK_HELP_ID
      : undefined;

  const priorityLabelByValue = new Map<string, string>(
    UAT_PRIORITY_OPTIONS.map((option) => [option.value, option.label] as const),
  );
  const statusLabelByValue = new Map<string, string>(
    UAT_STATUS_OPTIONS.map((option) => [option.value, option.label] as const),
  );
  const feedbackField = registerFeedbackField('feedback', {
    validate: (value) => value.trim() !== '' || UAT_FEEDBACK_REQUIRED_MESSAGE,
  });

  function getDraft(item: UatFeedbackItem): UatFeedbackDraft {
    return feedbackDrafts[item.id] ?? createUatFeedbackDraft(item);
  }

  function updateDraft(item: UatFeedbackItem, patch: Partial<UatFeedbackDraft>) {
    setFeedbackDrafts((prev) => ({
      ...prev,
      [item.id]: mergeUatFeedbackDraft({
        item,
        currentDraft: prev[item.id],
        patch,
      }),
    }));
  }

  function isDraftDirty(item: UatFeedbackItem) {
    return isUatFeedbackDraftDirty({
      item,
      draft: getDraft(item),
    });
  }

  function toggleItem(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function submitFeedbackForm() {
    await submitMutation.mutateAsync();
  }

  const handleSubmitFeedback = handleSubmitFeedbackForm(submitFeedbackForm);

  async function handleUpdateFeedback(item: UatFeedbackItem) {
    await updateMutation.mutateAsync({
      id: item.id,
      draft: getDraft(item),
    });
  }

  return (
    <div className="space-y-8">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Pilot Launch Dossier</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {dossierQuery.isLoading ? (
            <LoadingRows label="ローンチ前提を読み込み中" rows={4} />
          ) : dossierQuery.error ? (
            <SegmentError
              title="ローンチ前提を取得できませんでした"
              cause="Pilot Launch Dossier を表示できません。"
              nextAction="通信状態を確認して再読み込みしてください。"
              onRetry={() => void dossierQuery.refetch()}
              retryLabel="再試行"
            />
          ) : dossier ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Phase 2 開始判断</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {dossier.readiness.decisions.phase2_entry === 'ready' ? '進行可能' : '要修正'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    集計時刻 {new Date(dossier.generated_at).toLocaleString('ja-JP')}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">UAT / カバレッジ</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    blocker {dossier.uat_summary.blocker_count} / flagged{' '}
                    {dossier.org_audit.coverage.flagged_patient_count}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    圏外 {dossier.org_audit.coverage.uncovered_count} / 要確認{' '}
                    {dossier.org_audit.coverage.review_required_count}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">外部前提</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    PMDA {dossier.external_readiness.pmda.ready_for_import_test ? 'ok' : 'pending'}
                    {' / '}
                    Backup{' '}
                    {dossier.external_readiness.backup.ready_for_live_drill ? 'ready' : 'pending'}
                    {' / '}
                    ISMS{' '}
                    {dossier.external_readiness.isms.ready_for_quote_request
                      ? 'docs ok'
                      : 'pending'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    drill 記録 {dossier.external_readiness.backup.recorded_runs.length} 件
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">pilot 方針</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    facility {dossier.readiness.decisions.facility_batching}
                    {' / '}
                    set {dossier.readiness.decisions.medication_set_workflow}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    UAT {dossier.uat_summary.total_feedback} 件
                    {dossier.org_audit.coverage.flagged_patients_truncated
                      ? ' / flagged preview truncated'
                      : ''}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">統合アクション</p>
                <ul className="space-y-2">
                  {dossier.recommendations.map((item) => (
                    <li
                      key={item}
                      className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {readiness ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Pilot Readiness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">施設患者</p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {readiness.case_summary.facility_linked_case_count} /{' '}
                  {readiness.case_summary.active_case_count}
                </p>
                <p className="text-xs text-muted-foreground">
                  施設数 {readiness.case_summary.facility_count}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">セット pilot 対象</p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {readiness.case_summary.set_pilot_case_count} 件
                </p>
                <p className="text-xs text-muted-foreground">
                  施設紐付けなし {readiness.case_summary.set_pilot_without_facility_count} 件
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">UAT blocker</p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {readiness.uat_summary.blocker_count} 件
                </p>
                <p className="text-xs text-muted-foreground">
                  critical {readiness.uat_summary.critical_count} / high{' '}
                  {readiness.uat_summary.high_count}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Phase 2 開始判断</p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {readiness.decisions.phase2_entry === 'ready' ? '進行可能' : '要修正'}
                </p>
                <p className="text-xs text-muted-foreground">
                  集計時刻 {new Date(readiness.generated_at).toLocaleString('ja-JP')}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">推奨アクション</p>
              <ul className="space-y-2">
                {readiness.recommendations.map((item) => (
                  <li
                    key={item}
                    className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {readiness.uat_summary.recent_feedback.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">直近フィードバック</p>
                <ul className="space-y-2">
                  {readiness.uat_summary.recent_feedback.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs"
                    >
                      <p className="font-medium text-foreground">
                        [{item.priority}] {item.feedback}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {item.checklist_progress ?? '進捗未入力'} /{' '}
                        {new Date(item.created_at).toLocaleString('ja-JP')}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">UAT Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {summaryQuery.isLoading ? (
            <LoadingRows label="UAT集計を読み込み中" rows={4} />
          ) : summaryQuery.error ? (
            <SegmentError
              title="UAT集計を取得できませんでした"
              cause="フィードバック集計を表示できません。"
              nextAction="通信状態を確認して再読み込みしてください。"
              onRetry={() => void summaryQuery.refetch()}
              retryLabel="再試行"
            />
          ) : summary ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">総フィードバック</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {summary.total_feedback} 件
                  </p>
                  <p className="text-xs text-muted-foreground">
                    集計時刻 {new Date(summary.generated_at).toLocaleString('ja-JP')}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">未解消 blocker</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {summary.blocker_count} 件
                  </p>
                  <p className="text-xs text-muted-foreground">
                    critical {summary.priorities.critical} / high {summary.priorities.high}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-4">
                {UAT_PRIORITY_OPTIONS.map((option) => (
                  <div
                    key={option.value}
                    className="rounded-md border border-border/70 bg-background px-3 py-2"
                  >
                    <p className="text-xs text-muted-foreground">{option.label}</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {summary.priorities[option.value]}
                    </p>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">推奨アクション</p>
                <ul className="space-y-2">
                  {summary.recommendations.map((item) => (
                    <li
                      key={item}
                      className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">優先 action items</p>
                {summary.action_items.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
                    critical/high の未解消項目はありません。
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {summary.action_items.map((item) => (
                      <li
                        key={item.id}
                        className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs"
                      >
                        <p className="font-medium text-foreground">
                          [{priorityLabelByValue.get(item.priority) ?? item.priority}]{' '}
                          {item.feedback}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          状態 {statusLabelByValue.get(item.status) ?? item.status} /{' '}
                          {item.checklist_progress ?? '進捗未入力'} /{' '}
                          {new Date(item.created_at).toLocaleString('ja-JP')}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Target Pharmacy Audit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {orgAuditQuery.isLoading ? (
            <LoadingRows label="監査サマリーを読み込み中" rows={4} />
          ) : orgAuditQuery.error ? (
            <SegmentError
              title="監査サマリーを取得できませんでした"
              cause="Target Pharmacy Audit を表示できません。"
              nextAction="通信状態を確認して再読み込みしてください。"
              onRetry={() => void orgAuditQuery.refetch()}
              retryLabel="再試行"
            />
          ) : orgAudit ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">店舗構成</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {orgAudit.org_structure.site_count} 店舗 /{' '}
                    {orgAudit.org_structure.active_member_count} 名
                  </p>
                  <p className="text-xs text-muted-foreground">
                    集計時刻 {new Date(orgAudit.generated_at).toLocaleString('ja-JP')}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">訪問カバレッジ</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    area {orgAudit.coverage.service_area_covered_count} / 16km{' '}
                    {orgAudit.coverage.radius_16km_covered_count}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    圏外 {orgAudit.coverage.uncovered_count} / 要確認{' '}
                    {orgAudit.coverage.review_required_count} / flagged{' '}
                    {orgAudit.coverage.flagged_patient_count}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">pilot 対象</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    active {orgAudit.pilot_targets.active_case_count} / facility{' '}
                    {orgAudit.pilot_targets.facility_linked_case_count}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    set pilot {orgAudit.pilot_targets.set_pilot_case_count}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">ロール内訳</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {Object.entries(orgAudit.org_structure.role_counts)
                      .map(([role, count]) => `${role}:${count}`)
                      .join(' / ') || '未登録'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    `pnpm pilot:org-audit -- --org &lt;org_id&gt;` と同じ集計
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">店舗別 breakdown</p>
                <ul className="space-y-2">
                  {orgAudit.org_structure.site_breakdown.map((site) => (
                    <li
                      key={site.site_id}
                      className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground"
                    >
                      {site.site_name}: active members {site.active_member_count} / service areas{' '}
                      {site.service_area_count} / geo {site.has_geo ? 'ok' : 'missing'}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">監査メモ</p>
                <ul className="space-y-2">
                  {orgAudit.recommendations.map((item) => (
                    <li
                      key={item}
                      className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {orgAudit.coverage.flagged_patients.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-foreground">要確認患者</p>
                  {orgAudit.coverage.flagged_patients_truncated ? (
                    <p className="text-xs text-muted-foreground">
                      表示は先頭 20 件のみです。CLI で残件を確認してください。
                    </p>
                  ) : null}
                  <ul className="space-y-2">
                    {orgAudit.coverage.flagged_patients.map((patient) => (
                      <li
                        key={patient.patient_id}
                        className="rounded-md border border-border/70 bg-background px-3 py-2 text-xs"
                      >
                        <p className="font-medium text-foreground">{patient.patient_name}</p>
                        <p className="mt-1 text-muted-foreground">
                          {patient.reason} / {patient.address}
                          {patient.nearest_site_name
                            ? ` / nearest ${patient.nearest_site_name}`
                            : ''}
                          {patient.nearest_site_distance_km != null
                            ? ` / ${patient.nearest_site_distance_km}km`
                            : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Progress */}
      <div className="flex items-center gap-3">
        <SegmentedProgressBar value={checkedCount} max={totalItems} className="h-2 flex-1" />
        <span className="text-sm tabular-nums text-muted-foreground">
          {checkedCount} / {totalItems} 完了
        </span>
      </div>

      {/* Checklist */}
      <div className="space-y-6">
        {UAT_CHECKLIST.map((section) => (
          <Card key={section.title} size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-semibold">{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {section.items.map((item) => {
                  const isChecked = checked.has(item.id);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => toggleItem(item.id)}
                        className="flex w-full items-start gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-pressed={isChecked}
                      >
                        {isChecked ? (
                          <CheckSquare
                            className="mt-0.5 size-5 shrink-0 text-primary"
                            aria-hidden="true"
                          />
                        ) : (
                          <Square
                            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className={`text-sm leading-relaxed ${
                            isChecked ? 'text-muted-foreground line-through' : 'text-foreground'
                          }`}
                        >
                          {item.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <Separator />

      {/* Feedback form */}
      <form className="space-y-4" onSubmit={handleSubmitFeedback} noValidate>
        <h2 className="text-base font-semibold text-foreground">フィードバック送信</h2>

        <div className="space-y-1">
          <Label htmlFor="feedback_priority">優先度</Label>
          <Controller
            control={feedbackFormControl}
            name="priority"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(value) => {
                  if (!value) return;
                  field.onChange(value as UatFeedbackForm['priority']);
                }}
              >
                <SelectTrigger id="feedback_priority" className="w-48">
                  <SelectValue>{priorityLabelByValue.get(field.value) ?? field.value}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {UAT_PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="feedback_text">フィードバック内容</Label>
          <Textarea
            id="feedback_text"
            {...feedbackField}
            onChange={(event) => {
              void feedbackField.onChange(event);
              if (feedbackError && event.target.value.trim()) {
                clearFeedbackFormErrors('feedback');
              }
            }}
            aria-invalid={feedbackError ? true : undefined}
            aria-describedby={feedbackDescriptionId}
            rows={5}
            placeholder="問題の内容・再現手順・改善提案などを記入してください"
            className="resize-none"
          />
          {feedbackError ? (
            <p id={UAT_FEEDBACK_ERROR_ID} role="alert" className="text-sm text-destructive">
              {feedbackError}
            </p>
          ) : feedbackIsBlank ? (
            <p id={UAT_FEEDBACK_HELP_ID} className="text-xs text-muted-foreground">
              {UAT_FEEDBACK_HELP_MESSAGE}
            </p>
          ) : null}
        </div>

        <Button
          type="submit"
          disabled={submitMutation.isPending || feedbackIsBlank}
          aria-describedby={feedbackDescriptionId}
        >
          <Send className="mr-2 size-4" aria-hidden="true" />
          {submitMutation.isPending ? '送信中...' : 'フィードバックを送信'}
        </Button>
      </form>

      <Separator />

      <div className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">保存済みフィードバック</h2>
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={feedbackStatusText ? 'text-xs text-muted-foreground' : 'sr-only'}
        >
          {feedbackStatusText}
        </p>
        {feedbackQuery.isLoading ? (
          <LoadingRows label="保存済みフィードバックを読み込み中" rows={3} />
        ) : feedbackInitialError ? (
          <SegmentError
            title="保存済みフィードバックを取得できませんでした"
            cause="保存済みフィードバック一覧を表示できません。"
            nextAction="通信状態を確認して再読み込みしてください。"
            onRetry={() => void feedbackQuery.refetch()}
            retryLabel="再試行"
          />
        ) : feedbackItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだ保存済みフィードバックはありません。</p>
        ) : (
          <div className="space-y-3">
            {feedbackItems.map((item) => (
              <Card key={item.id} size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {priorityLabelByValue.get(item.priority) ?? item.priority}
                      {' · '}
                      {statusLabelByValue.get(item.status) ?? item.status}
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {new Date(item.created_at).toLocaleString('ja-JP')}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <p className="whitespace-pre-wrap text-foreground">{item.feedback}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>進捗: {item.checklist_progress ?? '未記録'}</span>
                    <span>チェック項目: {item.checked_items.length}</span>
                    <span>source: {item.source ?? 'unknown'}</span>
                    {item.resolved_at ? (
                      <span>解決日時: {new Date(item.resolved_at).toLocaleString('ja-JP')}</span>
                    ) : null}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor={`feedback-status-${item.id}`}>状態</Label>
                      <Select
                        value={getDraft(item).status}
                        onValueChange={(value) => {
                          if (!value) return;
                          updateDraft(item, { status: value });
                        }}
                      >
                        <SelectTrigger id={`feedback-status-${item.id}`}>
                          <SelectValue>
                            {statusLabelByValue.get(getDraft(item).status) ?? getDraft(item).status}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {UAT_STATUS_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`feedback-owner-${item.id}`}>担当者</Label>
                      <Select
                        value={getDraft(item).owner_user_id || '__unassigned__'}
                        onValueChange={(value) => {
                          if (!value) return;
                          updateDraft(item, {
                            owner_user_id: value === '__unassigned__' ? '' : value,
                          });
                        }}
                      >
                        <SelectTrigger id={`feedback-owner-${item.id}`}>
                          <SelectValue>
                            {getDraft(item).owner_user_id
                              ? (collaborators.find((c) => c.id === getDraft(item).owner_user_id)
                                  ?.name ?? '選択済み')
                              : '未割当'}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unassigned__">未割当</SelectItem>
                          {collaborators.map((collaborator) => (
                            <SelectItem key={collaborator.id} value={collaborator.id}>
                              {collaborator.name} ({collaborator.role})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {collaboratorsQuery.error ? (
                        <SegmentError
                          title="担当候補を取得できませんでした"
                          cause="担当者候補を表示できません。"
                          nextAction="通信状態を確認して再読み込みしてください。"
                          onRetry={() => void collaboratorsQuery.refetch()}
                          retryLabel="再試行"
                          className="mt-2"
                        />
                      ) : null}
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`feedback-work-item-${item.id}`}>関連 work item</Label>
                      <Input
                        id={`feedback-work-item-${item.id}`}
                        value={getDraft(item).linked_work_item}
                        onChange={(event) =>
                          updateDraft(item, { linked_work_item: event.target.value })
                        }
                        placeholder="例: CVX-102"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`feedback-due-date-${item.id}`}>期限</Label>
                      <Input
                        id={`feedback-due-date-${item.id}`}
                        type="date"
                        value={getDraft(item).due_date}
                        onChange={(event) => updateDraft(item, { due_date: event.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {getDraft(item).owner_user_id
                        ? `担当: ${
                            collaborators.find(
                              (collaborator) => collaborator.id === getDraft(item).owner_user_id,
                            )?.name ?? '選択済み'
                          }`
                        : '担当未割当'}
                      {' / '}
                      {getDraft(item).due_date ? `期限 ${getDraft(item).due_date}` : '期限未設定'}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={updateMutation.isPending || !isDraftDirty(item)}
                      onClick={() => handleUpdateFeedback(item)}
                    >
                      {updateMutation.isPending ? '保存中...' : 'triage を保存'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {feedbackCursorCycle ? (
              <SegmentError
                title="続きの読み込み位置が重複したため、追加読み込みを停止しました"
                cause="読み込み済みのフィードバックは保持しています。"
                nextAction="一覧を再読み込みしてください。"
                onRetry={() => void feedbackQuery.refetch()}
                retryLabel="一覧を再読み込み"
              />
            ) : feedbackQuery.isFetchNextPageError ? (
              <SegmentError
                title="続きのフィードバックを取得できませんでした"
                cause="読み込み済みのフィードバックは保持しています。"
                nextAction="通信状態を確認して、続きの取得を再試行してください。"
                onRetry={requestNextFeedbackPage}
                retryLabel="続きを再試行"
              />
            ) : null}
            {feedbackQuery.hasNextPage &&
            !feedbackQuery.isFetchNextPageError &&
            !feedbackCursorCycle ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full sm:w-auto"
                disabled={feedbackQuery.isFetchingNextPage}
                onClick={requestNextFeedbackPage}
              >
                {feedbackQuery.isFetchingNextPage ? '追加読込中…' : 'さらに読み込む'}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
