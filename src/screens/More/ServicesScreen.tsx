/**
 * Services & tools — hub-api MCP gateway on the phone.
 *
 * Real data or an honest degraded state, per the house rule:
 *  - No hub URL or no MCP worker key → demo mode banner + directions.
 *  - Connected → the live `tools/list` from the gateway, grouped by area.
 *  - Curated read-only tools (services status, service logs, monitor
 *    snapshot, whoami) get a real Run form.
 *  - Everything classified mutating gets a "Not run from mobile" badge and
 *    NO action button — destructive calls are never half-wired.
 *  - `dsect_tailscale_status` is labeled as not published by the gateway yet
 *    (drafted server-side, pending hub-side work).
 */
import { useMemo, useRef, useState } from 'react';
import { Badge, EmptyState, Spinner } from '@dsect/ui/components/feedback';
import { StateIndicator } from '@dsect/ui/components/status';
import { Card } from '@dsect/ui/components/surfaces';
import { QButton, QInput, QToggle } from '../../lib/untitled';
import { DemoBanner } from '../../components/DemoBanner';
import { getSettings } from '../../lib/settings';
import {
  McpClient,
  classifyTool,
  mcpConfigured,
  renderToolResult,
  toolArea,
  type McpContentBlock,
  type McpTool,
} from '../../api/mcp';
import {
  KNOWN_UNPUBLISHED_TOOLS,
  runnerFor,
  type RunnerConfig,
  type RunnerField,
} from '../../api/mcpTools';

type ConnState = 'idle' | 'connecting' | 'ready' | 'error';

interface ServiceEntry {
  id?: string;
  name?: string;
  group?: string | null;
  status?: string;
  [key: string]: unknown;
}

function statusState(status: string | undefined): 'ready' | 'degraded' | 'stopped' | 'unknown' {
  if (status === 'up') return 'ready';
  if (status === 'down') return 'stopped';
  if (status === 'degraded' || status === 'warn') return 'degraded';
  return 'unknown';
}

/** Pretty JSON render of a services_status result: kit rows, not raw text. */
function ServicesStatusResult({ blocks }: { blocks: McpContentBlock[] }) {
  const parsed = useMemo(() => {
    for (const b of blocks) {
      if (typeof b.text !== 'string') continue;
      try {
        const obj = JSON.parse(b.text) as {
          ok?: boolean;
          total?: number;
          up?: number;
          problems?: number;
          services?: ServiceEntry[];
        };
        if (obj && typeof obj === 'object' && Array.isArray(obj.services)) return obj;
      } catch {
        // not JSON — fall through to raw text below
      }
    }
    return null;
  }, [blocks]);

  if (!parsed) {
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-text-secondary">
        {renderToolResult(blocks).join('\n')}
      </pre>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={parsed.problems === 0 ? 'ok' : 'warn'} size="sm">
          {parsed.up ?? 0}/{parsed.total ?? parsed.services!.length} up
        </Badge>
        {(parsed.problems ?? 0) > 0 && (
          <Badge tone="err" size="sm">
            {parsed.problems} problems
          </Badge>
        )}
      </div>
      <ul className="flex flex-col gap-1">
        {parsed.services!.map((s) => (
          <li
            key={String(s.id ?? s.name ?? Math.random())}
            className="flex items-center justify-between gap-2 rounded border border-border-subtle px-2 py-1.5"
          >
            <span className="min-w-0">
              <span className="block truncate font-mono text-sm">{String(s.name ?? s.id ?? '?')}</span>
              {s.group ? (
                <span className="block truncate text-xs text-text-secondary">{String(s.group)}</span>
              ) : null}
            </span>
            <StateIndicator state={statusState(s.status)}>{s.status ?? 'unknown'}</StateIndicator>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ToolResult({ blocks, toolName }: { blocks: McpContentBlock[]; toolName: string }) {
  if (toolName === 'dsect_services_status') return <ServicesStatusResult blocks={blocks} />;
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-text-secondary">
      {renderToolResult(blocks).join('\n')}
    </pre>
  );
}

function RunnerForm({
  config,
  client,
  disabled,
}: {
  config: RunnerConfig;
  client: McpClient;
  disabled: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of config.fields) init[f.key] = String(f.defaultValue ?? '');
    return init;
  });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<McpContentBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setValue(field: RunnerField, value: string) {
    setValues((v) => ({ ...v, [field.key]: value }));
  }

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const blocks = await client.callTool(config.tool, config.buildArgs(values));
      setResult(blocks);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tool call failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
      {config.fields.map((field) =>
        field.type === 'toggle' ? (
          <label key={field.key} className="flex items-center justify-between gap-3">
            <span>
              <span className="block font-medium">{field.label}</span>
              {field.hint && (
                <span className="block text-sm text-text-secondary">{field.hint}</span>
              )}
            </span>
            <QToggle
              aria-label={field.label}
              isSelected={values[field.key] === 'true'}
              onChange={(selected) => setValue(field, String(selected))}
            />
          </label>
        ) : (
          <QInput
            key={field.key}
            label={field.label}
            hint={field.hint}
            placeholder={field.placeholder}
            value={values[field.key] ?? ''}
            onChange={(v) => setValue(field, v)}
            type={field.type === 'number' ? 'number' : 'text'}
          />
        ),
      )}
      <div>
        <QButton
          color="primary"
          size="md"
          onPress={run}
          isDisabled={disabled || running}
          isLoading={running}
        >
          Run
        </QButton>
      </div>
      {error && (
        <Badge tone="err" size="sm">
          {error}
        </Badge>
      )}
      {result && <ToolResult blocks={result} toolName={config.tool} />}
    </div>
  );
}

function ToolCard({ tool, client }: { tool: McpTool; client: McpClient }) {
  const [open, setOpen] = useState(false);
  const kind = classifyTool(tool.name);
  const runner = runnerFor(tool.name);
  const runnable = runner !== null;

  return (
    <Card>
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-mono text-sm font-semibold">{tool.name}</h3>
            {tool.description && (
              <p className="text-sm text-text-secondary">{tool.description}</p>
            )}
          </div>
          {runnable ? (
            <Badge tone="ok" size="sm">
              Read-only
            </Badge>
          ) : kind === 'mutating' ? (
            <Badge tone="err" size="sm">
              Not run from mobile
            </Badge>
          ) : (
            <Badge tone="slate" size="sm">
              Unclassified
            </Badge>
          )}
        </div>
        {runnable && runner && (
          <div>
            <QButton
              color="secondary"
              size="md"
              onPress={() => setOpen((o) => !o)}
              aria-expanded={open}
            >
              {open ? 'Hide' : `Run: ${runner.title}`}
            </QButton>
          </div>
        )}
        {open && runner && <RunnerForm config={runner} client={client} disabled={!client.connected} />}
      </div>
    </Card>
  );
}

export function ServicesScreen() {
  const settings = useMemo(() => getSettings(), []);
  const clientRef = useRef<McpClient | null>(null);
  const [conn, setConn] = useState<ConnState>('idle');
  const [connError, setConnError] = useState<string | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [query, setQuery] = useState('');

  const configured = mcpConfigured(settings.hub.baseUrl, settings.mcpKey);

  async function connect() {
    if (!configured) return;
    setConn('connecting');
    setConnError(null);
    const client = new McpClient(settings.hub.baseUrl, settings.mcpKey);
    try {
      await client.connect();
      const list = await client.listTools();
      clientRef.current = client;
      setTools(list);
      setConn('ready');
    } catch (e) {
      client.disconnect();
      setConn('error');
      setConnError(e instanceof Error ? e.message : 'Connection failed');
    }
  }

  function disconnect() {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setTools([]);
    setConn('idle');
  }

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? tools.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            (t.description ?? '').toLowerCase().includes(q),
        )
      : tools;
    const map = new Map<string, McpTool[]>();
    for (const t of filtered) {
      const area = toolArea(t.name);
      if (!map.has(area)) map.set(area, []);
      map.get(area)!.push(t);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tools, query]);

  const unlistedMissing = useMemo(() => {
    const names = new Set(tools.map((t) => t.name));
    return KNOWN_UNPUBLISHED_TOOLS.filter((k) => !names.has(k.tool));
  }, [tools]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-lg font-semibold">Services &amp; tools</h2>
        <p className="text-sm text-text-secondary">
          The hub MCP gateway's <span className="font-mono">dsect_*</span> tools
          (mail, calendar, drive, codex, github, docket, home assistant,
          service ops) — behind the Bearer worker key you entered in
          Connection settings. Read-only calls run from here; anything that
          changes state does not run from mobile.
        </p>
      </div>

      <DemoBanner configured={configured} serviceLabel="Hub API (MCP)" />
      {!configured && (
        <EmptyState
          mark="◎"
          title="Not connected"
          text={
            <>
              Set the Hub API base URL and your MCP worker key in{' '}
              <span className="font-semibold">More → Connection settings</span>.
              The key is your own, entered by you — it is never in the app
              bundle.
            </>
          }
        />
      )}

      {configured && conn === 'idle' && (
        <div>
          <QButton color="primary" onPress={connect}>
            Connect to MCP gateway
          </QButton>
        </div>
      )}

      {configured && conn === 'connecting' && (
        <div className="flex items-center gap-2">
          <Spinner size="md" />
          <span className="text-sm text-text-secondary">Opening MCP session…</span>
        </div>
      )}

      {conn === 'error' && (
        <Card>
          <div className="flex flex-col gap-3">
            <Badge tone="err" size="sm">
              Connection failed
            </Badge>
            <p className="text-sm text-text-secondary">{connError ?? 'Unknown error'}</p>
            <div>
              <QButton color="secondary" size="md" onPress={connect}>
                Try again
              </QButton>
            </div>
          </div>
        </Card>
      )}

      {conn === 'ready' && clientRef.current && (
        <>
          <div className="flex items-center justify-between gap-2">
            <Badge tone="ok" size="sm" dot>
              Connected — {tools.length} tools
            </Badge>
            <QButton color="secondary" size="md" onPress={disconnect}>
              Disconnect
            </QButton>
          </div>

          <QInput
            label="Search tools"
            placeholder="e.g. mail, logs, hass…"
            value={query}
            onChange={setQuery}
            aria-label="Search tools"
          />

          {grouped.map(([area, areaTools]) => (
            <section key={area} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
                {area} · {areaTools.length}
              </h3>
              {areaTools.map((t) => (
                <ToolCard key={t.name} tool={t} client={clientRef.current!} />
              ))}
            </section>
          ))}

          {unlistedMissing.map((k) => (
            <Card key={k.tool}>
              <div className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-mono text-sm font-semibold">{k.tool}</h3>
                  <Badge tone="warn" size="sm">
                    Not published yet
                  </Badge>
                </div>
                <p className="text-sm text-text-secondary">{k.note}</p>
              </div>
            </Card>
          ))}

          {grouped.length === 0 && (
            <EmptyState
              mark="∅"
              title="No tools match"
              text={<>No tools match “{query}”. Try a different search.</>}
            />
          )}
        </>
      )}
    </div>
  );
}
