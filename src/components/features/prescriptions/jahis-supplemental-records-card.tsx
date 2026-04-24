import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { JahisSupplementalRecordView } from '@/lib/pharmacy/jahis-supplemental-records-view';

export function JahisSupplementalRecordsCard({
  records,
  description,
  className,
  gridClassName = 'grid gap-3',
}: {
  records: JahisSupplementalRecordView[];
  description: string;
  className?: string;
  gridClassName?: string;
}) {
  if (records.length === 0) return null;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
          JAHIS補足情報
        </CardTitle>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className={gridClassName}>
        {records.map((record, index) => (
          <div
            key={record.id ?? `${record.recordType}-${record.lineNumber}-${index}`}
            className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-medium text-foreground">{record.recordLabel}</p>
              <Badge variant="outline" className="text-[11px]">
                {record.recordType} / {record.lineNumber}行目
              </Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {record.summary || record.rawLine}
            </p>
            {(record.details?.length ?? 0) > 0 && (
              <dl className={cn('mt-2 grid gap-1 text-xs', records.length > 1 && 'sm:grid-cols-2')}>
                {(record.details ?? []).map((detail) => (
                  <div key={`${detail.label}-${detail.value}`} className="min-w-0">
                    <dt className="text-muted-foreground">{detail.label}</dt>
                    <dd className="break-words font-medium text-foreground">{detail.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
