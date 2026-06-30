'use client';

import { useMemo, useState } from 'react';
import { APIProvider, InfoWindow, Map, Marker, Polyline } from '@vis.gl/react-google-maps';
import { Badge } from '@/components/ui/badge';

type VisitMapStatus =
  | 'planned'
  | 'in_preparation'
  | 'ready'
  | 'departed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'postponed'
  | 'rescheduled'
  | 'no_show';

type VisitMapPriority = 'normal' | 'urgent' | 'emergency';

/**
 * data-URI SVG の fill には CSS トークン(var(--state-*))を注入できないため、
 * globals.css の状態トークン(oklch)を 16進近似した値を 1 箇所に集約する。
 * 状態色とマップピン色の二重定義によるドリフトを防ぐための単一ソース。
 * role は 6 軸セマンティック(status-tokens.ts の StatusRole)に対応する。
 */
type MarkerRole = 'blocked' | 'done' | 'confirm' | 'info';

const MARKER_ROLE_HEX: Record<MarkerRole, string> = {
  blocked: '#bb1322', // --state-blocked (赤) — 止まっている理由
  done: '#2a7b42', // --state-done (緑) — 完了
  confirm: '#955600', // --state-confirm (橙) — 要確認・候補
  info: '#005f9e', // --tag-info (青) — 通常・予定・進行中
};

export type VisitRouteMapPoint = {
  scheduleId: string;
  patientName: string;
  address: string;
  lat: number;
  lng: number;
  orderLabel: string;
  status: VisitMapStatus;
  priority: VisitMapPriority;
  etaLabel: string | null;
  timeLabel?: string | null;
  pointKind?: 'proposal' | 'schedule';
};

function markerRole(
  point: Pick<VisitRouteMapPoint, 'status' | 'priority' | 'pointKind'>,
): MarkerRole {
  if (point.priority === 'emergency') return 'blocked';
  if (point.pointKind === 'proposal') return 'confirm';
  if (point.status === 'completed') return 'done';
  if (point.status === 'cancelled' || point.status === 'no_show') return 'blocked';
  if (point.status === 'postponed' || point.status === 'rescheduled') return 'confirm';
  // planned / in_preparation / ready / departed / in_progress → info(青)
  return 'info';
}

function markerColor(point: Pick<VisitRouteMapPoint, 'status' | 'priority' | 'pointKind'>) {
  return MARKER_ROLE_HEX[markerRole(point)];
}

const statusLabel: Record<VisitMapStatus, string> = {
  planned: '予定',
  in_preparation: '準備中',
  ready: '訪問準備完了',
  departed: '出発済み',
  in_progress: '訪問中',
  completed: '完了',
  cancelled: 'キャンセル',
  postponed: '延期',
  rescheduled: 'リスケ済み',
  no_show: '不在',
};

const priorityLabel: Record<VisitMapPriority, string> = {
  normal: '通常',
  urgent: '至急',
  emergency: '緊急',
};

function pointKindLabel(pointKind: VisitRouteMapPoint['pointKind']) {
  if (pointKind === 'proposal') return '候補';
  if (pointKind === 'schedule') return '確定予定';
  return '訪問先';
}

function mapPointTitle(point: VisitRouteMapPoint) {
  return [
    `順路 ${point.orderLabel}`,
    point.patientName,
    point.address,
    `種別 ${pointKindLabel(point.pointKind)}`,
    `状態 ${statusLabel[point.status]}`,
    `優先度 ${priorityLabel[point.priority]}`,
  ].join(' / ');
}

function buildMarkerIcon(orderLabel: string, fill: string) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42">
      <circle cx="21" cy="21" r="16" fill="${fill}" stroke="#ffffff" stroke-width="3" />
      <text x="21" y="26" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#ffffff">${orderLabel}</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function averageCenter(points: Array<{ lat: number; lng: number }>) {
  const totals = points.reduce(
    (acc, point) => ({
      lat: acc.lat + point.lat,
      lng: acc.lng + point.lng,
    }),
    { lat: 0, lng: 0 },
  );

  return {
    lat: totals.lat / points.length,
    lng: totals.lng / points.length,
  };
}

export function VisitRouteMap(props: {
  points: VisitRouteMapPoint[];
  encodedPath?: string | null;
  site?: { name: string; lat: number; lng: number } | null;
  note?: string | null;
  className?: string;
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const [activeScheduleId, setActiveScheduleId] = useState<string | null>(null);

  const allPoints = useMemo(() => {
    const mapped = props.points.map((point) => ({ lat: point.lat, lng: point.lng }));
    if (props.site) {
      mapped.unshift({ lat: props.site.lat, lng: props.site.lng });
    }
    return mapped;
  }, [props.points, props.site]);

  const center = useMemo(() => {
    if (allPoints.length === 0) {
      return { lat: 35.681236, lng: 139.767125 };
    }
    return averageCenter(allPoints);
  }, [allPoints]);

  const activePoint = props.points.find((point) => point.scheduleId === activeScheduleId) ?? null;

  if (!apiKey) {
    return (
      <div className={props.className}>
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          NEXT_PUBLIC_GOOGLE_MAPS_API_KEY が未設定のためマップを表示できません。
          {props.note ? <div className="mt-2">{props.note}</div> : null}
        </div>
      </div>
    );
  }

  if (props.points.length === 0) {
    return (
      <div className={props.className}>
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          地図に表示できる訪問先がありません。
          {props.note ? <div className="mt-2">{props.note}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={props.className}>
      <APIProvider apiKey={apiKey} language="ja" region="JP">
        <div className="overflow-hidden rounded-2xl border border-border bg-background">
          <Map
            defaultZoom={12}
            defaultCenter={center}
            mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? 'DEMO_MAP_ID'}
            gestureHandling="greedy"
            disableDefaultUI={false}
            className="h-[360px] w-full"
          >
            {props.encodedPath ? (
              <Polyline
                encodedPath={props.encodedPath}
                strokeColor="#0f172a"
                strokeOpacity={0.7}
                strokeWeight={4}
              />
            ) : null}
            {props.site ? (
              <Marker
                position={{ lat: props.site.lat, lng: props.site.lng }}
                title={props.site.name}
                icon={{
                  url: buildMarkerIcon('薬', '#0f172a'),
                }}
                onClick={() => setActiveScheduleId(null)}
              />
            ) : null}
            {props.points.map((point) => (
              <Marker
                key={point.scheduleId}
                position={{ lat: point.lat, lng: point.lng }}
                title={mapPointTitle(point)}
                icon={{
                  url: buildMarkerIcon(point.orderLabel, markerColor(point)),
                }}
                onClick={() => setActiveScheduleId(point.scheduleId)}
              />
            ))}
            {activePoint ? (
              <InfoWindow
                position={{ lat: activePoint.lat, lng: activePoint.lng }}
                onCloseClick={() => setActiveScheduleId(null)}
              >
                <div className="max-w-[220px] space-y-1 text-sm">
                  <div className="font-medium text-foreground">{activePoint.patientName}</div>
                  <div className="text-xs leading-5 text-muted-foreground">
                    {activePoint.address}
                  </div>
                  {activePoint.timeLabel ? (
                    <div className="text-xs text-muted-foreground">
                      時間 {activePoint.timeLabel}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-1 pt-1">
                    <Badge variant="outline">順路 {activePoint.orderLabel}</Badge>
                    <Badge variant="outline">{pointKindLabel(activePoint.pointKind)}</Badge>
                    <Badge variant="outline">状態 {statusLabel[activePoint.status]}</Badge>
                    <Badge variant="outline">優先度 {priorityLabel[activePoint.priority]}</Badge>
                    {activePoint.etaLabel ? (
                      <Badge variant="outline">ETA {activePoint.etaLabel}</Badge>
                    ) : null}
                  </div>
                </div>
              </InfoWindow>
            ) : null}
          </Map>
        </div>
      </APIProvider>
      {props.note ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{props.note}</p>
      ) : null}
    </div>
  );
}
