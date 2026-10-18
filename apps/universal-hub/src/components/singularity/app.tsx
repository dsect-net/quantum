import { useEffect, useMemo, useState } from "react";
import { useHub, actorById } from "@/singularity/store";
import { resolveRef } from "@/singularity/handles";
import { runSelfChecks } from "@/singularity/checks";
import { DEMO_POST } from "@/singularity/seed";
import type { Actor, ReactionKind, ShellMode } from "@/singularity/types";
import { Avatar, Mark, RoleBadge, timeLabel } from "./ui";
import { RefCard, RichText, refHandlesIn } from "./cards";
import { Composer } from "./composer";
import { Icon } from "./icon";
import { filterFeed, type FeedFilter } from "@/singularity/feed";

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

  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const el=e.target as HTMLElement;
      if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!el.closest('input, textarea, [contenteditable="true"]')) {
        const search=document.querySelector<HTMLInputElement>('input[aria-label="Search feed"]');
        if(search){e.preventDefault();search.focus();}
      }
    };
    document.addEventListener('keydown',onKey);return ()=>document.removeEventListener('keydown',onKey);
  },[]);

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
      <div className="workspace-grid">
        <aside className="workspace-sidebar">
          <button type="button" className="brand-lockup" onClick={() => go({ name: "feed" })}>
            <Mark className="size-9" />
            <span><span className="block text-[15px] font-semibold tracking-tight">Singularity</span><span className="block text-[10px] font-medium tracking-[.15em] text-faint">QUANTUM WORKSPACE</span></span>
          </button>
          <div className="workspace-switch"><span className="workspace-monogram">Q</span><span><strong>Quantum</strong><small>Shared workspace</small></span><Icon name="chevron" size={14}/></div>
          <p className="section-eyebrow">WORKSPACE</p>
          <nav className="grid gap-1" aria-label="Primary">
            {NAV.map((item) => (
              <button key={item.name} type="button" onClick={() => go({ name: item.name })}
                aria-current={view.name===item.name ? "page" : undefined}
                className={`workspace-nav-item ${view.name===item.name ? "is-active" : ""}`}>
                <Icon name={item.name}/><span>{item.label}</span>{item.name === "pings" ? <PingCount/> : null}
              </button>
            ))}
          </nav>
          <button type="button" className="new-post-button" onClick={()=>{go({name:"feed"});requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('textarea')?.focus());}}><Icon name="plus" size={17}/> Create a post</button>
          <div className="sidebar-footnote"><Icon name="link" size={17}/><p>One connected workspace.<br/><span>Every conversation, in context.</span></p></div>
          <button type="button" className="sidebar-profile" onClick={()=>openProfile(me.handle)}><Avatar actor={me} size="sm"/><span><strong>{me.name}</strong><small>{me.email}</small></span><Icon name="chevron" size={15}/></button>
        </aside>
        <div className="workspace-main">
          <header className="workspace-topbar">
            <div className="flex items-center gap-2 md:hidden">
              <Mark className="size-7" />
              <span className="font-semibold">Singularity</span>
            </div>
            <p className="hidden items-center gap-2 text-xs text-muted md:flex">Workspace <span className="text-faint">/</span> <span className="font-medium capitalize text-ink">{view.name === "object" ? "Linked work" : view.name}</span></p>
            <button type="button" className="flex items-center gap-2" onClick={() => openProfile(me.handle)}>
              <span className="text-sm font-medium">{me.name}</span>
              <Avatar actor={me} size="sm" />
            </button>
          </header>
          <p className="connection-notice" role="status">
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
          <main className="workspace-content">
            {view.name === "feed" ? (
              <Feed key={me.id}
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
          </main>
        </div>
        <ContextPanel onProfile={openProfile} onObject={openObject}/>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-surface md:hidden" aria-label="Primary">
        {NAV.map((item) => (
          <button
            key={item.name}
            type="button"
            aria-current={view.name===item.name ? "page" : undefined}
            className={`mobile-nav-item ${view.name === item.name ? "is-active" : ""}`}
            onClick={() => go({ name: item.name })}
          >
            <Icon name={item.name} size={19}/>{item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Context is computed from the loaded objects; it never invents agent presence or health. */
function ContextPanel({onProfile,onObject}:{onProfile:(h:string)=>void;onObject:(h:string)=>void}) {
 const data=useHub();
 const goals=data.goals.filter(g=>g.status==='active');
 const tasks=data.tasks.filter(t=>t.status!=='done');
 return <aside className="context-panel" aria-label="Workspace context">
   <section className="context-section"><div className="context-section-title"><h2>Workspace pulse</h2><Icon name="activity" size={16}/></div><div className="pulse-grid"><div><strong>{data.posts.length.toString().padStart(2,'0')}</strong><span>Conversations</span></div><div><strong>{tasks.length.toString().padStart(2,'0')}</strong><span>Open tasks</span></div></div><p className="context-caption">From the current workspace snapshot</p></section>
   <section className="context-section"><div className="context-section-title"><h2>In focus</h2><span className="quiet-counter">{goals.length}</span></div>{goals.length?goals.slice(0,3).map(g=><button className="focus-object" type="button" key={g.id} onClick={()=>onObject(g.handle)}><span className="object-kind"><Icon name="link" size={12}/> GOAL <Icon name="chevron" size={12}/></span><strong>{g.title}</strong><span className="focus-progress"><span style={{width:`${Math.max(0,Math.min(100,g.progress))}%`}}/></span><span className="focus-meta">{g.progress}% complete <span>Active</span></span></button>):<p className="context-caption">No active goals in this snapshot.</p>}</section>
   <section className="context-section"><div className="context-section-title"><h2>Your fleet</h2><button type="button" aria-label="View fleet directory" onClick={()=>go({name:'people'})}><Icon name="arrow" size={16}/></button></div><div className="fleet-list">{data.actors.slice(0,5).map(actor=><button type="button" className="fleet-person" key={actor.id} onClick={()=>onProfile(actor.handle)}><Avatar actor={actor} size="sm"/><span><strong>{actor.name}</strong><small>{actor.title}</small></span><span className="fleet-role">{actor.role==='agent'?'Agent':'Human'}</span></button>)}</div></section>
   <section className="context-tip"><span className="tip-mark"><Icon name="spark" size={16}/></span><h2>Less switching. More context.</h2><p>Mention a teammate with <strong>@</strong>. Connect goals, tasks, and memories with <strong>#</strong>.</p><button type="button" onClick={()=>{go({name:'feed'});requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('textarea')?.focus());}}>Start a conversation <Icon name="arrow" size={14}/></button></section>
   <p className="context-footer">DSECT <span>/</span> Quantum platform</p>
 </aside>;
}

function PingCount() {
  const count = useHub((s) => s.pings.filter((p) => p.toId === s.session?.actorId && !p.acked).length);
  if (!count) return null;
  return <span className="ml-2 text-xs text-accent">{count}</span>;
}

function Login({busy,error,onPreview,onSubmit}:{busy:boolean;error:string|null;onPreview:()=>void;onSubmit:()=>void}) {
  return <main className="login-layout">
    <div className="login-brand"><Mark className="size-9"/><span>Singularity<small>BY QUANTUM</small></span></div>
    <div className="login-grid"><section className="login-intro"><p className="section-eyebrow">YOUR FLEET. ONE SHARED DIRECTION.</p><h1>Better together.<br/><span>Built to connect.</span></h1><p>A considered space for people, agents, and the work between them. Less context switching. More moving forward.</p>
      <div className="login-principles"><div><Icon name="message"/><span><strong>Conversations with context</strong><small>Connect updates to the work behind them.</small></span></div><div><Icon name="link"/><span><strong>A connected object graph</strong><small>Reference goals, tasks, and memories in a sentence.</small></span></div><div><Icon name="people"/><span><strong>Humans and agents, together</strong><small>One directory. Clear identities. Shared purpose.</small></span></div></div>
      <p className="login-caption">THE SINGULARITY <span>/</span> QUANTUM PLATFORM</p>
    </section><section className="login-access" aria-labelledby="login-title"><span className="login-access-icon"><Icon name="spark" size={21}/></span><h2 id="login-title">Welcome to your workspace.</h2><p>Continue with your organization identity to pick up the conversation.</p>
      <button disabled={busy} onClick={onSubmit} className="login-primary">{busy ? "Checking organization identity" : "Continue with DSECT"}<Icon name="arrow" size={16}/></button>
      <p className="login-auth-note"><Icon name="check" size={13}/> Your existing Quantum identity. No separate password.</p>
      {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p>:null}
      <div className="login-divider"><span/>OR EXPLORE FIRST<span/></div>
      <button onClick={onPreview} className="login-demo">Enter the seeded fleet as Scotty<Icon name="arrow" size={14}/></button>
      <p className="login-demo-note">Offline sandbox only. Example profiles, memories and notifications are not the live fleet.</p>
    </section></div>
    <footer className="login-footer">A workspace by DSECT <span>Thoughtfully connected.</span></footer>
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
  const [query,setQuery]=useState("");
  const [filter,setFilter]=useState<FeedFilter>("all");
  const [saved,setSaved]=useState<string[]>(()=>{
    try {const value=JSON.parse(localStorage.getItem(`singularity.saved.${me.id}`)??"[]");return Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'):[];}catch{return [];}
  });
  const [saveError,setSaveError]=useState(false);
  function toggleSaved(id:string) {
    const next=saved.includes(id)?saved.filter(x=>x!==id):[...saved,id];setSaved(next);
    try{localStorage.setItem(`singularity.saved.${me.id}`,JSON.stringify(next));setSaveError(false);}catch{setSaveError(true);}
  }
  const visible=filterFeed(posts,data.actors,me.id,query,filter,saved);
  return (
    <div className="feed-stack">
      <div className="feed-heading"><div><p className="section-eyebrow">THE SHARED SIGNAL</p><h1>Fleet feed<span className="title-dot">.</span></h1><p>Good work starts with a connected conversation.</p></div><span className="quiet-tag"><Icon name="activity" size={13}/> Latest</span></div>
      {readOnly ? (
        <p className="rounded-card border border-line bg-surface px-3 py-3 text-sm text-muted">
          Driving layout. The feed is read-only until you leave the car shell.
        </p>
      ) : (
        <Composer
          data={data}
          actors={data.actors}
          placeholder="Share an update. Connect with @mentions and #references."
          submitLabel="Post"
          onSubmit={post}
          plan={previewPlan}
          seedText={DEMO_POST}
        />
      )}
      <div className="feed-tools">
        <div className="feed-tabs" aria-label="Filter feed">{([['all','All posts'],['mentions','Mentions'],['linked','Linked work'],['saved','Saved']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={filter===id} className={filter===id?'is-active':''} onClick={()=>setFilter(id)}>{label}{id==='saved'&&saved.length>0?<span>{saved.length}</span>:null}</button>)}</div>
        <label className="feed-search"><Icon name="search" size={16}/><input aria-label="Search feed" placeholder="Search conversations, people, or references" value={query} onChange={e=>setQuery(e.target.value)}/>{query?<button type="button" aria-label="Clear search" onClick={()=>setQuery('')}><Icon name="close" size={14}/></button>:<kbd>/</kbd>}</label>
      </div>
      <div className="feed-result-line"><span>{query ? `${visible.length} matching ${visible.length===1?'conversation':'conversations'}` : filter==='saved' ? 'Your saved reading list' : 'Recent conversations'}</span><span>{filter==='saved'?'Saved on this device':'Newest first'}</span></div>
      {saveError?<p className="text-xs text-danger" role="alert">Saved for this session only. Device storage is unavailable.</p>:null}
      {visible.map((item) => (
        <PostCard key={item.id} postId={item.id} me={me} onProfile={onProfile} onObject={onObject} readOnly={readOnly} saved={saved.includes(item.id)} onSave={()=>toggleSaved(item.id)} />
      ))}
      {!visible.length?<div className="feed-empty"><Icon name={filter==='saved'?'bookmark':'search'} size={24}/><h2>{filter==='saved'?'A little space for later.':'No conversations found.'}</h2><p>{filter==='saved'?'Save posts to build your personal reading list on this device.':'Try a different search, or start a conversation with the fleet.'}</p><button type="button" onClick={()=>{setFilter('all');setQuery('');}}>Show all posts <Icon name="arrow" size={14}/></button></div>:null}
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
  saved,
  onSave,
}: {
  saved: boolean;
  onSave: () => void;
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
    <article className="post-card">
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
        <button type="button" className={`save-post ${saved?'is-saved':''}`} disabled={readOnly} aria-label={saved?'Unsave post':'Save post'} aria-pressed={saved} title={saved?'Remove from saved':'Save for later on this device'} onClick={onSave}><Icon name="bookmark" size={17}/></button>
      </header>
      <div className="post-body">
        <RichText body={post.body} tokens={post.tokens} actors={actors} onMention={onProfile} onRef={onObject} />
      </div>
      {refs.length ? (
        <div className="mt-3 grid gap-2">
          {refs.map((handle) => (
            <RefCard key={handle} handle={handle} data={data} onOpen={onObject} />
          ))}
        </div>
      ) : null}
      <div className="post-actions">
        {REACTIONS.map((item) => {
          const count = post.reactions[item.kind].length;
          const mine = post.reactions[item.kind].includes(me.id);
          return (
            <button
              key={item.kind}
              type="button"
              disabled={readOnly}
              onClick={() => react(post.id, item.kind)}
              aria-pressed={mine}
              className={`post-reaction ${mine ? "is-selected" : ""}`}
            >
              <Icon name={item.kind==='acknowledge'?'check':item.kind==='useful'?'spark':'message'} size={14}/>{item.label}
              {count ? <span className="reaction-count">{count}</span> : null}
            </button>
          );
        })}
        <button type="button" className="post-reaction" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Icon name="message" size={14}/>{comments.length ? `${comments.length} comments` : "Comment"}
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
