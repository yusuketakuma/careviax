'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

type PrintActionButtonProps = {
  label?: string;
  className?: string;
};

export function PrintActionButton({
  label = '印刷',
  className,
}: PrintActionButtonProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={className}
      onClick={() => window.print()}
    >
      <Printer className="mr-1.5 size-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
