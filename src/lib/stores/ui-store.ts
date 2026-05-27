import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface UIState {
  sidebarOpen: boolean;
  sidebarPinned: boolean;
  theme: 'light' | 'dark' | 'system';
  notificationDrawerOpen: boolean;
  shortcutHelpOpen: boolean;
  globalSearchOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setSidebarPinned: (pinned: boolean) => void;
  setTheme: (theme: UIState['theme']) => void;
  toggleSidebar: () => void;
  toggleSidebarPinned: () => void;
  toggleNotificationDrawer: () => void;
  setNotificationDrawerOpen: (open: boolean) => void;
  setShortcutHelpOpen: (open: boolean) => void;
  toggleShortcutHelp: () => void;
  setGlobalSearchOpen: (open: boolean) => void;
  toggleGlobalSearch: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      sidebarPinned: true,
      theme: 'system',
      notificationDrawerOpen: false,
      shortcutHelpOpen: false,
      globalSearchOpen: false,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSidebarPinned: (pinned) => set({ sidebarPinned: pinned }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleSidebarPinned: () =>
        set((s) => ({ sidebarPinned: !s.sidebarPinned, sidebarOpen: !s.sidebarPinned })),
      toggleNotificationDrawer: () =>
        set((s) => ({ notificationDrawerOpen: !s.notificationDrawerOpen })),
      setNotificationDrawerOpen: (open) => set({ notificationDrawerOpen: open }),
      setShortcutHelpOpen: (open) => set({ shortcutHelpOpen: open }),
      toggleShortcutHelp: () => set((s) => ({ shortcutHelpOpen: !s.shortcutHelpOpen })),
      setGlobalSearchOpen: (open) => set({ globalSearchOpen: open }),
      toggleGlobalSearch: () => set((s) => ({ globalSearchOpen: !s.globalSearchOpen })),
    }),
    {
      name: 'ph-os-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarPinned: state.sidebarPinned,
        theme: state.theme,
      }),
    }
  )
);
