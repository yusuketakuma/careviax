import { create } from 'zustand';
import type { MemberRole } from '@prisma/client';

type CurrentUser = {
  id: string | null;
  email: string | null;
  name: string | null;
  cognitoSub: string | null;
  role: MemberRole | null;
};

interface AuthState {
  orgId: string | null;
  siteId: string | null;
  currentUser: CurrentUser;
  setOrg: (orgId: string) => void;
  setSite: (siteId: string) => void;
  setCurrentUser: (user: Partial<CurrentUser>) => void;
  resetAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  orgId: null,
  siteId: null,
  currentUser: {
    id: null,
    email: null,
    name: null,
    cognitoSub: null,
    role: null,
  },
  setOrg: (orgId) => set({ orgId }),
  setSite: (siteId) => set({ siteId }),
  setCurrentUser: (user) =>
    set((state) => ({
      currentUser: {
        ...state.currentUser,
        ...user,
      },
    })),
  resetAuth: () =>
    set({
      orgId: null,
      siteId: null,
      currentUser: {
        id: null,
        email: null,
        name: null,
        cognitoSub: null,
        role: null,
      },
    }),
}));
