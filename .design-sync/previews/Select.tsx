import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Label,
} from 'ph-os';

export function Closed() {
  return (
    <div style={{ padding: 20, maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Label>配薬方法</Label>
      <Select
        defaultValue="one-dose"
        items={{ 'one-dose': '一包化', ptp: 'PTPシート', case: '配薬カレンダー' }}
      >
        <SelectTrigger>
          <SelectValue placeholder="配薬方法を選択" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="one-dose">一包化</SelectItem>
          <SelectItem value="ptp">PTPシート</SelectItem>
          <SelectItem value="case">配薬カレンダー</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function Open() {
  return (
    <div style={{ padding: 20, paddingBottom: 220, maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Label>担当薬剤師</Label>
      <Select
        defaultValue="sato"
        defaultOpen
        items={{
          sato: '佐藤 花子',
          suzuki: '鈴木 健太',
          takahashi: '高橋 美咲',
          ito: '伊藤 大輔',
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="担当者を選択" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value="sato">佐藤 花子（在宅専従）</SelectItem>
          <SelectItem value="suzuki">鈴木 健太</SelectItem>
          <SelectItem value="takahashi">高橋 美咲</SelectItem>
          <SelectItem value="ito" disabled>
            伊藤 大輔（休職中）
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function Grouped() {
  return (
    <div style={{ padding: 20, paddingBottom: 280, maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Label>訪問区分</Label>
      <Select
        defaultValue="home-med"
        defaultOpen
        items={{
          'home-med': '在宅患者訪問薬剤管理指導',
          emergency: '緊急訪問',
          'care-mgmt': '居宅療養管理指導',
          'care-facility': '施設入居者等',
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="区分を選択" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            <SelectGroupLabel>医療保険</SelectGroupLabel>
            <SelectItem value="home-med">在宅患者訪問薬剤管理指導</SelectItem>
            <SelectItem value="emergency">緊急訪問</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectGroupLabel>介護保険</SelectGroupLabel>
            <SelectItem value="care-mgmt">居宅療養管理指導</SelectItem>
            <SelectItem value="care-facility">施設入居者等</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
