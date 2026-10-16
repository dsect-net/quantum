import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api, Item, List, ItemLinksResult } from '../api';
import {
  formatDue,
  isDateOnly,
  getTodayString,
  getTomorrowString,
  getNextWeekString,
  toDateInputValue,
} from '../date';
import { IconEdit, IconEye, IconTrash } from './Icons';

interface ItemDetailProps {
  itemId: string;
  lists: List[];
  onBack: () => void;
  onDeleted: (item: Item) => void;
}

export const ItemDetail: React.FC<ItemDetailProps> = ({
  itemId,
  lists,
  onBack,
  onDeleted,
}) => {
  const [item, setItem] = useState<Item | null>(null);
  const [links, setLinks] = useState<ItemLinksResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form edit states
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isEditingBody, setIsEditingBody] = useState(false);
  const [listId, setListId] = useState('');
  const [type, setType] = useState<'note' | 'task' | 'todo'>('note');
  const [status, setStatus] = useState<'open' | 'done' | 'archived'>('open');
  const [priority, setPriority] = useState<number | ''>('');
  const [dueAt, setDueAt] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  // Link addition state
  const [showAddLink, setShowAddLink] = useState(false);
  const [linkTargetType, setLinkTargetType] = useState<'internal' | 'external'>('internal');
  const [linkToItemId, setLinkToItemId] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkRelation, setLinkRelation] = useState<'spawned' | 'blocks' | 'related' | 'reference'>('related');
  const [allOtherItems, setAllOtherItems] = useState<Item[]>([]);

  // Autosave and status
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadDone = useRef(false);
  const titleTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const fetchItemAndLinks = async () => {
    try {
      setLoading(true);
      setError(null);
      const [fetchedItem, fetchedLinks] = await Promise.all([
        api.getItem(itemId, true),
        api.getItemLinks(itemId).catch(() => ({ outgoing: [], incoming: [] })),
      ]);
      setItem(fetchedItem);
      setLinks(fetchedLinks);

      setTitle(fetchedItem.title);
      setBody(fetchedItem.body || '');
      setListId(fetchedItem.list_id);
      setType(fetchedItem.type);
      setStatus(fetchedItem.status);
      setPriority(fetchedItem.priority ?? '');
      setDueAt(fetchedItem.due_at ? toDateInputValue(fetchedItem.due_at) : '');
      setTagsInput(fetchedItem.tags ? fetchedItem.tags.join(', ') : '');

      initialLoadDone.current = true;
    } catch (err: any) {
      setError(err?.message || 'Failed to load item');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (titleTextareaRef.current) {
      titleTextareaRef.current.style.height = 'auto';
      titleTextareaRef.current.style.height = `${titleTextareaRef.current.scrollHeight}px`;
    }
  }, [title]);

  useEffect(() => {
    fetchItemAndLinks();
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [itemId]);

  // Load other items for the link picker dropdown
  useEffect(() => {
    if (showAddLink && item) {
      api.search({ q: '', limit: 100 }).then((res) => {
        setAllOtherItems(res.results.map((r) => r.item).filter((it) => it.id !== item.id));
      });
    }
  }, [showAddLink, item]);

  // Debounced Autosave effect
  const triggerAutosave = (updatedFields: Record<string, any>) => {
    if (!initialLoadDone.current || !item) return;

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    setSaveStatus('Saving...');

    autosaveTimerRef.current = setTimeout(async () => {
      try {
        const updated = await api.updateItem(item.id, {
          ...updatedFields,
          autosave: true, // Coalesces in service layer (§13b.2)
        });
        setItem((prev) => (prev ? { ...prev, ...updated } : updated));
        setSaveStatus('Saved (autosave)');
        setTimeout(() => setSaveStatus(null), 2500);
      } catch (err: any) {
        setSaveStatus(`Autosave failed: ${err?.message}`);
      }
    }, 800);
  };

  // Explicit save affordance (always snapshots, autosave: false)
  const handleExplicitSave = async () => {
    if (!item) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    try {
      setSaveStatus('Saving snapshot...');
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const updated = await api.updateItem(item.id, {
        title: title.trim(),
        body: body.trim(),
        list: listId,
        type,
        status,
        priority: priority !== '' ? Number(priority) : null,
        due_at: dueAt ? (isDateOnly(dueAt) ? dueAt : (dueAt.includes('T') ? new Date(dueAt).toISOString() : dueAt)) : null,
        tags,
        autosave: false, // Explicit deliberate save -> snapshot!
      });

      // Refetch item with revisions
      const refreshed = await api.getItem(item.id, true);
      setItem(refreshed);
      setSaveStatus('Saved');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err: any) {
      setError(err?.message || 'Save failed');
      setSaveStatus(null);
    }
  };

  // Soft delete
  const handleDelete = async () => {
    if (!item) return;
    if (confirm('Move item to Deleted? You can undo or restore it later.')) {
      try {
        await api.deleteItem(item.id);
        onDeleted(item);
      } catch (err: any) {
        setError(err?.message || 'Delete failed');
      }
    }
  };

  // Add link handler
  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;

    try {
      await api.addItemLink(item.id, {
        to_item_id: linkTargetType === 'internal' ? linkToItemId : undefined,
        external_url: linkTargetType === 'external' ? linkUrl : undefined,
        relation: linkRelation,
      });

      const updatedLinks = await api.getItemLinks(item.id);
      setLinks(updatedLinks);
      setShowAddLink(false);
      setLinkUrl('');
      setLinkToItemId('');
    } catch (err: any) {
      alert(err?.message || 'Failed to add link');
    }
  };

  // America/New_York timezone formatter
  const formatNYTime = (isoString?: string | null) => {
    if (!isoString) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(new Date(isoString));
    } catch {
      return isoString;
    }
  };

  if (loading) {
    return <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading item details...</div>;
  }

  if (error || !item) {
    return (
      <div style={{ padding: '24px' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onBack} style={{ marginBottom: '16px' }}>
          ‹ Back
        </button>
        <div className="card" style={{ color: 'var(--danger)' }}>
          {error || 'Item not found'}
        </div>
      </div>
    );
  }

  const rawHtml = marked.parse(body || '*No content*');
  const sanitizedHtml = DOMPurify.sanitize(rawHtml as string);

  const isNoDate = !dueAt;
  const isTodayActive = dueAt === getTodayString();
  const isTomorrowActive = dueAt === getTomorrowString();
  const isNextWeekActive = dueAt === getNextWeekString();

  const handleSetDue = (val: string | null) => {
    const nextVal = val ? val.trim() : '';
    setDueAt(nextVal);
    triggerAutosave({ due_at: nextVal || null });
  };

  return (
    <div data-testid="item-detail-view">
      {/* Top action bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <button
          type="button"
          data-testid="item-back-btn"
          className="btn btn-secondary btn-sm"
          onClick={onBack}
        >
          ‹ Back
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {saveStatus && (
            <span
              data-testid="save-status"
              style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}
            >
              {saveStatus}
            </span>
          )}

          <button
            type="button"
            data-testid="item-explicit-save-btn"
            className="btn btn-black btn-sm"
            onClick={handleExplicitSave}
          >
            Save
          </button>
        </div>
      </div>

      {/* Main card */}
      <div className="card">
        {/* Title textarea (autosaves on change, auto-wraps, full-width) */}
        <div className="form-group" style={{ marginBottom: '16px' }}>
          <textarea
            ref={titleTextareaRef}
            data-testid="item-title-input"
            className="form-input"
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              lineHeight: 1.3,
              minHeight: '44px',
              width: '100%',
              resize: 'none',
              overflow: 'hidden',
            }}
            rows={1}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
              triggerAutosave({ title: e.target.value });
            }}
            placeholder="Title"
          />
        </div>

        {/* Meta Card container per Brief reference mockup-01 */}
        <div
          className="detail-meta-card"
          style={{
            background: 'var(--bg-app)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            padding: '14px',
            marginBottom: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {/* Row 1: List (Full-Width) */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">List</label>
            <select
              className="form-select"
              data-testid="item-list-select"
              value={listId}
              onChange={async (e) => {
                const newListId = e.target.value;
                setListId(newListId);
                try {
                  await api.moveItem(item.id, newListId);
                  setSaveStatus('Moved list');
                  setTimeout(() => setSaveStatus(null), 2000);
                } catch (err: any) {
                  setError(err?.message || 'Move failed');
                }
              }}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          {/* Row 2: Status & Type (2 columns) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Status</label>
              <select
                className="form-select"
                data-testid="item-status-select"
                value={status}
                onChange={(e) => {
                  const newStatus = e.target.value as any;
                  setStatus(newStatus);
                  triggerAutosave({ status: newStatus });
                }}
              >
                <option value="open">Open</option>
                <option value="done">Done</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Type</label>
              <select
                className="form-select"
                data-testid="item-type-select"
                value={type}
                onChange={(e) => {
                  const newType = e.target.value as any;
                  setType(newType);
                  triggerAutosave({ type: newType });
                }}
              >
                <option value="note">Note</option>
                <option value="task">Task</option>
                <option value="todo">Todo</option>
              </select>
            </div>
          </div>

          {/* Row 3: Priority (Full-Width) */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Priority</label>
            <select
              className="form-select"
              data-testid="item-priority-select"
              value={priority}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null;
                setPriority(val ?? '');
                triggerAutosave({ priority: val });
              }}
            >
              <option value="">None</option>
              <option value="1">1 - Urgent</option>
              <option value="2">2 - High</option>
              <option value="3">3 - Medium</option>
              <option value="4">4 - Low</option>
            </select>
          </div>

          {/* Row 4: Due Date (Full-Width with Quick Chips + Native Date Input) */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Due Date</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
              <button
                type="button"
                className={`btn btn-sm ${isNoDate ? 'btn-black' : 'btn-secondary'}`}
                style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: 'var(--radius-pill)' }}
                onClick={() => handleSetDue(null)}
              >
                No date
              </button>
              <button
                type="button"
                className={`btn btn-sm ${isTodayActive ? 'btn-black' : 'btn-secondary'}`}
                style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: 'var(--radius-pill)' }}
                onClick={() => handleSetDue(getTodayString())}
              >
                Today
              </button>
              <button
                type="button"
                className={`btn btn-sm ${isTomorrowActive ? 'btn-black' : 'btn-secondary'}`}
                style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: 'var(--radius-pill)' }}
                onClick={() => handleSetDue(getTomorrowString())}
              >
                Tomorrow
              </button>
              <button
                type="button"
                className={`btn btn-sm ${isNextWeekActive ? 'btn-black' : 'btn-secondary'}`}
                style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: 'var(--radius-pill)' }}
                onClick={() => handleSetDue(getNextWeekString())}
              >
                Next week
              </button>
            </div>
            <input
              type="date"
              data-testid="item-due-input"
              className="form-input"
              value={dueAt}
              onChange={(e) => handleSetDue(e.target.value)}
            />
          </div>

          {/* Row 5: Tags (Full-Width) */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Tags</label>
            <input
              type="text"
              data-testid="item-tags-input"
              className="form-input"
              value={tagsInput}
              onChange={(e) => {
                setTagsInput(e.target.value);
                const tags = e.target.value
                  .split(',')
                  .map((t) => t.trim())
                  .filter((t) => t.length > 0);
                triggerAutosave({ tags });
              }}
              placeholder="comma separated tags"
            />
          </div>
        </div>

        {/* Body (Markdown rendering + in-place click to edit + toggle preview button) */}
        <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <label className="form-label" style={{ marginBottom: 0 }}>
              Body
            </label>
            <button
              type="button"
              data-testid="toggle-edit-body-btn"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const next = !isEditingBody;
                setIsEditingBody(next);
                if (next) {
                  setTimeout(() => bodyTextareaRef.current?.focus(), 50);
                }
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {isEditingBody ? (
                <>
                  <IconEye size={14} /> Preview
                </>
              ) : (
                <>
                  <IconEdit size={14} /> Edit
                </>
              )}
            </button>
          </div>

          {isEditingBody ? (
            <textarea
              ref={bodyTextareaRef}
              className="form-textarea"
              data-testid="item-body-textarea"
              style={{ minHeight: '160px' }}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                triggerAutosave({ body: e.target.value });
              }}
              placeholder="Write Markdown..."
            />
          ) : (
            <div
              className="markdown-body"
              data-testid="item-body-rendered"
              onClick={() => {
                setIsEditingBody(true);
                setTimeout(() => bodyTextareaRef.current?.focus(), 50);
              }}
              style={{
                minHeight: '60px',
                padding: '8px 10px',
                borderRadius: 'var(--radius-btn)',
                cursor: 'pointer',
                background: 'var(--bg-app)',
                border: '1px dashed var(--border-color)',
                transition: 'border-color 0.15s ease, background-color 0.15s ease',
              }}
              title="Click to edit body"
            >
              {body.trim() ? (
                <div dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
              ) : (
                <p style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '0.875rem' }}>
                  Tap here to write notes (Markdown supported)...
                </p>
              )}
            </div>
          )}
        </div>

        {/* Metadata in America/New_York */}
        <div
          data-testid="item-metadata"
          style={{
            marginTop: '20px',
            paddingTop: '14px',
            borderTop: '1px solid var(--border-color)',
            fontSize: '0.8125rem',
            color: 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div>
            <strong>Author:</strong> {item.author || 'scotty'}
          </div>
          <div>
            <strong>Created:</strong> {formatNYTime(item.created_at)}
          </div>
          <div>
            <strong>Updated:</strong> {formatNYTime(item.updated_at)}
          </div>
          {item.due_at && (
            <div>
              <strong>Due:</strong> {formatDue(item.due_at)?.formatted}
            </div>
          )}
          {item.completed_at && (
            <div>
              <strong>Completed:</strong> {formatNYTime(item.completed_at)}
            </div>
          )}
        </div>

        {/* Soft Delete */}
        <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            data-testid="delete-item-btn"
            className="btn btn-danger btn-sm"
            onClick={handleDelete}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <IconTrash size={14} /> Delete Item
          </button>
        </div>
      </div>

      {/* Linked Items & URLs Section */}
      <div className="card" style={{ marginTop: '16px' }} data-testid="links-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Linked Items & Resources</h3>
          <button
            type="button"
            data-testid="open-add-link-btn"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowAddLink(!showAddLink)}
          >
            {showAddLink ? 'Cancel' : '＋ Link'}
          </button>
        </div>

        {showAddLink && (
          <form
            onSubmit={handleAddLink}
            data-testid="add-link-form"
            style={{
              padding: '12px',
              background: 'var(--bg-muted)',
              borderRadius: 'var(--radius-btn)',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label className="form-label">Link Type</label>
                <select
                  className="form-select"
                  data-testid="link-type-select"
                  value={linkTargetType}
                  onChange={(e) => setLinkTargetType(e.target.value as any)}
                >
                  <option value="internal">Another Item</option>
                  <option value="external">External URL</option>
                </select>
              </div>

              <div>
                <label className="form-label">Relation</label>
                <select
                  className="form-select"
                  data-testid="link-relation-select"
                  value={linkRelation}
                  onChange={(e) => setLinkRelation(e.target.value as any)}
                >
                  <option value="related">related</option>
                  <option value="spawned">spawned</option>
                  <option value="blocks">blocks</option>
                  <option value="reference">reference</option>
                </select>
              </div>
            </div>

            {linkTargetType === 'internal' ? (
              <div className="form-group">
                <label className="form-label">Select Target Item</label>
                <select
                  className="form-select"
                  data-testid="link-target-item-select"
                  value={linkToItemId}
                  onChange={(e) => setLinkToItemId(e.target.value)}
                  required
                >
                  <option value="">-- Choose item --</option>
                  {allOtherItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.title} ({it.type})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label">External URL</label>
                <input
                  type="url"
                  className="form-input"
                  data-testid="link-url-input"
                  placeholder="https://..."
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  required
                />
              </div>
            )}

            <button type="submit" data-testid="submit-link-btn" className="btn btn-black btn-sm">
              Save Link
            </button>
          </form>
        )}

        {/* Outgoing links */}
        <div style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
            OUTGOING LINKS ({links?.outgoing.length ?? 0})
          </div>
          {(!links || links.outgoing.length === 0) ? (
            <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)' }}>No outgoing links.</p>
          ) : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {links.outgoing.map((l) => (
                <li
                  key={l.id}
                  style={{
                    fontSize: '0.875rem',
                    padding: '8px 12px',
                    background: 'var(--bg-app)',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <span className="badge" style={{ marginRight: '8px' }}>
                      {l.relation}
                    </span>
                    {l.external_url ? (
                      <a href={l.external_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-violet)' }}>
                        {l.external_url}
                      </a>
                    ) : (
                      <span>
                        {l.target?.title || '[Target Item]'} {l.target?.deleted && <span style={{ color: 'var(--danger)' }}>(deleted)</span>}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Incoming backlinks */}
        <div>
          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
            BACKLINKS ({links?.incoming.length ?? 0})
          </div>
          {(!links || links.incoming.length === 0) ? (
            <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)' }}>No incoming backlinks.</p>
          ) : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {links.incoming.map((l) => (
                <li
                  key={l.id}
                  style={{
                    fontSize: '0.875rem',
                    padding: '8px 12px',
                    background: 'var(--bg-app)',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <span className="badge" style={{ marginRight: '8px' }}>
                      {l.relation}
                    </span>
                    <span>
                      From: {l.source?.title || '[Source Item]'} {l.source?.deleted && <span style={{ color: 'var(--danger)' }}>(deleted)</span>}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Revision History Section */}
      <div className="card" style={{ marginTop: '16px' }} data-testid="revisions-section">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px' }}>
          Revision History ({item.revisions?.length ?? 0})
        </h3>
        {(!item.revisions || item.revisions.length === 0) ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)' }}>No revisions recorded yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {item.revisions.map((rev, idx) => (
              <div
                key={rev.id || idx}
                style={{
                  fontSize: '0.8125rem',
                  padding: '8px 10px',
                  background: 'var(--bg-app)',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <span className="badge" style={{ marginRight: '8px', textTransform: 'uppercase' }}>
                    {rev.kind}
                  </span>
                  <span>by <strong>{rev.author}</strong></span>
                </div>
                <span style={{ color: 'var(--text-muted)' }}>{formatNYTime(rev.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
