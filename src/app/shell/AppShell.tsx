import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { motion } from 'motion/react';
import { useHotkeys } from '@/hooks/useHotkeys';
import { NotificationsProvider } from '../providers/NotificationsProvider';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { CommandPalette } from './CommandPalette';
import { OfflineBanner } from './OfflineBanner';

const COLLAPSE_KEY = 'max.sidebar.collapsed';

function initialCollapsed(): boolean {
  try {
    const v = localStorage.getItem(COLLAPSE_KEY);
    if (v !== null) return v === '1';
  } catch {
    /* ignore */
  }
  // tablets (and the POS on iPad) start with the icon sidebar
  return window.innerWidth < 1280;
}

export function AppShell() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [command, setCommand] = useState(false);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  }, []);

  useHotkeys({ 'mod+k': () => setCommand((v) => !v) }, true, ['__dialogs__']);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const isPos = location.pathname.startsWith('/pos');

  return (
    <NotificationsProvider>
      <div className="flex min-h-dvh">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
        <div className="flex min-w-0 flex-1 flex-col">
          <OfflineBanner />
          <TopBar onOpenCommand={() => setCommand(true)} />
          <main id="main" className={isPos ? 'min-h-0 flex-1 pb-16 md:pb-0' : 'flex-1 px-4 py-5 pb-24 md:px-6 md:pb-8'}>
            <motion.div
              key={location.pathname}
              // RTL: content enters from the inline-end (left) side
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="h-full"
            >
              <Outlet />
            </motion.div>
          </main>
        </div>
        <BottomNav />
        <CommandPalette open={command} onClose={() => setCommand(false)} />
      </div>
    </NotificationsProvider>
  );
}
