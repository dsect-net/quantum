/** Shared types for the Singularity fleet hub.
 * Posts store structured tokens, not just a string, so chips stay linked
 * to live objects instead of copied titles.
 */

export type Role = "human" | "agent";

export type Actor = {
  id: string;
  handle: string;
  name: string;
  role: Role;
  title: string;
  email: string;
  bio: string;
  interests: string[];
  photo?: string;
};

export type RefKind = "goal" | "task" | "issue" | "bounty" | "memory" | "service";

export type GoalStatus = "active" | "paused" | "done" | "archived";
export type TaskStatus = "todo" | "doing" | "done";

export type Goal = {
  id: string;
  handle: string;
  title: string;
  status: GoalStatus;
  progress: number;
  ownerId: string;
  summary: string;
};

export type Task = {
  id: string;
  handle: string;
  title: string;
  status: TaskStatus;
  assigneeId: string | null;
  goalHandle: string;
  summary: string;
};

export type IssueRef = {
  id: string;
  handle: string;
  title: string;
  status: string;
  repo: string;
  number: number;
};

export type BountyRef = {
  id: string;
  handle: string;
  title: string;
  status: string;
  reward: string;
};

export type MemoryRef = {
  id: string;
  handle: string;
  title: string;
  excerpt: string;
  tier: "transient" | "project" | "durable";
  agent: string;
};

export type ServiceRef = {
  id: string;
  handle: string;
  title: string;
  status: string;
  summary: string;
};

export type Token =
  | { type: "text"; text: string }
  | { type: "mention"; handle: string }
  | { type: "ref"; handle: string };

export type ReactionKind = "acknowledge" | "useful" | "question";

export type Post = {
  id: string;
  authorId: string;
  body: string;
  tokens: Token[];
  createdAt: string;
  reactions: Record<ReactionKind, string[]>;
};

export type Comment = {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  tokens: Token[];
  createdAt: string;
};

export type PingKind = "mention" | "task" | "email";

export type Ping = {
  id: string;
  toId: string;
  fromId: string;
  kind: PingKind;
  subject: string;
  summary: string;
  ref?: string;
  postId: string;
  createdAt: string;
  acked: boolean;
};

export type LogEntry = {
  id: string;
  at: string;
  level: "info" | "warn" | "error";
  message: string;
};

export type Session = {
  actorId: string;
  mode: "preview" | "hub";
  email: string;
};

export type ShellMode = "auto-layout" | "phone" | "desktop" | "tv" | "watch" | "car";

export type HubData = {
  actors: Actor[];
  goals: Goal[];
  tasks: Task[];
  issues: IssueRef[];
  bounties: BountyRef[];
  memories: MemoryRef[];
  services: ServiceRef[];
  posts: Post[];
  comments: Comment[];
  pings: Ping[];
  logs: LogEntry[];
  session: Session | null;
  developerMode: boolean;
  shell: ShellMode;
  hubUrl: string;
};
