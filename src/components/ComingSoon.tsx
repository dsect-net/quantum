/**
 * Honest placeholder for Phase-4 modules. Never fakes functionality:
 * it names the module, the real data source it will use, and that it is
 * not built yet.
 */
import { EmptyState } from '@dsect/ui/components/feedback';
import { Badge } from '@dsect/ui/components/feedback';

export interface ComingSoonProps {
  module: string;
  source: string;
}

export function ComingSoon({ module, source }: ComingSoonProps) {
  return (
    <EmptyState
      mark="◌"
      title={module}
      text={
        <>
          Coming soon — Phase 4. This module will read live data from{' '}
          <span className="font-mono">{source}</span>. Nothing here is wired
          up yet, so there is nothing to fake.
        </>
      }
      actions={
        <Badge tone="slate" size="sm">
          Phase 4
        </Badge>
      }
    />
  );
}
