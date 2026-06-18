import { FilterSummaryBar, Button } from 'ph-os';

export function Default() {
  return (
    <div style={{ padding: 20, maxWidth: 720 }}>
      <FilterSummaryBar
        items={[
          { label: '表示件数', value: '128件' },
          { label: '状態', value: '未対応' },
          { label: '種別', value: '疑義照会' },
          { label: '優先度', value: 'すべて' },
        ]}
      />
    </div>
  );
}

export function Tones() {
  return (
    <div style={{ padding: 20, maxWidth: 720 }}>
      <FilterSummaryBar
        items={[
          { label: '表示件数', value: '42件' },
          { label: '期限超過', value: '7件', tone: 'danger' },
          { label: '本日締切', value: '5件', tone: 'warning' },
          { label: '担当', value: '田中 薬剤師' },
        ]}
      />
    </div>
  );
}

export function WithActions() {
  return (
    <div style={{ padding: 20, maxWidth: 720 }}>
      <FilterSummaryBar
        items={[
          { label: '対象期間', value: '2026年6月' },
          { label: '訪問予定', value: '36件' },
          { label: '未確定', value: '4件', tone: 'warning' },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm">
              条件をクリア
            </Button>
            <Button variant="default" size="sm">
              CSV出力
            </Button>
          </>
        }
      />
    </div>
  );
}
