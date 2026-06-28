export const PACKAGING_METHOD_OPTIONS = [
  { value: 'none', label: '指定なし' },
  { value: 'unit_dose', label: '一包化' },
  { value: 'morning_evening_unit_dose', label: '朝夕別一包化' },
  { value: 'medication_box', label: 'お薬BOX' },
  { value: 'calendar_pack', label: 'カレンダーセット' },
  { value: 'blister_pack', label: 'ブリスター管理' },
  { value: 'crush_and_pack', label: '粉砕・混合' },
  { value: 'other', label: 'その他' },
] as const;

export const PACKAGING_DETAIL_OPTIONS = [
  { value: '朝だけ別包', label: '朝だけ別包' },
  { value: '昼だけ別包', label: '昼だけ別包' },
  { value: '夕だけ別包', label: '夕だけ別包' },
  { value: '眠前薬は別袋', label: '眠前薬は別袋' },
  { value: '頓用は別袋', label: '頓用は別袋' },
  { value: '食前薬はクリップ留め', label: '食前薬はクリップ留め' },
  { value: '粉砕薬あり', label: '粉砕薬あり' },
  { value: '家族確認後に手渡し', label: '家族確認後に手渡し' },
] as const;

export type PackagingMethodValue = (typeof PACKAGING_METHOD_OPTIONS)[number]['value'];

export const PACKAGING_INSTRUCTION_TAG_OPTIONS = [
  { value: 'cold_storage', label: '冷所保管' },
  { value: 'narcotic', label: '麻薬' },
  { value: 'half_tablet', label: '半錠・分割' },
  { value: 'crush_prohibited', label: '粉砕禁止' },
  { value: 'separate_pack', label: '別包' },
  { value: 'unit_dose', label: '一包化' },
  { value: 'staple_required', label: 'ホッチキス止め' },
  { value: 'label_required', label: '名前ラベル' },
] as const;

export type PackagingInstructionTagValue =
  (typeof PACKAGING_INSTRUCTION_TAG_OPTIONS)[number]['value'];

export const PACKAGING_METHOD_LABELS = Object.fromEntries(
  PACKAGING_METHOD_OPTIONS.map((option) => [option.value, option.label]),
) as Record<PackagingMethodValue, string>;

export const PACKAGING_INSTRUCTION_TAG_LABELS = Object.fromEntries(
  PACKAGING_INSTRUCTION_TAG_OPTIONS.map((option) => [option.value, option.label]),
) as Record<PackagingInstructionTagValue, string>;

export type PackagingProfileLike = {
  default_packaging_method?: PackagingMethodValue | null;
  medication_box_color?: string | null;
  notes?: string | null;
};

type ResolvePackagingArgs = {
  packagingMethod?: PackagingMethodValue | null;
  packagingInstructions?: string | null;
  profile?: PackagingProfileLike | null;
};

function normalizeText(value?: string | null) {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export function composePackagingDetail(preset?: string | null, custom?: string | null) {
  const values = [normalizeText(preset), normalizeText(custom)].filter(
    (value): value is string => value != null,
  );

  if (values.length === 0) return null;

  return Array.from(new Set(values)).join(' / ');
}

export function splitPackagingDetail(value?: string | null) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return { preset: '', custom: '' };
  }

  const matchedPreset =
    PACKAGING_DETAIL_OPTIONS.find((option) => normalized === option.value)?.value ??
    PACKAGING_DETAIL_OPTIONS.find((option) => normalized.startsWith(`${option.value} / `))?.value ??
    '';

  if (!matchedPreset) {
    return { preset: '', custom: normalized };
  }

  const custom = normalizeText(
    normalized
      .split(' / ')
      .filter((part) => part !== matchedPreset)
      .join(' / '),
  );

  return {
    preset: matchedPreset,
    custom: custom ?? '',
  };
}

function stripKnownPhrases(value: string, phrases: readonly string[]) {
  let next = value;
  for (const phrase of phrases) {
    next = next.replace(phrase, '');
  }
  return normalizeText(next.replace(/[\/、,]+/g, ' '));
}

const PACKAGING_PATTERNS: Array<{
  method: PackagingMethodValue;
  patterns: RegExp[];
  phrases: string[];
}> = [
  {
    method: 'morning_evening_unit_dose',
    patterns: [/朝夕.*一包化/i, /一包化.*朝夕/i],
    phrases: ['朝夕別一包化', '朝夕で一包化', '朝夕一包化', '一包化'],
  },
  {
    method: 'unit_dose',
    patterns: [/一包化/i],
    phrases: ['一包化'],
  },
  {
    method: 'medication_box',
    patterns: [/お薬box/i, /薬box/i, /服薬box/i, /お薬BOX/, /薬BOX/, /服薬BOX/],
    phrases: ['お薬BOX', '薬BOX', '服薬BOX'],
  },
  {
    method: 'calendar_pack',
    patterns: [/カレンダー/i],
    phrases: ['カレンダーセット', 'カレンダー'],
  },
  {
    method: 'blister_pack',
    patterns: [/ブリスター/i, /ptp/i, /ヒート管理/i],
    phrases: ['ブリスター管理', 'ブリスター', 'PTP', 'ヒート管理'],
  },
  {
    method: 'crush_and_pack',
    patterns: [/粉砕/i, /混合/i],
    phrases: ['粉砕・混合', '粉砕', '混合'],
  },
];

export function parsePackagingMethod(value?: string | null): {
  method: PackagingMethodValue | null;
  detail: string | null;
} {
  const normalized = normalizeText(value);
  if (!normalized) return { method: null, detail: null };

  for (const entry of PACKAGING_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        method: entry.method,
        detail: stripKnownPhrases(normalized, entry.phrases),
      };
    }
  }

  return {
    method: 'other',
    detail: normalized,
  };
}

const PACKAGING_TAG_PATTERNS: Array<{
  tag: PackagingInstructionTagValue;
  patterns: RegExp[];
}> = [
  {
    tag: 'cold_storage',
    patterns: [/冷所/, /要冷蔵/, /保冷/],
  },
  {
    tag: 'narcotic',
    patterns: [/麻薬/],
  },
  {
    tag: 'half_tablet',
    patterns: [/半錠/, /半分/, /1\/2/],
  },
  {
    tag: 'crush_prohibited',
    patterns: [/粉砕不可/, /粉砕禁止/, /つぶさない/],
  },
  {
    tag: 'separate_pack',
    patterns: [/別袋/, /別包/, /別に/, /別パック/],
  },
  {
    tag: 'staple_required',
    patterns: [/ホッチキス/, /ステープル/, /留め/],
  },
  {
    tag: 'label_required',
    patterns: [/名前シール/, /名前ラベル/, /ラベル/],
  },
];

export function buildPackagingInstructions(args: {
  method?: PackagingMethodValue | null;
  detail?: string | null;
  medicationBoxColor?: string | null;
}) {
  const parts: string[] = [];

  if (args.method && args.method !== 'none') {
    parts.push(PACKAGING_METHOD_LABELS[args.method]);
  }

  if (args.method === 'medication_box' && normalizeText(args.medicationBoxColor)) {
    parts.push(`BOX色:${normalizeText(args.medicationBoxColor)}`);
  }

  if (normalizeText(args.detail)) {
    parts.push(normalizeText(args.detail)!);
  }

  return parts.length > 0 ? parts.join(' / ') : null;
}

export function resolvePackagingSettings(args: ResolvePackagingArgs) {
  const explicitText = normalizeText(args.packagingInstructions);
  const parsed = parsePackagingMethod(explicitText);
  const method =
    args.packagingMethod ?? parsed.method ?? args.profile?.default_packaging_method ?? null;
  const detail = parsed.detail ?? normalizeText(args.profile?.notes) ?? null;
  const medicationBoxColor = normalizeText(args.profile?.medication_box_color);

  return {
    packaging_method: method,
    packaging_instructions: buildPackagingInstructions({
      method,
      detail,
      medicationBoxColor,
    }),
  };
}

export function extractPackagingInstructionTags(args: {
  packagingInstructions?: string | null;
  notes?: string | null;
  packagingMethod?: PackagingMethodValue | null;
}) {
  const detail = normalizeText([args.packagingInstructions, args.notes].filter(Boolean).join(' '));
  const tags = new Set<PackagingInstructionTagValue>();

  if (
    args.packagingMethod === 'unit_dose' ||
    args.packagingMethod === 'morning_evening_unit_dose'
  ) {
    tags.add('unit_dose');
  }

  if (detail) {
    for (const entry of PACKAGING_TAG_PATTERNS) {
      if (entry.patterns.some((pattern) => pattern.test(detail))) {
        tags.add(entry.tag);
      }
    }
    if (/一包化/.test(detail)) {
      tags.add('unit_dose');
    }
  }

  return PACKAGING_INSTRUCTION_TAG_OPTIONS.map((option) => option.value).filter((value) =>
    tags.has(value),
  );
}

export function resolveEffectivePackagingInstructionTags<T extends string>(
  decisionTags: readonly T[] | null | undefined,
  lineTags: readonly T[] | null | undefined,
) {
  return decisionTags && decisionTags.length > 0 ? [...decisionTags] : [...(lineTags ?? [])];
}
