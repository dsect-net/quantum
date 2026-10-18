import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Actor, HubData, ReactionKind, ShellMode } from "./types.ts";
import { seedData } from "./seed.ts";
import { ackPing, publishComment, publishPost, toggleReaction } from "./domain.ts";
import { planRoute } from "./routing.ts";

function note(level: "info" | "warn" | "error", message: string, prev: HubData["logs"]) {
  return [{ id: `log-${Date.now()}-${Math.random().toString(16).slice(2)}`, at: new Date().toISOString(), level, message }, ...prev].slice(0, 200);
}

type HubState = HubData & {
  hydrated: boolean;
  error: string | null;
  signInPreview: (actorId: string) => void;
  signInHub: (email: string) => void;
  signOut: () => void;
  setHubUrl: (url: string) => void;
  setDeveloperMode: (on: boolean) => void;
  setShell: (shell: ShellMode) => void;
  post: (body: string) => boolean;
  comment: (postId: string, body: string) => boolean;
  react: (postId: string, kind: ReactionKind) => void;
  ack: (pingId: string) => void;
  saveProfile: (patch: Pick<Actor, "bio" | "interests" | "photo" | "title">) => void;
  clearError: () => void;
  previewPlan: (body: string) => string[];
};

const seed = seedData();

export const useHub = create<HubState>()(
  persist(
    (set, get) => ({
      ...seed,
      hydrated: false,
      error: null,
      signInPreview: (actorId) => {
        const actor = get().actors.find((a) => a.id === actorId);
        if (!actor) {
          set({ error: "That person is not in the directory." });
          return;
        }
        set({
          session: { actorId: actor.id, mode: "preview", email: actor.email },
          error: null,
          logs: note("info", `Preview session for ${actor.email}. Password was not stored.`, get().logs),
        });
      },
      signInHub: (email) => {
        const actor = get().actors.find((a) => a.email.toLowerCase() === email.toLowerCase());
        const actorId = actor?.id ?? "actor-scotty";
        set({
          session: { actorId, mode: "hub", email },
          error: null,
          logs: note("info", `Hub session for ${email}.`, get().logs),
        });
      },
      signOut: () => set({ session: null, error: null }),
      setHubUrl: (hubUrl) => set({ hubUrl }),
      setDeveloperMode: (developerMode) =>
        set({
          developerMode,
          logs: note("info", developerMode ? "Developer mode on." : "Developer mode off.", get().logs),
        }),
      setShell: (shell) => set({ shell }),
      post: (body) => {
        const session = get().session;
        if (!session) {
          set({ error: "Sign in before posting." });
          return false;
        }
        const result = publishPost(get(), session.actorId, body);
        if (result.error) {
          set({ error: result.error, logs: note("error", result.error, get().logs) });
          return false;
        }
        set({ ...result.data, hydrated: true, error: null });
        return true;
      },
      comment: (postId, body) => {
        const session = get().session;
        if (!session) return false;
        const result = publishComment(get(), session.actorId, postId, body);
        if (result.error) {
          set({ error: result.error });
          return false;
        }
        set({ ...result.data, hydrated: true, error: null });
        return true;
      },
      react: (postId, kind) => {
        const session = get().session;
        if (!session) return;
        set({ ...toggleReaction(get(), postId, session.actorId, kind), hydrated: true });
      },
      ack: (pingId) => {
        const session = get().session;
        if (!session) return;
        set(ackPing(get(), pingId, session.actorId));
      },
      saveProfile: (patch) => {
        const session = get().session;
        if (!session) return;
        if (patch.photo && patch.photo.length > 450_000) {
          set({ error: "That photo is too large. Use an image under about 300 KB." });
          return;
        }
        set({
          error: null,
          actors: get().actors.map((a) => (a.id === session.actorId ? { ...a, ...patch } : a)),
          logs: note("info", "Profile saved on this device.", get().logs),
        });
      },
      clearError: () => set({ error: null }),
      previewPlan: (body) => {
        const session = get().session;
        if (!session || !body.trim()) return [];
        return planRoute(get(), body, session.actorId).notes;
      },
    }),
    {
      name: "singularity-hub-v1",
      skipHydration: true,
      partialize: (state) => {
        const {
          signInPreview: _a,
          signInHub: _b,
          signOut: _c,
          setHubUrl: _d,
          setDeveloperMode: _e,
          setShell: _f,
          post: _g,
          comment: _h,
          react: _i,
          ack: _j,
          saveProfile: _k,
          clearError: _l,
          previewPlan: _m,
          hydrated: _n,
          error: _o,
          ...data
        } = state;
        return data;
      },
    },
  ),
);

export function actorById(actors: Actor[], id: string | null | undefined): Actor | undefined {
  if (!id) return undefined;
  return actors.find((a) => a.id === id);
}
