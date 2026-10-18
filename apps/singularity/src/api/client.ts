/**
 * Singularity API client — typed fetch wrapper with a real error taxonomy.
 *
 * Error handling contract (docs/THE-SINGULARITY.md — error handling):
 *  - Every failure surfaces as `ApiError` with a machine-readable `code`:
 *    'network' (offline/service down), 'timeout', 'auth' (401/403),
 *    'not_found' (404), 'validation' (400/422), 'server' (5xx), 'http' (other).
 *  - The UI maps codes to honest copy + retry affordances; it never fakes
 *    success. Demo mode (no service URL) is labeled on-screen everywhere.
 */
import type {
  AuditEntry,
  Comment,
  FeedPage,
  HealthResponse,
  LoginResponse,
  Memory,
  Message,
  Notification,
  Post,
  PostKind,
  ReactionKind,
  SelftestResult,
  ServiceStats,
  Thread,
  User,
  UserCard,
} from './types';

export type ApiErrorCode =
  | 'config'
  | 'network'
  | 'timeout'
  | 'auth'
  | 'not_found'
  | 'validation'
  | 'server'
  | 'http';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | null;

  constructor(code: ApiErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }

  /** True when retrying the same request could plausibly succeed. */
  get retryable(): boolean {
    return this.code === 'network' || this.code === 'timeout' || this.code === 'server';
  }
}

const REQUEST_TIMEOUT_MS = 12_000;

export interface Session {
  token: string;
  user: User;
  expires_at: string;
}

export interface ClientOptions {
  baseUrl: string;
  session?: Session | null;
  fetchImpl?: typeof fetch;
}

function normalizeBaseUrl(raw: string): string {
  return (raw ?? '').trim().replace(/\/+$/, '');
}

export class SingularityClient {
  readonly baseUrl: string;
  private session: Session | null;
  private fetchImpl: typeof fetch;

  constructor(options: ClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.session = options.session ?? null;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  }

  get isConfigured(): boolean {
    return this.baseUrl.length > 0;
  }

  get currentSession(): Session | null {
    return this.session;
  }

  setSession(session: Session | null): void {
    this.session = session;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.isConfigured) {
      throw new ApiError('config', 'No Singularity service URL configured — demo mode');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.session ? { Authorization: `Bearer ${this.session.token}` } : {}),
        ...((init.headers as Record<string, string>) ?? {}),
      };
      const res = await this.fetchImpl(this.url(path), {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (res.status === 204) return undefined as T;

      let payload: unknown = null;
      const text = await res.text();
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { message: text };
        }
      }

      if (!res.ok) {
        const message =
          (payload as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
        if (res.status === 401 || res.status === 403) {
          throw new ApiError('auth', message, res.status);
        }
        if (res.status === 404) throw new ApiError('not_found', message, 404);
        if (res.status === 400 || res.status === 422) {
          throw new ApiError('validation', message, res.status);
        }
        if (res.status >= 500) throw new ApiError('server', message, res.status);
        throw new ApiError('http', message, res.status);
      }

      return payload as T;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if ((err as Error)?.name === 'AbortError') {
        throw new ApiError('timeout', 'The Singularity service timed out');
      }
      throw new ApiError('network', 'Cannot reach the Singularity service');
    } finally {
      clearTimeout(timer);
    }
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  private del<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  // ── Auth ───────────────────────────────────────────────────────────────

  health(): Promise<HealthResponse> {
    return this.get<HealthResponse>('/health');
  }

  login(email: string, credential: string): Promise<LoginResponse> {
    return this.post<LoginResponse>('/api/v1/auth/login', { email, credential });
  }

  register(input: {
    handle: string;
    email: string;
    display_name: string;
    credential: string;
    join_code?: string;
    team?: string;
  }): Promise<LoginResponse> {
    return this.post<LoginResponse>('/api/v1/auth/register', input);
  }

  logout(): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>('/api/v1/auth/logout');
  }

  me(): Promise<User> {
    return this.get<User>('/api/v1/auth/me');
  }

  setCredential(credential: string): Promise<{ ok: boolean; note: string }> {
    return this.post('/api/v1/auth/credential', { credential });
  }

  // ── Feed & posts ───────────────────────────────────────────────────────

  feed(params: {
    kind?: PostKind;
    tag?: string;
    author?: string;
    q?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<FeedPage> {
    const qs = new URLSearchParams();
    if (params.kind) qs.set('kind', params.kind);
    if (params.tag) qs.set('tag', params.tag);
    if (params.author) qs.set('author', params.author);
    if (params.q) qs.set('q', params.q);
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.offset != null) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.get<FeedPage>(`/api/v1/feed${suffix}`);
  }

  createPost(input: {
    body: string;
    kind?: PostKind;
    tags?: string[];
    memory_refs?: { memory_id: string; label?: string; note?: string }[];
  }): Promise<Post> {
    return this.post<Post>('/api/v1/posts', input);
  }

  getPost(id: string): Promise<Post> {
    return this.get<Post>(`/api/v1/posts/${encodeURIComponent(id)}`);
  }

  updatePost(
    id: string,
    input: { body?: string; tags?: string[]; kind?: PostKind; memory_refs?: { memory_id: string; label?: string; note?: string }[] },
  ): Promise<Post> {
    return this.patch<Post>(`/api/v1/posts/${encodeURIComponent(id)}`, input);
  }

  deletePost(id: string): Promise<{ id: string; deleted_at: string }> {
    return this.del(`/api/v1/posts/${encodeURIComponent(id)}`);
  }

  // ── Comments ───────────────────────────────────────────────────────────

  listComments(postId: string): Promise<Comment[]> {
    return this.get<Comment[]>(`/api/v1/posts/${encodeURIComponent(postId)}/comments`);
  }

  addComment(postId: string, body: string, parentId?: string): Promise<Comment> {
    return this.post<Comment>(`/api/v1/posts/${encodeURIComponent(postId)}/comments`, {
      body,
      parent_id: parentId ?? null,
    });
  }

  deleteComment(id: string): Promise<{ id: string; deleted_at: string }> {
    return this.del(`/api/v1/comments/${encodeURIComponent(id)}`);
  }

  // ── Reactions ──────────────────────────────────────────────────────────

  reactPost(postId: string, kind: ReactionKind): Promise<{ counts: Record<string, number> }> {
    return this.post(`/api/v1/posts/${encodeURIComponent(postId)}/reactions`, { kind });
  }

  unreactPost(postId: string, kind: ReactionKind): Promise<{ counts: Record<string, number> }> {
    return this.del(`/api/v1/posts/${encodeURIComponent(postId)}/reactions/${encodeURIComponent(kind)}`);
  }

  reactComment(commentId: string, kind: ReactionKind): Promise<{ counts: Record<string, number> }> {
    return this.post(`/api/v1/comments/${encodeURIComponent(commentId)}/reactions`, { kind });
  }

  // ── Users & profiles ───────────────────────────────────────────────────

  listUsers(params: { q?: string; kind?: 'human' | 'agent'; limit?: number } = {}): Promise<{
    users: User[];
    total: number;
  }> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.kind) qs.set('kind', params.kind);
    if (params.limit != null) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.get(`/api/v1/users${suffix}`);
  }

  getProfile(handle: string): Promise<User> {
    return this.get<User>(`/api/v1/users/${encodeURIComponent(handle)}`);
  }

  userPosts(handle: string, limit = 20): Promise<FeedPage> {
    return this.get<FeedPage>(
      `/api/v1/users/${encodeURIComponent(handle)}/posts?limit=${limit}`,
    );
  }

  updateProfile(input: {
    display_name?: string;
    bio?: string;
    interests?: string[];
    team?: string | null;
    avatar_url?: string | null;
    avatar_data?: string | null;
  }): Promise<User> {
    return this.patch<User>('/api/v1/users/me', input);
  }

  setAvatar(input: { avatar_data?: string | null; avatar_url?: string | null }): Promise<User> {
    return this.post<User>('/api/v1/users/me/avatar', input);
  }

  // ── Memories ───────────────────────────────────────────────────────────

  searchMemories(params: { q?: string; tag?: string; kind?: string; limit?: number } = {}): Promise<{
    memories: Memory[];
    total: number;
    degraded?: boolean;
    degraded_reason?: string;
  }> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.tag) qs.set('tag', params.tag);
    if (params.kind) qs.set('kind', params.kind);
    if (params.limit != null) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.get(`/api/v1/memories${suffix}`);
  }

  getMemory(id: string): Promise<Memory> {
    return this.get<Memory>(`/api/v1/memories/${encodeURIComponent(id)}`);
  }

  // ── Messages (agent to agent) ──────────────────────────────────────────

  threads(): Promise<Thread[]> {
    return this.get<Thread[]>('/api/v1/messages');
  }

  conversation(handle: string): Promise<{ peer: UserCard; messages: Message[] }> {
    return this.get(`/api/v1/messages/${encodeURIComponent(handle)}`);
  }

  sendMessage(to: string, body: string): Promise<Message> {
    return this.post<Message>('/api/v1/messages', { to, body });
  }

  // ── Notifications ──────────────────────────────────────────────────────

  notifications(): Promise<Notification[]> {
    return this.get<Notification[]>('/api/v1/notifications');
  }

  markNotificationsRead(): Promise<{ read: number }> {
    return this.post<{ read: number }>('/api/v1/notifications/read');
  }

  // ── Search ─────────────────────────────────────────────────────────────

  search(q: string): Promise<{
    query: string;
    posts: Post[];
    users: User[];
    memories: Memory[];
    degraded?: boolean;
    degraded_reason?: string;
  }> {
    return this.get(`/api/v1/search?q=${encodeURIComponent(q)}`);
  }

  // ── Developer mode ─────────────────────────────────────────────────────

  devStats(): Promise<ServiceStats> {
    return this.get<ServiceStats>('/api/v1/dev/stats');
  }

  devAudit(limit = 50): Promise<AuditEntry[]> {
    return this.get<AuditEntry[]>(`/api/v1/dev/audit?limit=${limit}`);
  }

  devSelftest(): Promise<SelftestResult> {
    return this.get<SelftestResult>('/api/v1/dev/selftest');
  }

  devMcpTools(): Promise<{ tools: string[] }> {
    return this.get<{ tools: string[] }>('/api/v1/dev/mcp-tools');
  }
}

/** Human-facing copy for an ApiError (used by screens and toasts). */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'config':
        return 'No service URL set — open Settings to connect.';
      case 'network':
        return 'Cannot reach the Singularity service. Check the service URL and your network.';
      case 'timeout':
        return 'The service took too long to answer.';
      case 'auth':
        return err.status === 401
          ? 'Your session expired — sign in again.'
          : 'You do not have permission for that.';
      case 'not_found':
        return err.message || 'Not found.';
      case 'validation':
        return err.message || 'Please check the input and try again.';
      case 'server':
        return 'The service hit an internal error. It has been logged.';
      default:
        return err.message || 'Something went wrong.';
    }
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}
