/**
 * Relay search — server-side GET /search over the whole relay log.
 */
import { useState } from 'react';
import { Badge, EmptyState, Spinner } from '@dsect/ui/components/feedback';
import { QButton, QInput } from '../../lib/untitled';
import { formatRelayTime, searchMessages, type RelayMessage } from '../../api/relay';

export function SearchScreen({ baseUrl }: { baseUrl: string }) {
  const [query, setQuery] = useState('');
  const [author, setAuthor] = useState('');
  const [results, setResults] = useState<RelayMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const run = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await searchMessages(baseUrl, q, author.trim() || null));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults(null);
    } finally {
      setSearching(false);
    }
  };

  if (!baseUrl) {
    return (
      <EmptyState
        mark="∅"
        title="Relay not connected"
        text="Add the relay base URL in More → Connection settings to search the team log."
        actions={<Badge tone="warn" size="sm">Not connected</Badge>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <QInput
          label="Search the team log"
          placeholder="Search the team log…"
          value={query}
          onChange={setQuery}
        />
        <div className="flex gap-2">
          <div className="w-36 shrink-0">
            <QInput
              label="Author (optional)"
              placeholder="author"
              value={author}
              onChange={setAuthor}
            />
          </div>
          <QButton size="lg" type="submit" className="flex-1" isDisabled={!query.trim() || searching}>
            {searching ? 'Searching…' : 'Search'}
          </QButton>
        </div>
      </form>

      {error && (
        <EmptyState
          mark="!"
          title="Search failed"
          text={error}
          actions={
            <QButton size="lg" onClick={() => void run()}>
              Retry
            </QButton>
          }
        />
      )}

      {searching && !error && (
        <div className="flex justify-center py-8">
          <Spinner label="Searching the relay" />
        </div>
      )}

      {results !== null && !searching && !error && (
        results.length === 0 ? (
          <EmptyState
            mark="◌"
            title="No matches"
            text="The relay's full log has nothing matching that query."
          />
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Search results">
            {results.map((m) => (
              <li key={m.id} className="rounded-lg border p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {m.author_display || m.author}
                  </span>
                  <span className="shrink-0 text-xs text-text-secondary">
                    {formatRelayTime(m.timestamp)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
