'use client';

import { Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SOAP_VOICE_FIELD_LABELS, type SoapVoiceField } from '@/lib/voice-recognition';

type SoapVoiceFieldToggleProps = {
  field: SoapVoiceField;
  activeField: SoapVoiceField | null;
  disabled?: boolean;
  error?: string | null;
  interimTranscript?: string;
  isOffline?: boolean;
  isSupported: boolean;
  onToggle: (field: SoapVoiceField) => void;
};

export function SoapVoiceFieldToggle({
  field,
  activeField,
  disabled,
  error,
  interimTranscript,
  isOffline,
  isSupported,
  onToggle,
}: SoapVoiceFieldToggleProps) {
  const isActive = activeField === field;
  const isUnavailable = disabled || !isSupported || isOffline;

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        size="sm"
        variant={isActive ? 'destructive' : 'outline'}
        className={isActive ? 'animate-pulse gap-1.5' : 'gap-1.5'}
        disabled={isUnavailable}
        onClick={() => onToggle(field)}
      >
        {isActive ? (
          <MicOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Mic className="h-4 w-4" aria-hidden="true" />
        )}
        {isActive ? `${SOAP_VOICE_FIELD_LABELS[field]} 音声入力を停止` : '音声入力'}
      </Button>
      {isOffline ? (
        <p className="text-xs text-muted-foreground">
          オフライン時は音声入力を利用できません
        </p>
      ) : !isSupported ? (
        <p className="text-xs text-muted-foreground">
          このブラウザでは Web Speech API を利用できません
        </p>
      ) : isActive ? (
        <p className="text-xs italic text-muted-foreground">
          {interimTranscript || '音声を認識しています...'}
        </p>
      ) : null}
      {isActive && error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
