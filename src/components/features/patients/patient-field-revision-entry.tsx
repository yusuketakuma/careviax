import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  REVISION_CATEGORY_LABELS,
  REVISION_SOURCE_LABELS,
  hasStructuredRevisionValue,
  isLegacyPresenceOnlyRevision,
  revisionChangeTypeMeta,
  revisionDetailText,
} from './patient-field-revision-presentation';
import type { PatientFieldRevisionTimelineItem } from './patient-field-revision-timeline-response-schema';

const REVISION_VALUE_KEY_LABELS: Record<string, string> = {
  name: '氏名・名称',
  relation: '続柄・関係',
  phone: '電話番号',
  email: 'メールアドレス',
  fax: 'FAX',
  organization_name: '所属組織',
  department: '部署',
  address: '住所',
  is_primary: '主連絡先・主病名',
  is_emergency_contact: '緊急連絡先',
  notes: '備考',
  condition_type: '区分',
  is_active: '有効',
  noted_at: '確認日',
  allergen: '原因物質',
  reaction: '反応',
  severity: '重症度',
};

const REVISION_ENUM_VALUE_LABELS: Record<string, Record<string, string>> = {
  condition_type: {
    disease: '病名',
    problem: '問題',
  },
};

const REVISION_IMPORTANCE_META = {
  normal: null,
  caution: {
    label: '要確認',
    className: 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm',
  },
  urgent: {
    label: '緊急',
    className: 'border-state-blocked/30 bg-state-blocked/10 text-state-blocked',
  },
} as const;

function revisionObjectKeyLabel(key: string, index: number): string {
  return REVISION_VALUE_KEY_LABELS[key] ?? `詳細${index + 1}`;
}

function RevisionValue({
  value,
  valueKey,
}: {
  value: PatientFieldRevisionTimelineItem['previous'];
  valueKey?: string;
}) {
  if (value == null || value === '') {
    return <span className="text-muted-foreground">未設定</span>;
  }
  if (typeof value === 'boolean') return <span>{value ? 'あり' : 'なし'}</span>;
  if (typeof value === 'number') return <span className="tabular-nums">{value}</span>;
  if (typeof value === 'string') {
    const label = valueKey ? REVISION_ENUM_VALUE_LABELS[valueKey]?.[value] : undefined;
    return <span className="break-words whitespace-pre-wrap">{label ?? value}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">なし</span>;
    return (
      <ol className="divide-y divide-border/70">
        {value.map((item, index) => (
          <li key={index} className="py-2 first:pt-0 last:pb-0">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">{index + 1}件目</p>
            <RevisionValue value={item} />
          </li>
        ))}
      </ol>
    );
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return <span className="text-muted-foreground">なし</span>;
  return (
    <dl className="space-y-1.5">
      {entries.map(([key, item], index) => (
        <div key={key} className="grid min-w-0 grid-cols-[minmax(6rem,0.35fr)_1fr] gap-2">
          <dt className="text-xs leading-5 font-medium text-muted-foreground">
            {revisionObjectKeyLabel(key, index)}
          </dt>
          <dd className="min-w-0 text-sm leading-5 text-foreground">
            <RevisionValue value={item} valueKey={key} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ExactRevisionDiff({ item }: { item: PatientFieldRevisionTimelineItem }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2" aria-label="変更前後の正確な値">
      <div className="min-w-0 rounded-md border border-border/70 bg-muted/20 p-3">
        <dt className="text-xs font-semibold text-muted-foreground">変更前</dt>
        <dd className="mt-1 min-w-0 text-sm leading-5 text-foreground">
          <RevisionValue value={item.previous} />
        </dd>
      </div>
      <div className="min-w-0 rounded-md border border-border/70 bg-background p-3">
        <dt className="text-xs font-semibold text-foreground">変更後</dt>
        <dd className="mt-1 min-w-0 text-sm leading-5 text-foreground">
          <RevisionValue value={item.current} />
        </dd>
      </div>
    </dl>
  );
}

export function PatientFieldRevisionEntry({
  item,
  showSource = true,
}: {
  item: PatientFieldRevisionTimelineItem;
  showSource?: boolean;
}) {
  const changeType = revisionChangeTypeMeta(item);
  const detail = revisionDetailText(item);
  const legacyPresenceOnly = isLegacyPresenceOnlyRevision(item);
  const structuredValue = hasStructuredRevisionValue(item);
  const importance = REVISION_IMPORTANCE_META[item.importance];

  return (
    <li className="px-3 py-3 text-sm" data-testid="patient-field-revision-entry">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="outline" className="shrink-0 text-xs">
            {REVISION_CATEGORY_LABELS[item.category] ?? item.category}
          </Badge>
          <p className="min-w-0 font-medium text-foreground">
            {item.field_label ?? item.field_key}
          </p>
          {item.is_current ? (
            <Badge variant="outline" className="border-border bg-background text-muted-foreground">
              現在適用中
            </Badge>
          ) : null}
          {importance ? (
            <Badge variant="outline" className={importance.className}>
              {importance.label}
            </Badge>
          ) : null}
        </div>
        <Badge variant="outline" className={cn('shrink-0 text-xs', changeType.className)}>
          {changeType.label}
        </Badge>
      </div>

      {detail ? (
        <p className="mt-2 break-words whitespace-pre-wrap text-sm leading-5 text-foreground">
          {detail}
        </p>
      ) : null}

      {legacyPresenceOnly ? (
        <p
          className="mt-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm leading-5 text-muted-foreground"
          data-testid="legacy-presence-only-revision"
        >
          この履歴は旧形式のため、変更前後の詳細値を表示できません。
        </p>
      ) : structuredValue ? (
        <details className="mt-2 rounded-md border border-border/70 bg-background">
          <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm leading-5 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
            変更前後の正確な値を表示
          </summary>
          <div className="border-t border-border/70 p-3">
            <ExactRevisionDiff item={item} />
          </div>
        </details>
      ) : !detail ? (
        <div className="mt-2">
          <ExactRevisionDiff item={item} />
        </div>
      ) : null}

      {item.change_reason ? (
        <p className="mt-2 break-words whitespace-pre-wrap text-sm leading-5 text-foreground">
          <span className="font-medium">変更理由:</span> {item.change_reason}
        </p>
      ) : null}

      <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground">
        <div className="flex gap-1">
          <dt>記録:</dt>
          <dd className="tabular-nums">
            {format(new Date(item.created_at), 'yyyy年M月d日 HH:mm')}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>更新者:</dt>
          <dd>{item.updated_by_name ?? '不明'}</dd>
        </div>
        {showSource ? (
          <div className="flex gap-1">
            <dt>確認元:</dt>
            <dd>{REVISION_SOURCE_LABELS[item.source] ?? item.source}</dd>
          </div>
        ) : null}
        <div className="flex gap-1">
          <dt>適用:</dt>
          <dd className="tabular-nums">
            {format(new Date(item.valid_from), 'yyyy年M月d日')}
            {item.valid_to ? `〜${format(new Date(item.valid_to), 'yyyy年M月d日')}` : '〜現在'}
          </dd>
        </div>
        {item.confirmed_at ? (
          <div className="flex gap-1">
            <dt>確認:</dt>
            <dd>
              {item.confirmed_by_name ?? '確認者不明'}・
              <span className="tabular-nums">
                {format(new Date(item.confirmed_at), 'yyyy年M月d日 HH:mm')}
              </span>
            </dd>
          </div>
        ) : null}
      </dl>
    </li>
  );
}

export function PatientFieldRevisionList({
  items,
  showSource = true,
}: {
  items: PatientFieldRevisionTimelineItem[];
  showSource?: boolean;
}) {
  return (
    <ul className="divide-y divide-border/70 rounded-md border border-border/70 bg-background">
      {items.map((item) => (
        <PatientFieldRevisionEntry key={item.id} item={item} showSource={showSource} />
      ))}
    </ul>
  );
}
