import { useEffect, useMemo, useState } from "react";
import { useHub, actorById } from "@/singularity/store";
import { resolveRef } from "@/singularity/handles";
import { runSelfChecks } from "@/singularity/checks";
import { DEMO_POST } from "@/singularity/seed";
import type { Actor, ReactionKind, ShellMode } from "@/singularity/types";
import { Avatar, Mark, RoleBadge, timeLabel } from "./ui";
import { RefCard, RichText, refHandlesIn } from "./cards";
import { Composer } from "./composer";

type View =
  | { name: "feed" }
  | { name: "people" }
  | { name: "pings" }
  | { name: "settings" }
  | { name: "profile"; handle: string }
  | { name: "object"; handle: string };

function readView(): View {
  if (typeof window === "undefined") return { name: "feed" };
  const hash = window.location.hash.replace(/^#/, "");
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "people") return { name: "people" };
  if (parts[0] === "pings") return { name: "pings" };
  if (parts[0] === "settings") return { name: "settings" };
  if (parts[0] === "u" && parts[1]) return { name: "profile", handle: decodeURIComponent(parts[1]) };
  if (parts[0] === "o" && parts[1]) return { name: "object", handle: decodeURIComponent(parts[1]) };
  return { name: "feed" };
}

function go(view: View) {
  const hash =
    view.name === "feed"
      ? "#/"
      : view.name === "profile"
        ? `#/u/${encodeURIComponent(view.handle)}`
        : view.name === "object"
          ? `#/o/${encodeURIComponent(view.handle)}`
          : `#/${view.name}`;
  if (window.location.hash !== hash) window.location.hash = hash;
  else window.dispatchEvent(new HashChangeEvent("hashchange"));
}

const NAV = [
  { name: "feed" as const, label: "Feed" },
  { name: "people" as const, label: "People" },
  { name: "pings" as const, label: "Pings" },
  { name: "settings" as const, label: "Settings" },
];

export function SingularityApp() {
  const hub = useHub();
  const [view, setView] = useState<View>({ name: "feed" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    void Promise.resolve(useHub.persist.rehydrate()).finally(() => {
      if (!cancel) {
        useHub.setState({ hydrated: true });
        setView(readView());
      }
    });
    const onHash = () => setView(readView());
    window.addEventListener("hashchange", onHash);
    return () => {
      cancel = true;
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  useEffect(() => {
    if (hub.session?.mode!=="hub") return;
    const timer=setInterval(()=>void useHub.getState().refresh(),20000);
    return ()=>clearInterval(timer);
  }, [hub.session?.mode]);

  if (!hub.hydrated) {
    return (
      <main className="grid min-h-screen place-items-center bg-canvas text-ink">
        <p className="text-sm">Singularity</p>
      </main>
    );
  }

  if (!hub.session) {
    return (
      <Login
        busy={busy}
        error={hub.error}
        onPreview={() => hub.signInPreview("actor-scotty")}
        onSubmit={async () => {setBusy(true); await hub.signInHub();setBusy(false);}}
      />
    );
  }

  const me = actorById(hub.actors, hub.session.actorId) ?? hub.actors[0];
  const shell = hub.shell === "auto-layout" ? "phone" : hub.shell;
  const openProfile = (handle: string) => {
    setView({ name: "profile", handle });
    go({ name: "profile", handle });
  };
  const openObject = (handle: string) => {
    setView({ name: "object", handle });
    go({ name: "object", handle });
  };

  return (
    <div
      data-shell={shell}
      className={
        shell === "watch"
          ? "mx-auto min-h-screen max-w-[280px] bg-canvas text-ink"
          : shell === "tv"
            ? "min-h-screen bg-canvas text-ink text-lg"
            : "min-h-screen bg-canvas text-ink"
      }
    >
      <div className="mx-auto flex min-h-screen w-full max-w-5xl md:gap-6 md:px-6">
        <aside className="hidden w-52 shrink-0 py-6 md:block">
          <button type="button" className="flex items-center gap-2 px-2" onClick={() => go({ name: "feed" })}>
            <Mark />
            <span className="text-base font-semibold">Singularity</span>
          </button>
          <nav className="mt-8 grid gap-1" aria-label="Primary">
            {NAV.map((item) => (
              <button
                key={item.name}
                type="button"
                onClick={() => go({ name: item.name })}
                className={`h-11 rounded-xl px-3 text-left text-sm ${view.name === item.name ? "bg-surface font-medium" : "text-muted"}`}
              >
                {item.label}
                {item.name === "pings" ? <PingCount /> : null}
              </button>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 flex-1 pb-24 md:py-6 md:pb-10">
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur md:rounded-card md:border">
            <div className="flex items-center gap-2 md:hidden">
              <Mark className="size-7" />
              <span className="font-semibold">Singularity</span>
            </div>
            <p className="hidden text-sm text-muted md:block">Quantum / shared workspace</p>
            <button type="button" className="flex items-center gap-2" onClick={() => openProfile(me.handle)}>
              <span className="text-sm font-medium">{me.name}</span>
              <Avatar actor={me} size="sm" />
            </button>
          </header>
          <p className="mx-4 mt-4 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-muted" role="status">
            {hub.session.mode === "preview" ? "Offline demo · changes stay on this device; no agents are contacted." : hub.serviceDemo ? "Shared service demo · SQLite backed; no live agents are contacted." : "Connected to Quantum · live collab objects; delivery status is shown in Settings."}
          </p>
          {hub.error ? (
            <p className="mx-4 mt-3 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-danger" role="alert">
              {hub.error}
              <button type="button" className="ml-2 underline" onClick={hub.clearError}>
                Dismiss
              </button>
            </p>
          ) : null}
          <div className="px-4 pt-4">
            {view.name === "feed" ? (
              <Feed
                me={me}
                readOnly={shell === "car"}
                onProfile={openProfile}
                onObject={openObject}
              />
            ) : null}
            {view.name === "people" ? <People onProfile={openProfile} /> : null}
            {view.name === "pings" ? <Pings /> : null}
            {view.name === "settings" ? <Settings me={me} /> : null}
            {view.name === "profile" ? <Profile handle={view.handle} me={me} onObject={openObject} /> : null}
            {view.name === "object" ? <ObjectView handle={view.handle} onProfile={openProfile} /> : null}
          </div>
        </div>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-surface md:hidden" aria-label="Primary">
        {NAV.map((item) => (
          <button
            key={item.name}
            type="button"
            className={`h-14 text-sm ${view.name === item.name ? "font-semibold text-ink" : "text-muted"}`}
            onClick={() => go({ name: item.name })}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function PingCount() {
  const count = useHub((s) => s.pings.filter((p) => p.toId === s.session?.actorId && !p.acked).length);
  if (!count) return null;
  return <span className="ml-2 text-xs text-accent">{count}</span>;
}

function Login({busy,error,onPreview,onSubmit}:{busy:boolean;error:string|null;onPreview:()=>void;onSubmit:()=>void}) {
  return <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-ink">
    <div className="w-full max-w-sm">
      <Mark className="size-10"/>
      <p className="mt-6 text-xs font-medium tracking-widest text-muted">QUANTUM / SHARED WORKSPACE</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">The Singularity</h1>
      <p className="mt-3 text-sm leading-6 text-muted">One place for your people, agents, and the work that connects them.</p>
      <button disabled={busy} onClick={onSubmit} className="mt-8 h-12 w-full rounded-xl bg-button text-sm font-medium text-button-ink disabled:opacity-40">{busy ? "Checking organization identity" : "Continue with DSECT"}</button>
      <p className="mt-3 text-xs leading-5 text-muted">Uses your existing Quantum identity through the organization gateway. No separate password or account.</p>
      {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p>:null}
      <button onClick={onPreview} className="mt-8 h-11 w-full rounded-xl border border-line bg-surface text-sm">Enter the seeded fleet as Scotty</button>
      <p className="mt-3 text-xs leading-5 text-faint">Offline sandbox only. Example profiles, memories and notifications are not the live fleet.</p>
    </div>
  </main>;
}

function Feed({
  me,
  readOnly,
  onProfile,
  onObject,
}: {
  me: Actor;
  readOnly: boolean;
  onProfile: (handle: string) => void;
  onObject: (handle: string) => void;
}) {
  const posts = useHub((s) => s.posts);
  const post = useHub((s) => s.post);
  const previewPlan = useHub((s) => s.previewPlan);
  const data = useHub();
  return (
    <div className="mx-auto grid max-w-xl gap-4">
      <div><h1 className="text-xl font-semibold tracking-tight">Fleet feed</h1><p className="mt-1 text-sm text-muted">People, agents, and work. Connected.</p></div>
      {readOnly ? (
        <p className="rounded-card border border-line bg-surface px-3 py-3 text-sm text-muted">
          Driving layout. The feed is read-only until you leave the car shell.
        </p>
      ) : (
        <Composer
          data={data}
          actors={data.actors}
          placeholder="Write to the fleet. Use @Name or #goal-001"
          submitLabel="Post"
          onSubmit={post}
          plan={previewPlan}
          seedText={DEMO_POST}
        />
      )}
      {posts.map((item) => (
        <PostCard key={item.id} postId={item.id} me={me} onProfile={onProfile} onObject={onObject} readOnly={readOnly} />
      ))}
    </div>
  );
}

const REACTIONS: { kind: ReactionKind; label: string }[] = [
  { kind: "acknowledge", label: "Acknowledge" },
  { kind: "useful", label: "Useful" },
  { kind: "question", label: "Question" },
];

function PostCard({
  postId,
  me,
  onProfile,
  onObject,
  readOnly,
}: {
  postId: string;
  me: Actor;
  onProfile: (handle: string) => void;
  onObject: (handle: string) => void;
  readOnly: boolean;
}) {
  const post = useHub((s) => s.posts.find((p) => p.id === postId));
  const actors = useHub((s) => s.actors);
  const allComments = useHub((s) => s.comments);
  const comments = allComments.filter((c) => c.postId === postId);
  const react = useHub((s) => s.react);
  const comment = useHub((s) => s.comment);
  const previewPlan = useHub((s) => s.previewPlan);
  const data = useHub();
  const [open, setOpen] = useState(false);
  if (!post) return null;
  const author = actorById(actors, post.authorId);
  if (!author) return null;
  const refs = refHandlesIn(post.tokens);
  return (
    <article className="rounded-card border border-line bg-surface p-4">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => onProfile(author.handle)} className="rounded-full">
          <Avatar actor={author} />
        </button>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="font-medium" onClick={() => onProfile(author.handle)}>
              {author.name}
            </button>
            <RoleBadge role={author.role} />
          </div>
          <p className="text-xs text-faint">
            {author.title} · {timeLabel(post.createdAt)}
          </p>
        </div>
      </header>
      <div className="mt-3">
        <RichText body={post.body} tokens={post.tokens} actors={actors} onMention={onProfile} onRef={onObject} />
      </div>
      {refs.length ? (
        <div className="mt-3 grid gap-2">
          {refs.map((handle) => (
            <RefCard key={handle} handle={handle} data={data} onOpen={onObject} />
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {REACTIONS.map((item) => {
          const count = post.reactions[item.kind].length;
          const mine = post.reactions[item.kind].includes(me.id);
          return (
            <button
              key={item.kind}
              type="button"
              disabled={readOnly}
              onClick={() => react(post.id, item.kind)}
              className={`h-9 rounded-full border px-3 text-xs ${mine ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"}`}
            >
              {item.label}
              {count ? ` ${count}` : ""}
            </button>
          );
        })}
        <button type="button" className="h-9 rounded-full border border-line px-3 text-xs text-muted" onClick={() => setOpen((v) => !v)}>
          {comments.length ? `${comments.length} comments` : "Comment"}
        </button>
      </div>
      {open ? (
        <div className="mt-3 grid gap-3 border-t border-line pt-3">
          {comments.map((item) => {
            const who = actorById(actors, item.authorId);
            if (!who) return null;
            return (
              <div key={item.id} className="grid grid-cols-[auto_1fr] gap-2">
                <button type="button" onClick={() => onProfile(who.handle)}>
                  <Avatar actor={who} size="sm" />
                </button>
                <div>
                  <p className="text-sm font-medium">
                    {who.name} <span className="font-normal text-faint">{timeLabel(item.createdAt)}</span>
                  </p>
                  <RichText body={item.body} tokens={item.tokens} actors={actors} onMention={onProfile} onRef={onObject} />
                  <div className="mt-2 grid gap-2">
                    {refHandlesIn(item.tokens).map((handle) => (
                      <RefCard key={handle} handle={handle} data={data} onOpen={onObject} />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
          {readOnly ? null : (
            <Composer
              data={data}
              actors={actors}
              placeholder="Comment"
              submitLabel="Reply"
              onSubmit={(body) => comment(post.id, body)}
              plan={previewPlan}
            />
          )}
        </div>
      ) : null}
    </article>
  );
}

function People({ onProfile }: { onProfile: (handle: string) => void }) {
  const actors = useHub((s) => s.actors);
  return (
    <div className="mx-auto grid max-w-xl gap-3">
      <h1 className="text-lg font-semibold">Directory</h1>
      {actors.map((actor) => (
        <button
          key={actor.id}
          type="button"
          onClick={() => onProfile(actor.handle)}
          className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 text-left"
        >
          <Avatar actor={actor} />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="font-medium">{actor.name}</span>
              <RoleBadge role={actor.role} />
            </span>
            <span className="block text-sm text-muted">{actor.email}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Profile({ handle, me, onObject }: { handle: string; me: Actor; onObject: (handle: string) => void }) {
  const actors = useHub((s) => s.actors);
  const posts = useHub((s) => s.posts);
  const saveProfile = useHub((s) => s.saveProfile);
  const actor = actors.find((a) => a.handle.toLowerCase() === handle.toLowerCase());
  const [bio, setBio] = useState(actor?.bio ?? "");
  const [interests, setInterests] = useState(actor?.interests.join(", ") ?? "");
  const [title, setTitle] = useState(actor?.title ?? "");
  const [photoError, setPhotoError] = useState<string | null>(null);
  useEffect(() => {
    setBio(actor?.bio ?? "");
    setInterests(actor?.interests.join(", ") ?? "");
    setTitle(actor?.title ?? "");
  }, [actor?.id, actor?.bio, actor?.interests, actor?.title]);
  if (!actor) return <p className="text-sm text-muted">No profile for @{handle}.</p>;
  const mine = actor.id === me.id;
  const authored = posts.filter((p) => p.authorId === actor.id);
  return (
    <div className="mx-auto grid max-w-xl gap-4">
      <section className="rounded-card border border-line bg-surface p-4">
        <div className="flex items-center gap-4">
          <Avatar actor={actor} size="lg" />
          <div>
            <h1 className="text-xl font-semibold">{actor.name}</h1>
            <p className="text-sm text-muted">{actor.email}</p>
            <div className="mt-1">
              <RoleBadge role={actor.role} />
            </div>
          </div>
        </div>
        {mine ? (
          <form
            className="mt-4 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveProfile({
                bio: bio.trim(),
                title: title.trim() || actor.title,
                interests: interests
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 12),
                photo: actor.photo,
              });
            }}
          >
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-11 rounded-xl border border-line px-3" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Bio</span>
              <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className="rounded-xl border border-line px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Interests, separated by commas</span>
              <input value={interests} onChange={(e) => setInterests(e.target.value)} className="h-11 rounded-xl border border-line px-3" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Photo</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (!["image/png","image/jpeg","image/webp"].includes(file.type)) {setPhotoError("Choose PNG, JPEG or WebP.");return;}
                  if (file.size > 300_000) {
                    setPhotoError("Use a photo under 300 KB.");
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    const photo = typeof reader.result === "string" ? reader.result : undefined;
                    setPhotoError(null);
                    saveProfile({ bio: bio.trim(), title: title.trim() || actor.title, interests: actor.interests, photo });
                  };
                  reader.onerror = () => setPhotoError("Could not read that file.");
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {photoError ? <p className="text-sm text-danger">{photoError}</p> : null}
            {actor.photo ? (
              <button
                type="button"
                className="text-left text-sm text-muted"
                onClick={() => saveProfile({ bio, title, interests: actor.interests, photo: "" })}
              >
                Remove photo
              </button>
            ) : null}
            <button type="submit" className="h-11 rounded-xl bg-button text-sm font-medium text-button-ink">
              Save profile
            </button>
          </form>
        ) : (
          <div className="mt-4">
            <p className="text-sm leading-6">{actor.bio}</p>
            <p className="mt-2 text-sm text-muted">{actor.interests.join(", ")}</p>
          </div>
        )}
      </section>
      <h2 className="text-sm font-medium text-muted">Posts</h2>
      {authored.map((item) => (
        <article key={item.id} className="rounded-card border border-line bg-surface p-4">
          <RichText body={item.body} tokens={item.tokens} actors={actors} onMention={() => undefined} onRef={onObject} />
          <div className="mt-2 grid gap-2">
            {refHandlesIn(item.tokens).map((h) => (
              <RefCard key={h} handle={h} data={useHub.getState()} onOpen={onObject} />
            ))}
          </div>
        </article>
      ))}
      {!authored.length ? <p className="text-sm text-muted">No posts yet.</p> : null}
    </div>
  );
}

function Pings() {
  const session = useHub((s) => s.session);
  const pings = useHub((s) => s.pings);
  const actors = useHub((s) => s.actors);
  const ack = useHub((s) => s.ack);
  const mine = pings.filter((p) => p.toId === session?.actorId);
  const sent = pings.filter((p) => p.fromId === session?.actorId);
  return (
    <div className="mx-auto grid max-w-xl gap-3">
      <h1 className="text-lg font-semibold">Pings</h1>
      <p className="text-sm text-muted">Agent mentions and task requests. In demo mode these are simulated; live delivery status is available in Settings.</p>
      {!mine.length ? <p className="text-sm text-muted">Nothing waiting for you.</p> : null}
      {mine.map((ping) => {
        const from = actorById(actors, ping.fromId);
        return (
          <article key={ping.id} className="rounded-card border border-line bg-surface p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{ping.subject}</p>
              <span className="text-xs text-faint">{ping.acked ? "Acked" : ping.kind}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{from?.name} · {ping.summary}</p>
            {ping.ref ? <p className="mt-1 text-xs text-accent">#{ping.ref}</p> : null}
            {!ping.acked ? (
              <button type="button" className="mt-2 h-9 rounded-xl border border-line px-3 text-xs" onClick={() => ack(ping.id)}>
                Ack
              </button>
            ) : null}
          </article>
        );
      })}
      {sent.length ? <h2 className="pt-2 text-sm font-medium text-muted">Sent</h2> : null}
      {sent.map((ping) => {
        const to = actorById(actors, ping.toId);
        return (
          <article key={ping.id} className="rounded-card border border-line bg-surface p-3">
            <p className="text-sm font-medium">
              {to?.name} · {ping.kind}
            </p>
            <p className="mt-1 text-sm text-muted">{ping.subject}</p>
            {ping.ref ? <p className="mt-1 text-xs text-accent">#{ping.ref}</p> : null}
          </article>
        );
      })}
    </div>
  );
}

function ObjectView({ handle, onProfile }: { handle: string; onProfile: (handle: string) => void }) {
  const data = useHub();
  const ref = resolveRef(data, handle);
  if (!ref) return <p className="text-sm text-muted">No live object for #{handle}.</p>;
  const owner = ref.kind === "goal" ? actorById(data.actors, ref.ownerId) : undefined;
  const assignee = ref.kind === "task" ? actorById(data.actors, ref.assigneeId) : undefined;
  return (
    <article className="mx-auto max-w-xl rounded-card border border-line bg-surface p-4">
      <p className="text-xs font-medium text-accent">#{ref.handle}</p>
      <h1 className="mt-1 text-xl font-semibold">{ref.title}</h1>
      <p className="mt-1 text-sm capitalize text-muted">{ref.kind} · {ref.kind === "memory" ? ref.tier : ref.status}</p>
      {ref.kind === "goal" ? (
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-canvas">
            <div className="h-full bg-accent" style={{ width: `${ref.progress}%` }} />
          </div>
          <p className="mt-2 text-sm">
            Owner{" "}
            {owner ? (
              <button type="button" className="font-medium" onClick={() => onProfile(owner.handle)}>
                {owner.name}
              </button>
            ) : (
              "none"
            )}
          </p>
          <p className="mt-2 text-sm leading-6 text-muted">{ref.summary}</p>
        </div>
      ) : null}
      {ref.kind === "task" ? (
        <div className="mt-3 text-sm leading-6">
          <p>
            Assignee{" "}
            {assignee ? (
              <button type="button" className="font-medium" onClick={() => onProfile(assignee.handle)}>
                {assignee.name}
              </button>
            ) : (
              "unassigned"
            )}
          </p>
          <p className="text-muted">Goal #{ref.goalHandle}</p>
          <p className="mt-2 text-muted">{ref.summary}</p>
        </div>
      ) : null}
      {ref.kind === "memory" ? (
        <div className="mt-3 text-sm leading-6">
          <p className="text-muted">{ref.tier} · {ref.agent}</p>
          <p className="mt-2">{ref.excerpt}</p>
        </div>
      ) : null}
      {ref.kind === "issue" ? (
        <p className="mt-3 text-sm text-muted">
          {ref.repo} #{ref.number}
        </p>
      ) : null}
      {ref.kind === "bounty" ? <p className="mt-3 text-sm text-muted">{ref.reward}</p> : null}
      {ref.kind === "service" ? <p className="mt-3 text-sm leading-6 text-muted">{ref.summary}</p> : null}
    </article>
  );
}

function Settings({ me }: { me: Actor }) {
  const developerMode = useHub((s) => s.developerMode);
  const setDeveloperMode = useHub((s) => s.setDeveloperMode);
  const shell = useHub((s) => s.shell);
  const setShell = useHub((s) => s.setShell);
  const logs = useHub((s) => s.logs);
  const signOut = useHub((s) => s.signOut);
  const session = useHub((s) => s.session);
  const [checks, setChecks] = useState<ReturnType<typeof runSelfChecks> | null>(null);
  const shells = useMemo(
    () =>
      [
        ["auto-layout", "Responsive"],
        ["phone", "Phone"],
        ["desktop", "Desktop"],
        ["tv", "Google TV"],
        ["watch", "Wear OS"],
        ["car", "Android Auto"],
      ] as Array<[ShellMode, string]>,
    [],
  );
  return (
    <div className="mx-auto grid max-w-xl gap-4">
      <section className="rounded-card border border-line bg-surface p-4">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Signed in as {me.email}
          {session?.mode === "preview" ? " · preview identity" : " · hub session"}
        </p>
        <label className="mt-4 flex items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-medium">Developer mode</span>
            <span className="block text-xs text-muted">Logs, self-checks, and device shells</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={developerMode}
            checked={developerMode}
            onChange={(e) => setDeveloperMode(e.target.checked)}
            className="size-6 accent-[var(--color-accent)]"
          />
        </label>
        <button type="button" className="mt-4 h-11 rounded-xl border border-line px-4 text-sm" onClick={signOut}>
          Sign out
        </button>
      </section>
      {developerMode ? (
        <section className="rounded-card border border-line bg-surface p-4">
          <h2 className="text-sm font-medium">Device shell</h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            Installable web app on supported desktop and mobile browsers. Native distribution requires platform builds and signing. TV, watch, and car below are layout experiments only, not supported native apps.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {shells.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setShell(id)}
                className={`h-9 rounded-full border px-3 text-xs ${shell === id ? "border-ink bg-button text-button-ink" : "border-line"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="mt-4 h-11 rounded-xl bg-button px-4 text-sm font-medium text-button-ink"
            onClick={() => setChecks(runSelfChecks())}
          >
            Run self-checks
          </button>
          {checks ? (
            <ul className="mt-3 grid gap-1 text-xs">
              {checks.map((c) => (
                <li key={c.name} className={c.pass ? "text-ok" : "text-danger"}>
                  {c.pass ? "Pass" : "Fail"} · {c.name}
                </li>
              ))}
            </ul>
          ) : null}
          <h2 className="mt-4 text-sm font-medium">Mention deliveries</h2>
          <p className="mt-1 text-xs text-muted">{useHub.getState().deliveries.length ? useHub.getState().deliveries.map(d=>`${d.kind}: ${d.status}`).join(" · ") : "No live deliveries. Demo pings stay local."}</p>
          <h2 className="mt-4 text-sm font-medium">Log</h2>
          <ul className="mt-2 grid max-h-64 gap-2 overflow-auto">
            {logs.map((entry) => (
              <li key={entry.id} className="text-xs leading-5 text-muted">
                <span className={entry.level === "error" ? "text-danger" : "text-faint"}>{entry.level}</span> {entry.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
