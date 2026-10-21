/** Board domain types — mirrored from board_server.py (the stopgap service).
 * Keep these in lockstep with TRK-0204's contract until P5 (TRK-0273)
 * ships a real JSON board API. */

export type Status =
  | 'planned'
  | 'in_progress'
  | 'in_review'
  | 'blocked'
  | 'done'
  | 'cancelled';

export type Priority = 'critical' | 'high' | 'medium' | 'low' | 'none';

/** List-view row (board_server.fetch_rows): no body on the board payload. */
export interface BoardItem {
  id: string;
  kind: string;
  title: string;
  status: Status;
  priority: Priority;
  assignee: string;
  due_at: string;
  points: number | null;
  updated_at: string;
}

/** A project hub: a goal item joined by undirected 'project' relations. */
export interface Project {
  id: string;
  title: string;
  slug: string;
  member_ids: string[];
}

export interface BoardData {
  generated_at: string;
  items: BoardItem[];
  projects: Project[];
}

/** Full record from GET /api/item/<id>. */
export interface ItemRecord extends BoardItem {
  body: string;
  parent_id: string;
  source: string;
  external_ref: string;
  created_at: string;
}

export interface EventRow {
  ts: string;
  actor: string;
  kind: string;
  text: string;
}

export interface ItemDetail {
  item: ItemRecord;
  comments: EventRow[];
  history: EventRow[];
}

/** Fields POST /api/item/<id>/update accepts (server whitelist). */
export interface ItemUpdate {
  title?: string;
  body?: string;
  status?: Status;
  priority?: Priority;
  assignee?: string;
  due_at?: string;
  points?: number | null;
}

/** Rendered columns, in stopgap order. Cancelled has no column. */
export const COLUMNS: { status: Status; label: string }[] = [
  { status: 'in_review', label: 'In Review' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'blocked', label: 'Blocked' },
  { status: 'planned', label: 'Planned' },
  { status: 'done', label: 'Done (recent)' },
];

export const STATUS_LABELS: Record<Status, string> = {
  planned: 'Planned',
  in_progress: 'In Progress',
  in_review: 'In Review',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const ALL_STATUSES = Object.keys(STATUS_LABELS) as Status[];

export const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low', 'none'];

/** Priority dot colors — same values as board_server.PRIIO_COLORS. */
export const PRIO_COLORS: Record<Priority, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#6b7280',
  none: '#d1d5db',
};

/** Done column shows at most this many cards (stopgap DONE_SHOWN). */
export const DONE_SHOWN = 30;
