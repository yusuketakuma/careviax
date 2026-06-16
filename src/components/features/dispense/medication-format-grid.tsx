import { cn } from '@/lib/utils';
import type {
  MedicationDoseSlotKey,
  MedicationFormatGroup,
  MedicationFormatLine,
} from '@/app/(dashboard)/dispense/dispense-workbench.shared';

type MedicationFormatGridMode = 'dispense' | 'dispenseAudit' | 'set' | 'setAudit';

type MedicationFormatGridProps = {
  title: string;
  groups: MedicationFormatGroup[];
  mode: MedicationFormatGridMode;
  className?: string;
};

const SLOT_KEYS: MedicationDoseSlotKey[] = ['morning', 'noon', 'evening', 'bedtime'];

const MODE_LABELS: Record<MedicationFormatGridMode, string> = {
  dispense: '調剤確認',
  dispenseAudit: '調剤監査',
  set: 'セット',
  setAudit: 'セット監査',
};

function joinLabels(labels: string[], emptyLabel: string) {
  return labels.length > 0 ? labels.join(' / ') : emptyLabel;
}

function LineBadges({ line }: { line: MedicationFormatLine }) {
  const labels = [...new Set([...line.cautionLabels, ...line.processingLabels])];
  if (labels.length === 0) return null;

  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <span
          key={label}
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
            label === '麻薬' || label === '粉砕不可'
              ? 'border-red-200 bg-red-50 text-red-800'
              : label === '冷所'
                ? 'border-cyan-200 bg-cyan-50 text-cyan-800'
                : 'border-amber-200 bg-amber-50 text-amber-800',
          )}
        >
          {label}
        </span>
      ))}
    </span>
  );
}

function SlotValue({
  line,
  slotKey,
  className,
}: {
  line: MedicationFormatLine;
  slotKey: MedicationDoseSlotKey;
  className?: string;
}) {
  const slot = line.slots[slotKey];
  return (
    <span
      className={cn(
        'inline-flex min-h-8 min-w-12 items-center justify-center rounded-md border px-1.5 text-sm font-semibold tabular-nums',
        slot.status === 'scheduled' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
        slot.status === 'needs_check' && 'border-amber-200 bg-amber-50 text-amber-800',
        slot.status === 'none' && 'border-border/60 bg-muted/40 text-muted-foreground',
        className,
      )}
      aria-label={`${line.drugName} ${slot.label} ${slot.text}`}
    >
      {slot.text}
    </span>
  );
}

function DesktopGroupTable({ group }: { group: MedicationFormatGroup }) {
  return (
    <section
      aria-labelledby={`medication-format-group-${group.id}`}
      className="rounded-lg border border-border/70 bg-card"
      data-testid="medication-format-group"
    >
      <div className="border-b border-border/70 px-2.5 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3
            id={`medication-format-group-${group.id}`}
            className="text-sm font-bold text-foreground"
          >
            {group.label}
          </h3>
          <span className="text-xs text-muted-foreground">{group.lines.length}品目</span>
        </div>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{group.description}</p>
      </div>

      <div className="max-w-full overflow-x-auto overscroll-x-contain">
        <table className="min-w-[780px] border-separate border-spacing-0 text-sm">
          <thead className="bg-muted/35 text-xs text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 w-[200px] border-b border-border/70 bg-muted px-2.5 py-1.5 text-left font-semibold">
                薬剤名
              </th>
              <th className="w-[80px] border-b border-border/70 px-2 py-2 text-left font-semibold">
                用法
              </th>
              {SLOT_KEYS.map((slotKey) => (
                <th
                  key={slotKey}
                  className="w-[56px] border-b border-border/70 px-1.5 py-1.5 text-center font-semibold"
                >
                  {group.lines[0]?.slots[slotKey].label}
                </th>
              ))}
              <th className="w-[78px] border-b border-border/70 px-2 py-1.5 text-left font-semibold">
                日数/総量
              </th>
              <th className="w-[64px] border-b border-border/70 px-2 py-1.5 text-left font-semibold">
                加工
              </th>
              <th className="w-[100px] border-b border-border/70 px-2 py-1.5 text-left font-semibold">
                備考
              </th>
              <th className="w-[60px] border-b border-border/70 px-2 py-1.5 text-left font-semibold">
                状態
              </th>
            </tr>
          </thead>
          <tbody>
            {group.lines.map((line) => (
              <tr key={line.lineId} className="align-top odd:bg-background even:bg-muted/15">
                <td className="sticky left-0 z-10 border-b border-border/50 bg-inherit px-2.5 py-2">
                  <div className="font-bold leading-5 text-foreground">{line.drugName}</div>
                  {line.doseText ? (
                    <div className="mt-0.5 text-xs text-muted-foreground">{line.doseText}</div>
                  ) : null}
                  <LineBadges line={line} />
                </td>
                <td className="border-b border-border/50 px-2 py-2 text-foreground">
                  {line.usage}
                </td>
                {SLOT_KEYS.map((slotKey) => (
                  <td key={slotKey} className="border-b border-border/50 px-1.5 py-1.5 text-center">
                    <SlotValue line={line} slotKey={slotKey} />
                  </td>
                ))}
                <td className="border-b border-border/50 px-2 py-2 text-foreground">
                  <div>{line.days != null ? `${line.days}日分` : '日数未登録'}</div>
                  <div className="text-xs text-muted-foreground">総量 {line.quantityLabel}</div>
                </td>
                <td className="border-b border-border/50 px-2 py-2 text-foreground">
                  {joinLabels(line.processingLabels, '通常')}
                </td>
                <td className="border-b border-border/50 px-2 py-2 text-muted-foreground">
                  {joinLabels(line.notes, '—')}
                </td>
                <td className="border-b border-border/50 px-2 py-2">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                      line.statusLabel === '数量未確定'
                        ? 'bg-red-50 text-red-700'
                        : line.statusLabel === '調剤済'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-600',
                    )}
                  >
                    {line.statusLabel}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MobileGroupCards({ group }: { group: MedicationFormatGroup }) {
  return (
    <section
      aria-labelledby={`medication-format-mobile-group-${group.id}`}
      className="rounded-lg border border-border/70 bg-card p-2.5"
      data-testid="medication-format-mobile-group"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3
          id={`medication-format-mobile-group-${group.id}`}
          className="text-sm font-bold text-foreground"
        >
          {group.label}
        </h3>
        <span className="text-xs text-muted-foreground">{group.lines.length}品目</span>
      </div>
      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{group.description}</p>
      <div className="mt-2 space-y-1.5">
        {group.lines.map((line) => (
          <article
            key={line.lineId}
            className="rounded-lg border border-border/60 bg-background p-2.5"
            aria-label={`${line.drugName} ${line.usage}`}
          >
            <h4 className="text-sm font-bold leading-5 text-foreground">{line.drugName}</h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {line.usage}
              {line.doseText ? ` / ${line.doseText}` : ''} /{' '}
              {line.days != null ? `${line.days}日分` : '日数未登録'} / 総量 {line.quantityLabel}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1.5" aria-label="服用時点">
              {SLOT_KEYS.map((slotKey) => (
                <div key={slotKey} className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {line.slots[slotKey].label}
                  </span>
                  <SlotValue line={line} slotKey={slotKey} className="min-h-[36px] min-w-16" />
                </div>
              ))}
            </div>
            <LineBadges line={line} />
            <dl className="mt-2 grid gap-1.5 text-xs">
              <div>
                <dt className="font-medium text-muted-foreground">加工</dt>
                <dd className="mt-0.5 text-foreground">
                  {joinLabels(line.processingLabels, '通常')}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">備考</dt>
                <dd className="mt-0.5 text-muted-foreground">{joinLabels(line.notes, '—')}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

export function MedicationFormatGrid({
  title,
  groups,
  mode,
  className,
}: MedicationFormatGridProps) {
  const itemCount = groups.reduce((sum, group) => sum + group.lines.length, 0);

  return (
    <section
      className={cn('rounded-lg border border-border/70 bg-muted/20 p-2.5', className)}
      aria-label={title}
      data-testid="medication-format-grid"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h2 className="text-sm font-bold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Excel 原票と同じ順に、包装方法・薬剤名・用法・朝昼夕眠前・加工指示を確認します。
          </p>
        </div>
        <p className="text-xs font-medium text-muted-foreground">
          {MODE_LABELS[mode]} / {itemCount}品目
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="mt-2 rounded-md border border-dashed border-border/70 bg-card px-3 py-2 text-sm text-muted-foreground">
          表示できる薬剤明細はありません。
        </p>
      ) : (
        <>
          <div className="mt-2 hidden space-y-2 md:block">
            {groups.map((group) => (
              <DesktopGroupTable key={group.id} group={group} />
            ))}
          </div>
          <div className="mt-2 space-y-2 md:hidden">
            {groups.map((group) => (
              <MobileGroupCards key={group.id} group={group} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
