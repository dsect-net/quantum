/**
 * Quantum app shell: @dsect/ui AppShell + AppBar + TabBar.
 *
 * Five tabs — Home, Chat, Create, Messages, More — per the finalized plan.
 * Unbuilt Phase-4 modules render honest "coming soon" placeholders;
 * the More tab hosts the real Connection settings and About screens.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Home, MessageCircle, Sparkles, Mail, Ellipsis } from 'lucide-react';
import { AppShell, AppBar, TabBar } from '@dsect/ui/components/app';
import type { TabBarItem } from '@dsect/ui/components/app';
import { HomeScreen } from './screens/HomeScreen';
import { ChatScreen } from './screens/ChatScreen';
import { CreateScreen } from './screens/CreateScreen';
import { MessagesScreen } from './screens/MessagesScreen';
import { MoreScreen } from './screens/MoreScreen';
import type { MoreRoute } from './screens/MoreScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AboutScreen } from './screens/AboutScreen';

type TabId = 'home' | 'chat' | 'create' | 'messages' | 'more';

const TABS: { id: TabId; label: string; icon: ReactNode; title: string }[] = [
  { id: 'home', label: 'Home', icon: <Home size={22} />, title: 'Home' },
  { id: 'chat', label: 'Chat', icon: <MessageCircle size={22} />, title: 'Chat' },
  { id: 'create', label: 'Create', icon: <Sparkles size={22} />, title: 'Create' },
  { id: 'messages', label: 'Messages', icon: <Mail size={22} />, title: 'Messages' },
  { id: 'more', label: 'More', icon: <Ellipsis size={22} />, title: 'More' },
];

export default function App() {
  const [tab, setTab] = useState<TabId>('home');
  const [moreRoute, setMoreRoute] = useState<MoreRoute | null>(null);

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
  else if (tab === 'messages') screen = <MessagesScreen />;
  else if (moreRoute === 'settings') {
    screen = <SettingsScreen />;
    title = 'Connection settings';
  } else if (moreRoute === 'about') {
    screen = <AboutScreen />;
    title = 'About';
  } else {
    screen = <MoreScreen onNavigate={setMoreRoute} />;
  }

  return (
    <AppShell
      appBar={<AppBar title={title} subtitle="Quantum · DSECT" />}
      tabBar={<TabBar items={items} current={tab} label="Primary" />}
    >
      {screen}
    </AppShell>
  );
}
