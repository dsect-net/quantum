/**
 * Messages tab tests — mocked fetch, no network:
 *  - thread list renders recent threads and opens one
 *  - thread view: identity prefill, send flow posts to /send
 *  - search: query submits to server-side /search, results render
 *  - digest: data / not-exposed / error states render honestly
 *  - demo mode: no relay URL → DemoBanner, no fetch calls
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagesScreen } from '../MessagesScreen';
import { ThreadsScreen } from './ThreadsScreen';
import { ThreadScreen } from './ThreadScreen';
import { SearchScreen } from './SearchScreen';
import { HeraldDigestView } from './HeraldDigestScreen';
import { SETTINGS_KEY } from '../../lib/settings';
import type { RelayThread } from '../../api/relay';

const RELAY = 'https://team.dsect.net/api/relay';

function setRelayUrl(url: string) {
  window.localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      hub: { baseUrl: '' },
      nebula: { baseUrl: '' },
      relay: { baseUrl: url },
      sol: { baseUrl: '' },
      mcpKey: '',
      nebulaPassphrase: '',
    }),
  );
}

function row(id: number, author: string, content: string, conv = 7) {
  return {
    id,
    uuid: `u-${id}`,
    author,
    author_display: author,
    content,
    mentions: '[]',
    platform: 'web',
    timestamp: 1759365600 + id,
    created_at: '2025-10-02T12:00:00Z',
    intent: null,
    routed_to: '[]',
    thread_id: null,
    conversation_id: conv,
  };
}

/** Tiny fake relay: /recent returns the log, /send appends, /messages?since= deltas. */
function fakeRelay(seed: ReturnType<typeof row>[] = [row(1, 'scotty', 'hello'), row(2, 'qubit', 'hi', 9)]) {
  const log = [...seed];
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/api/whoami')) {
      return new Response('{}', {
        status: 200,
        headers: { 'x-user-email': 'scottyvenable@gmail.com', 'x-user-name': 'Scotty' },
      });
    }
    if (url.includes('/recent')) {
      return new Response(JSON.stringify({ messages: log }), { status: 200 });
    }
    if (url.includes('/messages?')) {
      const since = Number(new URL(url).searchParams.get('since') ?? 0);
      return new Response(JSON.stringify({ messages: log.filter((m) => m.id > since) }), {
        status: 200,
      });
    }
    if (url.endsWith('/send')) {
      const body = JSON.parse(String(init?.body));
      log.push(row(log.length + 1, body.author, body.content));
      return new Response(null, { status: 200 });
    }
    if (url.includes('/search?')) {
      const q = new URL(url).searchParams.get('q') ?? '';
      return new Response(
        JSON.stringify({ messages: log.filter((m) => m.content.includes(q)) }),
        { status: 200 },
      );
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls, log };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('MessagesScreen demo mode', () => {
  it('shows the demo banner and never fetches without a relay URL', async () => {
    setRelayUrl('');
    const { fn } = (() => {
      const f = vi.fn(async () => new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', f);
      return { fn: f };
    })();
    render(<MessagesScreen />);
    expect(screen.getByText(/Demo mode/)).toBeInTheDocument();
    expect(screen.getByText(/Relay not connected/)).toBeInTheDocument();
    await waitFor(() => expect(fn).not.toHaveBeenCalled());
  });

  it('switches between Threads, Search, and Digest views', async () => {
    setRelayUrl('');
    render(<MessagesScreen />);
    // Demo mode: Threads and Search show the not-connected state…
    expect(screen.getAllByText(/Relay not connected/).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }));
    expect(screen.getByText(/search the team log/i)).toBeInTheDocument();
    // …while the Digest tab shows the not-exposed herald state (async probe).
    fireEvent.click(screen.getByRole('tab', { name: 'Digest' }));
    expect(await screen.findByText(/Not yet exposed via API/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Threads' }));
    expect(screen.getAllByText(/Relay not connected/).length).toBeGreaterThanOrEqual(1);
  });
});

describe('ThreadsScreen', () => {
  it('lists recent threads grouped by conversation', async () => {
    setRelayUrl(RELAY);
    fakeRelay();
    const onOpen = vi.fn();
    render(<ThreadsScreen baseUrl={RELAY} onOpenThread={onOpen} />);
    expect(await screen.findByText('scotty')).toBeInTheDocument();
    expect(screen.getByText('qubit')).toBeInTheDocument();
    fireEvent.click(screen.getByText('qubit').closest('button')!);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 9 }));
  });

  it('shows an honest error with retry when the relay is unreachable', async () => {
    setRelayUrl(RELAY);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    render(<ThreadsScreen baseUrl={RELAY} onOpenThread={() => {}} />);
    expect(await screen.findByText(/Couldn't reach the relay/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('ThreadScreen', () => {
  const thread: RelayThread = {
    conversationId: 7,
    name: 'scotty',
    lastMessage: row(1, 'scotty', 'hello') as unknown as RelayThread['lastMessage'],
    messageCount: 1,
  };

  it('prefills the handle from tailnet identity and posts via /send', async () => {
    setRelayUrl(RELAY);
    const { calls } = fakeRelay();
    render(<ThreadScreen baseUrl={RELAY} thread={thread} onBack={() => {}} />);

    // Initial tail loads, identity prefills the handle input.
    expect(await screen.findByText('hello')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('scotty')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'ship it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      const send = calls.find((c) => c.url.endsWith('/send'));
      expect(send).toBeDefined();
      expect(JSON.parse(String(send!.init?.body))).toEqual({
        author: 'scotty',
        content: 'ship it',
      });
    });
    // The poll/delta fetch picks the new row up.
    expect(await screen.findByText('ship it')).toBeInTheDocument();
  });

  it('asks the model to type a handle first instead of posting anonymously', async () => {
    setRelayUrl(RELAY);
    fakeRelay();
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).endsWith('/api/whoami')) return new Response('{}', { status: 401 });
      return new Response(JSON.stringify({ messages: [row(1, 'scotty', 'hello')] }), {
        status: 200,
      });
    });
    render(<ThreadScreen baseUrl={RELAY} thread={thread} onBack={() => {}} />);
    await screen.findByText('hello');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Enter your handle/);
  });
});

describe('SearchScreen', () => {
  it('submits the query server-side and renders results', async () => {
    setRelayUrl(RELAY);
    const { calls } = fakeRelay([row(1, 'scotty', 'solar panels rock'), row(2, 'qubit', 'unrelated')]);
    render(<SearchScreen baseUrl={RELAY} />);
    fireEvent.change(screen.getByLabelText(/Search the team log/), {
      target: { value: 'solar' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('/search?') && c.url.includes('q=solar'))).toBe(true);
    });
    expect(await screen.findByText('solar panels rock')).toBeInTheDocument();
    expect(screen.queryByText('unrelated')).not.toBeInTheDocument();
  });
});

describe('HeraldDigestView', () => {
  it('renders digest data with per-agent counts and summaries', () => {
    render(
      <HeraldDigestView
        state={{
          status: 'data',
          digest: {
            generatedAt: '2026-10-02T12:00:00Z',
            agents: [
              {
                agent: 'cooper',
                unread: 3,
                needsAction: 1,
                urgent: 1,
                items: [
                  {
                    from: 'scotty@dsect.net',
                    subject: 'Review the PR',
                    summary: 'Scotty asked for a review of the messages module.',
                    urgency: 'high',
                    needsAction: true,
                  },
                ],
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText('cooper')).toBeInTheDocument();
    expect(screen.getByText('3 unread')).toBeInTheDocument();
    expect(screen.getByText('1 action')).toBeInTheDocument();
    expect(screen.getByText('1 urgent')).toBeInTheDocument();
    expect(screen.getByText('Review the PR')).toBeInTheDocument();
    expect(screen.getByText(/Scotty asked for a review/)).toBeInTheDocument();
  });

  it('renders the honest not-exposed state — no fake digest data', () => {
    render(<HeraldDigestView state={{ status: 'not-exposed', hubBaseUrl: '' }} />);
    expect(screen.getByText(/Not yet exposed via API/)).toBeInTheDocument();
    expect(screen.getByText(/no.*HTTP endpoint/i)).toBeInTheDocument();
  });

  it('renders the error state with the probe message', () => {
    render(<HeraldDigestView state={{ status: 'error', message: 'hub refused the connection' }} />);
    expect(screen.getByText('hub refused the connection')).toBeInTheDocument();
  });
});
