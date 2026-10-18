/** Feed owns posts, profiles and stable handles, never a second live collab store.
 * SQLite commits each mutation plus its delivery outbox atomically. Failed external
 * effects remain visible and retryable; posts are never silently re-published.
 */
import { DatabaseSync } from 'node:sqlite';
import { seedData } from '../../../apps/universal-hub/src/singularity/seed.ts';
import { publishPost, publishComment, toggleReaction, ackPing } from '../../../apps/universal-hub/src/singularity/domain.ts';
import type { Actor, HubData, ReactionKind } from '../../../apps/universal-hub/src/singularity/types.ts';
import { z } from 'zod';

export class ServiceError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
export interface Backend {
  refresh(data: HubData, handle: (kind: string, id: string) => string): Promise<Partial<HubData>>;
  ping(ping: HubData['pings'][number], data: HubData): Promise<void>;
  assign(taskId: string, actor: Actor): Promise<void>;
}
export const profilePatch = z.object({
  bio: z.string().max(2000), title: z.string().max(120),
  interests: z.array(z.string().min(1).max(80)).max(20),
  photo: z.string().max(450000).refine(v => !v || /^https:\/\/[^\s]+$/.test(v) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v), 'Use HTTPS or a PNG/JPEG/WebP photo').optional(),
}).strict();
export class SingularityService {
  db: DatabaseSync;
  constructor(path: string, public demo: boolean, actors: Actor[] = [], private backend?: Backend) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS handles(seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, source TEXT NOT NULL, handle TEXT NOT NULL UNIQUE, UNIQUE(kind,source));
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');`);
    if (!this.db.prepare('SELECT id FROM state').get()) {
      const data = seedData();
      if (!demo) Object.assign(data, { actors, goals: [], tasks: [], posts: [], comments: [], pings: [], memories: [], issues: [], bounties: [], services: [], logs: [] });
      this.save(data);
    }
    // Prevent accidentally promoting a seeded DB into a live deployment.
    this.db.exec('CREATE TABLE IF NOT EXISTS deployment(mode TEXT NOT NULL)');
    const mode = this.db.prepare('SELECT mode FROM deployment').get() as {mode: string} | undefined;
    if (mode && mode.mode !== String(demo)) {this.db.close();throw new Error('Use a separate database for demo and live modes');}
    this.db.exec("UPDATE outbox SET status='needs-review' WHERE status='sending'");
    if (!mode) this.db.prepare('INSERT INTO deployment VALUES (?)').run(String(demo));
    if (!demo) { const data = this.read(); data.actors = actors.map(a => ({...a, ...data.actors.find(old => old.id === a.id), id:a.id, email:a.email, handle:a.handle, role:a.role})); this.save(data); }
  }
  read(): HubData { return JSON.parse((this.db.prepare('SELECT body FROM state WHERE id=1').get() as {body: string}).body); }
  private save(data: HubData) { this.db.prepare('INSERT OR REPLACE INTO state VALUES (1,?)').run(JSON.stringify(data)); }
  actor(id: string) { const actor = this.read().actors.find(a => a.id === id); if (!actor) throw new ServiceError(403, 'Identity is not in the organization directory'); return actor; }
  handle(kind: string, id: string) {
    const old = this.db.prepare('SELECT handle FROM handles WHERE kind=? AND source=?').get(kind,id) as {handle:string}|undefined;
    if (old) return old.handle;
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM handles WHERE kind=?').get(kind) as {n:number};
    const handle = `${kind}-${String(Number(count.n)+1).padStart(3,'0')}`;
    this.db.prepare('INSERT INTO handles(kind,source,handle) VALUES (?,?,?)').run(kind,id,handle);
    return handle;
  }
  async snapshot() {
    if (!this.demo) {
      if (!this.backend) throw new ServiceError(503,'Quantum backend is not configured');
      const current = await this.backend.refresh(this.read(), this.handle.bind(this));
      this.save({...this.read(), ...current});
    }
    return this.read();
  }
  publish(actorId: string, body: string, postId?: string) {
    this.actor(actorId);
    const before = this.read();
    const result = postId ? publishComment(before,actorId,postId,body) : publishPost(before,actorId,body);
    if (result.error) throw new ServiceError(400,result.error);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.demo) {
        for (const task of result.data.tasks) {
          if (task.assigneeId && task.assigneeId !== before.tasks.find(t=>t.id===task.id)?.assigneeId)
            this.db.prepare('INSERT INTO outbox(id,kind,payload) VALUES (?,?,?)').run(crypto.randomUUID(),'assign',JSON.stringify({taskId:task.id,actorId:task.assigneeId}));
        }
        for (const ping of result.data.pings.filter(p=>!before.pings.some(old=>old.id===p.id)))
          this.db.prepare('INSERT INTO outbox(id,kind,payload) VALUES (?,?,?)').run(ping.id,'ping',JSON.stringify(ping));
      }
      this.save(result.data); this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return postId ? result.data.comments.at(-1)! : result.data.posts[0];
  }
  react(actorId:string, postId:string, kind:ReactionKind) {
    this.actor(actorId); const data=this.read();
    if (!data.posts.some(p=>p.id===postId)) throw new ServiceError(404,'Post not found');
    this.save(toggleReaction(data,postId,actorId,kind)); return {ok:true};
  }
  profile(actorId:string, patch:unknown) {
    this.actor(actorId); const parsed=profilePatch.parse(patch); const data=this.read();
    data.actors=data.actors.map(a=>a.id===actorId?{...a,...parsed}:a); this.save(data); return this.actor(actorId);
  }
  ack(actorId:string, id:string) { this.actor(actorId); this.save(ackPing(this.read(),id,actorId)); return {ok:true}; }
  deliveries() { return this.db.prepare('SELECT id,kind,status FROM outbox ORDER BY rowid').all(); }
  private delivering = false;
  async deliver() {
    if (this.delivering || this.demo || !this.backend) return;
    this.delivering=true;
    try {
      // Unknown outcomes (timeout after the hub accepted a ping) are NOT auto-retried:
      // hub ping has no verified idempotency contract. Operator reconciles first.
      const rows=this.db.prepare("SELECT * FROM outbox WHERE status='pending' ORDER BY rowid").all() as unknown as Array<{id:string;kind:string;payload:string}>;
      for (const row of rows) {
        this.db.prepare("UPDATE outbox SET status='sending' WHERE id=?").run(row.id);
        try {
          const p=JSON.parse(row.payload);
          if (row.kind==='assign') await this.backend.assign(p.taskId,this.actor(p.actorId));
          else await this.backend.ping(p,this.read());
          this.db.prepare("UPDATE outbox SET status='sent' WHERE id=?").run(row.id);
        } catch { this.db.prepare("UPDATE outbox SET status='needs-review' WHERE id=?").run(row.id); }
      }
    } finally {this.delivering=false;}
  }
  close() { this.db.close(); }
}
