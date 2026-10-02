/**
 * Local conversation store — Sol chat history lives on-device.
 *
 * Plain localStorage (memory fallback in tests/SSR), no secrets, no
 * transcripts leaving the device. Each thread records which model it
 * used so a switched model never silently rewrites an old conversation.
 */
import type { ChatMessage } from '../../api/sol';

export interface StoredMessage extends ChatMessage {
  ts: number;
  /** Set when the assistant reply failed — shown as an honest error bubble. */
  error?: string;
}

export interface ChatThread {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}

const THREADS_KEY = 'quantum.sol.threads.v1';
const ACTIVE_KEY = 'quantum.sol.activeThread';
const MODEL_KEY = 'quantum.sol.model';

const memoryFallback = new Map<string, string>();

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memoryFallback.set(key, value);
  }
}

function storageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    memoryFallback.delete(key);
  }
}

function readThreads(): ChatThread[] {
  try {
    const raw = JSON.parse(storageGet(THREADS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (t): t is ChatThread =>
        t !== null &&
        typeof t === 'object' &&
        typeof (t as ChatThread).id === 'string' &&
        Array.isArray((t as ChatThread).messages),
    );
  } catch {
    return [];
  }
}

function writeThreads(threads: ChatThread[]): void {
  // Cap the local history so a phone never grows an unbounded log.
  const capped = threads.slice(0, 50).map((t) => ({ ...t, messages: t.messages.slice(-200) }));
  storageSet(THREADS_KEY, JSON.stringify(capped));
}

export function listThreads(): ChatThread[] {
  return readThreads().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getThread(id: string): ChatThread | null {
  return readThreads().find((t) => t.id === id) ?? null;
}

export function saveThread(thread: ChatThread): void {
  const threads = readThreads();
  const i = threads.findIndex((t) => t.id === thread.id);
  if (i >= 0) threads[i] = thread;
  else threads.unshift(thread);
  writeThreads(threads);
}

export function createThread(model: string): ChatThread {
  const now = Date.now();
  return {
    id: `thread-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'New conversation',
    model,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function deleteThread(id: string): void {
  writeThreads(readThreads().filter((t) => t.id !== id));
  if (getActiveThreadId() === id) setActiveThreadId(null);
}

export function getActiveThreadId(): string | null {
  return storageGet(ACTIVE_KEY);
}

export function setActiveThreadId(id: string | null): void {
  if (id) storageSet(ACTIVE_KEY, id);
  else storageRemove(ACTIVE_KEY);
}

export function getSelectedModel(): string {
  return storageGet(MODEL_KEY) ?? '';
}

export function setSelectedModel(model: string): void {
  if (model) storageSet(MODEL_KEY, model);
}

/** Derive a thread title from the first user message — never a fake reply. */
export function titleFromMessage(content: string): string {
  const clean = content.trim().replace(/\s+/g, ' ');
  if (!clean) return 'New conversation';
  return clean.length > 42 ? clean.slice(0, 42) + '…' : clean;
}
