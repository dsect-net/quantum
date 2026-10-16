import React, { useState } from 'react';
import { Item, List } from '../api';

interface ListViewProps {
  list: List;
  items: Item[];
  loading: boolean;
  onBack: () => void;
  onToggleComplete: (item: Item) => void;
  onSelectItem: (itemId: string) => void;
  onOpenCapture: (listId: string) => void;
}

export const ListView: React.FC<ListViewProps> = ({
  list,
  items,
  loading,
  onBack,
  onToggleComplete,
  onSelectItem,
  onOpenCapture,
}) => {
  const [showDone, setShowDone] = useState(false);

  const openItems = items.filter((it) => it.status !== 'done');
  const doneItems = items.filter((it) => it.status === 'done');

  const formatDue = (dueAt: string | null) => {
    if (!dueAt) return null;
    const date = new Date(dueAt);
    const now = new Date();
    const isPast = date.getTime() < now.getTime();
    const formatted = date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    return { formatted, isPast };
  };

  const renderItemRow = (item: Item) => {
    const isCompleted = item.status === 'done';
    const isTaskOrTodo = item.type === 'task' || item.type === 'todo';
    const dueInfo = formatDue(item.due_at);

    return (
      <div
        key={item.id}
        data-testid={`item-row-${item.id}`}
        className="item-row"
        onClick={() => onSelectItem(item.id)}
      >
        {isTaskOrTodo ? (
          <input
            type="checkbox"
            className="item-checkbox"
            data-testid={`checkbox-${item.id}`}
            checked={isCompleted}
            onChange={(e) => {
              e.stopPropagation();
              onToggleComplete(item);
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Toggle completion for ${item.title}`}
          />
        ) : (
          <div
            style={{
              width: '18px',
              height: '18px',
              marginTop: '3px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-dim)',
              fontSize: '0.75rem',
            }}
          >
            📝
          </div>
        )}

        <div className="item-row-content">
          <div
            className={`item-row-title ${isCompleted ? 'completed' : ''}`}
            data-testid={`item-title-${item.id}`}
          >
            {item.title}
          </div>

          {item.body && <div className="item-row-snippet">{item.body}</div>}

          <div className="item-row-meta">
            {dueInfo && (
              <span
                className={`badge ${dueInfo.isPast && !isCompleted ? 'badge-due-overdue' : 'badge-due-today'}`}
              >
                Due: {dueInfo.formatted}
              </span>
            )}

            {item.priority && (
              <span className="badge">P{item.priority}</span>
            )}

            {item.tags &&
              item.tags.map((t) => (
                <span key={t} className="badge">
                  #{t}
                </span>
              ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div data-testid="list-view">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <button
          type="button"
          data-testid="list-back-btn"
          className="btn btn-secondary btn-sm"
          onClick={onBack}
        >
          ‹ Lists
        </button>

        <button
          type="button"
          data-testid="list-add-item-btn"
          className="btn btn-black btn-sm"
          onClick={() => onOpenCapture(list.id)}
        >
          ＋ Add
        </button>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700 }}>{list.name}</h1>
          {list.private === 1 && <span title="Private list">🔒</span>}
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          {openItems.length} open {openItems.length === 1 ? 'item' : 'items'}
        </p>
      </div>

      {loading && items.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading items...
        </div>
      ) : (
        <>
          {openItems.length === 0 && doneItems.length === 0 ? (
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
              <p style={{ fontWeight: 600, marginBottom: '6px' }}>No items in this list yet</p>
              <p style={{ fontSize: '0.875rem' }}>Tap "＋ Add" above to capture a thought or task.</p>
            </div>
          ) : (
            <div data-testid="open-items-container">
              {openItems.map(renderItemRow)}
            </div>
          )}

          {doneItems.length > 0 && (
            <div style={{ marginTop: '24px' }}>
              <button
                type="button"
                data-testid="toggle-done-btn"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowDone(!showDone)}
                style={{ width: '100%', justifyContent: 'space-between', marginBottom: '8px' }}
              >
                <span>Done ({doneItems.length})</span>
                <span>{showDone ? '▲ Hide' : '▼ Show'}</span>
              </button>

              {showDone && (
                <div data-testid="done-items-container" style={{ opacity: 0.85 }}>
                  {doneItems.map(renderItemRow)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
