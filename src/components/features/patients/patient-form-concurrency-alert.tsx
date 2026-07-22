import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { PatientEditConflictType } from './patient-form-occ';

export interface PatientFormConcurrencyConflict {
  type: PatientEditConflictType;
  phase: 'refresh-required' | 'refreshing' | 'reconfirm-required' | 'refresh-failed';
}

export function PatientFormConcurrencyAlert({
  conflict,
  refreshAvailable,
  onRefresh,
  onReconfirm,
}: {
  conflict: PatientFormConcurrencyConflict;
  refreshAvailable: boolean;
  onRefresh: () => void;
  onReconfirm: () => void;
}) {
  const refreshing = conflict.phase === 'refreshing';
  return (
    <Alert id="patient-concurrency-conflict" variant="destructive" role="alert">
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertDescription className="space-y-3">
        <p>
          他の更新が反映されています。入力内容は保持されています。最新の版を取得し、差分を再確認してから再送してください。
        </p>
        {conflict.phase === 'reconfirm-required' ? (
          <Button type="button" variant="outline" onClick={onReconfirm}>
            入力内容を再確認して再送
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={refreshing || !refreshAvailable}
            aria-describedby={
              !refreshAvailable ? 'patient-concurrency-refresh-unavailable' : undefined
            }
            onClick={onRefresh}
          >
            {refreshing ? '最新の版を確認中...' : '最新の版を確認'}
          </Button>
        )}
        {!refreshAvailable ? (
          <p id="patient-concurrency-refresh-unavailable" className="text-sm">
            この画面では版を再取得できません。入力内容を控えたうえで画面を再読み込みしてください。
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
