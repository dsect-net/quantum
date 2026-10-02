import { Wordmark, Rule } from '@dsect/ui/components/brand';

export function AboutScreen() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Wordmark />
      <Rule />
      <p className="text-sm text-text-secondary">
        <strong className="text-text-primary">Quantum</strong> is DSECT's
        everything app: one mobile shell over the home lab — the hub dashboard,
        agent chat, Nebula image generation, the Hermes relay, and the
        fleet's tools — behind Tailscale identity auth, with no passwords and
        no login screen.
      </p>
      <p className="text-sm text-text-secondary">
        This build is the Phase 3 scaffold: app shell, dark-first theme,
        connection settings, and the real component kits (DSECT design-system
        + Untitled UI React). Modules land in Phase 4, one tab at a time, and
        every screen says plainly whether it shows live data or not.
      </p>
      <p className="font-mono text-xs text-text-secondary">
        quantum · Phase 3 scaffold · React 19 + Capacitor
      </p>
    </div>
  );
}
