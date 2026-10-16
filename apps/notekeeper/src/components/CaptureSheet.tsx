import React, { useState, useEffect, useRef } from 'react';
import { api, List, Item } from '../api';

interface CaptureSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (item: Item) => void;
  lists: List[];
  defaultListId?: string;
}

export const CaptureSheet: React.FC<CaptureSheetProps> = ({
  isOpen,
  onClose,
  onSaved,
  lists,
  defaultListId,
}) => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [listId, setListId] = useState(defaultListId || '');
  const [type, setType] = useState<'note' | 'task' | 'todo'>('note');
  const [priority, setPriority] = useState<number | ''>('');
  const [dueAt, setDueAt] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setBody('');
      // Default to given list, or inbox ('Ideas & Tasks'), or first list
      const inbox = lists.find((l) => l.name === 'Ideas & Tasks') || lists[0];
      setListId(defaultListId || (inbox ? inbox.id : ''));
      setType('note');
      setPriority('');
      setDueAt('');
      setTagsInput('');
      setError(null);
      setTimeout(() => {
        titleInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, defaultListId, lists]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const item = await api.createItem({
        title: title.trim(),
        body: body.trim(),
        list: listId || undefined,
        type,
        priority: priority !== '' ? Number(priority) : null,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        tags: tags.length > 0 ? tags : undefined,
        author: 'scotty',
      });

      onSaved(item);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save item');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} data-testid="capture-sheet-overlay">
      <div className="bottom-sheet" onClick={(e) => e.stopPropagation()} data-testid="capture-sheet">
        <div className="sheet-header">
          <h2 className="sheet-title">New Item</h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: '8px 12px',
              background: '#fef2f2',
              color: '#b91c1c',
              borderRadius: '8px',
              marginBottom: '12px',
              fontSize: '0.875rem',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} data-testid="capture-form">
          <div className="form-group">
            <label className="form-label" htmlFor="capture-title">
              Title *
            </label>
            <input
              id="capture-title"
              data-testid="capture-title-input"
              ref={titleInputRef}
              type="text"
              className="form-input"
              placeholder="What's on your mind?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="capture-body">
              Body
            </label>
            <textarea
              id="capture-body"
              data-testid="capture-body-input"
              className="form-textarea"
              placeholder="Add details (Markdown supported)..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="capture-list">
                List
              </label>
              <select
                id="capture-list"
                data-testid="capture-list-select"
                className="form-select"
                value={listId}
                onChange={(e) => setListId(e.target.value)}
              >
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} {l.private ? '🔒' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="capture-type">
                Type
              </label>
              <select
                id="capture-type"
                data-testid="capture-type-select"
                className="form-select"
                value={type}
                onChange={(e) => setType(e.target.value as any)}
              >
                <option value="note">Note</option>
                <option value="task">Task</option>
                <option value="todo">Todo</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="capture-due">
                Due Date
              </label>
              <input
                id="capture-due"
                data-testid="capture-due-input"
                type="datetime-local"
                className="form-input"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="capture-priority">
                Priority
              </label>
              <select
                id="capture-priority"
                data-testid="capture-priority-select"
                className="form-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">None</option>
                <option value="1">1 - Urgent</option>
                <option value="2">2 - High</option>
                <option value="3">3 - Medium</option>
                <option value="4">4 - Low</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="capture-tags">
              Tags (comma separated)
            </label>
            <input
              id="capture-tags"
              data-testid="capture-tags-input"
              type="text"
              className="form-input"
              placeholder="e.g. quantum, ideas, fleet"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
          </div>

          <div style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              data-testid="capture-save-btn"
              className="btn btn-black"
              disabled={saving}
              style={{ minWidth: '100px' }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
