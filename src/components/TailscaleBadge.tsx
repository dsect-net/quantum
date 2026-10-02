/**
 * TailscaleBadge — small honest connectivity badge for the app header.
 *
 * Green "Tritium connected" when the tailnet answers, amber
 * "Tailscale may be off" when the internet works but the tailnet doesn't,
 * red "Offline" when nothing does. Hides itself when no tailnet URLs are
 * configured. Tapping it jumps to Connection settings.
 */
import { Badge } from '@dsect/ui/components/feedback';
import { TAILNET_LABEL, useTailscaleStatus, type TailnetState } from '../lib/tailscale';
import type { Tone } from '@dsect/ui/components/feedback';

const TONE: Record<Exclude<TailnetState, 'unconfigured'>, Tone> = {
  connected: 'ok',
  'tailscale-off': 'warn',
  offline: 'err',
};

export function TailscaleBadge({ onPress }: { onPress?: () => void }) {
  const { state, probeUrl } = useTailscaleStatus();
  if (state === 'unconfigured') return null;
  const label = TAILNET_LABEL[state];
  const detail =
    state === 'connected'
      ? `Reached ${probeUrl}`
      : state === 'tailscale-off'
        ? `${probeUrl} didn't answer, but the internet works — check the Tailscale app on this device.`
        : 'No internet connection detected.';
  return (
    <button
      type="button"
      onClick={onPress}
      title={detail}
      aria-label={`Connection status: ${label}. ${detail}`}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: onPress ? 'pointer' : 'default',
      }}
    >
      <Badge tone={TONE[state]} size="sm" dot>
        {label}
      </Badge>
    </button>
  );
}
