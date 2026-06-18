import { SegmentedProgressBar } from 'ph-os';

export function ProgressLevels() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 360, padding: 20 }}>
      <div>
        <div style={{ fontSize: 12, marginBottom: 6 }}>本日の訪問完了 3 / 12 件</div>
        <SegmentedProgressBar value={3} max={12} className="h-3" />
      </div>
      <div>
        <div style={{ fontSize: 12, marginBottom: 6 }}>服薬指導記録 7 / 12 件</div>
        <SegmentedProgressBar value={7} max={12} className="h-3" />
      </div>
      <div>
        <div style={{ fontSize: 12, marginBottom: 6 }}>報告書提出 12 / 12 件</div>
        <SegmentedProgressBar value={12} max={12} className="h-3" />
      </div>
    </div>
  );
}

export function WithTargetMarker() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 360, padding: 20 }}>
      <div>
        <div style={{ fontSize: 12, marginBottom: 6 }}>月間訪問件数 84 件（目標 100 件）</div>
        <SegmentedProgressBar
          value={84}
          max={120}
          markerValue={100}
          className="h-3"
          markerClassName="bg-orange-500"
        />
      </div>
      <div>
        <div style={{ fontSize: 12, marginBottom: 6 }}>後発品調剤率 58%（目標 75%）</div>
        <SegmentedProgressBar
          value={58}
          max={100}
          markerValue={75}
          className="h-3"
          markerClassName="bg-orange-500"
        />
      </div>
    </div>
  );
}

export function ColorVariants() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 360, padding: 20 }}>
      <div>
        <div style={{ fontSize: 12, marginBottom: 6 }}>残薬調整の進捗</div>
        <SegmentedProgressBar value={9} max={10} className="h-3" filledClassName="bg-state-done" />
      </div>
      <div>
        <div style={{ fontSize: 12, marginBottom: 6 }}>期限内対応率（注意水準）</div>
        <SegmentedProgressBar
          value={4}
          max={10}
          className="h-3"
          filledClassName="bg-state-confirm"
        />
      </div>
      <div>
        <div style={{ fontSize: 12, marginBottom: 6 }}>未対応の疑義照会</div>
        <SegmentedProgressBar
          value={2}
          max={10}
          className="h-3"
          filledClassName="bg-state-blocked"
        />
      </div>
    </div>
  );
}
