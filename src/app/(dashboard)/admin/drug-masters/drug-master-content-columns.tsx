import { type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, CheckCircle2, Pill, Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { DrugMasterRow } from './drug-master-content-types';

export function DrugNameCell({ drug }: { drug: DrugMasterRow }) {
  const displayName = drug.tall_man_name?.trim() || drug.drug_name;
  const hasTallMan = displayName !== drug.drug_name;

  return (
    <div className="min-w-[200px]">
      <div className="flex items-center gap-1.5">
        <Pill className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-foreground">{displayName}</span>
        {hasTallMan && (
          <Badge variant="outline" className="border-tag-hazard/30 text-xs text-tag-hazard">
            Tall Man
          </Badge>
        )}
      </div>
      {hasTallMan && (
        <div className="mt-0.5 text-xs text-muted-foreground">通常表記: {drug.drug_name}</div>
      )}
      {drug.generic_name && (
        <div className="mt-0.5 text-xs text-muted-foreground">一般名: {drug.generic_name}</div>
      )}
      {(drug.is_lasa_risk || drug.lasa_group_key) && (
        <div className="mt-1 text-xs font-medium text-tag-hazard">
          LASA注意{drug.lasa_group_key ? `: ${drug.lasa_group_key}` : ''}
        </div>
      )}
    </div>
  );
}

export function StructuredPayload({ value }: { value: unknown }) {
  if (value == null) {
    return <p className="text-sm text-muted-foreground">情報はまだ登録されていません。</p>;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <p className="text-sm leading-6 text-foreground">{String(value)}</p>;
  }

  if (Array.isArray(value) && value.every((item) => typeof item !== 'object')) {
    return (
      <ul className="space-y-1 text-sm text-foreground">
        {value.map((item, index) => (
          <li key={`${String(item)}-${index}`} className="rounded-md bg-muted/40 px-2 py-1">
            {String(item)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-xs leading-5 text-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export const baseColumns: ColumnDef<DrugMasterRow>[] = [
  {
    id: 'formulary',
    header: '採用',
    cell: ({ row }) =>
      row.original.stock_config?.is_stocked ? (
        <Badge
          variant="outline"
          className="gap-1 border-transparent bg-state-done/10 text-state-done"
        >
          <CheckCircle2 className="size-3" aria-hidden="true" />
          採用
        </Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          未採用
        </Badge>
      ),
  },
  {
    accessorKey: 'drug_name',
    header: '医薬品名',
    cell: ({ row }) => <DrugNameCell drug={row.original} />,
  },
  {
    accessorKey: 'yj_code',
    header: 'YJコード',
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {row.original.yj_code}
      </span>
    ),
  },
  {
    accessorKey: 'dosage_form',
    header: '剤形',
    cell: ({ row }) => <span className="text-sm">{row.original.dosage_form ?? '—'}</span>,
  },
  {
    id: 'flags',
    header: '区分',
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.is_generic && (
          <Badge
            variant="outline"
            className="border-transparent bg-tag-info/10 text-xs text-tag-info"
          >
            後発
          </Badge>
        )}
        {row.original.is_narcotic && (
          <span className="inline-flex items-center gap-0.5 rounded bg-tag-hazard/10 px-1 py-0.5 text-xs font-medium text-tag-hazard">
            <AlertTriangle className="size-2.5" aria-hidden="true" />
            麻薬
          </span>
        )}
        {row.original.is_psychotropic && (
          <span className="inline-flex items-center gap-0.5 rounded bg-tag-hazard/10 px-1 py-0.5 text-xs font-medium text-tag-hazard">
            <Shield className="size-2.5" aria-hidden="true" />
            向精神
          </span>
        )}
        {row.original.is_high_risk && (
          <span className="inline-flex items-center gap-0.5 rounded border border-tag-hazard/30 bg-tag-hazard/10 px-1 py-0.5 text-xs font-medium text-tag-hazard">
            <AlertTriangle className="size-2.5" aria-hidden="true" />
            ハイリスク
          </span>
        )}
        {row.original.outpatient_injection_eligible && (
          <span className="inline-flex items-center gap-0.5 rounded border border-tag-info/30 bg-tag-info/10 px-1 py-0.5 text-xs font-medium text-tag-info">
            自己注射
          </span>
        )}
        {row.original.is_lasa_risk && (
          <span className="inline-flex items-center gap-0.5 rounded border border-tag-hazard/30 bg-tag-hazard/10 px-1 py-0.5 text-xs font-medium text-tag-hazard">
            LASA
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'drug_price',
    header: '薬価',
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">
        {row.original.drug_price != null
          ? `¥${Number(row.original.drug_price).toFixed(1)}/${row.original.unit ?? ''}`
          : '—'}
      </span>
    ),
  },
  {
    accessorKey: 'manufacturer',
    header: '製造元',
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{row.original.manufacturer ?? '—'}</span>
    ),
  },
  {
    accessorKey: 'max_administration_days',
    header: '最大日数',
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">{row.original.max_administration_days ?? '—'}</span>
    ),
  },
];
