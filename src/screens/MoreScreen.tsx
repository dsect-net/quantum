/**
 * More tab: secondary destinations. Everything not built yet says so
 * honestly (Phase 4); Connection settings and About are real today.
 */
import { Badge } from '@dsect/ui/components/feedback';
import { Card } from '@dsect/ui/components/surfaces';

export type MoreRoute = 'services' | 'memory' | 'research' | 'about' | 'settings';

export interface MoreScreenProps {
  onNavigate: (route: MoreRoute) => void;
}

interface Row {
  id: MoreRoute;
  title: string;
  text: string;
  badge: 'Phase 4' | 'Live';
  tone: 'slate' | 'ok';
}

const ROWS: Row[] = [
  {
    id: 'services',
    title: 'Services & tools',
    text: 'hub-api dsect_* tools (mail, calendar, drive, codex, github, home assistant, service logs).',
    badge: 'Phase 4',
    tone: 'slate',
  },
  {
    id: 'memory',
    title: 'Memory explorer',
    text: 'hive-memory feed, graph, table, analytics — over a labeled static snapshot until a memory API exists.',
    badge: 'Phase 4',
    tone: 'slate',
  },
  {
    id: 'research',
    title: 'Research hub',
    text: 'Projects, documents, markdown export. Local-only until sync exists.',
    badge: 'Phase 4',
    tone: 'slate',
  },
  {
    id: 'about',
    title: 'About Quantum',
    text: 'What this app is and what it is not.',
    badge: 'Live',
    tone: 'ok',
  },
  {
    id: 'settings',
    title: 'Connection settings',
    text: 'Per-service base URLs, recommended tailnet quick-fills, connection tests.',
    badge: 'Live',
    tone: 'ok',
  },
];

export function MoreScreen({ onNavigate }: MoreScreenProps) {
  return (
    <div className="flex flex-col gap-3 p-4">
      {ROWS.map((row) => (
        <Card key={row.id}>
          <button
            type="button"
            onClick={() => onNavigate(row.id)}
            className="flex w-full items-start justify-between gap-3 text-left"
          >
            <span>
              <span className="block font-semibold">{row.title}</span>
              <span className="block text-sm text-text-secondary">{row.text}</span>
            </span>
            <Badge tone={row.tone} size="sm">
              {row.badge}
            </Badge>
          </button>
        </Card>
      ))}
    </div>
  );
}
