import React, { useState, useEffect } from 'react';
import { api, Item } from '../api';

interface DeletedViewProps {
  onBack: () => void;
  onRestored: (item: Item) => void;
}

export const DeletedView: React.FC<DeletedViewProps> = ({
  onBack,
  onRestored,
}) => {
  const [deletedItems, setDeletedItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDeleted = async () => {
    try {
      setLoading(true);
      const res = await api.getDeletedItems(100);
      setDeletedItems(res.items);
    } catch {
      setDeletedItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDeleted();
  }, []);

  const handleRestore = async (item: Item) => {
    try {
      const restored = await api.restoreItem(item.id);
      setDeletedItems((prev) => prev.filter((it) => it.id !== item.id));
      onRestored(restored);
    } catch (err: any) {
      alert(err?.message || 'Failed to restore item');
    }
  };

  const formatDeletedDate = (dateStr?: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div data-testid="deleted-view">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <button
          type="button"
          data-testid="deleted-back-btn"
          className="btn btn-secondary btn-sm"
          onClick={onBack}
        >
          ‹ Lists
        </button>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700 }}>Deleted Items</h1>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          Items you soft-deleted can be restored at any time
        </p>
      </div>

      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading deleted items...
        </div>
      ) : deletedItems.length === 0 ? (
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
          Trash is empty. No deleted items found.
        </div>
      ) : (
        <div data-testid="deleted-items-container">
          {deletedItems.map((item) => (
            <div
              key={item.id}
              data-testid={`deleted-item-row-${item.id}`}
              className="card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{item.title}</div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Deleted: {formatDeletedDate(item.deleted_at)}
                </div>
              </div>

              <button
                type="button"
                data-testid={`restore-btn-${item.id}`}
                className="btn btn-secondary btn-sm"
                onClick={() => handleRestore(item)}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
