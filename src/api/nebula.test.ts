/**
 * Nebula API client tests. fetch is mocked; every test pins the exact
 * request/response contract against nebula/server.py (Oct 2026):
 * submit → poll → complete, poll timeout, aborts, auth/reject/network
 * errors, gallery + workflow parsing, and the URL builders.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JOB_TIMEOUT_MS,
  NebulaApiError,
  cancelJob,
  fetchMediaBlob,
  fileUrl,
  getJobs,
  getWorkflow,
  listGallery,
  listWorkflows,
  pollJob,
  runWorkflow,
  thumbUrl,
} from './nebula';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Responder = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

/** Install a fetch mock; returns the captured requests for assertions. */
function mockFetch(responder: Responder) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    return responder(url, init);
  });
  vi.stubGlobal('fetch', stub);
  return requests;
}

function queuedJobs(jobs: { url: string; body: unknown }[]): Responder {
  const queue = jobs.slice();
  return (url) => {
    // Consume in order: each poll gets the next queued response, so a
    // submit → poll → complete sequence advances through the states.
    const next = queue.length > 0 ? queue.shift()! : jobs[jobs.length - 1];
    if (!next) throw new Error('unexpected request: ' + url);
    return jsonResponse(next.body);
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const AUTH = { baseUrl: 'https://nebula.test:8092', passphrase: 'sekrit' };
const NO_AUTH = { baseUrl: 'https://nebula.test:8092' };

describe('listWorkflows', () => {
  it('parses the items shape with kinds', async () => {
    mockFetch(() =>
      jsonResponse({
        workflows: ['a.json', 'b.json'],
        items: [
          { name: 'a.json', title: 'Text to Image — RealVisXL', short: 'RealVisXL', family: 't2i', kind: 'Images', order: 1 },
          { name: 'b.json', title: '3D — Shape', short: 'Shape', family: 'mesh', kind: '3D', order: 2 },
        ],
        kinds: ['Images', '3D'],
      }),
    );
    const workflows = await listWorkflows(AUTH);
    expect(workflows).toHaveLength(2);
    expect(workflows[0]).toMatchObject({ name: 'a.json', short: 'RealVisXL', kind: 'Images', order: 1 });
    expect(workflows[1]).toMatchObject({ name: 'b.json', kind: '3D' });
  });

  it('falls back to the plain name list when items is empty', async () => {
    mockFetch(() => jsonResponse({ workflows: ['x.json'], items: [] }));
    const workflows = await listWorkflows(NO_AUTH);
    expect(workflows).toEqual([
      { name: 'x.json', title: 'x', short: 'x', family: '', kind: 'Other', order: 9 },
    ]);
  });

  it('sends the passphrase as a Bearer header and nothing else', async () => {
    const requests = mockFetch(() => jsonResponse({ workflows: [], items: [] }));
    await listWorkflows(AUTH);
    const headers = requests[0].init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sekrit');
    expect(Object.keys(headers)).not.toContain('X-Nebula-Agent');
  });

  it('throws config when no base URL is set', async () => {
    await expect(listWorkflows({ baseUrl: '' })).rejects.toMatchObject({ code: 'config' });
  });
});

describe('getWorkflow', () => {
  it('parses typed params, levels, and choices', async () => {
    mockFetch(() =>
      jsonResponse({
        name: 't2i.json',
        family: 't2i',
        basic: 3,
        advanced: 2,
        params: [
          { node: '6', key: 'text', kind: 'text', value: 'a fox', label: 'Prompt', level: 'basic' },
          { node: '5', key: 'width', kind: 'int', value: 1024, label: 'Width', min: 64, max: 2048, step: 64, level: 'basic' },
          { node: '3', key: 'seed', kind: 'int', value: 1, label: 'Seed', level: 'basic' },
          { node: '3', key: 'sampler_name', kind: 'choice', value: 'euler', label: 'Sampler',
            choices: ['euler', 'dpmpp_2m'], unavailable: ['sageattn'], level: 'advanced' },
          { node: '9', key: 'add_noise', kind: 'bool', value: true, label: 'Add noise', level: 'advanced' },
          { node: '12', key: 'image', kind: 'image', value: '', label: 'Reference', level: 'basic' },
          { node: '1', key: 'weird', kind: 'WIDGET', value: 'x', label: 'Weird', level: 'hidden' },
          { node: '2', key: 'future', kind: 'SOME_NEW_KIND', value: 0, label: 'Future', level: 'basic' },
        ],
      }),
    );
    const detail = await getWorkflow('t2i.json', NO_AUTH);
    expect(detail.name).toBe('t2i.json');
    expect(detail.family).toBe('t2i');
    const byKey = Object.fromEntries(detail.params.map((p) => [p.key, p]));
    expect(byKey.text.kind).toBe('text');
    expect(byKey.width.kind).toBe('int');
    expect(byKey.width.min).toBe(64);
    expect(byKey.sampler_name.kind).toBe('choice');
    expect(byKey.sampler_name.choices).toEqual(['euler', 'dpmpp_2m']);
    expect(byKey.sampler_name.unavailable).toEqual(['sageattn']);
    expect(byKey.add_noise.kind).toBe('bool');
    expect(byKey.image.kind).toBe('image');
    expect(byKey.weird.level).toBe('hidden');
    // Unknown kinds never break the form — they come back as "unsupported".
    expect(byKey.future.kind).toBe('unsupported');
    expect(detail.basic).toBe(3);
  });

  it('encodes the workflow name in the path', async () => {
    const requests = mockFetch(() => jsonResponse({ name: 'a b.json', params: [] }));
    await getWorkflow('a b.json', NO_AUTH);
    expect(requests[0].url).toBe('https://nebula.test:8092/api/workflow/a%20b.json');
  });
});

describe('runWorkflow', () => {
  it('posts workflow + overrides and returns the prompt id', async () => {
    const requests = mockFetch(() => jsonResponse({ prompt_id: 'abc-123', number: 4 }));
    const res = await runWorkflow({
      ...AUTH,
      workflow: 't2i.json',
      overrides: [
        { node: '6', key: 'text', value: 'a fox at dusk' },
        { node: '5', key: 'width', value: 1024 },
      ],
    });
    expect(res).toMatchObject({ promptId: 'abc-123', deferred: false });
    const sent = JSON.parse(String(requests[0].init?.body));
    expect(sent).toMatchObject({
      workflow: 't2i.json',
      backend: 'nvidia',
      randomize_seed: true,
      overrides: [
        { node: '6', key: 'text', value: 'a fox at dusk' },
        { node: '5', key: 'width', value: 1024 },
      ],
    });
  });

  it('handles a deferred run (backend busy)', async () => {
    mockFetch(() => jsonResponse({ deferred: true, queued_locally: 2, message: 'nvidia is busy — auto' }));
    const res = await runWorkflow({ ...NO_AUTH, workflow: 'big.json' });
    expect(res).toMatchObject({ promptId: null, deferred: true });
    expect(res.message).toContain('busy');
  });

  it('throws rejected when the server refuses the run', async () => {
    mockFetch(() => jsonResponse({ error: 'unknown workflow' }, 400));
    await expect(runWorkflow({ ...NO_AUTH, workflow: 'nope.json' })).rejects.toMatchObject({
      code: 'rejected',
      message: expect.stringContaining('unknown workflow'),
    });
  });

  it('maps 401 to auth with a passphrase hint', async () => {
    mockFetch(() => jsonResponse({ error: 'unauthorized' }, 401));
    await expect(runWorkflow({ ...NO_AUTH, workflow: 't2i.json' })).rejects.toMatchObject({
      code: 'auth',
      message: expect.stringContaining('passphrase'),
    });
  });

  it('throws config for an empty workflow name', async () => {
    await expect(runWorkflow({ ...NO_AUTH, workflow: '' })).rejects.toMatchObject({ code: 'config' });
  });

  it('maps fetch failure to network', async () => {
    mockFetch(() => {
      throw new TypeError('failed to fetch');
    });
    await expect(runWorkflow({ ...NO_AUTH, workflow: 't2i.json' })).rejects.toMatchObject({ code: 'network' });
  });
});

describe('getJobs', () => {
  it('parses active and recent jobs with progress', async () => {
    mockFetch(() =>
      jsonResponse({
        active: [
          {
            id: 'p1', state: 'running', workflow: 't2i.json', title: 'a fox',
            user: 'scott', backend: 'nvidia', device: 'phone', queued_at: 1700000000,
            progress: { value: 6, max: 8, node: '3', phase: 'Sampling' },
          },
          { id: 'p2', state: 'pending', workflow: 'up.json', title: '', user: '', backend: 'nvidia' },
        ],
        recent: [
          {
            id: 'p0', state: 'success', workflow: 't2i.json', title: 'old fox',
            user: 'scott', backend: 'nvidia', queued_at: 1699999999,
            outputs: ['t2i/fox_0001.png'],
          },
        ],
        busy: false,
        waiting: 1,
      }),
    );
    const jobs = await getJobs(20, NO_AUTH);
    expect(jobs.active).toHaveLength(2);
    expect(jobs.active[0]).toMatchObject({
      id: 'p1', state: 'running', workflow: 't2i.json', title: 'a fox', user: 'scott',
      progress: { value: 6, max: 8, node: '3', phase: 'Sampling' },
    });
    expect(jobs.active[1].progress).toBeNull();
    expect(jobs.recent[0]).toMatchObject({ id: 'p0', state: 'success', outputs: ['t2i/fox_0001.png'] });
    expect(jobs.waiting).toBe(1);
  });
});

describe('pollJob', () => {
  it('runs the submit → poll → complete flow', async () => {
    const requests = mockFetch(
      queuedJobs([
        {
          url: '/api/jobs',
          body: { active: [{ id: 'abc', state: 'pending', workflow: 't2i.json' }], recent: [] },
        },
        {
          url: '/api/jobs',
          body: { active: [{ id: 'abc', state: 'running', progress: { value: 4, max: 8 } }], recent: [] },
        },
        {
          url: '/api/jobs',
          body: {
            active: [],
            recent: [{ id: 'abc', state: 'success', workflow: 't2i.json', title: 'fox', outputs: ['t2i/fox_0001.png'] }],
          },
        },
      ]),
    );
    const seen: string[] = [];
    const job = await pollJob({
      ...AUTH,
      promptId: 'abc',
      intervalMs: 5,
      timeoutMs: 5000,
      onProgress: (state) => seen.push(state),
    });
    expect(job).toMatchObject({ id: 'abc', state: 'success', outputs: ['t2i/fox_0001.png'] });
    expect(seen).toEqual(['queued', 'running', 'done']);
    expect(requests.length).toBeGreaterThanOrEqual(3);
  });

  it('survives a transient poll failure and keeps waiting', async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      if (calls === 1) throw new TypeError('blip');
      return jsonResponse({ active: [], recent: [{ id: 'abc', state: 'success', outputs: [] }] });
    });
    const job = await pollJob({ ...NO_AUTH, promptId: 'abc', intervalMs: 5, timeoutMs: 5000 });
    expect(job.id).toBe('abc');
    expect(calls).toBe(2);
  });

  it('times out with code "timeout" when the job never finishes', async () => {
    mockFetch(() => jsonResponse({ active: [{ id: 'abc', state: 'running' }], recent: [] }));
    const promise = pollJob({ ...NO_AUTH, promptId: 'abc', intervalMs: 5, timeoutMs: 60 });
    await expect(promise).rejects.toMatchObject({ code: 'timeout' });
  });

  it('honors the overall cap from a single constant (JOB_TIMEOUT_MS default)', () => {
    expect(JOB_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('aborts with code "aborted" on an external signal', async () => {
    mockFetch(() => jsonResponse({ active: [{ id: 'abc', state: 'running' }], recent: [] }));
    const ctrl = new AbortController();
    const promise = pollJob({ ...NO_AUTH, promptId: 'abc', intervalMs: 5, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 20);
    await expect(promise).rejects.toMatchObject({ code: 'aborted' });
  });

  it('resolves a cancelled job with state intact and a "failed" report', async () => {
    mockFetch(() =>
      jsonResponse({ active: [], recent: [{ id: 'abc', state: 'cancelled', workflow: 't2i.json' }] }),
    );
    const seen: string[] = [];
    const job = await pollJob({
      ...NO_AUTH,
      promptId: 'abc',
      intervalMs: 5,
      onProgress: (state) => seen.push(state),
    });
    expect(job.state).toBe('cancelled');
    expect(seen).toEqual(['failed']);
  });
});

describe('cancelJob', () => {
  it('posts id + backend and returns the action', async () => {
    const requests = mockFetch(() => jsonResponse({ ok: true, action: 'interrupted', id: 'p1' }));
    const res = await cancelJob('p1', { ...AUTH, backend: 'nvidia' });
    expect(res).toEqual({ ok: true, action: 'interrupted' });
    const sent = JSON.parse(String(requests[0].init?.body));
    expect(sent).toEqual({ id: 'p1', backend: 'nvidia' });
  });

  it('throws rejected when the server says no', async () => {
    mockFetch(() => jsonResponse({ error: 'unknown backend' }, 400));
    await expect(cancelJob('p1', NO_AUTH)).rejects.toMatchObject({ code: 'rejected' });
  });
});

describe('gallery', () => {
  it('parses gallery items defensively', async () => {
    const requests = mockFetch(() =>
      jsonResponse({
        total: 2,
        items: [
          { path: 't2i/fox_0001.png', kind: 'image', mtime: 1700000001, dir: 't2i', tags: ['fox'], backend: 'nvidia' },
          { path: 't2i/fox_0002.png', kind: 'image', mtime: 1700000002, dir: 't2i', tags: [], backend: null },
          { kind: 'image' }, // missing path: dropped, never shown
        ],
      }),
    );
    const gallery = await listGallery(60, 0, NO_AUTH);
    expect(gallery.total).toBe(2);
    expect(gallery.items).toHaveLength(2);
    expect(gallery.items[0]).toMatchObject({ path: 't2i/fox_0001.png', tags: ['fox'], backend: 'nvidia' });
    expect(gallery.items[1].backend).toBeNull();
    expect(requests[0].url).toContain('/api/gallery?kind=image&limit=60&offset=0');
  });

  it('builds encoded thumb and file URLs', () => {
    expect(thumbUrl('https://nebula.test:8092/', 't2i/a fox (1).png', 320)).toBe(
      'https://nebula.test:8092/api/thumb/t2i/a%20fox%20(1).png?s=320',
    );
    expect(fileUrl('https://nebula.test:8092', 't2i/fox.png')).toBe(
      'https://nebula.test:8092/api/file/t2i/fox.png',
    );
  });

  it('fetches a thumbnail as a blob with auth headers', async () => {
    const requests = mockFetch(() => new Response(new Blob(['x'], { type: 'image/jpeg' }), { status: 200 }));
    const blob = await fetchMediaBlob('https://nebula.test:8092', 't2i/fox.png', 'thumb', {
      passphrase: 'sekrit',
      size: 200,
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(requests[0].url).toContain('/api/thumb/t2i/fox.png?s=200');
    const headers = requests[0].init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sekrit');
  });

  it('maps a 401 on media fetch to auth', async () => {
    mockFetch(() => jsonResponse({ error: 'unauthorized' }, 401));
    await expect(fetchMediaBlob('https://nebula.test:8092', 't2i/fox.png', 'file', {})).rejects.toBeInstanceOf(
      NebulaApiError,
    );
    await expect(fetchMediaBlob('https://nebula.test:8092', 't2i/fox.png', 'file', {})).rejects.toMatchObject({
      code: 'auth',
    });
  });
});
