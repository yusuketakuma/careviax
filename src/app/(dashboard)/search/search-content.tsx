'use client';

/**
 * p0_05「全体検索」ページ本体。
 * 180ms デバウンス + AbortController + Promise.all で 6 カテゴリを並列 fetch。
 * チップ切替は再 fetch なしに選択カテゴリの結果のみ表示(全件取得済みの配列から表示)。
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterChipBar } from '@/components/features/workspace/filter-chip-bar';
import { ListOpenCard } from '@/components/features/workspace/list-open-card';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { messageFromError } from '@/lib/utils/error-message';
import { AdvancedFilterModal } from './advanced-filter-modal';
import { type AdvancedFilterState, EMPTY_ADVANCED_FILTER } from './advanced-filter.shared';
import {
  type SearchCategory,
  type SearchResultRow,
  type PatientSearchItem,
  type ScheduleProposalSearchItem,
  type PrescriptionSearchItem,
  type MedicationDeadlineSearchItem,
  type DrugSearchItem,
  type FacilitySearchItem,
  type ReportSearchItem,
  type ContactSearchItem,
  SEARCH_CATEGORY_LABELS,
  SEARCH_CATEGORY_BADGE_CLASSES,
  buildPatientResult,
  buildScheduleProposalResult,
  buildPrescriptionResult,
  buildMedicationDeadlineResult,
  buildDrugResult,
  buildFacilityResult,
  buildReportResult,
  buildContactResult,
} from './search-result-builders';

const SEARCH_CATEGORIES: SearchCategory[] = [
  'patient',
  'proposal',
  'prescription',
  'medicationDeadline',
  'drug',
  'facility',
  'report',
  'contact',
];

const SEARCH_RESULT_LIMIT = 8;

type CategoryCounts = Partial<Record<SearchCategory, number>>;

type AllResults = Record<SearchCategory, SearchResultRow[]>;

const EMPTY_ALL_RESULTS: AllResults = {
  patient: [],
  proposal: [],
  prescription: [],
  medicationDeadline: [],
  drug: [],
  facility: [],
  report: [],
  contact: [],
};

type Pharmacist = { id: string; name: string };

type SearchContentProps = {
  initialQuery?: string;
  initialCategory?: SearchCategory;
};

function perfNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// PHI-safe, opt-in client-side measurement for /search performance work.
// Enable with NEXT_PUBLIC_DEBUG_SEARCH_PERF=true or localStorage.DEBUG_SEARCH_PERF=true.
function isSearchPerfTraceEnabled() {
  if (process.env.NEXT_PUBLIC_DEBUG_SEARCH_PERF === 'true') return true;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('DEBUG_SEARCH_PERF') === 'true';
  } catch {
    return false;
  }
}

function classifySearchFetchMode(url: string) {
  if (url.includes('view=palette')) return 'palette';
  if (
    url.includes('/api/patients') ||
    url.includes('/api/visit-schedule-proposals') ||
    url.includes('/api/care-reports')
  ) {
    return url.includes('limit=') ? 'full-bounded' : 'full';
  }
  if (url.includes('limit=')) return 'bounded';
  return 'full';
}

function countSearchPayloadItems(payload: unknown) {
  const data = (payload as { data?: unknown }).data;
  if (Array.isArray(data)) return data.length;

  const medicationDeadlinePayload = payload as {
    critical?: { items?: unknown[] };
    warning?: { items?: unknown[] };
  };
  if (medicationDeadlinePayload.critical || medicationDeadlinePayload.warning) {
    return (
      (medicationDeadlinePayload.critical?.items?.length ?? 0) +
      (medicationDeadlinePayload.warning?.items?.length ?? 0)
    );
  }

  return 0;
}

function estimateSearchPayloadBytes(payload: unknown) {
  try {
    return JSON.stringify(payload).length;
  } catch {
    return null;
  }
}

function traceSearchPerf(
  step: 'fetch' | 'json',
  category: SearchCategory,
  details: {
    elapsedMs: number;
    mode?: string;
    ok?: boolean;
    status?: number;
    itemCount?: number;
    payloadBytes?: number | null;
  },
) {
  if (!isSearchPerfTraceEnabled()) return;
  const parts = [
    '[PERF_TRACE]',
    'component=SearchContent',
    `step=${step}`,
    `category=${category}`,
    `elapsed_ms=${details.elapsedMs.toFixed(1)}`,
  ];
  if (details.mode) parts.push(`mode=${details.mode}`);
  if (details.ok !== undefined) parts.push(`ok=${details.ok ? 'true' : 'false'}`);
  if (details.status !== undefined) parts.push(`status=${details.status}`);
  if (details.itemCount !== undefined) parts.push(`item_count=${details.itemCount}`);
  if (details.payloadBytes !== undefined && details.payloadBytes !== null) {
    parts.push(`payload_bytes=${details.payloadBytes}`);
  }
  console.info(parts.join(' '));
}

async function fetchSearchCategory(
  category: SearchCategory,
  url: string,
  init: RequestInit,
): Promise<Response | null> {
  const startedAt = perfNow();
  const mode = classifySearchFetchMode(url);
  try {
    const response = await fetch(url, init);
    traceSearchPerf('fetch', category, {
      elapsedMs: perfNow() - startedAt,
      mode,
      ok: response.ok,
      status: response.status,
    });
    return response;
  } catch {
    traceSearchPerf('fetch', category, {
      elapsedMs: perfNow() - startedAt,
      mode,
      ok: false,
    });
    return null;
  }
}

async function readSearchJson<T>(category: SearchCategory, response: Response | null) {
  if (!response?.ok) return null;
  const startedAt = perfNow();
  const payload = (await response.json()) as T;
  traceSearchPerf('json', category, {
    elapsedMs: perfNow() - startedAt,
    itemCount: countSearchPayloadItems(payload),
    payloadBytes: isSearchPerfTraceEnabled() ? estimateSearchPayloadBytes(payload) : null,
  });
  return payload;
}

export function SearchContent({
  initialQuery = '',
  initialCategory = 'patient',
}: SearchContentProps) {
  const orgId = useOrgId();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<SearchCategory>(initialCategory);
  const [allResults, setAllResults] = useState<AllResults>(EMPTY_ALL_RESULTS);
  const [counts, setCounts] = useState<CategoryCounts>({});
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [failedCategories, setFailedCategories] = useState<SearchCategory[]>([]);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [advancedFilter, setAdvancedFilter] = useState<AdvancedFilterState>(EMPTY_ADVANCED_FILTER);
  const [pharmacists, setPharmacists] = useState<Pharmacist[]>([]);

  // 担当者選択肢を一度だけ取得
  useEffect(() => {
    if (!orgId) return;
    // unmount/orgId変更で in-flight を中断し、teardown後の setState と stale 上書きを防ぐ
    const controller = new AbortController();
    void fetch('/api/pharmacists', { headers: buildOrgHeaders(orgId), signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { data?: Array<{ user: { id: string; name: string } }> } | null) => {
        if (!payload?.data) return;
        setPharmacists(payload.data.map((m) => ({ id: m.user.id, name: m.user.name })));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [orgId]);

  const handleCategoryChange = useCallback(
    (next: SearchCategory) => {
      setCategory(next);
      const params = new URLSearchParams(searchParams.toString());
      if (query) {
        params.set('q', query);
      } else {
        params.delete('q');
      }
      params.set('category', next);
      router.replace(`/search?${params.toString()}`, { scroll: false });
    },
    [query, router, searchParams],
  );

  // 検索 effect — 180ms デバウンス + AbortController + Promise.all
  useEffect(() => {
    const normalized = query.trim();
    const controller = new AbortController();

    // クエリが空のとき状態クリアは debounce timeout で行う(setState 同期呼び出しを避ける)
    const timeoutId = window.setTimeout(async () => {
      if (!normalized) {
        setAllResults(EMPTY_ALL_RESULTS);
        setCounts({});
        setSearchError(null);
        setFailedCategories([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setSearchError(null);
      setFailedCategories([]);

      try {
        const q = encodeURIComponent(normalized);
        const headers: HeadersInit = orgId ? buildOrgHeaders(orgId) : {};
        const sig = controller.signal;
        const requestInit = { headers, signal: sig };

        // 接続可能な詳細絞り込み条件を既存 API に AND 合成(第一版)
        const visitScheduleParams = new URLSearchParams({ q: normalized });
        visitScheduleParams.set('view', 'palette');
        visitScheduleParams.set('limit', String(SEARCH_RESULT_LIMIT));
        if (advancedFilter.assigneeId) {
          visitScheduleParams.set('pharmacist_id', advancedFilter.assigneeId);
        }
        if (advancedFilter.visitDateRange) {
          const { from, to } = resolveDateRange(advancedFilter.visitDateRange);
          visitScheduleParams.set('date_from', from);
          visitScheduleParams.set('date_to', to);
        }
        if (advancedFilter.proposalStatus) {
          visitScheduleParams.set('status', advancedFilter.proposalStatus);
        }
        const medicationDeadlineParams = new URLSearchParams();
        if (advancedFilter.medicationDeadlineWithinDays != null) {
          medicationDeadlineParams.set(
            'within_days',
            String(advancedFilter.medicationDeadlineWithinDays),
          );
          medicationDeadlineParams.set('q', normalized);
          medicationDeadlineParams.set('limit', String(SEARCH_RESULT_LIMIT));
        }
        const cycleStatusParam = advancedFilter.cycleStatus
          ? `&status=${encodeURIComponent(advancedFilter.cycleStatus)}`
          : '';
        const careTagsParam =
          advancedFilter.careTags.length > 0
            ? `&care_tags=${encodeURIComponent(advancedFilter.careTags.join(','))}`
            : '';

        const [
          patientRes,
          proposalRes,
          prescriptionRes,
          medicationDeadlineRes,
          drugRes,
          facilityRes,
          reportRes,
          contactRes,
        ] = await Promise.all([
          fetchSearchCategory(
            'patient',
            `/api/patients?view=search&archive_status=active&q=${q}&limit=${SEARCH_RESULT_LIMIT}`,
            {
              headers,
              signal: sig,
            },
          ),
          fetchSearchCategory(
            'proposal',
            `/api/visit-schedule-proposals?${visitScheduleParams.toString()}`,
            requestInit,
          ),
          // prescription-intakes の q は API 側未実装(source_type/status のみ対応)のため
          // クライアント側で patient.name による前方一致フィルタを補完する。
          // 将来 API 側 q 実装時にフィルタ除去可。
          fetchSearchCategory(
            'prescription',
            `/api/prescription-intakes?q=${q}&limit=${SEARCH_RESULT_LIMIT}${cycleStatusParam}${careTagsParam}`,
            requestInit,
          ),
          advancedFilter.medicationDeadlineWithinDays != null
            ? fetchSearchCategory(
                'medicationDeadline',
                `/api/dashboard/medication-deadlines?${medicationDeadlineParams.toString()}`,
                requestInit,
              )
            : Promise.resolve(null),
          fetchSearchCategory('drug', `/api/drug-masters?q=${q}&limit=${SEARCH_RESULT_LIMIT}`, {
            signal: sig,
          }),
          fetchSearchCategory('facility', `/api/facilities?q=${q}&limit=${SEARCH_RESULT_LIMIT}`, {
            headers,
            signal: sig,
          }),
          fetchSearchCategory(
            'report',
            `/api/care-reports?view=palette&q=${q}&limit=${SEARCH_RESULT_LIMIT}`,
            {
              headers,
              signal: sig,
            },
          ),
          fetchSearchCategory(
            'contact',
            `/api/contact-profiles?q=${q}&limit=${SEARCH_RESULT_LIMIT}`,
            requestInit,
          ),
        ]);

        if (sig.aborted) return;

        const nextFailedCategories: SearchCategory[] = [];
        const noteFailure = (
          searchCategory: SearchCategory,
          response: Response | null,
          attempted = true,
        ) => {
          if (attempted && (!response || !response.ok)) {
            nextFailedCategories.push(searchCategory);
          }
        };

        noteFailure('patient', patientRes);
        noteFailure('proposal', proposalRes);
        noteFailure('prescription', prescriptionRes);
        noteFailure(
          'medicationDeadline',
          medicationDeadlineRes,
          advancedFilter.medicationDeadlineWithinDays != null,
        );
        noteFailure('drug', drugRes);
        noteFailure('facility', facilityRes);
        noteFailure('report', reportRes);
        noteFailure('contact', contactRes);

        const patientPayload = await readSearchJson<{ data: PatientSearchItem[] }>(
          'patient',
          patientRes,
        );
        const patientData = patientPayload?.data ?? [];

        const proposalPayload = await readSearchJson<{ data: ScheduleProposalSearchItem[] }>(
          'proposal',
          proposalRes,
        );
        const proposalData = proposalPayload?.data ?? [];

        // prescription-intakes の API 側 q 未対応のためクライアントフィルタで補完
        const prescriptionPayload = await readSearchJson<{ data: PrescriptionSearchItem[] }>(
          'prescription',
          prescriptionRes,
        );
        const prescriptionRaw = prescriptionPayload?.data ?? [];
        const prescriptionData = prescriptionRaw.filter((item) => {
          const patientName = item.cycle?.case_?.patient?.name ?? '';
          return patientName.includes(normalized) || normalized.length === 0;
        });

        const medicationDeadlinePayload = await readSearchJson<{
          critical?: { items?: MedicationDeadlineSearchItem[] };
          warning?: { items?: MedicationDeadlineSearchItem[] };
        }>('medicationDeadline', medicationDeadlineRes);
        const medicationDeadlineData = [
          ...(medicationDeadlinePayload?.critical?.items ?? []),
          ...(medicationDeadlinePayload?.warning?.items ?? []),
        ].slice(0, SEARCH_RESULT_LIMIT);

        const drugPayload = await readSearchJson<{ data: DrugSearchItem[] }>('drug', drugRes);
        const drugData = drugPayload?.data ?? [];

        const facilityPayload = await readSearchJson<{ data: FacilitySearchItem[] }>(
          'facility',
          facilityRes,
        );
        const facilityData = facilityPayload?.data ?? [];

        const reportPayload = await readSearchJson<{
          data: Array<ReportSearchItem & { patient?: { name?: string | null } | null }>;
        }>('report', reportRes);
        const reportData = (reportPayload?.data ?? []).slice(0, SEARCH_RESULT_LIMIT);

        const contactPayload = await readSearchJson<{ data: ContactSearchItem[] }>(
          'contact',
          contactRes,
        );
        const contactData = contactPayload?.data ?? [];

        const built: AllResults = {
          patient: patientData.map(buildPatientResult),
          proposal: proposalData.map(buildScheduleProposalResult),
          prescription: prescriptionData.map(buildPrescriptionResult),
          medicationDeadline: medicationDeadlineData.map(buildMedicationDeadlineResult),
          drug: drugData.map(buildDrugResult),
          facility: facilityData.map(buildFacilityResult),
          report: reportData.map((item) => buildReportResult(item, item.patient?.name ?? null)),
          contact: contactData.map(buildContactResult),
        };

        setAllResults(built);
        setFailedCategories(nextFailedCategories);
        setCounts(
          Object.fromEntries(
            SEARCH_CATEGORIES.map((cat) => [cat, built[cat].length]),
          ) as CategoryCounts,
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        setSearchError(messageFromError(err, '検索結果の取得に失敗しました。'));
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [query, orgId, advancedFilter]);

  const visibleItems = allResults[category];
  const hasResults = visibleItems.length > 0;
  const hasSearched = query.trim().length > 0;
  const totalResults = SEARCH_CATEGORIES.reduce((sum, cat) => sum + (counts[cat] ?? 0), 0);
  const selectedCategoryLabel = SEARCH_CATEGORY_LABELS[category];
  const categoriesWithResults = SEARCH_CATEGORIES.filter(
    (cat) => cat !== category && (counts[cat] ?? 0) > 0,
  );
  const resultStatusLabel = hasSearched
    ? `${selectedCategoryLabel} ${visibleItems.length}件 / 全カテゴリ ${totalResults}件`
    : 'キーワード入力待ち';

  const handleApplyFilter = (filter: AdvancedFilterState) => {
    setAdvancedFilter(filter);
  };

  return (
    <div className="w-full space-y-5" data-testid="search-page">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">全体検索</h1>
          <p className="hidden max-w-3xl text-sm leading-6 text-muted-foreground md:block">
            患者・訪問候補・処方・薬切れ・薬剤・施設・報告書・連絡先を横断し、必要なレコードへ直接移動します。
          </p>
        </div>
        <div
          role="status"
          className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-primary/15 bg-primary/10 px-4 text-sm font-semibold text-primary"
        >
          {resultStatusLabel}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <Input
          aria-label="全体検索キーワード"
          data-search-input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="田中 一郎 アムロジピン 施設A などで検索"
          className="h-12 min-h-[44px] text-base sm:h-12 sm:min-h-[44px]"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => setIsAdvancedOpen(true)}
          className="!h-auto !min-h-11 justify-center px-5"
        >
          詳しく絞り込む
        </Button>
      </div>

      <FilterChipBar
        ariaLabel="検索カテゴリの絞り込み"
        value={category}
        onChange={handleCategoryChange}
        options={SEARCH_CATEGORIES.map((cat) => ({
          value: cat,
          label: SEARCH_CATEGORY_LABELS[cat],
          count: counts[cat],
        }))}
      />

      <section aria-labelledby="search-results-title" className="border-t border-border/70 pt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="search-results-title" className="text-lg font-bold text-foreground">
            検索結果
          </h2>
          {isLoading ? (
            <p
              className="text-sm font-medium text-primary"
              role="status"
              aria-label="検索結果を読み込み中"
            >
              検索結果を読み込み中...
            </p>
          ) : null}
        </div>

        {searchError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {searchError}
          </p>
        ) : null}
        {failedCategories.length > 0 && !searchError ? (
          <div
            role="status"
            className="mb-4 flex items-start gap-2 rounded-md border border-state-confirm/30 bg-state-confirm/10 px-3 py-2 text-sm text-state-confirm"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              一部の検索結果を取得できませんでした:{' '}
              {failedCategories.map((cat) => SEARCH_CATEGORY_LABELS[cat]).join('、')}。
              条件を変えずに再検索できます。
            </p>
          </div>
        ) : null}

        {!isLoading && !searchError ? (
          !hasSearched ? (
            <EmptyState
              icon={Search}
              title="キーワードを入力して横断検索"
              description="キーワードを入力すると患者・訪問候補・処方・薬切れ・薬剤・施設・報告書・連絡先を横断して探します。"
            />
          ) : !hasResults && categoriesWithResults.length > 0 ? (
            <div
              role="status"
              className="rounded-lg border border-primary/20 bg-primary/5 p-5"
              data-testid="search-cross-category-hint"
            >
              <p className="text-sm font-semibold text-foreground">
                {selectedCategoryLabel}には一致がありません
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                他カテゴリに {totalResults} 件あります。該当カテゴリへ切り替えて確認してください。
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {categoriesWithResults.map((cat) => (
                  <Button
                    key={cat}
                    type="button"
                    variant="outline"
                    className="!h-auto !min-h-11 px-4"
                    onClick={() => handleCategoryChange(cat)}
                  >
                    {SEARCH_CATEGORY_LABELS[cat]} {counts[cat]}件
                  </Button>
                ))}
              </div>
            </div>
          ) : !hasResults ? (
            <EmptyState
              icon={Search}
              title="一致する結果がありません"
              description="キーワードや詳細条件を見直して、もう一度検索してください。"
            />
          ) : (
            <div role="list" aria-label={`${selectedCategoryLabel}の検索結果`}>
              <div className="space-y-3">
                {visibleItems.map((item) => (
                  <ListOpenCard
                    key={item.id}
                    badgeLabel={item.badgeLabel}
                    badgeClassName={item.badgeClassName}
                    title={item.title}
                    subtitle={item.subtitle}
                    onOpen={() => router.push(item.href)}
                  />
                ))}
              </div>
            </div>
          )
        ) : null}
      </section>

      {/* 詳しく絞り込むモーダル */}
      <AdvancedFilterModal
        open={isAdvancedOpen}
        onOpenChange={setIsAdvancedOpen}
        pharmacists={pharmacists}
        initialFilter={advancedFilter}
        onApply={handleApplyFilter}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 訪問日プリセット解決 helper
// ---------------------------------------------------------------------------

function toDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function resolveDateRange(preset: string): { from: string; to: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const addDays = (base: Date, days: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d;
  };

  const startOfWeek = (base: Date) => {
    const d = new Date(base);
    const day = d.getDay(); // 0=日, 1=月 ...
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); // 月曜始まり
    return d;
  };

  switch (preset) {
    case 'today':
      return { from: toDateKey(today), to: toDateKey(today) };
    case 'tomorrow':
      return { from: toDateKey(addDays(today, 1)), to: toDateKey(addDays(today, 1)) };
    case 'this_week': {
      const mon = startOfWeek(today);
      return { from: toDateKey(mon), to: toDateKey(addDays(mon, 6)) };
    }
    case 'next_week': {
      const nextMon = addDays(startOfWeek(today), 7);
      return { from: toDateKey(nextMon), to: toDateKey(addDays(nextMon, 6)) };
    }
    case 'today_to_week':
    default: {
      const mon = startOfWeek(today);
      return { from: toDateKey(today), to: toDateKey(addDays(mon, 6)) };
    }
  }
}

// SEARCH_CATEGORY_LABELS and SEARCH_CATEGORY_BADGE_CLASSES are re-exported for test convenience
export { SEARCH_CATEGORY_LABELS, SEARCH_CATEGORY_BADGE_CLASSES };
