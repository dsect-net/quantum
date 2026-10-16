export type ItemType = 'note' | 'task' | 'todo';
export type ItemStatus = 'open' | 'done' | 'archived';
export type ItemPriority = 1 | 2 | 3;
export type ItemRelation = 'spawned' | 'blocks' | 'related' | 'reference';
export type EmbeddingStatus = 'pending' | 'done' | 'failed';
export type RevisionKind =
  | 'create'
  | 'edit'
  | 'complete'
  | 'reopen'
  | 'delete'
  | 'restore'
  | 'move';

export interface List {
  id: string;
  name: string;
  category: string;
  parent_list_id: string | null;
  sort_order: number;
  private: number; // 0 or 1
  sync_excluded: number; // 0 or 1
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListWithCounts extends List {
  open_count: number;
  counts: ListCounts;
}

export interface Item {
  id: string;
  list_id: string;
  parent_item_id: string | null;
  type: ItemType;
  title: string;
  body: string;
  author: string;
  status: ItemStatus;
  priority: ItemPriority | null;
  due_at: string | null;
  linked_source: string | null;
  embedding_status: EmbeddingStatus;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  deleted_at: string | null;
}

export interface ItemWithTags extends Item {
  tags: string[];
  revisions?: Revision[];
}

export interface Tag {
  id: string;
  name: string;
}

export interface ItemTag {
  item_id: string;
  tag_id: string;
}

export interface ItemLink {
  id: string;
  from_item_id: string;
  to_item_id: string | null;
  external_url: string | null;
  relation: ItemRelation;
  created_at: string;
}

export interface Embedding {
  item_id: string;
  model_id: string;
  vector: Buffer;
  embedded_at: string;
}

export interface Revision {
  id: string;
  item_id: string;
  snapshot: string;
  author: string;
  created_at: string;
  kind: RevisionKind;
}

export interface ListCounts {
  open: number;
  done: number;
  archived: number;
  total: number;
}

export interface ListGetResult {
  list: List;
  counts: ListCounts;
}

export interface HealthResponse {
  status: 'ok';
  schema_version: number;
  lists: number;
}

export interface NoteAddInput {
  title: string;
  body?: string;
  list?: string; // name or id, defaults to 'Ideas & Tasks'
  type?: ItemType;
  tags?: string[];
  priority?: ItemPriority | null;
  due_at?: string | null;
  category?: string;
  linked_source?: string | null;
  parent_item_id?: string | null;
  author: string;
}

export interface NoteUpdateInput {
  id: string;
  author: string;
  title?: string;
  body?: string;
  list?: string; // name or id to move to
  type?: ItemType;
  tags?: string[];
  priority?: ItemPriority | null;
  due_at?: string | null;
  status?: ItemStatus;
  linked_source?: string | null;
  parent_item_id?: string | null;
  coalesce?: boolean; // service layer only (for app autosave)
}

export interface ListCreateInput {
  name: string;
  category: string;
  parent_list_id?: string | null;
  private?: boolean | number;
  author?: string;
}

export interface ListItemsOptions {
  list: string; // name or id
  status?: ItemStatus;
  type?: ItemType;
  include_subitems?: boolean; // default true
  limit?: number; // default 50, max 200
  offset?: number; // default 0
}

export interface ListItemsResult {
  items: ItemWithTags[];
  total: number;
  limit: number;
  offset: number;
}

export interface SearchOptions {
  query: string;
  list?: string; // name or id
  category?: string;
  tag?: string;
  type?: ItemType;
  status?: ItemStatus;
  due_before?: string;
  due_after?: string;
  limit?: number;
  offset?: number;
}

export interface SearchMatchItem {
  item: ItemWithTags;
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
