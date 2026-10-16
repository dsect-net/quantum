import React, { useState, useEffect } from 'react';
import { api, List, SearchMatchItem } from '../api';

interface SearchViewProps {
  lists: List[];
  onSelectItem: (itemId: string) => void;
}

export const SearchView: React.FC<SearchViewProps> = ({
  lists,
  onSelectItem,
}) => {
  const [query, setQuery] = useState('');
  const [selectedList, setSelectedList] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [results, setResults] = useState<SearchMatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [total, setTotal] = useState(0);

  const doSearch = async () => {
    try {
      setLoading(true);
      const res = await api.search({
        q: query.trim(),
        list: selectedList || undefined,
        type: selectedType || undefined,
        status: selectedStatus || undefined,
        limit: 50,
      });
      setResults(res.results);
      setTotal(res.total);
      setDegraded(res.degraded);
    } catch {
      setResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      doSearch();
    }, 300);
    return () => clearTimeout(timer);
  }, [query, selectedList, selectedType, selectedStatus]);

  return (
    <div data-testid="search-view">
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '16px', letterSpacing: '-0.02em' }}>
        Search
      </h1>

      {/* Main search input */}
      <div className="form-group" style={{ marginBottom: '16px' }}>
        <input
          type="search"
          data-testid="search-query-input"
          className="form-input"
          style={{ fontSize: '1rem', padding: '12px 14px' }}
          placeholder="Search by keywords or meaning..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {/* Filter chips */}
      <div className="filter-chips" data-testid="search-filter-chips">
        {/* Type filter */}
        <button
          type="button"
          data-testid="chip-type-all"
          className={`chip ${selectedType === '' ? 'active' : ''}`}
          onClick={() => setSelectedType('')}
        >
          All Types
        </button>
        <button
          type="button"
          data-testid="chip-type-note"
          className={`chip ${selectedType === 'note' ? 'active' : ''}`}
          onClick={() => setSelectedType(selectedType === 'note' ? '' : 'note')}
        >
          Notes
        </button>
        <button
          type="button"
          data-testid="chip-type-task"
          className={`chip ${selectedType === 'task' ? 'active' : ''}`}
          onClick={() => setSelectedType(selectedType === 'task' ? '' : 'task')}
        >
          Tasks
        </button>
        <button
          type="button"
          data-testid="chip-type-todo"
          className={`chip ${selectedType === 'todo' ? 'active' : ''}`}
          onClick={() => setSelectedType(selectedType === 'todo' ? '' : 'todo')}
        >
          Todos
        </button>

        {/* Status filter */}
        <button
          type="button"
          data-testid="chip-status-open"
          className={`chip ${selectedStatus === 'open' ? 'active' : ''}`}
          onClick={() => setSelectedStatus(selectedStatus === 'open' ? '' : 'open')}
        >
          Open
        </button>
        <button
          type="button"
          data-testid="chip-status-done"
          className={`chip ${selectedStatus === 'done' ? 'active' : ''}`}
          onClick={() => setSelectedStatus(selectedStatus === 'done' ? '' : 'done')}
        >
          Done
        </button>

        {/* List filter */}
        {lists.map((l) => (
          <button
            key={l.id}
            type="button"
            data-testid={`chip-list-${l.id}`}
            className={`chip ${selectedList === l.id ? 'active' : ''}`}
            onClick={() => setSelectedList(selectedList === l.id ? '' : l.id)}
          >
            {l.name}
          </button>
        ))}
      </div>

      {degraded && (
        <div
          data-testid="search-degraded-note"
          style={{
            padding: '8px 12px',
            background: 'var(--bg-muted)',
            color: 'var(--text-muted)',
            borderRadius: 'var(--radius-btn)',
            fontSize: '0.8125rem',
            marginBottom: '14px',
          }}
        >
          ℹ️ Semantic embedding is unavailable; using keyword search only.
        </div>
      )}

      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Searching...</div>
      ) : results.length === 0 ? (
        <div
          style={{
            padding: '48px 16px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            background: 'var(--bg-card)',
            border: '1px dashed var(--border-color)',
            borderRadius: 'var(--radius-card)',
          }}
        >
          {query.trim() ? 'No matches found.' : 'Type to search notes and tasks.'}
        </div>
      ) : (
        <div data-testid="search-results-container">
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Found {total} {total === 1 ? 'result' : 'results'}
          </div>

          {results.map(({ item, match }) => {
            const isSemantic = match === 'semantic' || match === 'both';
            return (
              <div
                key={item.id}
                data-testid={`search-result-${item.id}`}
                className="item-row"
                onClick={() => onSelectItem(item.id)}
              >
                <div className="item-row-content">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                    <span className="item-row-title">{item.title}</span>
                    {isSemantic && (
                      <span className="badge badge-violet" data-testid="meaning-match-tag">
                        meaning match
                      </span>
                    )}
                  </div>

                  {item.body && <div className="item-row-snippet">{item.body}</div>}

                  <div className="item-row-meta">
                    <span className="badge">{item.type}</span>
                    <span className="badge">{item.status}</span>
                    {item.tags?.map((t) => (
                      <span key={t} className="badge">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
