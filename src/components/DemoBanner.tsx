/**
 * Honest connectivity banner. When a service has no base URL configured,
 * the app is in demo mode and must say so — every module degrades to a
 * labeled degraded state instead of pretending to work.
 */
import { Badge } from '@dsect/ui/components/feedback';

export interface DemoBannerProps {
  configured: boolean;
  serviceLabel: string;
}

export function DemoBanner({ configured, serviceLabel }: DemoBannerProps) {
  if (configured) return null;
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-dashed p-3"
      role="status"
    >
      <Badge tone="warn" size="sm" dot>
        Demo mode
      </Badge>
      <p className="text-sm text-text-secondary">
        No {serviceLabel} base URL configured. This screen will show live data
        once you add one in More → Connection settings.
      </p>
    </div>
  );
}
