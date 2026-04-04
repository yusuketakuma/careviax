// ---------------------------------------------------------------------------
// Cycle status config — CLAUDE.md 配色ルール準拠
// ワークフロー状態: 待ち=青、進行中=緑、差戻し=赤、完了=灰
// ---------------------------------------------------------------------------

export const CYCLE_STATUS_CONFIG: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; className?: string }
> = {
  intake_received:   { label: '受付済',     variant: 'secondary' },
  structuring:       { label: '構造化中',   variant: 'secondary', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  inquiry_pending:   { label: '疑義照会中', variant: 'destructive', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  inquiry_resolved:  { label: '照会解決',   variant: 'outline' },
  ready_to_dispense: { label: '調剤待ち',   variant: 'default', className: 'bg-green-100 text-green-800 border-green-200' },
  dispensing:        { label: '調剤中',     variant: 'default' },
  dispensed:         { label: '調剤済',     variant: 'outline', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  audit_pending:     { label: '監査待ち',   variant: 'secondary' },
  audited:           { label: '監査済',     variant: 'outline', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  on_hold:           { label: '保留',       variant: 'outline', className: 'bg-orange-100 text-orange-800 border-orange-200' },
  cancelled:         { label: '取消',       variant: 'destructive' },
};
