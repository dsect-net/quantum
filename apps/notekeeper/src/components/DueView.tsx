import React, { useState, useEffect } from 'react';
import { api, Item, List } from '../api';
import { classifyDueBucket, formatDue, isDateOnly } from '../date';

interface DueViewProps {
  lists: List[];
  onSelectItem: (itemId: string) => void;
  onToggleComplete: (item: Item) => void;
}

export const DueView: React.FC<DueViewProps> = ({
  lists,
  onSelectItem,
  onToggleComplete,
}) => {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch all open items across lists
  useEffect(() => {
    const fetchAllDue = async () => {
      try {
        setLoading(true);
        const itemPromises = lists.map((l) =>
          api.getListItems(l.id, { status: 'open', limit: 100 }).catch(() => ({ items: [], total: 0 }))
        );
        const results = await Promise.all(itemPromises);
        const allOpen = results.flatMap((r) => r.items);
        const dueOnly = allOpen.filter((it) => it.due_at !== null && it.due_at !== undefined);
        setItems(dueOnly);
      } finally {
        setLoading(false);
      }
    };

    if (lists.length > 0) {
      fetchAllDue();
    }
  }, [lists]);

  // Group into buckets using local calendar date classification
  const overdue: Item[] = [];
  const today: Item[] = [];
  const thisWeek: Item[] = [];
  const later: Item[] = [];

  for (const it of items) {
    if (!it.due_at) continue;
    const bucket = classifyDueBucket(it.due_at);
    if (bucket === 'overdue') {
      overdue.push(it);
    } else if (bucket === 'today') {
      today.push(it);
    } else if (bucket === 'this_week') {
      thisWeek.push(it);
    } else if (bucket === 'later') {
      later.push(it);
    }
  }

  // Sort each bucket by due_at ascending
  const getSortTime = (dueAt: string) => {
    if (isDateOnly(dueAt)) {
      const [y, m, d] = dueAt.split('-').map(Number);
      return new Date(y, m - 1, d).getTime();
    }
    return new Date(dueAt).getTime();
  };

  const sortByDue = (a: Item, b: Item) => getSortTime(a.due_at!) - getSortTime(b.due_at!);
  overdue.sort(sortByDue);
  today.sort(sortByDue);
  thisWeek.sort(sortByDue);
  later.sort(sortByDue);

  const renderSection = (title: string, sectionItems: Item[], testId: string, badgeClass?: string) => {
    return (
      <div style={{ marginBottom: '24px' }} data-testid={testId}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>{title}</h2>
          <span className={`badge ${badgeClass || ''}`} style={{ fontWeight: 600 }}>
            {sectionItems.length}
          </span>
        </div>

        {sectionItems.length === 0 ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)', fontStyle: 'italic', marginBottom: '8px' }}>
            No items in {title.toLowerCase()}.
          </p>
        ) : (
          <div>
            {sectionItems.map((item) => (
              <div
                key={item.id}
                data-testid={`due-item-${item.id}`}
                className="item-row"
                onClick={() => onSelectItem(item.id)}
              >
                <input
                  type="checkbox"
                  className="item-checkbox"
                  checked={item.status === 'done'}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleComplete(item);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Toggle completion for ${item.title}`}
                />
                <div className="item-row-content">
                  <div className="item-row-title">{item.title}</div>
                  <div className="item-row-meta">
                    {(() => {
                      const dueInfo = formatDue(item.due_at);
                      if (!dueInfo) return null;
                      const isOverdue = item.status !== 'done' && dueInfo.isPast;
                      const isToday = item.status !== 'done' && dueInfo.isToday;
                      const dueBadgeClass = isOverdue ? 'badge-due-overdue' : (isToday ? 'badge-due-today' : '');
                      return (
                        <span className={`badge ${dueBadgeClass}`}>
                          Due: {dueInfo.formatted}
                        </span>
                      );
                    })()}
                    {item.priority && <span className="badge">P{item.priority}</span>}
                    <span className="badge">{item.type}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div data-testid="due-view">
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '6px', letterSpacing: '-0.02em' }}>
        Due Schedule
      </h1>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
        Track upcoming commitments across all lists
      </p>

      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading schedule...
        </div>
      ) : items.length === 0 ? (
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
          <p style={{ fontWeight: 600, marginBottom: '6px' }}>No items with due dates</p>
          <p style={{ fontSize: '0.875rem' }}>Set a due date when capturing or editing items to see them here.</p>
        </div>
      ) : (
        <div data-testid="due-sections-container">
          {renderSection('Overdue', overdue, 'section-overdue', 'badge-due-overdue')}
          {renderSection('Today', today, 'section-today', 'badge-due-today')}
          {renderSection('This week', thisWeek, 'section-this-week')}
          {renderSection('Later', later, 'section-later')}
        </div>
      )}
    </div>
  );
};
