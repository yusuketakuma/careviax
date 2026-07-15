'use client';

import { useRef, useState } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

type PrintActionButtonProps = {
  label?: string;
  className?: string;
  onPrint?: () => void | Promise<void>;
};

export function PrintActionButton({ label = '印刷', className, onPrint }: PrintActionButtonProps) {
  const [isPrinting, setIsPrinting] = useState(false);
  const printInFlightRef = useRef(false);
  const handlePrint = async () => {
    if (printInFlightRef.current) return;
    printInFlightRef.current = true;
    setIsPrinting(true);
    try {
      if (onPrint) {
        await onPrint();
      } else {
        window.print();
      }
    } finally {
      printInFlightRef.current = false;
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
