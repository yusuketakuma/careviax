'use client';

import { useState } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

type PrintActionButtonProps = {
  label?: string;
  className?: string;
  onPrint?: () => void | Promise<void>;
};

export function PrintActionButton({ label = '印刷', className, onPrint }: PrintActionButtonProps) {
  const [isPrinting, setIsPrinting] = useState(false);
  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      if (onPrint) {
        await onPrint();
      } else {
        window.print();
      }
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={className}
      disabled={isPrinting}
      onClick={() => {
        void handlePrint();
      }}
    >
      <Printer className="mr-1.5 size-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
