import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type WorkMode = 'pharmacist' | 'clerk_support' | 'management';
export type CareMode = 'home_visit' | 'outpatient';

interface UIState {
  sidebarOpen: boolean;
  sidebarPinned: boolean;
  workspaceRailOpen: boolean;
  workspaceRailAvailable: boolean;
  workspaceRailMountCount: number;
  theme: 'light' | 'dark' | 'system';
  notificationDrawerOpen: boolean;
  shortcutHelpOpen: boolean;
  workMode: WorkMode;
  careMode: CareMode;
  setSidebarOpen: (open: boolean) => void;
  setSidebarPinned: (pinned: boolean) => void;
  setWorkspaceRailOpen: (open: boolean) => void;
  setWorkspaceRailAvailable: (available: boolean) => void;
  registerWorkspaceRail: () => void;
  unregisterWorkspaceRail: () => void;
  setTheme: (theme: UIState['theme']) => void;
  toggleSidebar: () => void;
  toggleSidebarPinned: () => void;
  toggleWorkspaceRail: () => void;
  toggleNotificationDrawer: () => void;
  setNotificationDrawerOpen: (open: boolean) => void;
  setShortcutHelpOpen: (open: boolean) => void;
  toggleShortcutHelp: () => void;
  setWorkMode: (mode: WorkMode) => void;
  setCareMode: (mode: CareMode) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: false,
      sidebarPinned: false,
      workspaceRailOpen: false,
      workspaceRailAvailable: false,
      workspaceRailMountCount: 0,
      theme: 'system',
      notificationDrawerOpen: false,
      shortcutHelpOpen: false,
      workMode: 'pharmacist' as WorkMode,
      careMode: 'home_visit' as CareMode,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSidebarPinned: (pinned) => set({ sidebarPinned: pinned }),
      setWorkspaceRailOpen: (open) => set({ workspaceRailOpen: open }),
      setWorkspaceRailAvailable: (available) => set({ workspaceRailAvailable: available }),
      registerWorkspaceRail: () =>
        set((state) => {
          const nextCount = state.workspaceRailMountCount + 1;
          return {
            workspaceRailMountCount: nextCount,
            workspaceRailAvailable: nextCount > 0,
          };
        }),
      unregisterWorkspaceRail: () =>
        set((state) => {
          const nextCount = Math.max(0, state.workspaceRailMountCount - 1);
          return {
            workspaceRailMountCount: nextCount,
            workspaceRailAvailable: nextCount > 0,
            workspaceRailOpen: nextCount > 0 ? state.workspaceRailOpen : false,
          };
        }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleSidebarPinned: () =>
        set((s) => ({ sidebarPinned: !s.sidebarPinned, sidebarOpen: !s.sidebarPinned })),
      toggleWorkspaceRail: () => set((s) => ({ workspaceRailOpen: !s.workspaceRailOpen })),
      toggleNotificationDrawer: () =>
        set((s) => ({ notificationDrawerOpen: !s.notificationDrawerOpen })),
      setNotificationDrawerOpen: (open) => set({ notificationDrawerOpen: open }),
      setShortcutHelpOpen: (open) => set({ shortcutHelpOpen: open }),
      toggleShortcutHelp: () => set((s) => ({ shortcutHelpOpen: !s.shortcutHelpOpen })),
      setWorkMode: (mode) => set({ workMode: mode }),
      setCareMode: (mode) => set({ careMode: mode }),
    }),
    {
      name: 'ph-os-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        theme: state.theme,
        workMode: state.workMode,
        careMode: state.careMode,
      }),
    },
  ),
);
