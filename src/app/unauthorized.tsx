import { ErrorState } from '@/components/ui/error-state';

export default function UnauthorizedPage() {
  return (
    <ErrorState
      variant="unauthorized"
      size="page"
      action={{ label: 'ログイン画面へ', href: '/login' }}
      secondaryAction={{ label: 'パスワード再設定', href: '/password/reset', variant: 'outline' }}
    />
  );
}
