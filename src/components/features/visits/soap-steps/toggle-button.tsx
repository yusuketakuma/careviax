'use client';

interface ToggleButtonProps {
  selected: boolean;
  label: string;
  onToggle: () => void;
}

export function ToggleButton({ selected, label, onToggle }: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`min-h-[44px] rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
        selected
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-input bg-background text-foreground hover:bg-accent'
      }`}
    >
      {label}
    </button>
  );
}
