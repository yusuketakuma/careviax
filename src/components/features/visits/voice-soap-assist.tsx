'use client';

import { Languages, Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  SOAP_VOICE_FIELD_LABELS,
  getVoiceInputSupportMatrix,
  type SoapVoiceField,
} from '@/lib/voice-recognition';

const VOICE_CAPTURE_TARGETS: Array<{
  field: SoapVoiceField;
  label: string;
  description: string;
}> = [
  {
    field: 'soap_subjective',
    label: '訴えを聞く',
    description: '患者・家族の言葉',
  },
  {
    field: 'soap_objective',
    label: '観察を残す',
    description: '残薬・副作用・生活状況',
  },
  {
    field: 'soap_assessment',
    label: '評価を残す',
    description: '薬学的判断',
  },
  {
    field: 'soap_plan',
    label: '次回対応を残す',
    description: '介入・申し送り',
  },
];

export function VoiceSoapAssist({
  activeField,
  disabled,
  error,
  interimTranscript,
  isOffline,
  isSupported,
  lastTranscript,
  onToggle,
}: {
  activeField: SoapVoiceField | null;
  disabled?: boolean;
  error?: string | null;
  interimTranscript?: string;
  isOffline?: boolean;
  isSupported: boolean;
  lastTranscript?: string;
  onToggle?: (field: SoapVoiceField) => void;
}) {
  const supportMatrix = getVoiceInputSupportMatrix(isSupported);
  const voiceControlsDisabled = disabled || isOffline || !isSupported;

  return (
    <Card className="border-border bg-muted/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm text-foreground">
          <Languages className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          SOAP 音声入力
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {onToggle ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {VOICE_CAPTURE_TARGETS.map((target) => {
              const isActive = activeField === target.field;
              return (
                <Button
                  key={target.field}
                  type="button"
                  variant={isActive ? 'default' : 'outline'}
                  disabled={voiceControlsDisabled}
                  onClick={() => onToggle(target.field)}
                  className={cn('min-h-16 justify-start gap-2 rounded-xl px-3 text-left')}
                  aria-pressed={isActive}
                >
                  {isActive ? (
                    <MicOff className="size-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <Mic className="size-4 shrink-0" aria-hidden="true" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">
                      {isActive ? `${SOAP_VOICE_FIELD_LABELS[target.field]} 停止` : target.label}
                    </span>
                    <span
                      className={cn(
                        'mt-0.5 block text-xs',
                        isActive ? 'text-primary-foreground/85' : 'text-muted-foreground',
                      )}
                    >
                      {target.description}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
        ) : null}

        <div className="rounded-lg border border-border bg-background px-3 py-2">
          {isOffline ? (
            <p className="text-xs text-muted-foreground">
              オフライン時は Web Speech API を利用できません。再接続後に各 SOAP 欄の
              聞き取りボタンを使用してください。
            </p>
          ) : activeField ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">
                {SOAP_VOICE_FIELD_LABELS[activeField]} 欄に音声入力中
              </p>
              <p className="text-xs italic text-muted-foreground">
                {interimTranscript || '音声を認識しています...'}
              </p>
            </div>
          ) : lastTranscript ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">直近の反映テキスト</p>
              <p className="text-sm text-foreground">{lastTranscript}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              画面上部の聞き取りボタンから `ja-JP` 認識を開始できます。
              確定したテキストはその欄へ追記され、既存の IndexedDB
              下書き保存にも自動で反映されます。
            </p>
          )}
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
            <p className="text-xs font-medium text-foreground">デスクトップ</p>
            <p className="mt-1 text-xs text-muted-foreground">{supportMatrix.desktop}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Chrome / Edge を推奨</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
            <p className="text-xs font-medium text-foreground">タブレット</p>
            <p className="mt-1 text-xs text-muted-foreground">{supportMatrix.tablet}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">iPad Safari / Chrome を想定</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
            <p className="text-xs font-medium text-foreground">モバイル/PWA</p>
            <p className="mt-1 text-xs text-muted-foreground">{supportMatrix.mobile}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              HTTPS 必須。初回のみマイク権限を要求し、バックグラウンド遷移時は録音を自動停止します。
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
