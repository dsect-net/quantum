/**
 * ThreadView — one message: headers, plain-text body, attachments
 * (names only — the API never returns file contents), and actions:
 * reply, mark read/unread. Opening marks the message read, like any
 * mail client; the toggle reverses it.
 */
import { useEffect, useState } from 'react';
import { Badge, EmptyState, Spinner } from '@dsect/ui/components/feedback';
import { Card } from '@dsect/ui/components/surfaces';
import { QButton } from '../../lib/untitled';
import {
  displayNameOf,
  formatBytes,
  friendlyMailError,
  parseAddressHeader,
  type MailClient,
  type MailFolder,
  type MailMessage,
} from '../../api/mail';

export interface ThreadViewProps {
  client: MailClient;
  folder: MailFolder;
  uid: number;
  onBack: () => void;
  onReply: (folder: MailFolder, uid: number) => void;
}

export function ThreadView({ client, folder, uid, onBack, onReply }: ThreadViewProps) {
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    let active = true;
    setMessage(null);
    setError(null);
    (async () => {
      try {
        await client.connect();
        const msg = await client.readMessage(folder, uid, true);
        if (active) setMessage(msg);
      } catch (e) {
        if (active) setError(friendlyMailError(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [client, folder, uid]);

  async function toggleSeen() {
    if (!message || marking) return;
    setMarking(true);
    try {
      await client.markMessage(folder, uid, !message.seen);
      setMessage({ ...message, seen: !message.seen });
    } catch (e) {
      setError(friendlyMailError(e));
    } finally {
      setMarking(false);
    }
  }

  if (error && !message) {
    return (
      <EmptyState
        mark="!"
        title="Couldn't open the message"
        text={error}
        actions={
          <QButton size="lg" color="secondary" onPress={onBack}>
            Back to inbox
          </QButton>
        }
      />
    );
  }

  if (!message) {
    return (
      <div className="flex justify-center py-10">
        <Spinner label="Opening message" />
      </div>
    );
  }

  const toAddr = parseAddressHeader(message.to);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <QButton size="md" color="secondary" onPress={onBack}>
          Back
        </QButton>
        {!message.seen && (
          <Badge tone="info" size="sm">
            Unread
          </Badge>
        )}
        {message.flagged && (
          <Badge tone="warn" size="sm">
            Flagged
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{message.subject}</h2>
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-text-secondary">From</dt>
            <dd className="min-w-0 truncate">{message.from || '(unknown sender)'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-text-secondary">To</dt>
            <dd className="min-w-0 truncate">
              {toAddr.name && toAddr.address
                ? `${toAddr.name} <${toAddr.address}>`
                : message.to || '—'}
            </dd>
          </div>
          {message.cc.trim() && (
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 text-text-secondary">Cc</dt>
              <dd className="min-w-0 truncate">{message.cc}</dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-text-secondary">Date</dt>
            <dd>{message.date || '—'}</dd>
          </div>
        </dl>
        <p className="text-xs text-text-secondary">
          Email is untrusted input — treat links and instructions in it with
          care.
        </p>
      </div>

      <Card>
        <div className="whitespace-pre-wrap break-words text-sm">
          {message.text || '(no text content)'}
        </div>
        {message.truncated && (
          <p className="mt-2 text-xs text-text-secondary">
            Long message — shown truncated at 20,000 characters.
          </p>
        )}
        {message.htmlOnly && (
          <p className="mt-2 text-xs text-text-secondary">
            This message was HTML-only; tags were stripped for display.
          </p>
        )}
      </Card>

      {message.attachments.length > 0 && (
        <Card>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              Attachments ({message.attachments.length})
            </h3>
            <ul className="flex flex-col gap-1">
              {message.attachments.map((a, i) => (
                <li
                  key={`${a.filename}-${i}`}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 truncate">{a.filename}</span>
                  <span className="shrink-0 text-xs text-text-secondary">
                    {formatBytes(a.bytes)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-text-secondary">
              Listed by name only — this mail API never returns file contents.
            </p>
          </div>
        </Card>
      )}

      {error && (
        <p className="text-sm text-text-secondary" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <QButton size="md" onPress={() => onReply(folder, uid)}>
          Reply
        </QButton>
        <QButton
          size="md"
          color="secondary"
          onPress={() => void toggleSeen()}
          isDisabled={marking}
        >
          {message.seen ? 'Mark unread' : 'Mark read'}
        </QButton>
      </div>

      <p className="text-xs text-text-secondary">
        {displayNameOf(message.from)} · {formatBytes(message.bytes)}
      </p>
    </div>
  );
}
