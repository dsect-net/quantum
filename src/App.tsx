/**
 * Quantum app shell: @dsect/ui AppShell + AppBar + TabBar.
 *
 * Five tabs — Home, Chat, Create, Mail, More — per the finalized plan.
 * The Mail tab is the DSECT email client (name@dsect.net).
 *
 * Shell behaviors (Oct 2026 feedback round):
 *  - DSECT Light theme default (see theme.ts), toggle in settings.
 *  - Bottom tab bar is pinned stationary (CSS: position fixed, no
 *    overscroll motion) with safe-area-aware content padding.
 *  - Screens animate in on tab/route change (quantum-screen).
 *  - Long-press a tab → jumps to Connection settings (contextual action).
 *  - Upper-right debug toggle (Scotty-only): reveals the Debug tools
 *    screen under More plus a DBG badge. Off by default.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Home, MessageCircle, Sparkles, Mail, Ellipsis, ArrowLeft } from 'lucide-react';
import { AppShell, AppBar, TabBar } from '@dsect/ui/components/app';
import { IconButton } from '@dsect/ui/components/buttons';
import type { TabBarItem } from '@dsect/ui/components/app';
import { QToggle } from './lib/untitled';
import { loadDebugMode, storeDebugMode, debugLog } from './lib/debug';
import { useUpdater } from './lib/useUpdater';
import { UpdatePrompt } from './components/UpdatePrompt';
import { getUpdaterSettings } from './lib/updater';
import { Capacitor } from '@capacitor/core';
import { HomeScreen } from './screens/HomeScreen';
import { ChatScreen } from './screens/ChatScreen';
import { CreateScreen } from './screens/CreateScreen';
import { MailScreen } from './screens/Mail/MailScreen';
import { MoreScreen } from './screens/MoreScreen';
import type { MoreRoute } from './screens/MoreScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AboutScreen } from './screens/AboutScreen';
import { ServicesScreen } from './screens/More/ServicesScreen';
import { HiveScreen } from './screens/More/HiveScreen';
import { ResearchScreen } from './screens/More/ResearchScreen';
import { DebugScreen } from './screens/DebugScreen';

type TabId = 'home' | 'chat' | 'create' | 'mail' | 'more';

const TABS: { id: TabId; label: string; icon: ReactNode; title: string }[] = [
  { id: 'home', label: 'Home', icon: <Home size={22} />, title: 'Home' },
  { id: 'chat', label: 'Chat', icon: <MessageCircle size={22} />, title: 'Chat' },
  { id: 'create', label: 'Create', icon: <Sparkles size={22} />, title: 'Create' },
  { id: 'mail', label: 'Mail', icon: <Mail size={22} />, title: 'Mail' },
  { id: 'more', label: 'More', icon: <Ellipsis size={22} />, title: 'More' },
];

const LONG_PRESS_MS = 500;

export default function App() {
  const [tab, setTab] = useState<TabId>('home');
  const [moreRoute, setMoreRoute] = useState<MoreRoute | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  // The stored value loads asynchronously on mount; never let that late
  // read clobber a toggle the user already flipped.
  const debugTouched = useRef(false);

  useEffect(() => {
    loadDebugMode()
      .then((v) => {
        if (!debugTouched.current) setDebugMode(v);
      })
      .catch(() => {});
  }, []);

  const onDebugToggle = useCallback(async (on: boolean) => {
    debugTouched.current = true;
    setDebugMode(on);
    await storeDebugMode(on);
    debugLog('debug', `Debug mode ${on ? 'enabled' : 'disabled'}.`);
    if (!on) setMoreRoute((r) => (r === 'debug' ? null : r));
  }, []);

  const openSettings = useCallback(() => {
    setTab('more');
    setMoreRoute('settings');
  }, []);

  /* Long-press on a tab button → contextual action: Connection settings.
     The kit renders the buttons, so this uses event delegation on the
     wrapper: a hold suppresses the tap that would follow it. */
  const tabNavRef = useRef<HTMLDivElement | null>(null);
  const lpTimer = useRef<number | null>(null);
  const lpFired = useRef(false);

  const clearLp = () => {
    if (lpTimer.current != null) {
      window.clearTimeout(lpTimer.current);
      lpTimer.current = null;
    }
  };

  const tabIndexOf = (target: EventTarget | null): number => {
    const nav = tabNavRef.current;
    const btn = (target as HTMLElement | null)?.closest?.('button');
    if (!nav || !btn) return -1;
    return Array.from(nav.querySelectorAll('button')).indexOf(btn as HTMLButtonElement);
  };

  const onTabPointerDown = (e: React.PointerEvent) => {
    const idx = tabIndexOf(e.target);
    if (idx < 0) return;
    lpFired.current = false;
    clearLp();
    lpTimer.current = window.setTimeout(() => {
      lpFired.current = true;
      lpTimer.current = null;
      debugLog('app', `Long-press on tab "${TABS[idx].label}" → Connection settings.`);
      openSettings();
    }, LONG_PRESS_MS);
  };

  const onTabClickCapture = (e: React.MouseEvent) => {
    if (lpFired.current) {
      e.stopPropagation();
      e.preventDefault();
      lpFired.current = false;
    }
  };

  const items: TabBarItem[] = TABS.map((t) => ({
    id: t.id,
    label: t.label,
    icon: t.icon,
    onSelect: () => {
      setTab(t.id);
      if (t.id !== 'more') setMoreRoute(null);
    },
  }));

  const active = TABS.find((t) => t.id === tab)!;

  let screen: ReactNode;
  let title = active.title;
  if (tab === 'home') screen = <HomeScreen />;
  else if (tab === 'chat') screen = <ChatScreen />;
  else if (tab === 'create') screen = <CreateScreen />;
  else if (tab === 'mail') screen = <MailScreen />;
  else if (moreRoute === 'services') {
    screen = <ServicesScreen />;
    title = 'Services & tools';
  } else if (moreRoute === 'memory') {
    screen = <HiveScreen />;
    title = 'Memory explorer';
  } else if (moreRoute === 'research') {
    screen = <ResearchScreen />;
    title = 'Research hub';
  } else if (moreRoute === 'settings') {
    screen = <SettingsScreen />;
    title = 'Connection settings';
  } else if (moreRoute === 'about') {
    screen = <AboutScreen />;
    title = 'About';
  } else if (moreRoute === 'debug' && debugMode) {
    screen = <DebugScreen />;
    title = 'Debug tools';
  } else {
    screen = <MoreScreen onNavigate={setMoreRoute} showDebug={debugMode} />;
  }

  // If debug mode was switched off while on the debug screen, fall back.
  useEffect(() => {
    if (!debugMode && tab === 'more') {
      setMoreRoute((r) => (r === 'debug' ? null : r));
    }
  }, [debugMode, tab]);

  const inMoreSubscreen = tab === 'more' && moreRoute !== null;
  const screenKey = `${tab}:${moreRoute ?? ''}`;

  // In-app updater: silent launch check (auto-check setting, default on).
  // Only the "update available" outcome surfaces UI (UpdatePrompt below);
  // every other outcome stays quiet.
  const updater = useUpdater();
  const updaterChecked = useRef(false);
  useEffect(() => {
    if (updaterChecked.current) return;
    updaterChecked.current = true;
    try {
      if (getUpdaterSettings().autoCheck && Capacitor.isNativePlatform()) {
        debugLog('updater', 'Launch auto-check starting.');
        void updater.check({ silent: true });
      }
    } catch {
      /* never break launch over an update check */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
    <AppShell
      appBar={
        <AppBar
          title={title}
          subtitle={
            <>
              Quantum · DSECT
              {debugMode && <span className="debug-badge">DBG</span>}
            </>
          }
          leading={
            inMoreSubscreen ? (
              <IconButton label="Back to More" onClick={() => setMoreRoute(null)}>
                <ArrowLeft size={22} />
              </IconButton>
            ) : undefined
          }
          actions={
            <QToggle
              size="sm"
              aria-label="Debug mode"
              isSelected={debugMode}
              onChange={onDebugToggle}
            />
          }
        />
      }
      tabBar={
        <div
          ref={tabNavRef}
          data-longpress
          onPointerDown={onTabPointerDown}
          onPointerUp={clearLp}
          onPointerLeave={clearLp}
          onPointerCancel={clearLp}
          onClickCapture={onTabClickCapture}
          onContextMenu={(e) => e.preventDefault()}
        >
          <TabBar items={items} current={tab} label="Primary" />
        </div>
      }
    >
      <div key={screenKey} className="quantum-screen">
        {screen}
      </div>
    </AppShell>
    <UpdatePrompt updater={updater} />
    </>
  );
}
