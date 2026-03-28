import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/loading';

type LoadingButtonProps = React.ComponentProps<typeof Button> & {
  loading?: boolean;
  loadingLabel?: React.ReactNode;
};

export function LoadingButton({
  loading = false,
  loadingLabel,
  children,
  disabled,
  ...props
}: LoadingButtonProps) {
  return (
    <Button aria-busy={loading} disabled={disabled || loading} {...props}>
      {loading ? <Spinner size="sm" className="text-current" /> : null}
      {loading ? (loadingLabel ?? children) : children}
    </Button>
  );
}
