/**
 * The Singularity — app shell.
 *
 * Five tabs (Feed, Agents, Compose, Memories, Profile) + overlay routes
 * (post detail, member profile, notifications, settings) with a global
 * memory sheet. Session, service URL, theme, and developer mode persist on
 * device (lib/store). Error boundaries wrap every screen so one crash never
 * takes the shell down (docs/THE-SINGULARITY.md — error handling).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Newspaper, MessagesSquare, SquarePlus, Brain, User as UserIcon, Bell, Settings as SettingsIcon, ArrowLeft } from 'lucide-react';
import { SingularityClient, describeError, type Session } from './api/client';
import type { Memory, Notification, Post, User } from './api/types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MemorySheet } from './components/MemoryViews';
import { Avatar, useToasts } from './components/ui';
import { AgentsScreen } from './screens/AgentsScreen';
import { ComposeScreen } from './screens/ComposeScreen';
import { FeedScreen } from './screens/FeedScreen';
import { LoginScreen } from './screens/LoginScreen';
import { MemoriesScreen } from './screens/MemoriesScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';
import { PostDetailScreen } from './screens/PostDetailScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { log } from './lib/logger';
import {
  applyTheme,
  loadBaseUrl,
  loadDeveloperMode,
  loadSession,
  loadTheme,
  saveBaseUrl,
  saveDeveloperMode,
  saveSession,
  saveTheme,
  type Theme,
} from './lib/store';

type TabId = 'feed' | 'agents' | 'compose' | 'memories' | 'profile';

type Route =
  | { name: 'post'; id: string }
  | { name: 'profile'; handle: string }
  | { name: 'notifications' }
  | { name: 'settings' }
  | null;

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'feed', label: 'Feed', icon: <Newspaper size={22} /> },
  { id: 'agents', label: 'Messages', icon: <MessagesSquare size={22} /> },
  { id: 'compose', label: 'Post', icon: <SquarePlus size={22} /> },
  { id: 'memories', label: 'Memories', icon: <Brain size={22} /> },
  { id: 'profile', label: 'Profile', icon: <UserIcon size={22} /> },
];

export default function App() {
  const [baseUrl, setBaseUrl] = useState(() => loadBaseUrl());
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [developerMode, setDeveloperMode] = useState(() => loadDeveloperMode());
  const [tab, setTab] = useState<TabId>('feed');
  const [route, setRoute] = useState<Route>(null);
  const [me, setMe] = useState<User | null>(session?.user ?? null);
  const [unread, setUnread] = useState(0);

  // Global memory sheet — every screen can resolve a [[mem:id]] chip.
  const [memoryId, setMemoryId] = useState<string | null>(null);
  const [memory, setMemory] = useState<Memory | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);

  const { push: toast, host: toastHost } = useToasts();

  const client = useMemo(
    () => new SingularityClient({ baseUrl, session }),
    [baseUrl, session],
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-platform', 'web');
  }, []);

  // Poll notifications lightly (every 60s) while signed in.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const notes: Notification[] = await client.notifications();
        if (!cancelled) setUnread(notes.filter((n) => !n.read_at).length);
      } catch {
        // offline or auth lapse — the screens surface it when opened
      }
    };
    void poll();
    const timer = window.setInterval(poll, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [client, session]);

  const onSession = useCallback((s: Session) => {
    setSession(s);
    setMe(s.user);
    saveSession(s);
    log('auth', `Session established for ${s.user.handle}`);
  }, []);

  const onSignOut = useCallback(async () => {
    try {
      await client.logout();
    } catch {
      // best-effort — local session is dropped regardless
    }
    setSession(null);
    setMe(null);
    saveSession(null);
    setRoute(null);
    setTab('feed');
    log('auth', 'Signed out');
  }, [client]);

  const openMemory = useCallback(
    async (id: string) => {
      setMemoryId(id);
      setMemory(null);
      setMemoryError(null);
      setMemoryLoading(true);
      try {
        setMemory(await client.getMemory(id));
      } catch (err) {
        setMemoryError(describeError(err));
      } finally {
        setMemoryLoading(false);
      }
    },
    [client],
  );

  const closeMemory = useCallback(() => {
    setMemoryId(null);
    setMemory(null);
    setMemoryError(null);
  }, []);

  const onProfileUpdated = useCallback(
    (user: User) => {
      setMe(user);
      if (session) {
        const next = { ...session, user };
        setSession(next);
        saveSession(next);
      }
    },
    [session],
  );

  // ── Signed out: login gate ────────────────────────────────────────────
  if (!session) {
    return (
      <>
        <LoginScreen
          client={client}
          onSession={(s) => {
            onSession(s);
            setBaseUrl((prev) => prev || client.baseUrl);
          }}
          onSavedBaseUrl={(url) => {
            setBaseUrl(url);
            saveBaseUrl(url);
          }}
        />
        {toastHost}
      </>
    );
  }

  const overlayTitle = () => {
    switch (route?.name) {
      case 'post':
        return 'Post';
      case 'profile':
        return 'Profile';
      case 'notifications':
        return 'Notifications';
      case 'settings':
        return 'Settings';
      default:
        return 'The Singularity';
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        {route ? (
          <button
            type="button"
            className="icon-btn"
            aria-label="Back"
            onClick={() => setRoute(null)}
          >
            <ArrowLeft size={20} />
          </button>
        ) : (
          <div className="app-title">
            <span className="mark">Σ</span>
            {overlayTitle()}
          </div>
        )}
        {route && <strong style={{ fontSize: 15 }}>{overlayTitle()}</strong>}
        <span className="header-spacer" />
        {!route && (
          <>
            <button
              type="button"
              className="icon-btn"
              aria-label="Notifications"
              onClick={() => setRoute({ name: 'notifications' })}
            >
              <Bell size={20} />
              {unread > 0 && <span className="badge-dot">{unread > 9 ? '9+' : unread}</span>}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Settings"
              onClick={() => setRoute({ name: 'settings' })}
            >
              <SettingsIcon size={20} />
            </button>
            <button
              type="button"
              aria-label="Your profile"
              onClick={() => setTab('profile')}
              style={{ marginLeft: 2 }}
            >
              <Avatar user={me ?? session.user} size="sm" />
            </button>
          </>
        )}
      </header>

      <main className="app-main">
        <ErrorBoundary scope={overlayTitle()}>
          {route?.name === 'post' ? (
            <PostDetailScreen
              client={client}
              postId={route.id}
              me={me}
              onBack={() => setRoute(null)}
              onOpenAuthor={(handle) => setRoute({ name: 'profile', handle })}
              onOpenMemory={openMemory}
              onDeleted={() => setRoute(null)}
              toast={toast}
            />
          ) : route?.name === 'profile' ? (
            <ProfileScreen
              client={client}
              handle={route.handle}
              me={me}
              onOpenPost={(post: Post) => setRoute({ name: 'post', id: post.id })}
              onOpenMemory={openMemory}
              onProfileUpdated={onProfileUpdated}
              toast={toast}
            />
          ) : route?.name === 'notifications' ? (
            <NotificationsScreen
              client={client}
              onBack={() => setRoute(null)}
              toast={toast}
              onOpenTarget={(n: Notification) => {
                setUnread((u) => Math.max(0, u - 1));
                if (n.target_type === 'post' && n.target_id) {
                  setRoute({ name: 'post', id: n.target_id });
                } else if (n.target_type === 'message') {
                  setRoute({ name: 'profile', handle: n.actor.handle });
                  setTab('agents');
                  setRoute(null);
                } else {
                  setRoute({ name: 'profile', handle: n.actor.handle });
                }
              }}
            />
          ) : route?.name === 'settings' ? (
            <SettingsScreen
              client={client}
              me={me}
              theme={theme}
              onThemeChange={(t) => {
                setTheme(t);
                saveTheme(t);
              }}
              developerMode={developerMode}
              onDeveloperModeChange={(on) => {
                setDeveloperMode(on);
                saveDeveloperMode(on);
                log('dev', `Developer mode ${on ? 'enabled' : 'disabled'}`);
              }}
              baseUrl={baseUrl}
              onBaseUrlChange={(url) => {
                setBaseUrl(url);
                saveBaseUrl(url);
              }}
              onSignOut={onSignOut}
              onSessionRefreshed={onProfileUpdated}
              toast={toast}
            />
          ) : tab === 'feed' ? (
            <FeedScreen
              client={client}
              onOpenPost={(post: Post) => setRoute({ name: 'post', id: post.id })}
              onOpenAuthor={(handle) => setRoute({ name: 'profile', handle })}
              onOpenMemory={openMemory}
              onCompose={() => setTab('compose')}
            />
          ) : tab === 'agents' ? (
            <AgentsScreen client={client} me={me} toast={toast} />
          ) : tab === 'compose' ? (
            <ComposeScreen
              client={client}
              me={me}
              toast={toast}
              onPublished={() => setTab('feed')}
            />
          ) : tab === 'memories' ? (
            <MemoriesScreen client={client} onOpenMemory={openMemory} />
          ) : (
            <ProfileScreen
              client={client}
              handle={me?.handle ?? session.user.handle}
              me={me}
              onOpenPost={(post: Post) => setRoute({ name: 'post', id: post.id })}
              onOpenMemory={openMemory}
              onProfileUpdated={onProfileUpdated}
              toast={toast}
            />
          )}
        </ErrorBoundary>
      </main>

      {!route && (
        <nav className="tabbar" aria-label="Primary">
          <div className="tabbar-inner">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`tab${t.id === 'compose' ? ' tab-compose' : ''}`}
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => setTab(t.id)}
              >
                {t.id === 'compose' ? <span className="compose-circle">{t.icon}</span> : t.icon}
                <span>{t.label}</span>
                <span className="tab-dot" />
              </button>
            ))}
          </div>
        </nav>
      )}

      <MemorySheet
        memory={memory}
        loading={memoryLoading && Boolean(memoryId)}
        error={memoryError}
        onClose={closeMemory}
      />
      {toastHost}
    </div>
  );
}
