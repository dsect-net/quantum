import { useId, useMemo, useRef, useState } from "react";
import type { Actor, HubData } from "@/singularity/types";
import { parseTokens } from "@/singularity/parse";
import { MentionChip } from "./cards";

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
  return (
    <form
      className="rounded-card border border-line bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="sr-only" htmlFor={`composer-${id}`}>
        {placeholder}
      </label>
      <textarea
        id={`composer-${id}`}
        ref={ref}
        value={text}
        rows={3}
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
      <div className="flex items-center justify-between gap-3">
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
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="h-11 rounded-xl bg-button px-4 text-sm font-medium text-button-ink disabled:opacity-40"
        >
          {busy ? "Sending…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
