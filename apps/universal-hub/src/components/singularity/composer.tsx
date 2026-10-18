import { useId, useMemo, useRef, useState } from "react";
import type { Actor, HubData } from "@/singularity/types";
import { parseTokens } from "@/singularity/parse";
import { MentionChip } from "./cards";
import { Avatar } from "./ui";
import { Icon } from "./icon";

type Suggestion = { label: string; insert: string; hint: string };

function suggestions(data: HubData, kind: "@" | "#", query: string): Suggestion[] {
  const q = query.toLowerCase();
  if (kind === "@") {
    return data.actors
      .filter((a) => a.name.toLowerCase().includes(q) || a.handle.toLowerCase().includes(q))
      .slice(0, 6)
      .map((a) => ({ label: a.name, insert: `@${a.handle}`, hint: a.role === "agent" ? "Agent" : "Human" }));
  }
  const refs = [
    ...data.goals.map((g) => ({ insert: `#${g.handle}`, label: g.title, hint: "Goal" })),
    ...data.tasks.map((t) => ({ insert: `#${t.handle}`, label: t.title, hint: "Task" })),
    ...data.issues.map((i) => ({ insert: `#${i.handle}`, label: i.title, hint: "Issue" })),
    ...data.bounties.map((b) => ({ insert: `#${b.handle}`, label: b.title, hint: "Bounty" })),
    ...data.memories.map((m) => ({ insert: `#${m.handle}`, label: m.title, hint: "Memory" })),
    ...data.services.map((s) => ({ insert: `#${s.handle}`, label: s.title, hint: "Service" })),
  ];
  return refs.filter((r) => r.insert.toLowerCase().includes(q) || r.label.toLowerCase().includes(q)).slice(0, 6);
}

export function Composer({
  data,
  actors,
  placeholder,
  submitLabel,
  onSubmit,
  plan,
  seedText,
}: {
  data: HubData;
  actors: Actor[];
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<boolean>;
  plan: (body: string) => string[];
  seedText?: string;
}) {
  const id = useId();
  const [busy,setBusy] = useState(false);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const active = useMemo(() => {
    const upto = text.slice(0, caret);
    const match = upto.match(/(^|\s)([@#])([\w-]*)$/);
    if (!match) return null;
    return { kind: match[2] as "@" | "#", query: match[3] ?? "", start: caret - (match[3]?.length ?? 0) - 1 };
  }, [text, caret]);

  const items = active ? suggestions(data, active.kind, active.query) : [];
  const tokens = parseTokens(text);
  const notes = text.trim() ? plan(text) : [];

  function sync(next: string, el: HTMLTextAreaElement | null) {
    setText(next);
    setCaret(el?.selectionStart ?? next.length);
    setOpen(true);
  }

  function choose(insert: string) {
    if (!active) return;
    const next = text.slice(0, active.start) + insert + " " + text.slice(caret);
    setText(next);
    setOpen(false);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const pos = active.start + insert.length + 1;
      el.focus();
      el.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  }

  async function submit() {
    if (busy || !text.trim()) return;
    setBusy(true);
    try {if (await onSubmit(text)) {setText("");setOpen(false);}}
    finally {setBusy(false);}
  }
  function addToken(token:string) {
    const before=text.slice(0,caret);const after=text.slice(caret);
    const insert=(before&&!/\s$/.test(before)?' ':'')+token;
    const next=before+insert+after;const pos=before.length+insert.length;
    setText(next);setCaret(pos);setOpen(true);
    requestAnimationFrame(()=>{ref.current?.focus();ref.current?.setSelectionRange(pos,pos);});
  }
  const author=actors.find(a=>a.id===data.session?.actorId);
  return (
    <form
      className={`composer-card ${submitLabel==='Post'?'is-post-composer':''}` }
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {submitLabel==='Post'&&author?<div className="composer-identity"><Avatar actor={author} size="sm"/><span>Share an update<span> with your fleet</span></span><span className="composer-scope"><Icon name="people" size={12}/> Workspace</span></div>:null}
      <label className="sr-only" htmlFor={`composer-${id}`}>
        {placeholder}
      </label>
      <textarea
        id={`composer-${id}`}
        ref={ref}
        value={text}
        rows={2}
        maxLength={2000}
        disabled={busy}
        placeholder={placeholder}
        className="w-full resize-none bg-transparent text-[15px] leading-6 text-ink outline-none placeholder:text-faint"
        onChange={(e) => sync(e.target.value, e.target)}
        onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
        onClick={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      {open && active && items.length ? (
        <ul className="mb-2 overflow-hidden rounded-xl border border-line" aria-label="Mention and reference suggestions">
          {items.map((item) => (
            <li key={item.insert}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-canvas"
                onClick={() => choose(item.insert)}
              >
                <span className="font-medium text-ink">{item.label}</span>
                <span className="text-xs text-muted">
                  {item.hint} · {item.insert}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {tokens.some((t) => t.type !== "text") ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {tokens.map((token, i) => {
            if (token.type === "mention") {
              const actor = actors.find((a) => a.handle.toLowerCase() === token.handle.toLowerCase());
              return <MentionChip key={i} name={actor?.name ?? token.handle} agent={actor?.role === "agent"} />;
            }
            if (token.type === "ref") {
              return (
                <span key={i} className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                  #{token.handle}
                </span>
              );
            }
            return null;
          })}
        </div>
      ) : null}
      {notes.length ? <p className="mb-2 text-xs leading-5 text-muted">{notes.join(" ")}</p> : null}
      <div className="composer-toolbar"><div className="composer-inserts"><button type="button" disabled={busy} onClick={()=>addToken('@')} title="Mention a person or agent" aria-label="Insert mention">@</button><button type="button" disabled={busy} onClick={()=>addToken('#')} title="Link a goal, task or memory" aria-label="Insert reference"><Icon name="link" size={16}/></button><span className="toolbar-divider"/>

        {seedText ? (
          <button
            type="button"
            className="text-left text-xs text-muted underline-offset-2 hover:underline"
            onClick={() => {
              setText(seedText);
              setCaret(seedText.length);
            }}
          >
            Use the example
          </button>
        ) : (
          <span />
        )}
        </div><div className="composer-submit"><span className={text.length>1900?'text-danger':'text-faint'} aria-label={`${text.length} of 2000 characters`}>{text.length ? `${text.length}/2000` : 'Ctrl + Enter'}</span>
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="h-11 rounded-xl bg-button px-4 text-sm font-medium text-button-ink disabled:opacity-40"
        >
          {busy ? "Sending…" : submitLabel}<Icon name="arrow" size={14}/>
        </button></div>
      </div>
    </form>
  );
}
