import { formatDateLabel } from '@/lib/ui/date-format';

export function formatReportDate(value?: string | null): string {
  return formatDateLabel(value, { pattern: 'yyyy年M月d日' });
}
