'use client';

import { useEffect, useRef, useState } from 'react';
import type { MemberRole } from '@prisma/client';
import { readApiJson } from '@/lib/api/client-json';
import { hasPermission } from '@/lib/auth/permission-matrix';
import { ACTIVE_PALETTE_CATEGORIES, type PaletteCategory } from '@/lib/search/categories';
import type { SearchResultRow } from '@/lib/search/result-builders';

/** 1 カテゴリ分の結果。失敗(failed)と 0 件(ok/空配列)を区別する。 */
export type CategoryResult = {
  category: PaletteCategory['id'];
  label: string;
  status: 'ok' | 'failed';
  rows: SearchResultRow[];
  bestEffort?: boolean;
  bestEffortNote?: string;
};

export type UseGlobalSearchResult = {
  results: CategoryResult[];
  loading: boolean;
  /**
   * debounce/fetch 未完了、または現入力(query|role|orgId)に results が未対応(stale)な状態。
   * 呼び出し側は pending 中は results を露出せず、可視ローディングを表示し操作を無効化する。
   */
  pending: boolean;
  hasQuery: boolean;
};

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
const PRESCRIPTION_CAP = 8;

/** 結果の stale 判定に使う入力キー。query/role/orgId のいずれが変わっても別キーになる。 */
export function globalSearchKey(query: string, role: MemberRole | null, orgId: string): string {
  return `${query.trim()}\x1f${role ?? ''}\x1f${orgId}`;
}

/**
 * 権限と orgId から「実際に fetch してよいカテゴリ」を決める(URL 構築前ゲート)。
 * role が null(不明)のときは fail-closed で org/perm 必須カテゴリを除外し、
 * 認証のみで足りる drug のみ許可する。deferred カテゴリ(F-010A 待ち)は対象外。
 */
export function resolveEnabledCategories(
  role: MemberRole | null,
  orgId: string,
): PaletteCategory[] {
  return ACTIVE_PALETTE_CATEGORIES.filter((category) => {
    const permitted =
      category.requiredPermission === null
        ? true
        : role !== null && hasPermission(role, category.requiredPermission);
    if (!permitted) return false;
    if (category.orgScoped && !orgId) return false;
    return true;
  });
}

/**
 * prescription(bestEffort): 取得 items を query で client filter する。
 * patient 名 / 施設名 への前方一致(大小無視)→ 決定的 cap。
 */
function filterPrescriptionItems(items: unknown[], query: string): unknown[] {
  const needle = query.trim().toLowerCase();
  const matched = items.filter((raw) => {
    const item = raw as {
      cycle?: { case_?: { patient?: { name?: string | null } | null } | null } | null;
      prescriber_institution?: { name?: string | null } | null;
    };
    const patientName = item.cycle?.case_?.patient?.name ?? '';
    const institutionName = item.prescriber_institution?.name ?? '';
    return (
      patientName.toLowerCase().startsWith(needle) ||
      institutionName.toLowerCase().startsWith(needle)
    );
  });
  return matched.slice(0, PRESCRIPTION_CAP);
}

async function fetchCategory(
  category: PaletteCategory,
  query: string,
  orgId: string,
  signal: AbortSignal,
): Promise<CategoryResult> {
  const base: Pick<CategoryResult, 'category' | 'label' | 'bestEffort' | 'bestEffortNote'> = {
    category: category.id,
    label: category.label,
    bestEffort: category.bestEffort,
    bestEffortNote: category.bestEffortNote,
  };
  try {
    const headers: HeadersInit = orgId ? { 'x-org-id': orgId } : {};
    const res = await fetch(category.endpoint(query), { headers, signal });
    // fail-closed parse(403/非 2xx/malformed は throw)。
    const parsed = await readApiJson(res, {
      schema: category.schema,
      fallbackMessage: '検索結果を取得できませんでした',
    });
    let items = category.normalize(parsed);
    if (category.bestEffort) {
      items = filterPrescriptionItems(items, query);
    }
    const rows = items.map((item) => category.build(item));
    return { ...base, status: 'ok', rows };
  } catch {
    // 当該カテゴリのみ failed(空結果に変換しない)。他カテゴリは継続。
    return { ...base, status: 'failed', rows: [] };
  }
}

/**
 * F-009 グローバル検索パレットのデータ取得フック。
 * 250ms デバウンス + 権限 no-fetch ゲート + Promise.allSettled 並列 fetch +
 * AbortController + sequence-id による stale 破棄 を担う。
 */
export function useGlobalSearch(
  query: string,
  role: MemberRole | null,
  orgId: string,
): UseGlobalSearchResult {
  const [results, setResults] = useState<CategoryResult[]>([]);
  // results が対応する入力キー。現入力と不一致なら呼び出し側は stale として扱う。
  const [resultsKey, setResultsKey] = useState('');
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);

  const trimmed = query.trim();
  const hasQuery = trimmed.length >= MIN_CHARS;

  useEffect(() => {
    const controller = new AbortController();
    // 2 文字未満は near-immediate(0ms)でクリア、検索は 250ms デバウンス。
    // setState は常にタイマーコールバック内で行い、effect 本体での同期 setState を避ける。
    const isClear = trimmed.length < MIN_CHARS;
    const reqKey = globalSearchKey(trimmed, role, orgId);
    const timeoutId = window.setTimeout(
      () => {
        if (isClear) {
          seqRef.current += 1; // in-flight 結果を stale 化
          setResults([]);
          setResultsKey('');
          setLoading(false);
          return;
        }
        const enabled = resolveEnabledCategories(role, orgId);
        const seq = (seqRef.current += 1);
        setLoading(true);

        void Promise.allSettled(
          enabled.map((category) => fetchCategory(category, trimmed, orgId, controller.signal)),
        ).then((settled) => {
          // post-parse seq チェック: 古い query の結果は破棄(上書きしない)。
          if (seq !== seqRef.current) return;
          if (controller.signal.aborted) return;
          const next = settled.map((entry, index) =>
            entry.status === 'fulfilled'
              ? entry.value
              : ({
                  category: enabled[index].id,
                  label: enabled[index].label,
                  status: 'failed' as const,
                  rows: [],
                  bestEffort: enabled[index].bestEffort,
                  bestEffortNote: enabled[index].bestEffortNote,
                } satisfies CategoryResult),
          );
          setResults(next);
          setResultsKey(reqKey); // この結果が対応する入力を記録(stale 判定用)。
          setLoading(false);
        });
      },
      isClear ? 0 : DEBOUNCE_MS,
    );

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [trimmed, role, orgId]);

  // render 中に stale 判定(effect の setState を介さない)。results が現入力に未対応なら pending。
  const pending = hasQuery && (loading || resultsKey !== globalSearchKey(trimmed, role, orgId));

  return { results, loading, pending, hasQuery };
}
