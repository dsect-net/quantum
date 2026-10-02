/**
 * ComposeView — new message or reply.
 *
 * To / Subject via QInput, body via the kit TextArea. Validation mirrors
 * the server limits (see validateSendArgs in ../../api/mail) so mistakes
 * fail fast; server refusals (e.g. the secret scanner, the daily limit)
 * surface as send errors. Replies thread via in_reply_to_uid and quote
 * the original below the fold.
 */
import { useEffect, useState } from 'react';
import { EmptyState, Spinner } from '@dsect/ui/components/feedback';
import { TextArea } from '@dsect/ui/components/forms';
import { QButton, QInput } from '../../lib/untitled';
import {
  MAIL_SEND_LIMITS,
  MailError,
  friendlyMailError,
  parseAddressHeader,
  validateSendArgs,
  type MailClient,
  type MailFolder,
} from '../../api/mail';

export interface ComposeReplyTo {
  folder: MailFolder;
  uid: number;
}

export interface ComposeViewProps {
  client: MailClient;
  replyTo: ComposeReplyTo | null;
  onCancel: () => void;
  onSent: () => void;
}

function splitRecipients(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function replySubject(subject: string): string {
  const s = subject.trim() || '(no subject)';
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

function replyBody(from: string, date: string, text: string): string {
  const quoted = text
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
  const when = date.trim() || 'an earlier date';
  return `\n\n---\nOn ${when}, ${from.trim() || 'the sender'} wrote:\n${quoted}`;
}

export function ComposeView({ client, replyTo, onCancel, onSent }: ComposeViewProps) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loadingOriginal, setLoadingOriginal] = useState(!!replyTo);
  const [sending, setSending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [inReplyToUid, setInReplyToUid] = useState<number | null>(null);

  // Prefill for replies: recipient, subject, quoted body.
  useEffect(() => {
    if (!replyTo) return;
    let active = true;
    (async () => {
      try {
        await client.connect();
        const orig = await client.readMessage(
          replyTo.folder,
          replyTo.uid,
          false,
        );
        if (!active) return;
        const { address } = parseAddressHeader(orig.from);
        setTo(address || orig.from);
        setSubject(replySubject(orig.subject));
        setBody(replyBody(orig.from, orig.date, orig.text));
        setInReplyToUid(orig.uid);
      } catch (e) {
        if (active) setSendError(friendlyMailError(e));
      } finally {
        if (active) setLoadingOriginal(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [client, replyTo]);

  async function onSend() {
    const args = {
      to: splitRecipients(to),
      subject,
      body,
      ...(inReplyToUid ? { inReplyToUid } : {}),
    };
    const problem = validateSendArgs(args);
    if (problem) {
      setFieldError(problem);
      return;
    }
    setFieldError(null);
    setSendError(null);
    setSending(true);
    try {
      await client.sendMessage(args);
      onSent();
    } catch (e) {
      setSendError(
        e instanceof MailError
          ? e.message
          : friendlyMailError(e),
      );
    } finally {
      setSending(false);
    }
  }

  if (loadingOriginal) {
    return (
      <div className="flex justify-center py-10">
        <Spinner label="Loading original message" />
      </div>
    );
  }

  const toInvalid = fieldError !== null && splitRecipients(to).length === 0;
  const subjectInvalid =
    fieldError !== null &&
    (!subject.trim() || /[\r\n]/.test(subject));
  const bodyInvalid =
    fieldError !== null &&
    (!body.trim() || body.length > MAIL_SEND_LIMITS.maxBodyChars);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {replyTo ? 'Reply' : 'New message'}
        </h2>
        <QButton size="md" color="secondary" onPress={onCancel}>
          Cancel
        </QButton>
      </div>

      {sendError && !fieldError && (
        <EmptyState
          mark="!"
          title="Couldn't send"
          text={sendError}
          actions={
            <QButton size="md" color="secondary" onPress={() => setSendError(null)}>
              Dismiss
            </QButton>
          }
        />
      )}

      <QInput
        label="To"
        hint={
          toInvalid
            ? fieldError
            : 'One or more addresses, separated by commas.'
        }
        placeholder="name@dsect.net"
        value={to}
        onChange={(v) => {
          setTo(v);
          setFieldError(null);
        }}
        isInvalid={toInvalid}
        inputMode="email"
        autoComplete="email"
      />

      <QInput
        label="Subject"
        hint={
          subjectInvalid
            ? fieldError
            : `One line, ${MAIL_SEND_LIMITS.maxSubjectChars} characters max.`
        }
        placeholder="Subject"
        value={subject}
        onChange={(v) => {
          setSubject(v);
          setFieldError(null);
        }}
        isInvalid={subjectInvalid}
        maxLength={MAIL_SEND_LIMITS.maxSubjectChars + 20}
      />

      <TextArea
        label="Message"
        hint={
          bodyInvalid
            ? undefined
            : `${body.length.toLocaleString()} / ${MAIL_SEND_LIMITS.maxBodyChars.toLocaleString()} characters.`
        }
        error={bodyInvalid ? fieldError : undefined}
        placeholder="Write your message…"
        rows={10}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setFieldError(null);
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <QButton
          size="lg"
          onPress={() => void onSend()}
          isDisabled={sending}
          isLoading={sending}
        >
          {sending ? 'Sending…' : 'Send'}
        </QButton>
        <span className="text-xs text-text-secondary">
          Sent as your own @dsect.net address.
        </span>
      </div>
    </div>
  );
}
