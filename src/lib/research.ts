/**
 * Research records — browser-local only, matching research-hub's own
 * semantics ("records stay in the browser"). No sync backend exists, so
 * the store is localStorage (keyed, versioned) and the screen labels every
 * record "On this device only".
 *
 * Shape mirrors research-hub loosely: projects hold documents (markdown).
 */
export interface ResearchDocument {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

export interface ResearchProject {
  id: string;
  title: string;
  summary: string;
  documents: ResearchDocument[];
  createdAt: string;
  updatedAt: string;
}

const STORE_KEY = 'quantum.research.v1';

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function readRaw(): unknown {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function isProject(value: unknown): value is ResearchProject {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return typeof p.id === 'string' && typeof p.title === 'string' && Array.isArray(p.documents);
}

/** Load all local projects. Corrupt stores come back empty, never crash. */
export function listProjects(): ResearchProject[] {
  const raw = readRaw();
  if (!Array.isArray(raw)) return [];
  return raw.filter(isProject);
}

function persist(projects: ResearchProject[]): void {
  window.localStorage.setItem(STORE_KEY, JSON.stringify(projects));
}

export function getProject(id: string): ResearchProject | null {
  return listProjects().find((p) => p.id === id) ?? null;
}

export function createProject(title: string, summary = ''): ResearchProject {
  const project: ResearchProject = {
    id: newId(),
    title: title.trim() || 'Untitled project',
    summary,
    documents: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  persist([project, ...listProjects()]);
  return project;
}

export function updateProject(id: string, patch: { title?: string; summary?: string }): ResearchProject | null {
  const projects = listProjects();
  const project = projects.find((p) => p.id === id);
  if (!project) return null;
  if (patch.title !== undefined) project.title = patch.title.trim() || project.title;
  if (patch.summary !== undefined) project.summary = patch.summary;
  project.updatedAt = nowIso();
  persist(projects);
  return project;
}

export function deleteProject(id: string): boolean {
  const projects = listProjects();
  const kept = projects.filter((p) => p.id !== id);
  if (kept.length === projects.length) return false;
  persist(kept);
  return true;
}

export function createDocument(projectId: string, title: string, body = ''): ResearchDocument | null {
  const projects = listProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return null;
  const doc: ResearchDocument = {
    id: newId(),
    title: title.trim() || 'Untitled document',
    body,
    updatedAt: nowIso(),
  };
  project.documents = [doc, ...project.documents];
  project.updatedAt = nowIso();
  persist(projects);
  return doc;
}

export function updateDocument(
  projectId: string,
  docId: string,
  patch: { title?: string; body?: string },
): ResearchDocument | null {
  const projects = listProjects();
  const project = projects.find((p) => p.id === projectId);
  const doc = project?.documents.find((d) => d.id === docId);
  if (!project || !doc) return null;
  if (patch.title !== undefined) doc.title = patch.title.trim() || doc.title;
  if (patch.body !== undefined) doc.body = patch.body;
  doc.updatedAt = nowIso();
  project.updatedAt = nowIso();
  persist(projects);
  return doc;
}

export function deleteDocument(projectId: string, docId: string): boolean {
  const projects = listProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return false;
  const kept = project.documents.filter((d) => d.id !== docId);
  if (kept.length === project.documents.length) return false;
  project.documents = kept;
  project.updatedAt = nowIso();
  persist(projects);
  return true;
}

/** Export a project as a single markdown document (research-hub parity). */
export function exportProjectMarkdown(project: ResearchProject): string {
  const lines = [
    `# ${project.title}`,
    '',
    `> Exported ${project.updatedAt.slice(0, 10)} · On this device only`,
    '',
  ];
  if (project.summary.trim()) {
    lines.push(project.summary.trim(), '');
  }
  for (const doc of project.documents) {
    lines.push(`## ${doc.title}`, '', doc.body.trim(), '');
  }
  return lines.join('\n');
}

export { STORE_KEY };
