import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { MotionConfig } from 'motion/react';
import './index.css';
import { I18nProvider } from '@/i18n';
import { isSupabaseConfigured } from '@/lib/env';
import { router } from '@/app/router';
import { SetupScreen } from '@/app/pages';
import { ToastProvider } from '@/app/providers/ToastProvider';
import { AuthProvider } from '@/app/providers/AuthProvider';
import { SettingsProvider } from '@/app/providers/SettingsProvider';
import { ConnectionProvider } from '@/app/providers/ConnectionProvider';
import { ConfirmProvider } from '@/app/providers/ConfirmProvider';

const root = createRoot(document.getElementById('root')!);

root.render(
  <StrictMode>
    <I18nProvider>
      {/* reducedMotion="user" makes every motion component respect prefers-reduced-motion */}
      <MotionConfig reducedMotion="user" transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
        {isSupabaseConfigured ? (
          <ToastProvider>
            <AuthProvider>
              <SettingsProvider>
                <ConnectionProvider>
                  <ConfirmProvider>
                    <RouterProvider router={router} />
                  </ConfirmProvider>
                </ConnectionProvider>
              </SettingsProvider>
            </AuthProvider>
          </ToastProvider>
        ) : (
          <SetupScreen />
        )}
      </MotionConfig>
    </I18nProvider>
  </StrictMode>,
);
