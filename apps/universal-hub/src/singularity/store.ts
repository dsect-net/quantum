import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Actor, HubData, ReactionKind, ShellMode } from "./types.ts";
import { seedData } from "./seed.ts";
import { ackPing, publishComment, publishPost, toggleReaction } from "./domain.ts";
import { request, hubSession, hubSnapshot } from "./hub-client";
import { planRoute } from "./routing.ts";

function note(level: "info" | "warn" | "error", message: string, prev: HubData["logs"]) {
  return [{ id: `log-${Date.now()}-${Math.random().toString(16).slice(2)}`, at: new Date().toISOString(), level, message }, ...prev].slice(0, 200);
}

type HubState = HubData & {
  hydrated: boolean;
  error: string | null;
  signInPreview: (actorId: string) => void;
  signInHub: () => Promise<void>;
  refresh: () => Promise<void>;
  serviceDemo: boolean;
  deliveries: Array<{id:string;kind:string;status:string}>;
  signOut: () => void;
  setHubUrl: (url: string) => void;
  setDeveloperMode: (on: boolean) => void;
  setShell: (shell: ShellMode) => void;
  post: (body: string) => Promise<boolean>;
  comment: (postId: string, body: string) => Promise<boolean>;
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
      serviceDemo: false,
      deliveries: [],
      error: null,
      signInPreview: (actorId) => {
        // Never carry an authenticated fleet's data into the offline sandbox.
        const preview = seedData();
        const actor = preview.actors.find((a) => a.id === actorId);
        if (!actor) {
          set({ error: "That person is not in the directory." });
          return;
        }
        set({
          ...preview,
          serviceDemo: false,
          deliveries: [],
          session: { actorId: actor.id, mode: "preview", email: actor.email },
          error: null,
          logs: note("info", `Preview session for ${actor.email}. Password was not stored.`, get().logs),
        });
      },
      signInHub: async () => {
        try {
          const {actor,demo}=await hubSession();
          const data=await hubSnapshot();
          set({...data, serviceDemo:demo, session:{actorId:actor.id,mode:"hub",email:actor.email},error:null});
        } catch(e) { set({error:e instanceof Error?e.message:"Organization sign-in unavailable"}); }
      },
      refresh: async () => {
        if (get().session?.mode!=="hub") return;
        try {const data=await hubSnapshot(); const {session,developerMode,shell}=get(); set({...data,session,developerMode,shell,error:null});}
        catch(e) {set({error:e instanceof Error?e.message:"Refresh failed"});}
      },
      signOut: () => set({ session: null, error: null }),
      setHubUrl: (hubUrl) => set({ hubUrl }),
      setDeveloperMode: (developerMode) =>
        set({
          developerMode,
          logs: note("info", developerMode ? "Developer mode on." : "Developer mode off.", get().logs),
        }),
      setShell: (shell) => set({ shell }),
      post: async (body) => {
        const session = get().session;
        if (!session) {
          set({ error: "Sign in before posting." });
          return false;
        }
        if (session.mode === "hub") {
          try { await request('/posts',{body}); await get().refresh(); return true; }
          catch(e) {set({error:e instanceof Error?e.message:"Post failed"});return false;}
        }
        const result = publishPost(get(), session.actorId, body);
        if (result.error) {
          set({ error: result.error, logs: note("error", result.error, get().logs) });
          return false;
        }
        set({ ...result.data, hydrated: true, error: null });
        return true;
      },
      comment: async (postId, body) => {
        const session = get().session;
        if (!session) return false;
        if (session.mode === "hub") {
          try { await request('/comments',{postId,body}); await get().refresh(); return true; }
          catch(e) {set({error:e instanceof Error?e.message:"Comment failed"});return false;}
        }
        const result = publishComment(get(), session.actorId, postId, body);
        if (result.error) {
          set({ error: result.error });
          return false;
        }
        set({ ...result.data, hydrated: true, error: null });
        return true;
      },
      react: async (postId, kind) => {
        const session = get().session;
        if (!session) return;
        if (session.mode === "hub") {
          try {await request('/reactions',{postId,kind});await get().refresh();}catch {set({error:"Reaction was not saved"});} return;
        }
        set({ ...toggleReaction(get(), postId, session.actorId, kind), hydrated: true });
      },
      ack: async (pingId) => {
        const session = get().session;
        if (!session) return;
        if (session.mode === "hub") {
          try {await request('/ack',{id:pingId});await get().refresh();}catch {set({error:"Acknowledgement was not saved"});} return;
        }
        set(ackPing(get(), pingId, session.actorId));
      },
      saveProfile: async (patch) => {
        const session = get().session;
        if (!session) return;
        if (patch.photo && patch.photo.length > 450_000) {
          set({ error: "That photo is too large. Use an image under about 300 KB." });
          return;
        }
        if (session.mode === "hub") {
          try {await request('/profile',patch,'PATCH');await get().refresh();}catch {set({error:"Profile was not saved. Check photo format and connection."});} return;
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
      name: "singularity-hub-v2",
      skipHydration: true,
      partialize: (state) => ({
        // Never persist server data or an authenticated server session.
        ...(state.session?.mode === "preview" ? {
          actors:state.actors,posts:state.posts,comments:state.comments,pings:state.pings,
          tasks:state.tasks,session:state.session,
        } : {}),
        developerMode:state.developerMode,shell:state.shell,
      }),
    },
  ),
);

export function actorById(actors: Actor[], id: string | null | undefined): Actor | undefined {
  if (!id) return undefined;
  return actors.find((a) => a.id === id);
}
