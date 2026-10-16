export type ItemType = 'note' | 'task' | 'todo';
export type ItemStatus = 'open' | 'done' | 'archived';
export type ItemPriority = 1 | 2 | 3;
export type ItemRelation = 'spawned' | 'blocks' | 'related' | 'reference';
export type EmbeddingStatus = 'pending' | 'done' | 'failed';

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
