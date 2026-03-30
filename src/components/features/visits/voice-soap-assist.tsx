'use client';

import { Languages } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  SOAP_VOICE_FIELD_LABELS,
  getVoiceInputSupportMatrix,
  type SoapVoiceField,
} from '@/lib/voice-recognition';

export function VoiceSoapAssist({
  activeField,
  error,
  interimTranscript,
  isOffline,
  isSupported,
  lastTranscript,
}: {
  activeField: SoapVoiceField | null;
  error?: string | null;
  interimTranscript?: string;
  isOffline?: boolean;
  isSupported: boolean;
  lastTranscript?: string;
}) {
  const supportMatrix = getVoiceInputSupportMatrix(isSupported);

  return (
    <Card className="border-emerald-200 bg-emerald-50/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm text-emerald-950">
          <Languages className="h-4 w-4 text-emerald-700" aria-hidden="true" />
          SOAP 音声入力
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="rounded-lg border border-emerald-200 bg-background px-3 py-2">
          {isOffline ? (
            <p className="text-xs text-muted-foreground">
              オフライン時は Web Speech API を利用できません。再接続後に各 SOAP 欄の
              「音声入力」ボタンを使用してください。
            </p>
          ) : activeField ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-emerald-700">
                {SOAP_VOICE_FIELD_LABELS[activeField]} 欄に音声入力中
              </p>
              <p className="text-xs italic text-muted-foreground">
                {interimTranscript || '音声を認識しています...'}
              </p>
            </div>
          ) : lastTranscript ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-emerald-700">直近の反映テキスト</p>
              <p className="text-sm text-foreground">{lastTranscript}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              各 SOAP セクションの「音声入力」ボタンから `ja-JP` 認識を開始できます。
              確定したテキストはその欄へ追記され、既存の IndexedDB 下書き保存にも自動で反映されます。
            </p>
          )}
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
            <p className="text-xs font-medium text-foreground">デスクトップ</p>
            <p className="mt-1 text-xs text-emerald-700">{supportMatrix.desktop}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Chrome / Edge を推奨
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
            <p className="text-xs font-medium text-foreground">タブレット</p>
            <p className="mt-1 text-xs text-emerald-700">{supportMatrix.tablet}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              iPad Safari / Chrome を想定
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
            <p className="text-xs font-medium text-foreground">モバイル/PWA</p>
            <p className="mt-1 text-xs text-emerald-700">{supportMatrix.mobile}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              HTTPS 必須。初回のみマイク権限を要求し、バックグラウンド遷移時は録音を自動停止します。
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
