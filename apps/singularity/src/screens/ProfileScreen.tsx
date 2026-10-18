/**
 * Profile — the member page: photo (uploaded or linked from the user DB),
 * @dsect email, display name, team, bio, interests, and the member's posts.
 * The owner sees an inline editor; everyone else sees read-only + posts.
 */
import { useCallback, useEffect, useState } from 'react';
import { describeError, type SingularityClient } from '../api/client';
import type { Post, User } from '../api/types';
import { PostCard } from '../components/PostCard';
import { Avatar, Badge, EmptyState, Spinner } from '../components/ui';
import { relativeTime, withAt } from '../lib/format';
import { log } from '../lib/logger';

const MAX_PHOTO_BYTES = 512 * 1024;

export function ProfileScreen({
  client,
  handle,
  me,
  onOpenPost,
  onOpenMemory,
  onProfileUpdated,
  toast,
}: {
  client: SingularityClient;
  handle: string;
  me: User | null;
  onOpenPost: (post: Post) => void;
  onOpenMemory: (id: string) => void;
  onProfileUpdated: (user: User) => void;
  toast: (message: string, tone?: 'info' | 'error') => void;
}) {
  const isSelf = me?.handle === handle;
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Editable fields
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [interests, setInterests] = useState('');
  const [team, setTeam] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [u, p] = await Promise.all([
        client.getProfile(handle),
        client.userPosts(handle, 20),
      ]);
      setUser(u);
      setPosts(p.posts);
      setDisplayName(u.display_name);
      setBio(u.bio);
      setInterests(u.interests.join(', '));
      setTeam(u.team ?? '');
      setAvatarUrl(u.avatar_url ?? '');
      setState('ready');
    } catch (err) {
      setState('error');
      log('profile', `Load failed: ${(err as Error).message}`, 'warn');
    }
  }, [client, handle]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const updated = await client.updateProfile({
        display_name: displayName.trim(),
        bio: bio.trim(),
        interests: interests
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        team: team.trim() || null,
        avatar_url: avatarUrl.trim() || null,
      });
      setUser(updated);
      if (isSelf) onProfileUpdated(updated);
      setEditing(false);
      toast('Profile updated');
    } catch (err) {
      toast(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Photo upload: local file → data URL → avatar_data. Small photos only
   * (512 KB floor); bigger assets should be linked via URL instead.
   */
  const onPickPhoto = (file: File | null) => {
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      toast('Photo is too large (max 512 KB) — link a URL instead', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result ?? '');
      if (!dataUrl.startsWith('data:image/')) {
        toast('That file is not an image', 'error');
        return;
      }
      setBusy(true);
      try {
        const updated = await client.setAvatar({ avatar_data: dataUrl });
        setUser(updated);
        if (isSelf) onProfileUpdated(updated);
        toast('Photo updated');
      } catch (err) {
        toast(describeError(err), 'error');
      } finally {
        setBusy(false);
      }
    };
    reader.onerror = () => toast('Could not read that file', 'error');
    reader.readAsDataURL(file);
  };

  if (state === 'loading') {
    return (
      <div className="row" style={{ justifyContent: 'center', padding: 48 }}>
        <Spinner />
      </div>
    );
  }

  if (state === 'error' || !user) {
    return (
      <div className="card">
        <h2 className="h2">Profile unavailable</h2>
        <p className="muted small" style={{ marginTop: 8 }}>
          Could not load {withAt(handle)}.
        </p>
        <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <div className="profile-head">
          <Avatar user={user} size="lg" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <h1 className="h1">{user.display_name}</h1>
              <Badge tone={user.kind === 'agent' ? 'accent' : 'muted'}>
                {user.kind === 'agent' ? 'Agent' : 'Member'}
              </Badge>
              {user.role !== 'member' ? <Badge tone="ok">{user.role}</Badge> : null}
            </div>
            <div className="muted small">
              {withAt(user.handle)} · <strong>{user.email}</strong>
              {user.team ? ` · ${user.team}` : ''}
            </div>
            <div className="dim small">Joined {relativeTime(user.created_at)} ago</div>
          </div>
        </div>

        {user.bio && <p className="post-body" style={{ marginTop: 14 }}>{user.bio}</p>}

        {user.interests.length > 0 && (
          <div className="interests">
            {user.interests.map((i) => (
              <Badge key={i} tone="muted">
                {i}
              </Badge>
            ))}
          </div>
        )}

        {isSelf && !editing && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: 16 }}
            onClick={() => setEditing(true)}
          >
            Edit profile
          </button>
        )}
      </div>

      {isSelf && editing && (
        <div className="card">
          <h2 className="h2">Edit profile</h2>
          <div className="stack" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="p-name">Display name</label>
              <input id="p-name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="p-bio">Bio</label>
              <textarea id="p-bio" className="textarea" style={{ minHeight: 90 }} value={bio} onChange={(e) => setBio(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="p-interests">Interests (comma-separated)</label>
              <input id="p-interests" className="input" value={interests} onChange={(e) => setInterests(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="p-team">Team</label>
              <input id="p-team" className="input" value={team} onChange={(e) => setTeam(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="p-avatar-url">Linked photo URL (from the user database)</label>
              <input id="p-avatar-url" className="input" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div className="field">
              <label htmlFor="p-avatar-file">Or upload a photo (max 512 KB)</label>
              <input
                id="p-avatar-file"
                type="file"
                accept="image/*"
                onChange={(e) => onPickPhoto(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <h2 className="section-title">Posts ({posts.length})</h2>
      {posts.length === 0 ? (
        <EmptyState title="No posts yet" hint={`${user.display_name} has not posted.`} />
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onReact={async (p, kind) => {
              try {
                if (p.my_reactions.includes(kind)) await client.unreactPost(p.id, kind);
                else await client.reactPost(p.id, kind);
              } catch (err) {
                toast(describeError(err), 'error');
              }
              await load();
            }}
            onOpen={onOpenPost}
            onOpenAuthor={() => {}}
            onOpenMemory={onOpenMemory}
          />
        ))
      )}
    </div>
  );
}
