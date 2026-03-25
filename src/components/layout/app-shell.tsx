'use client';

import { Sidebar } from '@/components/layout/sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useUIStore } from '@/lib/stores/ui-store';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { sidebarOpen, toggleSidebar } = useUIStore();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar — always visible on md+ */}
      <div className="hidden md:flex md:shrink-0">
        <Sidebar />
      </div>

      {/* Mobile sidebar — Sheet overlay */}
      <div className="md:hidden">
        <Sheet
          open={sidebarOpen}
          onOpenChange={(open) => {
            if (!open) toggleSidebar();
          }}
        >
          <SheetContent side="left" className="w-56 p-0">
            <Sidebar className="border-r-0" />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main content */}
      <main
        className="flex flex-1 flex-col overflow-y-auto"
        id="main-content"
        tabIndex={-1}
      >
        {/* Skip to main content link for keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:shadow"
        >
          メインコンテンツへスキップ
        </a>

        {/* Bottom padding for mobile nav bar */}
        <div className="flex-1 pb-16 md:pb-0">{children}</div>
      </main>

      {/* Mobile bottom navigation */}
      <MobileNav />
    </div>
  );
}
