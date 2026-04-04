export type BadgeTone = 'urgent' | 'attention' | 'info' | 'neutral' | 'positive';

const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  urgent: 'border-red-200 bg-red-100 text-red-800',
  attention: 'border-amber-200 bg-amber-100 text-amber-800',
  info: 'border-blue-200 bg-blue-100 text-blue-800',
  neutral: 'border-slate-200 bg-slate-100 text-slate-700',
  positive: 'border-emerald-200 bg-emerald-100 text-emerald-800',
};

export function badgeToneClass(tone: BadgeTone) {
  return BADGE_TONE_CLASSES[tone];
}
