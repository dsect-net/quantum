/**
 * About Quantum — dsect.dev content in-app.
 *
 * Static copy from dsect.dev (About / Divisions / Principles), plus what
 * Quantum is as an app: the honest-state rule, the data sources per tab,
 * and contact. Static content is honest content — it does not change day
 * to day.
 */
import { Wordmark, Rule, DivisionTag } from '@dsect/ui/components/brand';
import { Card } from '@dsect/ui/components/surfaces';

const DIVISIONS = [
  {
    tag: 'systems' as const,
    name: 'DSECT Systems',
    text: 'The physical estate everything runs on: hardware, home servers, networking and self-hosted infrastructure.',
  },
  {
    tag: 'software' as const,
    name: 'DSECT Software',
    text: 'Products and tools people use: applications, developer tools, libraries and the interfaces that tie them together.',
  },
  {
    tag: 'labs' as const,
    name: 'DSECT Labs',
    text: 'Research into multi-agent systems and local-first AI, written up as studies and technical reports.',
  },
];

const PRINCIPLES = [
  {
    name: 'Local-first',
    text: 'Our models, data and tools run on hardware we control. Rented capability is used deliberately, not depended on.',
  },
  {
    name: 'Evidence over assertion',
    text: 'A result is published with how it was measured, including what didn’t work.',
  },
  {
    name: 'Private by default, public by choice',
    text: 'Work is built in private and released on purpose, when it is ready to be useful to someone else.',
  },
  {
    name: 'A small team, amplified',
    text: 'One founder working with a team of AI agents. Every piece of work is signed by whoever made it.',
  },
];

export function AboutScreen() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Wordmark />
      <Rule />

      <section className="flex flex-col gap-2">
        <p className="text-sm text-text-secondary">
          <strong className="text-text-primary">DSECT</strong> — Developmental
          Systems, Engineering &amp; Computing Technologies. An independent
          technology lab. We take hard problems apart until they are
          understood, then build what they need: systems, software and
          research that are local-first, measured, and owned.
        </p>
        <p className="text-sm text-text-secondary">
          <strong className="text-text-primary">Quantum</strong> is DSECT's
          everything app: one mobile shell over the home lab — the hub
          dashboard, agent chat, Nebula image generation, the Hermes relay,
          and the fleet's tools — behind Tailscale identity auth, with no
          passwords and no login screen.
        </p>
        <p className="text-sm text-text-secondary">
          Every module shows real data or says plainly what it shows instead:
          live, a labeled snapshot, local-only, or demo mode. That is the
          house rule, and it is why unbuilt modules say "Phase 4" instead of
          pretending.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Three divisions</h2>
        {DIVISIONS.map((d) => (
          <Card key={d.tag}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <DivisionTag division={d.tag}>{d.name}</DivisionTag>
              </div>
              <p className="text-sm text-text-secondary">{d.text}</p>
            </div>
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">How we work</h2>
        {PRINCIPLES.map((p) => (
          <Card key={p.name}>
            <h3 className="font-semibold">{p.name}</h3>
            <p className="text-sm text-text-secondary">{p.text}</p>
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Contact</h2>
        <p className="font-mono text-sm">contact@dsect.net</p>
        <p className="font-mono text-xs text-text-secondary">
          © 2026 DSECT · Decompose. Then build.
        </p>
      </section>
    </div>
  );
}
