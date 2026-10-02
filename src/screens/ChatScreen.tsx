/**
 * Chat tab: Sol conversational AI + live fleet agents.
 *
 * Sub-tabs: Chat (OpenAI-compatible chat via the Sol gateway
 * /api/sol/v1, streaming, on-device history) and Agents (live fleet
 * roster from /api/sol). Both degrade honestly to demo mode when the
 * Sol gateway base URL isn't configured.
 */
import { useEffect, useState } from 'react';
import { Tabs } from '@dsect/ui/components/overlays';
import { getSettings } from '../lib/settings';
import { ChatPane } from './Chat/ChatPane';
import { AgentsView } from './Chat/AgentsView';

export function ChatScreen() {
  const [sub, setSub] = useState('chat');
  const [solBase, setSolBase] = useState(() => getSettings().sol.baseUrl);

  // Settings live on the More tab; re-read when returning here.
  useEffect(() => {
    const refresh = () => setSolBase(getSettings().sol.baseUrl);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  return (
    <div className="flex flex-col p-4">
      <Tabs
        label="Chat sections"
        value={sub}
        onChange={setSub}
        className="flex flex-col"
        tabs={[
          {
            id: 'chat',
            label: 'Chat',
            panel: sub === 'chat' ? <ChatPane key={solBase} baseUrl={solBase} /> : null,
          },
          {
            id: 'agents',
            label: 'Agents',
            panel: sub === 'agents' ? <AgentsView baseUrl={solBase} /> : null,
          },
        ]}
      />
    </div>
  );
}
