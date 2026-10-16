import React, { useState, useEffect } from 'react';
import { api, List } from '../api';
import { classifyDueBucket } from '../date';
import { IconCalendar, IconGear, IconLock, IconTrash } from './Icons';

interface ListHomeProps {
  lists: List[];
  loading: boolean;
  onSelectList: (listId: string) => void;
  onOpenCapture?: () => void;
  onOpenDeleted: () => void;
  onNavigateDue?: () => void;
  onOpenSettings?: () => void;
}

export const ListHome: React.FC<ListHomeProps> = ({
  lists,
  loading,
  onSelectList,
  onOpenDeleted,
  onNavigateDue,
  onOpenSettings,
}) => {
  const [dueSummary, setDueSummary] = useState<{ today: number; overdue: number } | null>(null);

  // Ensure "Ideas & Tasks" is placed first (inbox)
  const sortedLists = [...lists].sort((a, b) => {
    if (a.name === 'Ideas & Tasks') return -1;
    if (b.name === 'Ideas & Tasks') return 1;
    return a.sort_order - b.sort_order;
  });

  // Load due summary (Today & Overdue counts across lists)
  useEffect(() => {
    let active = true;
    const loadDueSummary = async () => {
      if (lists.length === 0) {
        setDueSummary(null);
        return;
      }
      try {
        const itemPromises = lists.map((l) =>
          api.getListItems(l.id, { status: 'open', limit: 100 }).catch(() => ({ items: [], total: 0 }))
        );
        const results = await Promise.all(itemPromises);
        const allOpen = results.flatMap((r) => r.items);
        let todayCount = 0;
        let overdueCount = 0;
        for (const it of allOpen) {
          if (!it.due_at) continue;
          const bucket = classifyDueBucket(it.due_at);
          if (bucket === 'today') todayCount++;
          else if (bucket === 'overdue') overdueCount++;
        }
        if (active) {
          setDueSummary({ today: todayCount, overdue: overdueCount });
        }
      } catch {
        // ignore
      }
    };

    loadDueSummary();
    return () => {
      active = false;
    };
  }, [lists]);

  return (
    <div data-testid="lists-home">
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>Lists</h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Capture, organize, and review</p>
      </div>

      {/* Home Summary Strip per Fold-in (a) */}
      {dueSummary !== null && (
        <div
          data-testid="home-due-summary-strip"
          onClick={onNavigateDue}
          className="card card-interactive"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            marginBottom: '16px',
            cursor: onNavigateDue ? 'pointer' : 'default',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: 'var(--accent-violet)', display: 'inline-flex', alignItems: 'center' }}>
              <IconCalendar size={18} />
            </span>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-main)', fontWeight: 500 }}>
              Today: <strong style={{ fontWeight: 700 }}>{dueSummary.today}</strong> · Overdue:{' '}
              <strong style={{ fontWeight: 700, color: dueSummary.overdue > 0 ? 'var(--danger)' : 'inherit' }}>
                {dueSummary.overdue}
              </strong>
            </span>
          </div>
          {onNavigateDue && (
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              Due view ›
            </span>
          )}
        </div>
      )}

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
                  padding: '14px 16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{list.name}</span>
                  {list.private === 1 && (
                    <span title="Private list" data-testid="lock-glyph" style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--text-muted)' }}>
                      <IconLock size={15} />
                    </span>
                  )}
                  {isInbox && <span className="badge badge-inbox">Inbox</span>}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="badge">{openCount} open</span>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>›</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer entries: Deleted and Settings */}
      <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'space-between' }}>
        <button
          type="button"
          data-testid="home-open-deleted-btn"
          className="btn btn-secondary btn-sm"
          onClick={onOpenDeleted}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <IconTrash size={15} />
          <span>Recently Deleted</span>
        </button>

        {onOpenSettings && (
          <button
            type="button"
            data-testid="home-open-settings-btn"
            className="btn btn-secondary btn-sm"
            onClick={onOpenSettings}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <IconGear size={15} />
            <span>Settings</span>
          </button>
        )}
      </div>
    </div>
  );
};
