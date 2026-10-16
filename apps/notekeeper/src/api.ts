export interface List {
  id: string;
  name: string;
  category: string;
  parent_list_id: string | null;
  sort_order: number;
  private: number;
  sync_excluded: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  open_count?: number;
  counts?: {
    open: number;
    done: number;
    archived: number;
    total: number;
  };
}

export interface Item {
  id: string;
  list_id: string;
  parent_item_id: string | null;
  type: 'note' | 'task' | 'todo';
  title: string;
  body: string;
  author: string;
  status: 'open' | 'done' | 'archived';
  priority: number | null;
  due_at: string | null;
  linked_source: string | null;
  embedding_status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  deleted_at: string | null;
  tags: string[];
  revisions?: Revision[];
}

export interface Revision {
  id: string;
  item_id: string;
  snapshot: string;
  author: string;
  kind: 'create' | 'edit' | 'complete' | 'reopen' | 'delete' | 'restore' | 'move';
  created_at: string;
}

export interface ResolvedLinkEnd {
  id: string;
  title: string;
  type: 'note' | 'task' | 'todo';
  deleted: boolean;
}

export interface OutgoingLinkItem {
  id: string;
  from_item_id: string;
  to_item_id: string | null;
  external_url: string | null;
  relation: 'spawned' | 'blocks' | 'related' | 'reference';
  created_at: string;
  target?: ResolvedLinkEnd | null;
  item?: ResolvedLinkEnd | null;
  deleted?: boolean;
}

export interface IncomingLinkItem {
  id: string;
  from_item_id: string;
  to_item_id: string;
  external_url: string | null;
  relation: 'spawned' | 'blocks' | 'related' | 'reference';
  created_at: string;
  source: ResolvedLinkEnd;
  item: ResolvedLinkEnd;
  deleted: boolean;
}

export interface ItemLinksResult {
  outgoing: OutgoingLinkItem[];
  incoming: IncomingLinkItem[];
}

export interface SearchMatchItem {
  item: Item;
  match: 'keyword' | 'semantic' | 'both';
  score?: number;
}

export interface SearchResult {
  results: SearchMatchItem[];
  total: number;
  limit: number;
  offset: number;
  degraded: boolean;
  message?: string;
}

const BASE_URL = import.meta.env.VITE_NOTEKEEPER_API || '/api/v1';
const TOKEN = import.meta.env.VITE_NOTEKEEPER_TOKEN || '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (TOKEN) {
    headers.set('Authorization', `Bearer ${TOKEN}`);
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errMsg = `Request failed: HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) errMsg = data.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  return res.json() as Promise<T>;
}

export const api = {
  async getLists(): Promise<List[]> {
    return request<List[]>('/lists');
  },

  async getList(id: string): Promise<{ list: List; counts: any }> {
    return request<{ list: List; counts: any }>(`/lists/${encodeURIComponent(id)}`);
  },

  async getListItems(
    listId: string,
    params?: { status?: string; type?: string; limit?: number; offset?: number }
  ): Promise<{ items: Item[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.type) query.set('type', params.type);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString() ? `?${query.toString()}` : '';
    return request<{ items: Item[]; total: number }>(`/lists/${encodeURIComponent(listId)}/items${qs}`);
  },

  async createItem(input: {
    title: string;
    body?: string;
    list?: string;
    type?: string;
    tags?: string[];
    priority?: number | null;
    due_at?: string | null;
    author?: string;
  }): Promise<Item> {
    return request<Item>('/items', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async getItem(id: string, includeRevisions = true): Promise<Item> {
    return request<Item>(`/items/${encodeURIComponent(id)}${includeRevisions ? '?include_revisions=true' : ''}`);
  },

  async updateItem(
    id: string,
    data: {
      title?: string;
      body?: string;
      list?: string;
      type?: string;
      tags?: string[];
      priority?: number | null;
      due_at?: string | null;
      status?: string;
      autosave?: boolean;
      author?: string;
    }
  ): Promise<Item> {
    return request<Item>(`/items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteItem(id: string): Promise<{ id: string; deleted_at: string }> {
    return request<{ id: string; deleted_at: string }>(`/items/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async restoreItem(id: string): Promise<Item> {
    return request<Item>(`/items/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
    });
  },

  async completeItem(id: string): Promise<Item> {
    return request<Item>(`/items/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
    });
  },

  async reopenItem(id: string): Promise<Item> {
    return request<Item>(`/items/${encodeURIComponent(id)}/reopen`, {
      method: 'POST',
    });
  },

  async moveItem(id: string, toList: string): Promise<Item> {
    return request<Item>(`/items/${encodeURIComponent(id)}/move`, {
      method: 'POST',
      body: JSON.stringify({ to_list: toList }),
    });
  },

  async search(params: {
    q: string;
    list?: string;
    category?: string;
    tag?: string;
    type?: string;
    status?: string;
    due_before?: string;
    due_after?: string;
    limit?: number;
    offset?: number;
  }): Promise<SearchResult> {
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    if (params.list) query.set('list', params.list);
    if (params.category) query.set('category', params.category);
    if (params.tag) query.set('tag', params.tag);
    if (params.type) query.set('type', params.type);
    if (params.status) query.set('status', params.status);
    if (params.due_before) query.set('due_before', params.due_before);
    if (params.due_after) query.set('due_after', params.due_after);
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    const qs = query.toString() ? `?${query.toString()}` : '';
    return request<SearchResult>(`/search${qs}`);
  },

  async getItemLinks(id: string): Promise<ItemLinksResult> {
    return request<ItemLinksResult>(`/items/${encodeURIComponent(id)}/links`);
  },

  async addItemLink(
    id: string,
    link: {
      to_item_id?: string;
      external_url?: string;
      relation: 'spawned' | 'blocks' | 'related' | 'reference';
      author?: string;
    }
  ): Promise<any> {
    return request(`/items/${encodeURIComponent(id)}/links`, {
      method: 'POST',
      body: JSON.stringify(link),
    });
  },

  async getDeletedItems(limit = 50, offset = 0): Promise<{ items: Item[]; total: number }> {
    return request<{ items: Item[]; total: number }>(`/deleted?limit=${limit}&offset=${offset}`);
  },
};
