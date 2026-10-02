/**
 * InboxView — folder list for one mailbox folder.
 *
 * Folder picker + unread filter, message rows (sender, subject, snippet,
 * date, unread marker), and cursor pagination via the server's
 * next_before_uid. Rows are QButtons (real button semantics, 44px+ touch
 * targets) — the kit has no list-row component, so this is the gap-free
 * compliant choice rather than a raw <button>.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, EmptyState, Spinner } from '@dsect/ui/components/feedback';
import { SelectField } from '@dsect/ui/components/forms';
import { Avatar } from '@dsect/ui/components/status';
import { QButton, QToggle } from '../../lib/untitled';
import { useLongPress } from '../../lib/useLongPress';
import {
  MAIL_FOLDERS,
  displayNameOf,
  folderLabel,
  formatMailDate,
  friendlyMailError,
  type MailClient,
  type MailFolder,
  type MailListResult,
  type MailMessageSummary,
} from '../../api/mail';

export interface InboxViewProps {
  client: MailClient;
  /** Bump to force a reload (e.g. after sending). */
  refreshToken: number;
  onOpenMessage: (folder: MailFolder, uid: number) => void;
}

/**
 * One inbox row. Tap opens the thread; long-press toggles read/unread.
 * The tap is suppressed when the long-press fired so a hold never also
 * opens the thread.
 */
function MessageRow({
  message: m,
  onOpen,
  onToggleSeen,
}: {
  message: MailMessageSummary;
  onOpen: () => void;
  onToggleSeen: (seen: boolean) => void;
}) {
  const suppressTap = useRef(false);
  const lp = useLongPress({
    onLongPress: () => {
      suppressTap.current = true;
      onToggleSeen(!m.seen);
    },
  });

  return (
    <QButton
      onPress={() => {
        if (suppressTap.current) {
          suppressTap.current = false;
          return;
        }
        onOpen();
      }}
      aria-label={`${m.seen ? '' : 'Unread: '}${m.subject}, from ${displayNameOf(m.from)}${m.seen ? '' : '. Long-press to mark as read.'}`}
      className="flex w-full items-start gap-3 p-3 text-left"
      {...lp}
    >
      <span
        aria-hidden
        className={`mt-2 h-2 w-2 shrink-0 rounded-full ${m.seen ? 'bg-transparent' : 'bg-accent'}`}
      />
      <Avatar
        name={displayNameOf(m.from)}
        size="sm"
        className="shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-sm ${m.seen ? 'text-text-secondary' : 'font-semibold'}`}
          >
            {displayNameOf(m.from)}
          </span>
          <span className="shrink-0 text-xs text-text-secondary">
            {formatMailDate(m.date)}
          </span>
        </span>
        <span
          className={`block truncate text-sm ${m.seen ? '' : 'font-medium'}`}
        >
          {m.subject}
        </span>
        {m.snippet && (
          <span className="block truncate text-sm text-text-secondary">
            {m.snippet}
          </span>
        )}
      </span>
    </QButton>
  );
}

export function InboxView({ client, refreshToken, onOpenMessage }: InboxViewProps) {
  const [folder, setFolder] = useState<MailFolder>('INBOX');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [result, setResult] = useState<MailListResult | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bump to re-run the connect+load effect (retry button). */
  const [attempt, setAttempt] = useState(0);
  const nextCursor = useRef<number | null>(null);

  // Connect (once per attempt) then load the first page. Folder, filter,
  // refresh-token and retry changes all re-run this effect.
  useEffect(() => {
    let active = true;
    nextCursor.current = null;
    setConnecting(true);
    setError(null);
    setResult(null);
    (async () => {
      try {
        await client.connect();
      } catch (e) {
        if (active) {
          setError(friendlyMailError(e));
          setConnecting(false);
        }
        return;
      }
      if (!active) return;
      try {
        const page = await client.listMessages(folder, {
          limit: 20,
          unreadOnly,
        });
        if (!active) return;
        nextCursor.current = page.nextBeforeUid;
        setResult(page);
      } catch (e) {
        if (active) setError(friendlyMailError(e));
      } finally {
        if (active) setConnecting(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [client, folder, unreadOnly, refreshToken, attempt]);

  const refresh = useCallback(async () => {
    try {
      const page = await client.listMessages(folder, {
        limit: 20,
        unreadOnly,
      });
      nextCursor.current = page.nextBeforeUid;
      setResult(page);
      setError(null);
    } catch (e) {
      setError(friendlyMailError(e));
    }
  }, [client, folder, unreadOnly]);

  const loadMore = useCallback(async () => {    const cursor = nextCursor.current;
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await client.listMessages(folder, {
        limit: 20,
        unreadOnly,
        beforeUid: cursor,
      });
      nextCursor.current = page.nextBeforeUid;
      setResult((prev) =>
        prev
          ? {
              messages: [...prev.messages, ...page.messages],
              matched: page.matched,
              nextBeforeUid: page.nextBeforeUid,
            }
          : page,
      );
    } catch (e) {
      setError(friendlyMailError(e));
    } finally {
      setLoadingMore(false);
    }
  }, [client, folder, unreadOnly]);

  /** Long-press action on a row: toggle read/unread, then refresh the list. */
  const toggleSeen = useCallback(
    async (uid: number, seen: boolean) => {
      try {
        await client.markMessage(folder, uid, seen);
        await refresh();
      } catch (e) {
        setError(friendlyMailError(e));
      }
    },
    [client, folder, refresh],
  );

  if (connecting) {
    return (
      <div className="flex justify-center py-10">
        <Spinner label="Connecting to mail" />
      </div>
    );
  }

  if (error && !result) {
    return (
      <EmptyState
        mark="!"
        title="Couldn't reach mail"
        text={error}
        actions={
          <QButton size="lg" onPress={() => setAttempt((a) => a + 1)}>
            Retry
          </QButton>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3">
        <SelectField
          label="Folder"
          value={folder}
          onChange={(e) => setFolder(e.target.value as MailFolder)}
        >
          {MAIL_FOLDERS.map((f) => (
            <option key={f} value={f}>
              {folderLabel(f)}
            </option>
          ))}
        </SelectField>
        <label className="flex min-h-[44px] items-center justify-between gap-3">
          <span className="text-sm font-medium">Unread only</span>
          <QToggle
            aria-label="Show unread only"
            isSelected={unreadOnly}
            onChange={setUnreadOnly}
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-text-secondary" role="status">
          {result
            ? `${result.matched} message${result.matched === 1 ? '' : 's'}${unreadOnly ? ' unread' : ''}`
            : ''}
        </span>
        <div className="flex items-center gap-2">
          {result && unreadOnly && result.matched > 0 && (
            <Badge tone="info" size="sm">
              {result.matched} unread
            </Badge>
          )}
          <QButton size="md" color="secondary" onPress={() => void refresh()}>
            Refresh
          </QButton>
        </div>
      </div>

      {error && result && (
        <p className="text-sm text-text-secondary" role="alert">
          Couldn&apos;t refresh: {error}
        </p>
      )}

      {!result ? (
        <div className="flex justify-center py-10">
          <Spinner label="Loading messages" />
        </div>
      ) : result.messages.length === 0 ? (
        <EmptyState
          mark="◌"
          title={unreadOnly ? 'No unread messages' : 'Folder is empty'}
          text={
            unreadOnly
              ? `Nothing unread in ${folderLabel(folder)} — you're caught up.`
              : `No messages in ${folderLabel(folder)} yet.`
          }
        />
      ) : (
        <ul
          className="flex flex-col gap-2"
          aria-label={`${folderLabel(folder)} messages`}
        >
          {result.messages.map((m) => (
            <li key={m.uid}>
              <MessageRow
                message={m}
                onOpen={() => onOpenMessage(folder, m.uid)}
                onToggleSeen={(seen) => void toggleSeen(m.uid, seen)}
              />
            </li>
          ))}
        </ul>
      )}

      {result?.nextBeforeUid ? (
        <QButton
          color="secondary"
          onPress={() => void loadMore()}
          isDisabled={loadingMore}
          isLoading={loadingMore}
        >
          Load more
        </QButton>
      ) : null}
    </div>
  );
}
