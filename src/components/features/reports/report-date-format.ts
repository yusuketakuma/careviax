import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';

export function formatReportDate(value?: string | null): string {
  if (!value) return '—';
  const parsed = parseISO(value);
  if (!Number.isNaN(parsed.getTime())) {
    return format(parsed, 'yyyy年M月d日', { locale: ja });
  }
  return value;
}
