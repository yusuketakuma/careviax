import { ErrorState } from '@/components/ui/error-state';

export default function ForbiddenPage() {
  return (
    <ErrorState
      variant="forbidden"
      size="page"
      action={{ label: 'ダッシュボードへ戻る', href: '/dashboard' }}
      secondaryAction={{ label: '設定を開く', href: '/settings', variant: 'outline' }}
    />
  );
}
