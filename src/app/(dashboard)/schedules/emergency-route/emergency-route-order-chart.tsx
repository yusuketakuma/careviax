import { useMemo } from 'react';

const CHART_WIDTH = 520;
const CHART_HEIGHT = 320;

/** Schematic visit order chart. It intentionally does not represent a geographic map. */
export function EmergencyRouteOrderChart({
  scheduleIds,
  emergencyScheduleId,
  lockedScheduleIds,
}: {
  scheduleIds: string[];
  emergencyScheduleId: string | null;
  lockedScheduleIds: Set<string>;
}) {
  const count = scheduleIds.length;
  const coords = useMemo(() => {
    if (count === 0) return [] as Array<{ x: number; y: number }>;
    if (count === 1) return [{ x: CHART_WIDTH / 2, y: CHART_HEIGHT / 2 }];
    const marginX = CHART_WIDTH * 0.08;
    const usableX = CHART_WIDTH - marginX * 2;
    const top = CHART_HEIGHT * 0.18;
    const bottom = CHART_HEIGHT * 0.82;
    return scheduleIds.map((_, index) => ({
      x: marginX + (usableX * index) / (count - 1),
      y: index % 2 === 0 ? bottom - (index % 3) * 28 : top + (index % 3) * 28,
    }));
  }, [scheduleIds, count]);

  function nodeColor(scheduleId: string) {
    if (scheduleId === emergencyScheduleId) return 'var(--state-blocked)';
    if (lockedScheduleIds.has(scheduleId)) return 'var(--state-waiting)';
    return 'var(--tag-info)';
  }

  return (
    <div className="rounded-lg bg-tag-info/5 p-3">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`再計算後の訪問順(${count}件)`}
      >
        {coords.length > 1 ? (
          <polyline
            points={coords.map((coord) => `${coord.x},${coord.y}`).join(' ')}
            fill="none"
            stroke="var(--tag-info)"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {coords.map((coord, index) => {
          const scheduleId = scheduleIds[index];
          return (
            <g key={scheduleId}>
              <title>{`訪問 ${index + 1}`}</title>
              <circle cx={coord.x} cy={coord.y} r={15} fill={nodeColor(scheduleId)} />
              <text
                x={coord.x}
                y={coord.y}
                dy="0.35em"
                textAnchor="middle"
                fill="#ffffff"
                fontSize={13}
                fontWeight={600}
              >
                {index + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
