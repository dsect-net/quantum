import React, { useState, useEffect, useRef } from 'react';
import { api, List, Item } from '../api';
import { DueDatePicker } from './DueDatePicker';

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
  const [type, setType] = useState<'note' | 'task' | 'todo'>('todo');
  const [priority, setPriority] = useState<number | ''>('');
  const [dueAt, setDueAt] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setBody('');
      // Default to inbox ('Ideas & Tasks') or defaultListId or first list
      const inbox = lists.find((l) => l.name === 'Ideas & Tasks') || lists[0];
      setListId(defaultListId || (inbox ? inbox.id : ''));
      setType('todo');
      setPriority('');
      setDueAt('');
      setTagsInput('');
      setIsExpanded(false);
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
        due_at: dueAt.trim() ? dueAt.trim() : null,
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
          {/* Primary single field: Title (autofocused) */}
          <div className="form-group" style={{ marginBottom: '14px' }}>
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

          {/* More options expander */}
          <div style={{ marginBottom: '16px' }}>
            <button
              type="button"
              data-testid="capture-more-options-btn"
              className="btn btn-secondary btn-sm"
              onClick={() => setIsExpanded(!isExpanded)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <span>{isExpanded ? 'Fewer options' : 'More options'}</span>
              <span>{isExpanded ? '▴' : '▾'}</span>
            </button>
          </div>

          {isExpanded && (
            <div
              data-testid="capture-more-options-container"
              style={{
                background: 'var(--bg-app)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-card)',
                padding: '14px',
                marginBottom: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              {/* Body */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="capture-body">
                  Body (Markdown supported)
                </label>
                <textarea
                  id="capture-body"
                  data-testid="capture-body-input"
                  className="form-textarea"
                  placeholder="Add details..."
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  style={{ minHeight: '80px' }}
                />
              </div>

              {/* List */}
              <div className="form-group" style={{ marginBottom: 0 }}>
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
                      {l.name} {l.private ? '(Private)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Type and Priority 2-column row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
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
                    <option value="todo">Todo</option>
                    <option value="task">Task</option>
                    <option value="note">Note</option>
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
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
                    <option value="0">P0 - Critical</option>
                    <option value="1">P1 - Urgent</option>
                    <option value="2">P2 - High</option>
                    <option value="3">P3 - Normal</option>
                  </select>
                </div>
              </div>

              {/* Due Date using shared DueDatePicker */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="capture-due">
                  Due Date
                </label>
                <DueDatePicker
                  id="capture-due"
                  testId="capture-due-input"
                  value={dueAt}
                  onChange={(val) => setDueAt(val || '')}
                />
              </div>

              {/* Tags */}
              <div className="form-group" style={{ marginBottom: 0 }}>
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
            </div>
          )}

          {/* Action buttons: Save immediately usable */}
          <div style={{ marginTop: '16px', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
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
