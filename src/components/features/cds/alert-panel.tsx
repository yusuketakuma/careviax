'use client';

import { useState } from 'react';
import { AlertTriangle, AlertCircle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CdsAlert = {
  type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  details?: Record<string, unknown>;
};

type AlertItemProps = {
  alert: CdsAlert;
};

function AlertItem({ alert }: AlertItemProps) {
  const [expanded, setExpanded] = useState(false);

  const config = {
    critical: {
      icon: AlertTriangle,
      containerClass: 'border-destructive/40 bg-destructive/5',
      iconClass: 'text-destructive',
      titleClass: 'text-destructive font-semibold',
      label: '禁忌・危険',
    },
    warning: {
      icon: AlertCircle,
      containerClass: 'border-orange-400/40 bg-orange-50',
      iconClass: 'text-orange-600',
      titleClass: 'text-orange-700 font-semibold',
      label: '注意',
    },
    info: {
      icon: Info,
      containerClass: 'border-blue-400/40 bg-blue-50',
      iconClass: 'text-blue-600',
      titleClass: 'text-blue-700 font-semibold',
      label: '情報',
    },
  } as const satisfies Record<
    CdsAlert['severity'],
    {
      icon: typeof AlertTriangle;
      containerClass: string;
      iconClass: string;
      titleClass: string;
      label: string;
    }
  >;

  const alertConfig = config[alert.severity];

  const Icon = alertConfig.icon;
  const hasDetails = alert.details && Object.keys(alert.details).length > 0;

  return (
    <div className={cn('rounded-md border px-3 py-2.5 text-sm', alertConfig.containerClass)}>
      <div className="flex items-start gap-2">
        <Icon className={cn('mt-0.5 size-4 shrink-0', alertConfig.iconClass)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('text-xs uppercase', alertConfig.iconClass)}>
              {alertConfig.label}
            </span>
          </div>
          <p className={cn('mt-0.5', alertConfig.titleClass)}>{alert.message}</p>

          {hasDetails && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 flex min-h-[44px] min-w-[44px] items-center gap-1 rounded-sm py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={expanded}
            >
              {expanded ? (
                <>
                  <ChevronUp className="size-3" aria-hidden="true" />
                  詳細を隠す
                </>
              ) : (
                <>
                  <ChevronDown className="size-3" aria-hidden="true" />
                  詳細を見る
                </>
              )}
            </button>
          )}

          {expanded && hasDetails && (
            <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
              {alert.details?.mechanism !== undefined && (
                <div>
                  <dt className="font-medium">作用機序</dt>
                  <dd>{String(alert.details.mechanism)}</dd>
                </div>
              )}
              {alert.details?.effect !== undefined && (
                <div>
                  <dt className="font-medium">臨床的影響</dt>
                  <dd>{String(alert.details.effect)}</dd>
                </div>
              )}
              {alert.details?.max_days !== undefined && (
                <div>
                  <dt className="font-medium">投与日数上限</dt>
                  <dd>{String(alert.details.max_days)}日</dd>
                </div>
              )}
              {alert.details?.prescribed_days !== undefined && (
                <div>
                  <dt className="font-medium">処方日数</dt>
                  <dd>{String(alert.details.prescribed_days)}日</dd>
                </div>
              )}
              {alert.details?.patient_age !== undefined && (
                <div>
                  <dt className="font-medium">患者年齢</dt>
                  <dd>{String(alert.details.patient_age)}歳</dd>
                </div>
              )}
              {alert.details?.egfr !== undefined && (
                <div>
                  <dt className="font-medium">eGFR</dt>
                  <dd>{String(alert.details.egfr)}</dd>
                </div>
              )}
              {alert.details?.egfr_range !== undefined && (
                <div>
                  <dt className="font-medium">該当レンジ</dt>
                  <dd>{String(alert.details.egfr_range)}</dd>
                </div>
              )}
              {alert.details?.recommendation !== undefined && (
                <div>
                  <dt className="font-medium">推奨対応</dt>
                  <dd>{String(alert.details.recommendation)}</dd>
                </div>
              )}
              {alert.details?.drug_display_name !== undefined && (
                <div>
                  <dt className="font-medium">確認表示名</dt>
                  <dd>{String(alert.details.drug_display_name)}</dd>
                </div>
              )}
              {alert.details?.tall_man_name !== undefined && (
                <div>
                  <dt className="font-medium">Tall Man表記</dt>
                  <dd>{String(alert.details.tall_man_name)}</dd>
                </div>
              )}
              {alert.details?.lasa_group_key !== undefined && (
                <div>
                  <dt className="font-medium">LASAグループ</dt>
                  <dd>{String(alert.details.lasa_group_key)}</dd>
                </div>
              )}
              {alert.details?.allergy_drug !== undefined && (
                <div>
                  <dt className="font-medium">既知アレルギー</dt>
                  <dd>{String(alert.details.allergy_drug)}</dd>
                </div>
              )}
              {alert.details?.allergy_severity !== undefined && (
                <div>
                  <dt className="font-medium">アレルギー重症度</dt>
                  <dd>
                    {(
                      {
                        severe: '重度',
                        moderate: '中等度',
                        mild: '軽度',
                        unknown: '不明',
                      } as Record<string, string>
                    )[String(alert.details.allergy_severity)] ??
                      String(alert.details.allergy_severity)}
                  </dd>
                </div>
              )}
              {alert.details?.analyte !== undefined && (
                <div>
                  <dt className="font-medium">検査項目</dt>
                  <dd>{String(alert.details.analyte).toUpperCase()}</dd>
                </div>
              )}
              {alert.details?.value !== undefined && (
                <div>
                  <dt className="font-medium">直近値</dt>
                  <dd>{String(alert.details.value)}</dd>
                </div>
              )}
              {alert.details?.therapeutic_category !== undefined && (
                <div>
                  <dt className="font-medium">薬効分類</dt>
                  <dd>{String(alert.details.therapeutic_category)}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}

type AlertPanelProps = {
  alerts: CdsAlert[];
  isLoading?: boolean;
  isUnavailable?: boolean;
  className?: string;
};

export function CdsAlertPanel({ alerts, isLoading, isUnavailable, className }: AlertPanelProps) {
  if (isLoading) {
    return (
      <div className={cn('space-y-2', className)} role="status" aria-live="polite">
        <span className="sr-only">処方安全アラートを確認中です</span>
        <div className="h-10 animate-pulse rounded-md bg-muted" />
        <div className="h-10 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  if (isUnavailable) {
    return (
      <div
        className={cn(
          'rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm',
          className,
        )}
        role="alert"
        aria-live="assertive"
      >
        <div className="flex items-start gap-2 text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">処方安全チェックを完了できません</p>
            <p className="mt-1 text-destructive/90">
              禁忌・相互作用・アレルギー等の確認結果が未確定です。通信状態と権限を確認してから再試行してください。
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div
        className={cn(
          'rounded-md border border-green-300 bg-green-50 px-3 py-2.5 text-sm',
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-green-700">
          <Info className="size-4 shrink-0" aria-hidden="true" />
          <span>処方安全アラートはありません</span>
        </div>
      </div>
    );
  }

  const criticals = alerts.filter((a) => a.severity === 'critical');
  const warnings = alerts.filter((a) => a.severity === 'warning');
  const infos = alerts.filter((a) => a.severity === 'info');
  const nonCriticalAlerts = [...warnings, ...infos];

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span>処方安全アラート</span>
        {criticals.length > 0 && (
          <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
            禁忌 {criticals.length}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="rounded-full bg-orange-500 px-2 py-0.5 text-xs font-semibold text-white">
            注意 {warnings.length}
          </span>
        )}
        {infos.length > 0 && (
          <span className="rounded-full bg-blue-500 px-2 py-0.5 text-xs font-semibold text-white">
            情報 {infos.length}
          </span>
        )}
      </div>

      {criticals.length > 0 && (
        <div role="alert" aria-live="assertive" aria-atomic="true" className="space-y-2">
          {criticals.map((alert, index) => (
            <AlertItem key={`critical-${index}`} alert={alert} />
          ))}
        </div>
      )}

      {nonCriticalAlerts.length > 0 && (
        <div role="status" aria-live="polite" aria-atomic="true" className="space-y-2">
          {nonCriticalAlerts.map((alert, index) => (
            <AlertItem key={`${alert.severity}-${index}`} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}
