/**
 * 後方互換 shim。
 * 結果行 builder/型の実体は共有 lib(`@/lib/search/result-builders`)へ移設済み。
 * 既存 import(search-content.tsx / page.tsx / 既存テスト)を無編集で有効に保つため
 * 全シンボルをそのまま再エクスポートする。
 */
export * from '@/lib/search/result-builders';
