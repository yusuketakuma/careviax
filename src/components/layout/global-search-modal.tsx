'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, CalendarDays, CheckSquare, Clock3, FileText, Pill, Search, User, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { labelForPath } from '@/lib/navigation/route-labels';

type PatientSearchResult = {
  id: string;
  name: string;
  name_kana: string;
  residences: Array<{ address: string }>;
  cases: Array<{ status: string }>;
};

type DrugSearchResult = {
  id: string;
  yj_code: string | null;
  drug_name: string;
  generic_name: string | null;
  therapeutic_category: string | null;
};

type FacilitySearchResult = {
  id: string;
  name: string;
  facility_type: string;
};

type StaffSearchResult = {
  id: string;
  name: string;
  license_number?: string | null;
};

type TaskSearchResult = {
  id: string;
  title: string;
  status: string;
};

type PrescriptionSearchResult = {
  id: string;
  patient_id: string;
  patient_name?: string | null;
  prescribed_date?: string | null;
};

type VisitRecordSearchResult = {
  id: string;
  patient_id: string;
  patient_name?: string | null;
  visit_date?: string | null;
};

type RecentOperation = {
  href: string;
  label: string;
  visitedAt: string;
};

type GlobalSearchModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pathname: string;
};

const RECENT_OPERATIONS_KEY = 'careviax:recent-operations';

function readRecentOperations() {
  if (typeof window === 'undefined') {
    return [] as RecentOperation[];
  }

  try {
    const raw = window.localStorage.getItem(RECENT_OPERATIONS_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as RecentOperation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecentOperation(pathname: string) {
  if (typeof window === 'undefined' || !pathname.startsWith('/')) {
    return [];
  }

  const nextItem: RecentOperation = {
    href: pathname,
    label: labelForPath(pathname),
    visitedAt: new Date().toISOString(),
  };

  const deduped = readRecentOperations().filter((item) => item.href !== pathname);
  const next = [nextItem, ...deduped].slice(0, 8);
  window.localStorage.setItem(RECENT_OPERATIONS_KEY, JSON.stringify(next));
  return next;
}

type ResultItem = { href: string; label: string; sub?: string };

function buildResultItems(
  patients: PatientSearchResult[],
  drugs: DrugSearchResult[],
  facilities: FacilitySearchResult[],
  staff: StaffSearchResult[],
  tasks: TaskSearchResult[],
  prescriptions: PrescriptionSearchResult[],
  visitRecords: VisitRecordSearchResult[],
): ResultItem[] {
  return [
    ...patients.map((p) => ({
      href: `/patients/${p.id}`,
      label: p.name,
      sub: p.name_kana,
    })),
    ...drugs.map((d) => ({
      href: `/admin/drug-masters?q=${encodeURIComponent(d.yj_code ?? d.drug_name)}`,
      label: d.drug_name,
      sub: d.yj_code ?? undefined,
    })),
    ...facilities.map((f) => ({
      href: `/admin/facilities?q=${encodeURIComponent(f.name)}`,
      label: f.name,
      sub: f.facility_type,
    })),
    ...staff.map((s) => ({
      href: `/admin/pharmacists?q=${encodeURIComponent(s.name)}`,
      label: s.name,
      sub: s.license_number ?? undefined,
    })),
    ...tasks.map((t) => ({
      href: `/tasks/${t.id}`,
      label: t.title,
      sub: t.status,
    })),
    ...prescriptions.map((p) => ({
      href: `/prescriptions/${p.id}`,
      label: p.patient_name ?? p.patient_id,
      sub: p.prescribed_date ?? undefined,
    })),
    ...visitRecords.map((v) => ({
      href: `/visit-records/${v.id}`,
      label: v.patient_name ?? v.patient_id,
      sub: v.visit_date ?? undefined,
    })),
  ];
}

export function GlobalSearchModal({
  open,
  onOpenChange,
  pathname,
}: GlobalSearchModalProps) {
  const orgId = useOrgId();
  const [query, setQuery] = useState('');
  const [patients, setPatients] = useState<PatientSearchResult[]>([]);
  const [drugs, setDrugs] = useState<DrugSearchResult[]>([]);
  const [facilities, setFacilities] = useState<FacilitySearchResult[]>([]);
  const [staff, setStaff] = useState<StaffSearchResult[]>([]);
  const [tasks, setTasks] = useState<TaskSearchResult[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionSearchResult[]>([]);
  const [visitRecords, setVisitRecords] = useState<VisitRecordSearchResult[]>([]);
  const [recentOperations, setRecentOperations] = useState<RecentOperation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const resultRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  useEffect(() => {
    setRecentOperations(saveRecentOperation(pathname));
  }, [pathname]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setPatients([]);
      setDrugs([]);
      setFacilities([]);
      setStaff([]);
      setTasks([]);
      setPrescriptions([]);
      setVisitRecords([]);
      setSearchError(null);
      setActiveIndex(-1);
      return;
    }

    setRecentOperations(readRecentOperations());
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const normalized = query.trim();
    if (!normalized) {
      setPatients([]);
      setDrugs([]);
      setFacilities([]);
      setStaff([]);
      setTasks([]);
      setPrescriptions([]);
      setVisitRecords([]);
      setSearchError(null);
      setIsLoading(false);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsLoading(true);
      setSearchError(null);
      setActiveIndex(-1);

      try {
        const q = encodeURIComponent(normalized);
        const headers: HeadersInit = orgId ? { 'x-org-id': orgId } : {};
        const sig = controller.signal;

        const [
          patientRes,
          drugRes,
          facilityRes,
          staffRes,
          taskRes,
          prescriptionRes,
          visitRes,
        ] = await Promise.all([
          fetch(`/api/patients?q=${q}&limit=5`, { headers, signal: sig }),
          fetch(`/api/drug-masters?q=${q}&limit=5`, { signal: sig }),
          fetch(`/api/facilities?q=${q}&limit=5`, { headers, signal: sig }).catch(() => null),
          fetch(`/api/pharmacists?q=${q}&limit=5`, { headers, signal: sig }).catch(() => null),
          fetch(`/api/tasks?q=${q}&limit=5`, { headers, signal: sig }).catch(() => null),
          fetch(`/api/prescription-intakes?q=${q}&limit=5`, { headers, signal: sig }).catch(() => null),
          fetch(`/api/visit-records?q=${q}&limit=5`, { headers, signal: sig }).catch(() => null),
        ]);

        if (!patientRes.ok || !drugRes.ok) {
          throw new Error('検索結果の取得に失敗しました。');
        }

        const patientPayload = (await patientRes.json()) as { data: PatientSearchResult[] };
        const drugPayload = (await drugRes.json()) as { data: DrugSearchResult[] };
        const facilityPayload = facilityRes?.ok ? (await facilityRes.json()) as { data: FacilitySearchResult[] } : { data: [] };
        const staffPayload = staffRes?.ok ? (await staffRes.json()) as { data: StaffSearchResult[] } : { data: [] };
        const taskPayload = taskRes?.ok ? (await taskRes.json()) as { data: TaskSearchResult[] } : { data: [] };
        const prescriptionPayload = prescriptionRes?.ok ? (await prescriptionRes.json()) as { data: PrescriptionSearchResult[] } : { data: [] };
        const visitPayload = visitRes?.ok ? (await visitRes.json()) as { data: VisitRecordSearchResult[] } : { data: [] };

        setPatients(patientPayload.data ?? []);
        setDrugs(drugPayload.data ?? []);
        setFacilities(facilityPayload.data ?? []);
        setStaff(staffPayload.data ?? []);
        setTasks(taskPayload.data ?? []);
        setPrescriptions(prescriptionPayload.data ?? []);
        setVisitRecords(visitPayload.data ?? []);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setSearchError(
          error instanceof Error ? error.message : '検索結果の取得に失敗しました。'
        );
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
  }, [open, query, orgId]);

  const allResults = useMemo(
    () => buildResultItems(patients, drugs, facilities, staff, tasks, prescriptions, visitRecords),
    [patients, drugs, facilities, staff, tasks, prescriptions, visitRecords]
  );

  const hasResults = allResults.length > 0;

  // Sync active index ref to DOM
  useEffect(() => {
    if (activeIndex >= 0 && activeIndex < resultRefs.current.length) {
      resultRefs.current[activeIndex]?.focus();
    }
  }, [activeIndex]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!hasResults) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, allResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Escape') {
      onOpenChange(false);
    }
  }

  const encodedQuery = encodeURIComponent(query.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>グローバル検索</DialogTitle>
          <DialogDescription>
            患者・薬剤・施設・スタッフ・タスクを横断検索できます。↑↓キーで結果を選択、Enterで移動。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4" onKeyDown={handleKeyDown}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-search-input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(-1);
              }}
              placeholder="患者名 / 薬剤名 / 施設名 / スタッフ名で検索"
              className="pl-9"
            />
          </div>

          {query.trim() ? (
            <div className="space-y-4" role="listbox" aria-label="検索結果">
              {[
                {
                  icon: Users,
                  label: '患者',
                  items: patients,
                  renderItem: (p: PatientSearchResult) => ({
                    href: `/patients/${p.id}`,
                    primary: p.name,
                    secondary: `${p.name_kana}${p.residences[0]?.address ? ` / ${p.residences[0].address}` : ''}`,
                  }),
                  showAllHref: `/patients?q=${encodedQuery}`,
                },
                {
                  icon: Pill,
                  label: '薬剤マスタ',
                  items: drugs,
                  renderItem: (d: DrugSearchResult) => ({
                    href: `/admin/drug-masters?q=${encodeURIComponent(d.yj_code ?? d.drug_name)}`,
                    primary: d.drug_name,
                    secondary: d.yj_code ?? 'YJコード未設定',
                  }),
                  showAllHref: `/admin/drug-masters?q=${encodedQuery}`,
                },
                {
                  icon: Building2,
                  label: '施設',
                  items: facilities,
                  renderItem: (f: FacilitySearchResult) => ({
                    href: `/admin/facilities?q=${encodeURIComponent(f.name)}`,
                    primary: f.name,
                    secondary: f.facility_type,
                  }),
                  showAllHref: `/admin/facilities?q=${encodedQuery}`,
                },
                {
                  icon: User,
                  label: 'スタッフ',
                  items: staff,
                  renderItem: (s: StaffSearchResult) => ({
                    href: `/admin/pharmacists?q=${encodeURIComponent(s.name)}`,
                    primary: s.name,
                    secondary: s.license_number ?? '',
                  }),
                  showAllHref: `/admin/pharmacists?q=${encodedQuery}`,
                },
                {
                  icon: CheckSquare,
                  label: 'タスク',
                  items: tasks,
                  renderItem: (t: TaskSearchResult) => ({
                    href: `/tasks/${t.id}`,
                    primary: t.title,
                    secondary: t.status,
                  }),
                  showAllHref: `/tasks?q=${encodedQuery}`,
                },
                {
                  icon: FileText,
                  label: '処方',
                  items: prescriptions,
                  renderItem: (p: PrescriptionSearchResult) => ({
                    href: `/prescriptions/${p.id}`,
                    primary: p.patient_name ?? p.patient_id,
                    secondary: p.prescribed_date ?? '',
                  }),
                  showAllHref: `/prescriptions?q=${encodedQuery}`,
                },
                {
                  icon: CalendarDays,
                  label: '訪問記録',
                  items: visitRecords,
                  renderItem: (v: VisitRecordSearchResult) => ({
                    href: `/visit-records/${v.id}`,
                    primary: v.patient_name ?? v.patient_id,
                    secondary: v.visit_date ?? '',
                  }),
                  showAllHref: `/visit-records?q=${encodedQuery}`,
                },
              ]
                .filter((cat) => cat.items.length > 0)
                .map((cat) => {
                  const Icon = cat.icon;
                  return (
                    <section key={cat.label} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-blue-600" aria-hidden="true" />
                          <h3 className="font-medium text-foreground">{cat.label}</h3>
                          <Badge variant="outline">{cat.items.length}</Badge>
                        </div>
                        <Link
                          href={cat.showAllHref}
                          onClick={() => onOpenChange(false)}
                          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                        >
                          すべて表示 →
                        </Link>
                      </div>
                      <div className="space-y-1">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {cat.items.map((item: any) => {
                          const rendered = cat.renderItem(item);
                          const flatIdx = allResults.findIndex((r) => r.href === rendered.href);
                          return (
                            <Link
                              key={item.id}
                              href={rendered.href}
                              onClick={() => onOpenChange(false)}
                              ref={(el) => { resultRefs.current[flatIdx] = el; }}
                              role="option"
                              aria-selected={activeIndex === flatIdx}
                              className={`block rounded-lg border px-3 py-2 outline-none transition-colors hover:bg-muted/40 focus:bg-muted/60 ${
                                activeIndex === flatIdx
                                  ? 'border-blue-400 bg-muted/60'
                                  : 'border-border'
                              }`}
                            >
                              <p className="text-sm font-medium text-foreground">{rendered.primary}</p>
                              {rendered.secondary ? (
                                <p className="text-xs text-muted-foreground">{rendered.secondary}</p>
                              ) : null}
                            </Link>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
            </div>
          ) : (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-blue-600" aria-hidden="true" />
                <h3 className="font-medium text-foreground">最近の操作履歴</h3>
                <Badge variant="outline">{recentOperations.length}</Badge>
              </div>
              {recentOperations.length > 0 ? (
                <div className="space-y-2">
                  {recentOperations.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => onOpenChange(false)}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2 hover:bg-muted/40"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{item.label}</p>
                        <p className="text-xs text-muted-foreground">{item.href}</p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(item.visitedAt).toLocaleDateString('ja-JP', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={Clock3}
                  title="最近の操作履歴はまだありません"
                  description="ページを移動すると、ここに最近開いた画面が表示されます。"
                />
              )}
            </section>
          )}

          {isLoading ? (
            <p className="text-sm text-muted-foreground">検索中...</p>
          ) : null}
          {searchError ? (
            <p className="text-sm text-destructive">{searchError}</p>
          ) : null}
          {query.trim() && !isLoading && !searchError && !hasResults ? (
            <EmptyState
              icon={Search}
              title="一致する結果がありません"
              description="患者名の一部、薬剤名、または YJ コードでもう一度検索してください。"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
