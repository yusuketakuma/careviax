'use client';

/**
 * p0_05「全体検索」ページ本体。
 * 180ms デバウンス + AbortController + Promise.all で 6 カテゴリを並列 fetch。
 * チップ切替は再 fetch なしに選択カテゴリの結果のみ表示(全件取得済みの配列から表示)。
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterChipBar } from '@/components/features/workspace/filter-chip-bar';
import { ListOpenCard } from '@/components/features/workspace/list-open-card';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { AdvancedFilterModal } from './advanced-filter-modal';
import { type AdvancedFilterState, EMPTY_ADVANCED_FILTER } from './advanced-filter.shared';
import {
  type SearchCategory,
  type SearchResultRow,
  type PatientSearchItem,
  type PrescriptionSearchItem,
  type DrugSearchItem,
  type FacilitySearchItem,
  type ReportSearchItem,
  type ContactSearchItem,
  SEARCH_CATEGORY_LABELS,
  SEARCH_CATEGORY_BADGE_CLASSES,
  buildPatientResult,
  buildPrescriptionResult,
  buildDrugResult,
  buildFacilityResult,
  buildReportResult,
  buildContactResult,
} from './search-result-builders';

const SEARCH_CATEGORIES: SearchCategory[] = [
  'patient',
  'prescription',
  'drug',
  'facility',
  'report',
  'contact',
];

type CategoryCounts = Partial<Record<SearchCategory, number>>;

type AllResults = Record<SearchCategory, SearchResultRow[]>;

const EMPTY_ALL_RESULTS: AllResults = {
  patient: [],
  prescription: [],
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
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [advancedFilter, setAdvancedFilter] = useState<AdvancedFilterState>(EMPTY_ADVANCED_FILTER);
  const [pharmacists, setPharmacists] = useState<Pharmacist[]>([]);

  // 担当者選択肢を一度だけ取得
  useEffect(() => {
    if (!orgId) return;
    void fetch('/api/pharmacists', { headers: { 'x-org-id': orgId } })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { data?: Array<{ user: { id: string; name: string } }> } | null) => {
        if (!payload?.data) return;
        setPharmacists(payload.data.map((m) => ({ id: m.user.id, name: m.user.name })));
      })
      .catch(() => undefined);
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
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setSearchError(null);

      try {
        const q = encodeURIComponent(normalized);
        const headers: HeadersInit = orgId ? { 'x-org-id': orgId } : {};
        const sig = controller.signal;

        // 接続可能な詳細絞り込み条件を既存 API に AND 合成(第一版)
        const visitScheduleParams = new URLSearchParams({ q });
        if (advancedFilter.assigneeId) {
          visitScheduleParams.set('pharmacist_id', advancedFilter.assigneeId);
        }
        if (advancedFilter.visitDateRange) {
          const { from, to } = resolveDateRange(advancedFilter.visitDateRange);
          visitScheduleParams.set('date_from', from);
          visitScheduleParams.set('date_to', to);
        }
        const cycleStatusParam = advancedFilter.cycleStatus
          ? `&status=${encodeURIComponent(advancedFilter.cycleStatus)}`
          : '';
        const careTagsParam =
          advancedFilter.careTags.length > 0
            ? `&care_tags=${encodeURIComponent(advancedFilter.careTags.join(','))}`
            : '';

        const [patientRes, prescriptionRes, drugRes, facilityRes, reportRes, contactRes] =
          await Promise.all([
            fetch(`/api/patients?q=${q}&limit=8`, { headers, signal: sig }).catch(() => null),
            // prescription-intakes の q は API 側未実装(source_type/status のみ対応)のため
            // クライアント側で patient.name による前方一致フィルタを補完する。
            // 将来 API 側 q 実装時にフィルタ除去可。
            fetch(`/api/prescription-intakes?q=${q}&limit=8${cycleStatusParam}${careTagsParam}`, {
              headers,
              signal: sig,
            }).catch(() => null),
            fetch(`/api/drug-masters?q=${q}&limit=8`, { signal: sig }).catch(() => null),
            fetch(`/api/facilities?q=${q}&limit=8`, { headers, signal: sig }).catch(() => null),
            fetch(`/api/care-reports?q=${q}`, { headers, signal: sig }).catch(() => null),
            fetch(`/api/contact-profiles?q=${q}`, { headers, signal: sig }).catch(() => null),
          ]);

        const patientData = patientRes?.ok
          ? (((await patientRes.json()) as { data: PatientSearchItem[] }).data ?? [])
          : [];

        // prescription-intakes の API 側 q 未対応のためクライアントフィルタで補完
        const prescriptionRaw = prescriptionRes?.ok
          ? (((await prescriptionRes.json()) as { data: PrescriptionSearchItem[] }).data ?? [])
          : [];
        const prescriptionData = prescriptionRaw.filter((item) => {
          const patientName = item.cycle?.case_?.patient?.name ?? '';
          return patientName.includes(normalized) || normalized.length === 0;
        });

        const drugData = drugRes?.ok
          ? (((await drugRes.json()) as { data: DrugSearchItem[] }).data ?? [])
          : [];

        const facilityData = facilityRes?.ok
          ? (((await facilityRes.json()) as { data: FacilitySearchItem[] }).data ?? [])
          : [];

        // care-reports は limit なしのため先頭 8 件に slice
        const reportRaw = reportRes?.ok
          ? (((await reportRes.json()) as { data: ReportSearchItem[] }).data ?? [])
          : [];
        const reportData = reportRaw.slice(0, 8);

        const contactData = contactRes?.ok
          ? (((await contactRes.json()) as { data: ContactSearchItem[] }).data ?? [])
          : [];

        // medicationDeadlineWithinDays は /api/dashboard/medication-deadlines で取得可能だが
        // 結果リストの統合が複雑なため第一版は API 呼び出しのみ省略し将来接続。

        const built: AllResults = {
          patient: patientData.map(buildPatientResult),
          prescription: prescriptionData.map(buildPrescriptionResult),
          drug: drugData.map(buildDrugResult),
          facility: facilityData.map(buildFacilityResult),
          report: reportData.map((item) => buildReportResult(item)),
          contact: contactData.map(buildContactResult),
        };

        setAllResults(built);
        setCounts(
          Object.fromEntries(
            SEARCH_CATEGORIES.map((cat) => [cat, built[cat].length]),
          ) as CategoryCounts,
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        setSearchError(err instanceof Error ? err.message : '検索結果の取得に失敗しました。');
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

  const handleApplyFilter = (filter: AdvancedFilterState) => {
    setAdvancedFilter(filter);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5" data-testid="search-page">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">全体検索</h1>

      {/* 検索ボックス */}
      <Input
        data-search-input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="田中 一郎 アムロジピン 施設A などで検索"
        className="h-12 text-base"
      />

      {/* カテゴリチップ + 詳しく絞り込むボタン */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterChipBar
          ariaLabel="検索カテゴリの絞り込み"
          value={category}
          onChange={handleCategoryChange}
          options={SEARCH_CATEGORIES.map((cat) => ({
            value: cat,
            label: SEARCH_CATEGORY_LABELS[cat],
            count: counts[cat],
          }))}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsAdvancedOpen(true)}
          className="shrink-0"
        >
          詳しく絞り込む
        </Button>
      </div>

      {/* ローディング */}
      {isLoading ? <p className="text-sm text-muted-foreground">検索中...</p> : null}
      {/* エラー */}
      {searchError ? <p className="text-sm text-destructive">{searchError}</p> : null}

      {/* 結果リスト */}
      {!isLoading && !searchError ? (
        !hasSearched ? (
          <EmptyState
            icon={Search}
            title="キーワードを入力して横断検索"
            description="キーワードを入力すると患者・処方・薬剤・施設・報告書・連絡先を横断して探します。"
          />
        ) : !hasResults ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 text-center text-sm text-muted-foreground">
            <Search className="size-7" aria-hidden="true" />
            <p>一致する結果がありません</p>
          </div>
        ) : (
          <div role="list" aria-label={`${SEARCH_CATEGORY_LABELS[category]}の検索結果`}>
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
