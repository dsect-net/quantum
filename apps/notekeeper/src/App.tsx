import React, { useState, useEffect, useCallback } from 'react';
import { api, List, Item } from './api';
import { ListHome } from './components/ListHome';
import { ListView } from './components/ListView';
import { ItemDetail } from './components/ItemDetail';
import { CaptureSheet } from './components/CaptureSheet';
import { SearchView } from './components/SearchView';
import { DueView } from './components/DueView';
import { DeletedView } from './components/DeletedView';
import { SettingsView } from './components/SettingsView';
import { CompletionStyle } from './components/ItemCheckbox';
import {
  IconAlert,
  IconNotebook,
  IconFolder,
  IconCalendar,
  IconSearch,
  IconGear,
} from './components/Icons';

export type MainTab = 'lists' | 'due' | 'search';
export type ActiveView = 'home' | 'list' | 'item' | 'deleted' | 'settings';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<MainTab>('lists');
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // Completion animation style preference (persisted in localStorage)
  const [completionStyle, setCompletionStyle] = useState<CompletionStyle>(() => {
    try {
      const saved = localStorage.getItem('notekeeper:completion_style');
      if (saved === 'pop' || saved === 'sweep' || saved === 'minimal') {
        return saved;
      }
    } catch {
      // ignore
    }
    return 'pop';
  });

  const handleSetCompletionStyle = (style: CompletionStyle) => {
    setCompletionStyle(style);
    try {
      localStorage.setItem('notekeeper:completion_style', style);
    } catch {
      // ignore
    }
  };

  const [lists, setLists] = useState<List[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);

  // List view items
  const [currentListItems, setCurrentListItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // Capture sheet
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [captureDefaultListId, setCaptureDefaultListId] = useState<string | undefined>();

  // Offline detection
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // Toast notification (e.g. undo delete)
  const [toast, setToast] = useState<{ message: string; onUndo?: () => void } | null>(null);

  // Load lists
  const loadLists = useCallback(async () => {
    try {
      setLoadingLists(true);
      const data = await api.getLists();
      setLists(data);
    } catch {
      // ignore
    } finally {
      setLoadingLists(false);
    }
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  // URL query param routing for Item detail view
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const itemParam = params.get('item');
    if (itemParam) {
      setActiveItemId(itemParam);
      setActiveView('item');
    }

    const handlePopState = () => {
      const p = new URLSearchParams(window.location.search);
      const item = p.get('item');
      if (item) {
        setActiveItemId(item);
        setActiveView('item');
      } else {
        setActiveItemId(null);
        setActiveView('home');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateToItem = (id: string) => {
    setActiveItemId(id);
    setActiveView('item');
    window.history.pushState(null, '', `?item=${encodeURIComponent(id)}`);
  };

  const navigateBackFromItem = () => {
    window.history.pushState(null, '', window.location.pathname);
    if (activeListId) {
      setActiveView('list');
      loadListItems(activeListId);
    } else {
      setActiveView('home');
    }
    loadLists();
  };

  // Offline listener
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load items for active list
  const loadListItems = useCallback(async (listId: string) => {
    try {
      setLoadingItems(true);
      const res = await api.getListItems(listId, { limit: 100 });
      setCurrentListItems(res.items);
    } catch {
      setCurrentListItems([]);
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    if (activeView === 'list' && activeListId) {
      loadListItems(activeListId);
    }
  }, [activeView, activeListId, loadListItems]);

  // Toggle item complete/reopen
  const handleToggleComplete = async (item: Item) => {
    try {
      const isDone = item.status === 'done';
      const updated = isDone
        ? await api.reopenItem(item.id)
        : await api.completeItem(item.id);

      setCurrentListItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, ...updated } : it))
      );
      // Refresh list counts
      loadLists();
    } catch (err: any) {
      alert(err?.message || 'Failed to update item status');
    }
  };

  // Soft delete item with undo toast
  const handleItemDeleted = (item: Item) => {
    setToast({
      message: `"${item.title}" moved to Deleted.`,
      onUndo: async () => {
        try {
          await api.restoreItem(item.id);
          setToast(null);
          loadLists();
          if (activeListId) loadListItems(activeListId);
        } catch {
          // ignore
        }
      },
    });
    setTimeout(() => {
      setToast((prev) => (prev?.message.includes(item.title) ? null : prev));
    }, 6000);

    // Return to list view or home
    if (activeListId) {
      setActiveView('list');
      loadListItems(activeListId);
    } else {
      setActiveView('home');
    }
    loadLists();
  };

  const handleOpenCapture = (defaultList?: string) => {
    setCaptureDefaultListId(defaultList || activeListId || undefined);
    setIsCaptureOpen(true);
  };

  const handleItemSaved = (item: Item) => {
    loadLists();
    if (activeView === 'list' && activeListId === item.list_id) {
      setCurrentListItems((prev) => [item, ...prev]);
    }
  };

  const currentList = lists.find((l) => l.id === activeListId);
  const viewKey = `${activeTab}-${activeView}-${activeListId || ''}-${activeItemId || ''}`;

  return (
    <div className="app-viewport" data-completion-style={completionStyle}>
      <div className={`app-container completion-style-${completionStyle}`} data-completion-style={completionStyle}>
        {/* Offline banner */}
        {isOffline && (
          <div className="offline-banner" data-testid="offline-banner">
            <span style={{ display: 'inline-flex', alignItems: 'center' }}><IconAlert size={16} /></span> You're offline — changes can't be saved right now.
          </div>
        )}

        {/* Global header */}
        <header className="app-header">
          <div className="app-brand">
            <span style={{ display: 'inline-flex', alignItems: 'center' }}><IconNotebook size={18} /></span>
            <span className="app-title">Notekeeper</span>
          </div>

          <button
            type="button"
            data-testid="header-settings-btn"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setActiveTab('lists');
              setActiveView('settings');
            }}
            aria-label="Settings"
            title="Settings"
            style={{ padding: '6px 8px', borderRadius: 'var(--radius-btn)' }}
          >
            <IconGear size={16} />
          </button>
        </header>

        {/* Main Content with subtle page transitions */}
        <main className="app-content">
          <div key={viewKey} className="view-transition">
            {activeTab === 'lists' && (
              <>
                {activeView === 'home' && (
                  <ListHome
                    lists={lists}
                    loading={loadingLists}
                    onSelectList={(id) => {
                      setActiveListId(id);
                      setActiveView('list');
                    }}
                    onOpenDeleted={() => setActiveView('deleted')}
                    onNavigateDue={() => setActiveTab('due')}
                    onOpenSettings={() => {
                      setActiveTab('lists');
                      setActiveView('settings');
                    }}
                  />
                )}

                {activeView === 'list' && currentList && (
                  <ListView
                    list={currentList}
                    items={currentListItems}
                    loading={loadingItems}
                    onBack={() => {
                      setActiveView('home');
                      loadLists();
                    }}
                    onToggleComplete={handleToggleComplete}
                    onSelectItem={(id) => navigateToItem(id)}
                    onOpenCapture={(listId) => handleOpenCapture(listId)}
                    completionStyle={completionStyle}
                  />
                )}

                {activeView === 'item' && activeItemId && (
                  <ItemDetail
                    itemId={activeItemId}
                    lists={lists}
                    onBack={navigateBackFromItem}
                    onDeleted={handleItemDeleted}
                  />
                )}

                {activeView === 'deleted' && (
                  <DeletedView
                    onBack={() => setActiveView('home')}
                    onRestored={(_restored) => {
                      loadLists();
                    }}
                  />
                )}

                {activeView === 'settings' && (
                  <SettingsView
                    currentStyle={completionStyle}
                    onSelectStyle={handleSetCompletionStyle}
                    onBack={() => {
                      if (activeListId) {
                        setActiveView('list');
                      } else {
                        setActiveView('home');
                      }
                    }}
                  />
                )}
              </>
            )}

            {activeTab === 'due' && (
              <DueView
                lists={lists}
                onSelectItem={(id) => {
                  setActiveTab('lists');
                  navigateToItem(id);
                }}
                onToggleComplete={handleToggleComplete}
                completionStyle={completionStyle}
              />
            )}

            {activeTab === 'search' && (
              <SearchView
                lists={lists}
                onSelectItem={(id) => {
                  setActiveTab('lists');
                  navigateToItem(id);
                }}
              />
            )}
          </div>
        </main>

        {/* Bottom Navigation */}
        <nav className="bottom-nav">
          <div className="bottom-nav-inner">
            <button
              type="button"
              data-testid="tab-lists"
              className={`nav-tab ${activeTab === 'lists' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('lists');
                if (activeView !== 'item') {
                  setActiveView('home');
                }
              }}
            >
              <IconFolder size={18} />
              <span>Lists</span>
            </button>

            <button
              type="button"
              data-testid="global-add-btn"
              className="bottom-nav-add-btn"
              onClick={() => handleOpenCapture()}
              aria-label="Add item"
              title="Add item"
            >
              ＋
            </button>

            <button
              type="button"
              data-testid="tab-due"
              className={`nav-tab ${activeTab === 'due' ? 'active' : ''}`}
              onClick={() => setActiveTab('due')}
            >
              <IconCalendar size={18} />
              <span>Due</span>
            </button>

            <button
              type="button"
              data-testid="tab-search"
              className={`nav-tab ${activeTab === 'search' ? 'active' : ''}`}
              onClick={() => setActiveTab('search')}
            >
              <IconSearch size={18} />
              <span>Search</span>
            </button>
          </div>
        </nav>

        {/* Global Capture Sheet */}
        <CaptureSheet
          isOpen={isCaptureOpen}
          onClose={() => setIsCaptureOpen(false)}
          onSaved={handleItemSaved}
          lists={lists}
          defaultListId={captureDefaultListId}
        />

        {/* Toast */}
        {toast && (
          <div className="toast-container" data-testid="toast-container">
            <div className="toast">
              <span>{toast.message}</span>
              {toast.onUndo && (
                <button
                  type="button"
                  data-testid="toast-undo-btn"
                  className="toast-btn"
                  onClick={toast.onUndo}
                >
                  Undo
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
