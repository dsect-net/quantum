/**
 * More-tab screens: honest labeling is the contract under test.
 *
 *  - Services screen: not configured → demo banner; configured → connect
 *    button; mock-connect path is covered in mcp.test.ts.
 *  - Hive explorer: "Snapshot — not live" appears on list AND detail; the
 *    sample is bounded and sourced from the static hive-memory JSON.
 *  - Research: local-only labeling; project create + doc round-trip.
 */
import '../../index.css';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HiveScreen } from './HiveScreen';
import { ResearchScreen } from './ResearchScreen';
import { ServicesScreen } from './ServicesScreen';
import { HIVE_SNAPSHOT } from '../../data/hiveSnapshot';
import { createProject, exportProjectMarkdown } from '../../lib/research';

describe('HiveScreen', () => {
  it('labels the snapshot as not live, prominently', () => {
    render(<HiveScreen />);
    const labels = screen.getAllByText(/not live/);
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Snapshot — not live')).toBeInTheDocument();
  });

  it('says how many entries are sampled out of the source total', () => {
    render(<HiveScreen />);
    expect(screen.getByText(new RegExp(`${HIVE_SNAPSHOT.length} of`))).toBeInTheDocument();
    expect(screen.getByText(/no live backend/)).toBeInTheDocument();
  });

  it('renders snapshot entries with agent and tier', () => {
    render(<HiveScreen />);
    expect(screen.getByText(new RegExp(`#${HIVE_SNAPSHOT[0].id}`))).toBeInTheDocument();
  });

  it('drills into detail and keeps the not-live label', () => {
    render(<HiveScreen />);
    const first = HIVE_SNAPSHOT[0];
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`#${first.id}`) }));
    expect(screen.getByText('Snapshot — not live')).toBeInTheDocument();
    // Agent appears in the detail definition list.
    expect(screen.getByText(first.agent, { selector: 'dd' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Back to list/ }));
    expect(screen.getByText('Snapshot — not live')).toBeInTheDocument();
  });

  it('searches the snapshot', () => {
    render(<HiveScreen />);
    const unique = HIVE_SNAPSHOT[0].tags[0];
    fireEvent.change(screen.getByLabelText(/Search snapshot/), {
      target: { value: `zz-no-such-tag-${Date.now()}` },
    });
    expect(screen.getByText(/No matches/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Search snapshot/), { target: { value: unique } });
    expect(screen.queryByText(/No matches/)).not.toBeInTheDocument();
  });
});

describe('ResearchScreen', () => {
  it('labels records as on-device-only', () => {
    render(<ResearchScreen />);
    expect(screen.getByText('On this device only')).toBeInTheDocument();
    expect(screen.getByText(/records live on this device/)).toBeInTheDocument();
  });

  it('creates a project and a document', () => {
    render(<ResearchScreen />);
    fireEvent.change(screen.getByLabelText(/New project title/), {
      target: { value: 'Test project' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    // Creating navigates into the project detail: the title sits in its input.
    expect(screen.getByLabelText(/Project title/)).toHaveValue('Test project');
    expect(screen.getByText('On this device only')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/New document title/), {
      target: { value: 'Notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add document' }));
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('exports markdown with the local-only marker', () => {
    const p = createProject('Export me');
    expect(exportProjectMarkdown(p)).toContain('On this device only');
  });
});

describe('ServicesScreen', () => {
  it('shows demo mode when nothing is configured', () => {
    render(<ServicesScreen />);
    expect(screen.getByText('Demo mode')).toBeInTheDocument();
    expect(screen.getAllByText(/Connection settings/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: /Connect to MCP gateway/ })).not.toBeInTheDocument();
  });
});
