'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Clock3, Pill, Search, Users } from 'lucide-react';
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

const PATH_LABELS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^\/dashboard$/, label: 'ホーム' },
  { pattern: /^\/patients(\/.*)?$/, label: '患者' },
  { pattern: /^\/schedules(\/.*)?$/, label: 'スケジュール' },
  { pattern: /^\/visits(\/.*)?$/, label: '訪問' },
  { pattern: /^\/reports(\/.*)?$/, label: '報告' },
  { pattern: /^\/dispensing(\/.*)?$/, label: '調剤' },
  { pattern: /^\/auditing(\/.*)?$/, label: '鑑査' },
  { pattern: /^\/notifications(\/.*)?$/, label: '通知' },
  { pattern: /^\/communications(\/.*)?$/, label: '連携' },
  { pattern: /^\/admin(\/.*)?$/, label: '管理' },
  { pattern: /^\/settings$/, label: 'ユーザー設定' },
];

function labelForPath(pathname: string) {
  return PATH_LABELS.find((item) => item.pattern.test(pathname))?.label ?? pathname;
}

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

export function GlobalSearchModal({
  open,
  onOpenChange,
  pathname,
}: GlobalSearchModalProps) {
  const orgId = useOrgId();
  const [query, setQuery] = useState('');
  const [patients, setPatients] = useState<PatientSearchResult[]>([]);
  const [drugs, setDrugs] = useState<DrugSearchResult[]>([]);
  const [recentOperations, setRecentOperations] = useState<RecentOperation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    setRecentOperations(saveRecentOperation(pathname));
  }, [pathname]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setPatients([]);
      setDrugs([]);
      setSearchError(null);
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
      setSearchError(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsLoading(true);
      setSearchError(null);

      try {
        const [patientResponse, drugResponse] = await Promise.all([
          fetch(`/api/patients?q=${encodeURIComponent(normalized)}&limit=5`, {
            headers: orgId ? { 'x-org-id': orgId } : {},
            signal: controller.signal,
          }),
          fetch(`/api/drug-masters?q=${encodeURIComponent(normalized)}&limit=5`, {
            signal: controller.signal,
          }),
        ]);

        if (!patientResponse.ok || !drugResponse.ok) {
          throw new Error('検索結果の取得に失敗しました。');
        }

        const patientPayload = (await patientResponse.json()) as {
          data: PatientSearchResult[];
        };
        const drugPayload = (await drugResponse.json()) as {
          data: DrugSearchResult[];
        };

        setPatients(patientPayload.data ?? []);
        setDrugs(drugPayload.data ?? []);
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

  const hasResults = useMemo(
    () => patients.length > 0 || drugs.length > 0,
    [patients.length, drugs.length]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>グローバル検索</DialogTitle>
          <DialogDescription>
            患者名、薬剤名、YJコードで横断検索できます。最近の操作履歴もここから開けます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-search-input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="患者名 / 薬剤名 / YJコードで検索"
              className="pl-9"
            />
          </div>

          {query.trim() ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-600" aria-hidden="true" />
                  <h3 className="font-medium text-foreground">患者</h3>
                  <Badge variant="outline">{patients.length}</Badge>
                </div>
                <div className="space-y-2">
                  {patients.map((patient) => (
                    <Link
                      key={patient.id}
                      href={`/patients/${patient.id}`}
                      onClick={() => onOpenChange(false)}
                      className="block rounded-lg border border-border px-3 py-2 hover:bg-muted/40"
                    >
                      <p className="text-sm font-medium text-foreground">{patient.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {patient.name_kana}
                        {patient.residences[0]?.address
                          ? ` / ${patient.residences[0].address}`
                          : ''}
                      </p>
                    </Link>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Pill className="h-4 w-4 text-blue-600" aria-hidden="true" />
                  <h3 className="font-medium text-foreground">薬剤マスタ</h3>
                  <Badge variant="outline">{drugs.length}</Badge>
                </div>
                <div className="space-y-2">
                  {drugs.map((drug) => (
                    <Link
                      key={drug.id}
                      href={`/admin/drug-masters?q=${encodeURIComponent(drug.yj_code ?? drug.drug_name)}`}
                      onClick={() => onOpenChange(false)}
                      className="block rounded-lg border border-border px-3 py-2 hover:bg-muted/40"
                    >
                      <p className="text-sm font-medium text-foreground">{drug.drug_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {drug.yj_code ?? 'YJコード未設定'}
                        {drug.generic_name ? ` / ${drug.generic_name}` : ''}
                      </p>
                    </Link>
                  ))}
                </div>
              </section>
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
