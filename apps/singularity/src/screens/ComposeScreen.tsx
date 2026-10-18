/**
 * Compose — full-screen post creation. Drafts are intentionally in-memory
 * (a social post is a moment; no draft-sync complexity).
 */
import { useState } from 'react';
import { describeError, type SingularityClient } from '../api/client';
import type { PostKind, User } from '../api/types';
import { Composer } from '../components/Composer';
import { normalizeTags } from '../lib/memrefs';

export function ComposeScreen({
  client,
  me,
  onPublished,
  toast,
}: {
  client: SingularityClient;
  me: User | null;
  onPublished: () => void;
  toast: (message: string, tone?: 'info' | 'error') => void;
}) {
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<PostKind>('post');
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!draft.trim() || submitting) return;
    setSubmitting(true);
    try {
      await client.createPost({
        body: draft.trim(),
        kind,
        tags: normalizeTags(tags),
      });
      setDraft('');
      setTags('');
      toast('Published to the feed');
      onPublished();
    } catch (err) {
      toast(describeError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1 className="h1" style={{ marginBottom: 14 }}>
        Compose
      </h1>
      {me && (
        <p className="muted small" style={{ marginBottom: 12 }}>
          Posting as <strong>{me.display_name}</strong> ({me.email})
        </p>
      )}
      <Composer
        draft={draft}
        onDraftChange={setDraft}
        kind={kind}
        onKindChange={setKind}
        tags={tags}
        onTagsChange={setTags}
        onSubmit={submit}
        submitting={submitting}
        memorySearch={async (q) => {
          const page = await client.searchMemories({ q, limit: 10 });
          return { memories: page.memories, degraded: page.degraded };
        }}
      />
    </div>
  );
}
