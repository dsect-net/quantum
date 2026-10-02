/**
 * Mail tab — DSECT mail over the hub MCP gateway.
 *
 * Routes: inbox (folder list) -> thread (message view) -> compose.
 * Unconfigured -> the honest "not connected" state; the client is never
 * faked. The parent wires this screen into the tab bar as the Mail tab
 * (renamed from Messages).
 */
import { useMemo, useState } from 'react';
import { Badge, EmptyState } from '@dsect/ui/components/feedback';
import { DemoBanner } from '../../components/DemoBanner';
import { getSettings } from '../../lib/settings';
import { mailConfigured } from '../../lib/mail-settings';
import { createMailClient, type MailFolder } from '../../api/mail';
import { QButton } from '../../lib/untitled';
import { InboxView } from './InboxView';
import { ThreadView } from './ThreadView';
import { ComposeView } from './ComposeView';

type Route =
  | { name: 'inbox' }
  | { name: 'thread'; folder: MailFolder; uid: number }
  | { name: 'compose'; replyTo: { folder: MailFolder; uid: number } | null };

export function MailScreen() {
  const settings = useMemo(() => getSettings(), []);
  const client = useMemo(
    () => createMailClient(settings.hub.baseUrl, settings.mcpKey),
    [settings],
  );
  const configured = mailConfigured(settings);
  const [route, setRoute] = useState<Route>({ name: 'inbox' });
  /** Bumped after a send so the inbox reloads. */
  const [inboxRefresh, setInboxRefresh] = useState(0);

  if (!configured) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <DemoBanner configured={false} serviceLabel="mail" />
        <EmptyState
          mark="@"
          title="Mail is not connected"
          text="Add the Hub API base URL and your MCP worker key in More → Connection settings. Mail runs over the hub MCP gateway — no separate mail password is needed, and your mailbox is the one registered to your key."
          actions={
            <Badge tone="warn" size="sm">
              Not connected
            </Badge>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Mail</h2>
        {route.name === 'inbox' && (
          <QButton
            size="md"
            onPress={() => setRoute({ name: 'compose', replyTo: null })}
          >
            Compose
          </QButton>
        )}
      </div>

      {route.name === 'inbox' && (
        <InboxView
          client={client}
          refreshToken={inboxRefresh}
          onOpenMessage={(folder, uid) =>
            setRoute({ name: 'thread', folder, uid })
          }
        />
      )}

      {route.name === 'thread' && (
        <ThreadView
          client={client}
          folder={route.folder}
          uid={route.uid}
          onBack={() => setRoute({ name: 'inbox' })}
          onReply={(folder, uid) =>
            setRoute({ name: 'compose', replyTo: { folder, uid } })
          }
        />
      )}

      {route.name === 'compose' && (
        <ComposeView
          client={client}
          replyTo={route.replyTo}
          onCancel={() => setRoute({ name: 'inbox' })}
          onSent={() => {
            setInboxRefresh((n) => n + 1);
            setRoute({ name: 'inbox' });
          }}
        />
      )}
    </div>
  );
}
