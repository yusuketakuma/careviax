'use client';

import { PhosToast } from '@/phos/contracts/phos_copy.ja';
import { ToastToneToken } from '@/phos/contracts/phos_design_tokens';
import type { ActionResponse } from '@/phos/contracts/phos_contracts';

export type PhosToastInput = NonNullable<ActionResponse['toast']>;

export type PhosToastEntry = PhosToastInput & {
  id: string;
  created_at: number;
  message: string;
};

const TOAST_MESSAGE_BY_KEY: Readonly<Record<string, string>> = {
  'toast.handoff.created': PhosToast.HANDOFF_CREATED_OK,
  'toast.claim_candidate_excluded': '算定候補を除外しました。',
  'toast.action.error': PhosToast.NET_ERROR_RETRY,
};

function stableParams(params: PhosToastInput['params']): string {
  if (!params) return '';
  return JSON.stringify(
    Object.keys(params)
      .sort()
      .reduce<Record<string, string>>((result, key) => {
        result[key] = params[key] ?? '';
        return result;
      }, {}),
  );
}

function toastKey(toast: PhosToastInput): string {
  return `${toast.message_key}:${stableParams(toast.params)}`;
}

export function resolvePhosToastMessage(toast: PhosToastInput): string {
  if (toast.params?.message) return toast.params.message;
  return TOAST_MESSAGE_BY_KEY[toast.message_key] ?? toast.message_key;
}

export function appendPhosToast(
  current: readonly PhosToastEntry[],
  toast: PhosToastInput,
  now: number,
  debounceMs = 3000,
  maxToasts = 3,
): PhosToastEntry[] {
  const key = toastKey(toast);
  const hasRecentDuplicate = current.some(
    (entry) => toastKey(entry) === key && now - entry.created_at < debounceMs,
  );
  if (hasRecentDuplicate) return current.slice(-maxToasts);

  return [
    ...current,
    {
      ...toast,
      id: `${key}:${now}`,
      created_at: now,
      message: resolvePhosToastMessage(toast),
    },
  ].slice(-maxToasts);
}

export function PhosToastRegion({ toasts }: { toasts: readonly PhosToastEntry[] }) {
  if (toasts.length === 0) return null;

  return (
    <section
      aria-label="PH-OS toast notifications"
      aria-live="polite"
      className="fixed right-4 top-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
      role="status"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="rounded-md border px-3 py-2 text-sm font-medium shadow-sm"
          style={{
            backgroundColor: ToastToneToken[toast.tone].bg,
            borderColor: ToastToneToken[toast.tone].border,
            color: ToastToneToken[toast.tone].fg,
          }}
        >
          {toast.message}
        </div>
      ))}
    </section>
  );
}
