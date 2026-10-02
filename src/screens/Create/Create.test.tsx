/**
 * Create module UI tests: honest demo state when unconfigured, and the
 * full New → submit → Jobs handoff when configured (fetch mocked).
 *
 * Extended for the Nebula-mirroring rebuild: the "Type of generation" kind
 * tablist, the 3D rigging hint, advanced-options changed-count/reset,
 * the Recent runs card, the jobs queue-note line, cancel, and the
 * gallery search + grid/list toggle + viewer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CreateScreen } from './CreateScreen';
import { SETTINGS_KEY } from '../../lib/settings';

// jsdom implements <dialog> without showModal()/close() — the kit Dialog is
// a native dialog, so the imperative bits are stubbed here (real browsers
// have them). The `open` content attribute mirrors the dialog state.
if (typeof HTMLDialogElement !== 'undefined') {
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(
  responder: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
) {
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      return responder(url, init);
    }),
  );
  return requests;
}

const WORKFLOWS = {
  workflows: ['t2i.json'],
  items: [{ name: 't2i.json', title: 'Text to Image — Fox', short: 'Fox', family: 't2i', kind: 'Images', order: 1 }],
};

const WORKFLOWS_TWO_KINDS = {
  workflows: ['t2i.json', 'mesh.json'],
  items: [
    { name: 't2i.json', title: 'Text to Image — Fox', short: 'Fox', family: 't2i', kind: 'Images', order: 1 },
    { name: 'mesh.json', title: '3D — Turntable', short: 'Turntable', family: 'm3d', kind: '3D', order: 1 },
  ],
};

const WORKFLOW_DETAIL = {
  name: 't2i.json',
  family: 't2i',
  basic: 2,
  advanced: 0,
  params: [
    { node: '6', key: 'text', kind: 'text', value: '', label: 'Prompt', level: 'basic' },
    { node: '3', key: 'steps', kind: 'int', value: 8, label: 'Steps', min: 1, max: 50, level: 'basic' },
  ],
};

const WORKFLOW_DETAIL_ADVANCED = {
  name: 't2i.json',
  family: 't2i',
  basic: 1,
  advanced: 1,
  params: [
    { node: '6', key: 'text', kind: 'text', value: '', label: 'Prompt', level: 'basic' },
    { node: '3', key: 'steps', kind: 'int', value: 8, label: 'Steps', min: 1, max: 50, level: 'advanced' },
  ],
};

const EMPTY_JOBS = { active: [], recent: [], busy: false, waiting: 0 };

function configureNebula() {
  window.localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      hub: { baseUrl: '' },
      nebula: { baseUrl: 'https://nebula.test:8092' },
      relay: { baseUrl: '' },
      mcpKey: '',
      nebulaPassphrase: '',
    }),
  );
}

/** jsdom has no URL.createObjectURL — stub it so AuthenticatedImage renders <img>. */
function stubObjectUrls() {
  window.URL.createObjectURL = vi.fn(() => 'blob:mock');
  window.URL.revokeObjectURL = vi.fn();
}

function mediaResponder(url: string) {
  if (url.includes('/api/thumb/') || url.includes('/api/file/')) {
    return new Response(new Blob(['img'], { type: 'image/png' }), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  }
  throw new Error('unexpected request: ' + url);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('CreateScreen', () => {
  it('shows the honest demo banner and makes no network calls when unconfigured', async () => {
    const requests = mockFetch(() => jsonResponse({}));
    render(<CreateScreen />);
    expect(screen.getByText(/No Nebula base URL configured/)).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    // Sub-views exist but stay inert without a connection.
    expect(screen.getByRole('tablist', { name: 'Create views' })).toBeInTheDocument();
  });

  it('loads workflows, submits a run, and hands off to the Jobs view', async () => {
    configureNebula();
    const requests = mockFetch((url, init) => {
      if (url.includes('/api/workflows')) return jsonResponse(WORKFLOWS);
      if (url.includes('/api/workflow/')) return jsonResponse(WORKFLOW_DETAIL);
      if (url.includes('/api/run')) {
        const sent = JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}'));
        expect(sent.workflow).toBe('t2i.json');
        expect(sent.overrides).toEqual(
          expect.arrayContaining([{ node: '6', key: 'text', value: 'a fox at dusk' }]),
        );
        return jsonResponse({ prompt_id: 'p1' });
      }
      if (url.includes('/api/jobs')) return jsonResponse(EMPTY_JOBS);
      throw new Error('unexpected request: ' + url);
    });

    render(<CreateScreen />);

    // Run card mirrors Nebula: heading + workflow count.
    expect(await screen.findByRole('heading', { name: 'Run a workflow' })).toBeInTheDocument();
    expect(screen.getByText('1 saved')).toBeInTheDocument();

    // Workflow picker populates from the server.
    const picker = await screen.findByLabelText('Workflow');
    expect(picker).toHaveValue('t2i.json');

    // Run form renders the workflow's basic params.
    const prompt = await screen.findByLabelText('Prompt');
    fireEvent.change(prompt, { target: { value: 'a fox at dusk' } });

    fireEvent.click(screen.getByRole('button', { name: 'Queue run' }));

    // Submit hands off to Jobs, which polls /api/jobs.
    await screen.findByText(/No jobs yet/);
    expect(requests.some((u) => u.includes('/api/run'))).toBe(true);
    expect(requests.some((u) => u.includes('/api/jobs'))).toBe(true);
    const tabs = screen.getByRole('tablist', { name: 'Create views' });
    const jobsTab = within(tabs).getByRole('tab', { name: 'Jobs' });
    expect(jobsTab).toHaveAttribute('aria-selected', 'true');
  });

  it('reports a refused run honestly instead of pretending it worked', async () => {
    configureNebula();
    mockFetch((url) => {
      if (url.includes('/api/workflows')) return jsonResponse(WORKFLOWS);
      if (url.includes('/api/workflow/')) return jsonResponse(WORKFLOW_DETAIL);
      if (url.includes('/api/run')) return jsonResponse({ error: 'unknown workflow' }, 400);
      if (url.includes('/api/jobs')) return jsonResponse(EMPTY_JOBS);
      throw new Error('unexpected request: ' + url);
    });

    render(<CreateScreen />);
    await screen.findByLabelText('Prompt');
    fireEvent.click(screen.getByRole('button', { name: 'Queue run' }));
    await screen.findByText(/Nebula refused the request/);
    // Still on the New tab — no fake handoff.
    const tabs = screen.getByRole('tablist', { name: 'Create views' });
    const newTab = within(tabs).getByRole('tab', { name: 'New' });
    expect(newTab).toHaveAttribute('aria-selected', 'true');
  });

  it('reports workflow-list failures with an error box and retry', async () => {
    configureNebula();
    mockFetch((url) => {
      if (url.includes('/api/workflows')) return jsonResponse({ error: 'boom' }, 500);
      throw new Error('unexpected request: ' + url);
    });

    render(<CreateScreen />);
    await screen.findByText(/Nebula returned HTTP 500/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('picks the generation type first, with per-kind counts like Nebula', async () => {
    configureNebula();
    mockFetch((url) => {
      if (url.includes('/api/workflows')) return jsonResponse(WORKFLOWS_TWO_KINDS);
      if (url.includes('/api/workflow/')) return jsonResponse(WORKFLOW_DETAIL);
      if (url.includes('/api/jobs')) return jsonResponse(EMPTY_JOBS);
      throw new Error('unexpected request: ' + url);
    });

    render(<CreateScreen />);
    const kindTabs = await screen.findByRole('tablist', { name: 'Type of generation' });
    const imagesTab = within(kindTabs).getByRole('tab', { name: /Images/ });
    const meshTab = within(kindTabs).getByRole('tab', { name: /3D/ });
    // Counts ride on the tabs.
    expect(imagesTab).toHaveTextContent('1');
    expect(meshTab).toHaveTextContent('1');
    expect(imagesTab).toHaveAttribute('aria-selected', 'true');

    // Switching the type switches the workflow list to that kind only.
    fireEvent.click(meshTab);
    const picker = (await screen.findByLabelText('Workflow')) as HTMLSelectElement;
    expect(picker).toHaveValue('mesh.json');
    expect(picker.options).toHaveLength(1);
    expect(within(kindTabs).getByRole('tab', { name: /3D/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the 3D rigging hint at generation time', async () => {
    configureNebula();
    mockFetch((url) => {
      if (url.includes('/api/workflows')) return jsonResponse(WORKFLOWS_TWO_KINDS);
      if (url.includes('/api/workflow/')) return jsonResponse(WORKFLOW_DETAIL);
      if (url.includes('/api/jobs')) return jsonResponse(EMPTY_JOBS);
      throw new Error('unexpected request: ' + url);
    });

    render(<CreateScreen />);
    const kindTabs = await screen.findByRole('tablist', { name: 'Type of generation' });
    expect(screen.queryByText(/T-pose or A-pose/)).not.toBeInTheDocument();
    fireEvent.click(within(kindTabs).getByRole('tab', { name: /3D/ }));
    expect(await screen.findByText(/T-pose or A-pose/)).toBeInTheDocument();
  });

  it('counts changed advanced settings and resets them to defaults', async () => {
    configureNebula();
    mockFetch((url) => {
      if (url.includes('/api/workflows')) return jsonResponse(WORKFLOWS);
      if (url.includes('/api/workflow/')) return jsonResponse(WORKFLOW_DETAIL_ADVANCED);
      if (url.includes('/api/jobs')) return jsonResponse(EMPTY_JOBS);
      throw new Error('unexpected request: ' + url);
    });

    render(<CreateScreen />);
    await screen.findByLabelText('Prompt');

    const toggle = await screen.findByRole('button', { name: 'Advanced options' });
    fireEvent.click(toggle);

    // Filter + reset controls appear with the advanced settings.
    expect(screen.getByLabelText('Filter advanced settings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument();

    const steps = screen.getByLabelText('Steps') as HTMLInputElement;
    expect(steps).toHaveValue(8);
    fireEvent.change(steps, { target: { value: '12' } });
    expect(await screen.findByRole('button', { name: 'Advanced options (1 changed)' })).toBeInTheDocument();

    // The filter narrows the settings list.
    fireEvent.change(screen.getByLabelText('Filter advanced settings'), { target: { value: 'zzz' } });
    expect(screen.getByText('No settings match that filter.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter advanced settings'), { target: { value: '' } });

    // Reset restores the server defaults and clears the count.
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(screen.getByLabelText('Steps')).toHaveValue(8);
    expect(screen.getByRole('button', { name: 'Advanced options' })).toBeInTheDocument();
  });

  it('shows the Recent runs card fed by the jobs endpoint', async () => {
    configureNebula();
    mockFetch((url) => {
      if (url.includes('/api/workflows')) return jsonResponse(WORKFLOWS);
      if (url.includes('/api/workflow/')) return jsonResponse(WORKFLOW_DETAIL);
      if (url.includes('/api/jobs'))
        return jsonResponse({
          active: [],
          recent: [
            { id: 'abc12345ef', state: 'success', workflow: 't2i.json', title: '', user: '', backend: '', device: '', queued_at: null, progress: null, outputs: ['out/a.png', 'out/b.png'] },
            { id: 'deadbeef00', state: 'cancelled', workflow: 't2i.json', title: '', user: '', backend: '', device: '', queued_at: null, progress: null, outputs: [] },
          ],
          busy: false,
          waiting: 0,
        });
      throw new Error('unexpected request: ' + url);
    });

    render(<CreateScreen />);
    await screen.findByRole('heading', { name: 'Recent runs' });
    const log = await screen.findByRole('log', { name: 'Recent runs' });
    // Nebula-style log lines: ok <id8> · N file(s); cancelled keeps its own state.
    expect(within(log).getByText('ok')).toBeInTheDocument();
    expect(within(log).getByText('abc12345')).toBeInTheDocument();
    expect(within(log).getByText(/2 files/)).toBeInTheDocument();
    expect(within(log).getByText('cancelled')).toBeInTheDocument();

    const jobsCalls = () =>
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) => String(u).includes('/api/jobs')).length;
    const before = jobsCalls();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await vi.waitFor(() => expect(jobsCalls()).toBeGreaterThan(before));
  });

  it('shows the queue note, progress with steps, and cancels an active job', async () => {
    configureNebula();
    stubObjectUrls();
    const requests = mockFetch((url, init) => {
      if (url.includes('/api/workflows')) return jsonResponse(WORKFLOWS);
      if (url.includes('/api/workflow/')) return jsonResponse(WORKFLOW_DETAIL);
      if (url.includes('/api/cancel')) {
        const sent = JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}'));
        expect(sent).toEqual({ id: 'j1', backend: 'nvidia' });
        return jsonResponse({ ok: true, action: 'cancelled' });
      }
      if (url.includes('/api/jobs'))
        return jsonResponse({
          active: [
            { id: 'j1', state: 'running', workflow: 't2i.json', title: 'Fox run', user: 'scott', backend: 'nvidia', device: 'tritium', queued_at: 1759324800, progress: { value: 3, max: 10, phase: 'sampling' }, outputs: [] },
          ],
          recent: [],
          busy: false,
          waiting: 2,
        });
      return mediaResponder(url);
    });

    render(<CreateScreen />);
    const tabs = await screen.findByRole('tablist', { name: 'Create views' });
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Jobs' }));

    // Nebula's queue-note line, verbatim logic.
    await screen.findByText('2 waiting for a free backend · 1 active');
    // Progress row: phase, percent, step value/max.
    expect(screen.getByText(/sampling · 30% · step 3\/10/)).toBeInTheDocument();
    expect(screen.getByText('Fox run')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(requests.some((u) => u.includes('/api/cancel'))).toBe(true));
  });

  it('expands a finished job to reveal its outputs', async () => {
    configureNebula();
    stubObjectUrls();
    mockFetch((url) => {
      if (url.includes('/api/workflows')) return jsonResponse(WORKFLOWS);
      if (url.includes('/api/workflow/')) return jsonResponse(WORKFLOW_DETAIL);
      if (url.includes('/api/jobs'))
        return jsonResponse({
          active: [],
          recent: [
            { id: 'r1', state: 'success', workflow: 't2i.json', title: 'Old fox', user: '', backend: '', device: '', queued_at: null, progress: null, outputs: ['out/a.png', 'out/b.png'] },
          ],
          busy: false,
          waiting: 0,
        });
      return mediaResponder(url);
    });

    render(<CreateScreen />);
    const tabs = await screen.findByRole('tablist', { name: 'Create views' });
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Jobs' }));

    await screen.findByText('Old fox');
    // Thumbnails show inline; the toggle reveals the full images.
    expect(await screen.findAllByAltText(/Output \d of Old fox/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Outputs (2)' }));
    const full = await screen.findAllByAltText('Output of Old fox');
    expect(full).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Hide outputs' }));
    expect(screen.queryByAltText('Output of Old fox')).not.toBeInTheDocument();
  });

  it('filters the gallery by name and switches grid/list layout', async () => {
    configureNebula();
    stubObjectUrls();
    mockFetch((url) => {
      if (url.includes('/api/workflows')) return jsonResponse(WORKFLOWS);
      if (url.includes('/api/workflow/')) return jsonResponse(WORKFLOW_DETAIL);
      if (url.includes('/api/jobs')) return jsonResponse(EMPTY_JOBS);
      if (url.includes('/api/gallery'))
        return jsonResponse({
          total: 2,
          items: [
            { path: 'out/fox.png', kind: 'image', mtime: 1759324800, dir: 'out', tags: [], backend: 'nvidia' },
            { path: 'out/wolf.png', kind: 'image', mtime: 1759324900, dir: 'out', tags: [], backend: 'nvidia' },
          ],
        });
      return mediaResponder(url);
    });

    render(<CreateScreen />);
    const tabs = await screen.findByRole('tablist', { name: 'Create views' });
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Gallery' }));

    await screen.findByRole('button', { name: 'Open out/fox.png' });
    expect(screen.getByText('2 of 2 images')).toBeInTheDocument();

    // Name filter narrows the tiles.
    fireEvent.change(screen.getByLabelText('Filter by name'), { target: { value: 'wolf' } });
    expect(screen.getByText('1 of 2 loaded match the filter')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open out/fox.png' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by name'), { target: { value: '' } });

    // Layout toggle is a radiogroup; list view shows one row per image.
    const layout = screen.getByRole('radiogroup', { name: 'Gallery layout' });
    expect(within(layout).getByRole('radio', { name: 'Grid view' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(layout).getByRole('radio', { name: 'List view' }));
    expect(within(layout).getByRole('radio', { name: 'List view' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('fox.png')).toBeInTheDocument();
    expect(screen.getByText('wolf.png')).toBeInTheDocument();

    // Tapping a tile opens the viewer sheet; Close dismisses it.
    fireEvent.click(screen.getByRole('button', { name: 'Open out/fox.png' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('fox.png')).toBeInTheDocument();
    expect(dialog).toHaveAttribute('open');
    // The kit Dialog also renders its own header close button named
    // "Close"; the sheet's footer action is the last one in the dialog.
    const closeButtons = within(dialog).getAllByRole('button', { name: 'Close' });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    // The native dialog stays in the DOM; closed means no `open` attribute.
    expect(dialog).not.toHaveAttribute('open');
  });
});
