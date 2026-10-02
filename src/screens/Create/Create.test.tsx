/**
 * Create module UI tests: honest demo state when unconfigured, and the
 * full New → submit → Jobs handoff when configured (fetch mocked).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CreateScreen } from './CreateScreen';
import { SETTINGS_KEY } from '../../lib/settings';

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
  kinds: ['Images'],
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
      if (url.includes('/api/jobs')) return jsonResponse({ active: [], recent: [], busy: false, waiting: 0 });
      throw new Error('unexpected request: ' + url);
    });

    render(<CreateScreen />);

    // Workflow picker populates from the server.
    const picker = await screen.findByLabelText('Workflow');
    expect(picker).toHaveValue('t2i.json');

    // Run form renders the workflow's basic params.
    const prompt = await screen.findByLabelText('Prompt');
    fireEvent.change(prompt, { target: { value: 'a fox at dusk' } });

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    // Submit hands off to Jobs, which polls /api/jobs.
    await screen.findByText(/No jobs yet/);
    expect(requests.some((u) => u.includes('/api/run'))).toBe(true);
    expect(requests.some((u) => u.includes('/api/jobs'))).toBe(true);
    const tabs = screen.getByRole('tablist', { name: 'Create views' });
    const jobsTab = Array.from(tabs.querySelectorAll('button')).find(
      (b) => b.textContent === 'Jobs',
    )!;
    expect(jobsTab).toHaveAttribute('aria-selected', 'true');
  });

  it('reports a refused run honestly instead of pretending it worked', async () => {
    configureNebula();
    mockFetch((url) => {
      if (url.includes('/api/workflows')) return jsonResponse(WORKFLOWS);
      if (url.includes('/api/workflow/')) return jsonResponse(WORKFLOW_DETAIL);
      if (url.includes('/api/run')) return jsonResponse({ error: 'unknown workflow' }, 400);
      throw new Error('unexpected request: ' + url);
    });

    render(<CreateScreen />);
    await screen.findByLabelText('Prompt');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await screen.findByText(/Nebula refused the request/);
    // Still on the New tab — no fake handoff.
    const tabs = screen.getByRole('tablist', { name: 'Create views' });
    const newTab = Array.from(tabs.querySelectorAll('button')).find(
      (b) => b.textContent === 'New',
    )!;
    expect(newTab).toHaveAttribute('aria-selected', 'true');
  });
});
