/**
 * Research hub — browser-local records, labeled "On this device only".
 *
 * research-hub keeps records in the browser with no sync backend; this
 * screen follows the same contract: projects with markdown documents,
 * stored in localStorage on this device. The honesty label appears in the
 * header and in every export.
 */
import { useMemo, useState } from 'react';
import { Badge, EmptyState } from '@dsect/ui/components/feedback';
import { Card } from '@dsect/ui/components/surfaces';
import { QButton, QInput } from '../../lib/untitled';
import {
  createDocument,
  createProject,
  deleteDocument,
  deleteProject,
  exportProjectMarkdown,
  getProject,
  listProjects,
  updateDocument,
  updateProject,
  type ResearchDocument,
  type ResearchProject,
} from '../../lib/research';

function useProjects(): [ResearchProject[], () => void] {
  const [version, setVersion] = useState(0);
  const projects = useMemo(() => listProjects(), [version]);
  return [projects, () => setVersion((v) => v + 1)];
}

function DocumentCard({
  projectId,
  doc,
  onChange,
}: {
  projectId: string;
  doc: ResearchDocument;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(doc.body);
  const [title, setTitle] = useState(doc.title);
  const [editing, setEditing] = useState(false);

  function save() {
    updateDocument(projectId, doc.id, { title, body });
    setEditing(false);
    onChange();
  }

  function remove() {
    if (window.confirm(`Delete “${doc.title}”? This cannot be undone.`)) {
      deleteDocument(projectId, doc.id);
      onChange();
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="min-w-0 flex-1 text-left font-semibold"
            aria-expanded={open}
          >
            <span className="truncate">{doc.title}</span>
          </button>
          <span className="font-mono text-xs text-text-secondary">
            {doc.updatedAt.slice(0, 10)}
          </span>
        </div>
        {open && (
          <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
            {!editing ? (
              <>
                <pre className="whitespace-pre-wrap text-sm">{doc.body || <span className="text-text-secondary">(empty)</span>}</pre>
                <div className="flex gap-2">
                  <QButton color="secondary" size="md" onPress={() => setEditing(true)}>
                    Edit
                  </QButton>
                  <QButton color="secondary" size="md" onPress={remove}>
                    Delete
                  </QButton>
                </div>
              </>
            ) : (
              <>
                <QInput
                  label="Title"
                  value={title}
                  onChange={setTitle}
                  aria-label="Document title"
                />
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Body (markdown)</span>
                  <textarea
                    className="min-h-32 rounded border border-border-subtle bg-surface p-2 font-mono text-sm"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={8}
                  />
                </label>
                <div className="flex gap-2">
                  <QButton color="primary" size="md" onPress={save}>
                    Save
                  </QButton>
                  <QButton color="secondary" size="md" onPress={() => setEditing(false)}>
                    Cancel
                  </QButton>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function ProjectDetail({
  project,
  onChange,
  onBack,
}: {
  project: ResearchProject;
  onChange: () => void;
  onBack: () => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [summary, setSummary] = useState(project.summary);
  const [newDocTitle, setNewDocTitle] = useState('');

  function saveMeta() {
    updateProject(project.id, { title, summary });
    onChange();
  }

  function addDoc() {
    const doc = createDocument(project.id, newDocTitle, '');
    if (doc) {
      setNewDocTitle('');
      onChange();
    }
  }

  function removeProject() {
    if (window.confirm(`Delete “${project.title}” and all its documents?`)) {
      deleteProject(project.id);
      onBack();
    }
  }

  function exportMarkdown() {
    const md = exportProjectMarkdown(project);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.title.replace(/[^\w-]+/g, '-').toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <QButton color="secondary" size="md" onPress={onBack}>
          ← Back to library
        </QButton>
      </div>
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Badge tone="info" size="sm" dot>
              On this device only
            </Badge>
            <span className="font-mono text-xs text-text-secondary">
              {project.documents.length} document{project.documents.length === 1 ? '' : 's'}
            </span>
          </div>
          <QInput label="Project title" value={title} onChange={setTitle} />
          <QInput label="Summary" value={summary} onChange={setSummary} hint="One-line description." />
          <div className="flex flex-wrap gap-2">
            <QButton color="primary" size="md" onPress={saveMeta}>
              Save
            </QButton>
            <QButton color="secondary" size="md" onPress={exportMarkdown}>
              Export markdown
            </QButton>
            <QButton color="secondary" size="md" onPress={removeProject}>
              Delete project
            </QButton>
          </div>
        </div>
      </Card>

      <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
        Documents
      </h3>
      <Card>
        <div className="flex flex-col gap-2">
          <QInput
            label="New document title"
            placeholder="e.g. Experiment notes"
            value={newDocTitle}
            onChange={setNewDocTitle}
            aria-label="New document title"
          />
          <div>
            <QButton color="secondary" size="md" onPress={addDoc}>
              Add document
            </QButton>
          </div>
        </div>
      </Card>
      {project.documents.map((doc) => (
        <DocumentCard key={doc.id} projectId={project.id} doc={doc} onChange={onChange} />
      ))}
    </div>
  );
}

export function ResearchScreen() {
  const [projects, refresh] = useProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');

  if (selectedId) {
    const project = getProject(selectedId);
    if (!project) {
      setSelectedId(null);
    } else {
      return (
        <div className="p-4">
          <ProjectDetail
            project={project}
            onChange={refresh}
            onBack={() => {
              setSelectedId(null);
              refresh();
            }}
          />
        </div>
      );
    }
  }

  function addProject() {
    const project = createProject(newTitle);
    setNewTitle('');
    refresh();
    setSelectedId(project.id);
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Research hub</h2>
          <Badge tone="info" size="sm" dot>
            On this device only
          </Badge>
        </div>
        <p className="text-sm text-text-secondary">
          Projects and markdown documents. There is no sync backend — these
          records live on this device and do not leave it.
        </p>
      </div>

      <Card>
        <div className="flex flex-col gap-2">
          <QInput
            label="New project title"
            placeholder="e.g. CIRCE follow-ups"
            value={newTitle}
            onChange={setNewTitle}
            aria-label="New project title"
          />
          <div>
            <QButton color="primary" size="md" onPress={addProject}>
              Create project
            </QButton>
          </div>
        </div>
      </Card>

      {projects.length === 0 ? (
        <EmptyState
          mark="◌"
          title="No projects yet"
          text={<>Create a project above. It stays on this device.</>}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Card>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">{p.title}</span>
                    {p.summary && (
                      <span className="block truncate text-sm text-text-secondary">{p.summary}</span>
                    )}
                  </span>
                  <Badge tone="slate" size="sm">
                    {p.documents.length} doc{p.documents.length === 1 ? '' : 's'}
                  </Badge>
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
