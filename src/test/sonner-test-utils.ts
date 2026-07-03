import { vi } from 'vitest';

export const SONNER_TOAST_MOCK_METHODS = [
  'success',
  'info',
  'warning',
  'error',
  'custom',
  'message',
  'promise',
  'dismiss',
  'loading',
  'getHistory',
  'getToasts',
] as const;

export type SonnerToastMockMethod = (typeof SONNER_TOAST_MOCK_METHODS)[number];
export type VitestMockFunction = ReturnType<typeof vi.fn> & ((...args: unknown[]) => unknown);
export type SonnerToastMock = VitestMockFunction &
  Record<SonnerToastMockMethod, VitestMockFunction>;

export interface SonnerToastMockHarness {
  readonly toast: SonnerToastMock;
  readonly module: { readonly toast: SonnerToastMock };
  clear: () => void;
  reset: () => void;
}

function allToastMocks(toast: SonnerToastMock): VitestMockFunction[] {
  return [toast, ...SONNER_TOAST_MOCK_METHODS.map((method) => toast[method])];
}

function applyDefaultImplementations(toast: SonnerToastMock) {
  toast.mockReturnValue('toast-id');
  toast.success.mockReturnValue('toast-id');
  toast.info.mockReturnValue('toast-id');
  toast.warning.mockReturnValue('toast-id');
  toast.error.mockReturnValue('toast-id');
  toast.custom.mockReturnValue('toast-id');
  toast.message.mockReturnValue('toast-id');
  toast.promise.mockReturnValue({ unwrap: vi.fn(async () => undefined) });
  toast.dismiss.mockReturnValue('toast-id');
  toast.loading.mockReturnValue('toast-id');
  toast.getHistory.mockReturnValue([]);
  toast.getToasts.mockReturnValue([]);
}

export function createSonnerToastMock(): SonnerToastMockHarness {
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    custom: vi.fn(),
    message: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(),
    getHistory: vi.fn(),
    getToasts: vi.fn(),
  }) as SonnerToastMock;

  applyDefaultImplementations(toast);

  return {
    toast,
    module: { toast },
    clear: () => {
      for (const mock of allToastMocks(toast)) {
        mock.mockClear();
      }
    },
    reset: () => {
      for (const mock of allToastMocks(toast)) {
        mock.mockReset();
      }
      applyDefaultImplementations(toast);
    },
  };
}
