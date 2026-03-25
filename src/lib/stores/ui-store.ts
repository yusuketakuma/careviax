import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  notificationDrawerOpen: boolean;
  toggleSidebar: () => void;
  toggleNotificationDrawer: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  notificationDrawerOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleNotificationDrawer: () => set((s) => ({ notificationDrawerOpen: !s.notificationDrawerOpen })),
}));
