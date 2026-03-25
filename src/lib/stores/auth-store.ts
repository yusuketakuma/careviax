import { create } from 'zustand';

interface AuthState {
  orgId: string | null;
  siteId: string | null;
  setOrg: (orgId: string) => void;
  setSite: (siteId: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  orgId: null,
  siteId: null,
  setOrg: (orgId) => set({ orgId }),
  setSite: (siteId) => set({ siteId }),
}));
