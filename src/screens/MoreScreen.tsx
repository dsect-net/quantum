/**
 * More tab: secondary destinations. Badges say plainly what each screen
 * shows: Live, Snapshot, or On-device. Nothing here pretends.
 */
import { Badge } from '@dsect/ui/components/feedback';
import { Card } from '@dsect/ui/components/surfaces';

export type MoreRoute = 'services' | 'memory' | 'research' | 'about' | 'settings' | 'debug';

export interface MoreScreenProps {
  onNavigate: (route: MoreRoute) => void;
  /** Revealed by the Scotty-only debug toggle in the app bar. */
  showDebug?: boolean;
}

interface Row {
  id: MoreRoute;
  title: string;
  text: string;
  badge: 'Live' | 'Snapshot' | 'On-device';
  tone: 'ok' | 'warn' | 'info';
}

const ROWS: Row[] = [
  {
    id: 'services',
    title: 'Services & tools',
    text: 'hub-api MCP gateway: connect with your worker key and run read-only dsect_* tools.',
    badge: 'Live',
    tone: 'ok',
  },
  {
    id: 'memory',
    title: 'Memory explorer',
    text: 'hive-memory feed over a vendored static snapshot — no live backend exists.',
    badge: 'Snapshot',
    tone: 'warn',
  },
  {
    id: 'research',
    title: 'Research hub',
    text: 'Projects and markdown documents. Records stay on this device.',
    badge: 'On-device',
    tone: 'info',
  },
  {
    id: 'about',
    title: 'About Quantum',
    text: 'What this app is, DSECT divisions and principles (from dsect.dev).',
    badge: 'Live',
    tone: 'ok',
  },
  {
    id: 'settings',
    title: 'Connection settings',
    text: 'Per-service base URLs, credentials, theme, diagnostics.',
    badge: 'Live',
    tone: 'ok',
  },
];

export function MoreScreen({ onNavigate, showDebug = false }: MoreScreenProps) {
  const rows: Row[] = showDebug
    ? [
        {
          id: 'debug',
          title: 'Debug tools',
          text: 'Connection diagnostics, settings inspector, log viewer. Scotty-only.',
          badge: 'Live',
          tone: 'warn',
        },
        ...ROWS,
      ]
    : ROWS;
  return (
    <div className="flex flex-col gap-3 p-4">
      {rows.map((row) => (
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
