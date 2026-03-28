import { ErrorState } from '@/components/ui/error-state';

export default function NotFound() {
  return (
    <ErrorState
      variant="not-found"
      size="page"
      action={{ label: 'ダッシュボードへ戻る', href: '/dashboard' }}
      secondaryAction={{ label: '患者一覧へ', href: '/patients', variant: 'outline' }}
    />
  );
}
