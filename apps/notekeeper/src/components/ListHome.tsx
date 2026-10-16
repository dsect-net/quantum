import React from 'react';
import { List } from '../api';

interface ListHomeProps {
  lists: List[];
  loading: boolean;
  onSelectList: (listId: string) => void;
  onOpenCapture: () => void;
  onOpenDeleted: () => void;
}

export const ListHome: React.FC<ListHomeProps> = ({
  lists,
  loading,
  onSelectList,
  onOpenCapture,
  onOpenDeleted,
}) => {
  // Ensure "Ideas & Tasks" is placed first (inbox)
  const sortedLists = [...lists].sort((a, b) => {
    if (a.name === 'Ideas & Tasks') return -1;
    if (b.name === 'Ideas & Tasks') return 1;
    return a.sort_order - b.sort_order;
  });

  return (
    <div data-testid="lists-home">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>Lists</h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Capture, organize, and review</p>
        </div>
        <button
          type="button"
          data-testid="home-add-btn"
          className="btn btn-black"
          onClick={onOpenCapture}
        >
          ＋ Add
        </button>
      </div>

      {loading && lists.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading lists...
        </div>
      ) : (
        <div data-testid="lists-container">
          {sortedLists.map((list) => {
            const isInbox = list.name === 'Ideas & Tasks';
            const openCount = list.open_count ?? list.counts?.open ?? 0;

            return (
              <div
                key={list.id}
                data-testid={`list-card-${list.id}`}
                className="card card-interactive"
                onClick={() => onSelectList(list.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 18px',
                  borderLeft: isInbox ? '4px solid #000000' : '1px solid var(--border-color)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.0625rem', fontWeight: 600 }}>{list.name}</span>
                  {isInbox && <span className="badge badge-inbox">Inbox</span>}
                  {list.private === 1 && (
                    <span title="Private list" style={{ fontSize: '0.9rem' }} data-testid="lock-glyph">
                      🔒
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span
                    className="badge"
                    data-testid={`list-count-${list.id}`}
                    style={{
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      background: isInbox ? 'var(--bg-muted)' : 'var(--bg-app)',
                    }}
                  >
                    {openCount}
                  </span>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>›</span>
                </div>
              </div>
            );
          })}

          {/* Deleted items link card at the bottom */}
          <div
            data-testid="deleted-items-link"
            className="card card-interactive"
            onClick={onOpenDeleted}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              marginTop: '20px',
              borderStyle: 'dashed',
              background: 'transparent',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
              <span>🗑️</span>
              <span style={{ fontSize: '0.9375rem', fontWeight: 500 }}>Deleted Items</span>
            </div>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>Restore ›</span>
          </div>
        </div>
      )}
    </div>
  );
};
