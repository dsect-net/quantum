/**
 * Connection settings — Sol's pattern, per-service.
 *
 * Empty defaults = honest demo mode. "Use recommended" fills Scotty's
 * tailnet quick-fill (a plain network address, not a secret). Each service
 * has its own connection test. The MCP worker key and Nebula passphrase are
 * user-entered secrets stored via Capacitor Preferences / localStorage —
 * they never appear in code.
 */
import { useState } from 'react';
import { Card } from '@dsect/ui/components/surfaces';
import { Badge } from '@dsect/ui/components/feedback';
import { QButton, QInput, QToggle } from '../lib/untitled';
import { applyTheme, storeTheme } from '../theme';
import type { Theme } from '@dsect/ui/theme';
import { APP_VERSION } from '../lib/appInfo';
import {
  SERVICE_META,
  getSettings,
  isDemoMode,
  mcpKeyConfigured,
  saveSettings,
  testServiceConnection,
  validateBaseUrl,
  type QuantumSettings,
  type ServiceId,
} from '../lib/settings';
import { MAIL_META, mailStatusLine, testMailConnection } from '../lib/mail-settings';

const SERVICES: ServiceId[] = ['hub', 'nebula', 'relay', 'sol'];

type TestState = { status: 'idle' | 'testing' | 'ok' | 'err'; message?: string };

export function SettingsScreen() {
  const [settings, setSettings] = useState<QuantumSettings>(() => getSettings());
  const [errors, setErrors] = useState<Record<ServiceId, string | null>>({
    hub: null,
    nebula: null,
    relay: null,
    sol: null,
  });
  const [tests, setTests] = useState<Record<ServiceId, TestState>>({
    hub: { status: 'idle' },
    nebula: { status: 'idle' },
    relay: { status: 'idle' },
    sol: { status: 'idle' },
  });
  const [saved, setSaved] = useState(false);
  const [mailTest, setMailTest] = useState<TestState>({ status: 'idle' });
  const [theme, setTheme] = useState<Theme>(() => {
    const t = document.documentElement.getAttribute('data-theme');
    return t === 'light' ? 'light' : 'dark'; // DSECT Light boot
  });

  async function onThemeToggle(dark: boolean) {
    const next: Theme = dark ? 'dark' : 'light';
    setTheme(next);
    applyTheme(next);
    await storeTheme(next);
  }

  function updateUrl(service: ServiceId, value: string) {
    setSettings((s) => ({ ...s, [service]: { baseUrl: value } }));
    setErrors((e) => ({ ...e, [service]: validateBaseUrl(value) }));
    setSaved(false);
  }

  function useRecommended(service: ServiceId) {
    updateUrl(service, SERVICE_META[service].recommended);
  }

  async function test(service: ServiceId) {
    const baseUrl = settings[service].baseUrl;
    const err = validateBaseUrl(baseUrl);
    if (err || !baseUrl.trim()) {
      setErrors((e) => ({ ...e, [service]: err ?? 'No base URL — demo mode, nothing to test.' }));
      return;
    }
    setTests((t) => ({ ...t, [service]: { status: 'testing' } }));
    try {
      const { status } = await testServiceConnection(service, baseUrl);
      setTests((t) => ({
        ...t,
        [service]: { status: 'ok', message: `Connected — HTTP ${status}` },
      }));
    } catch (e) {
      setTests((t) => ({
        ...t,
        [service]: {
          status: 'err',
          message: e instanceof Error ? e.message : 'Connection failed',
        },
      }));
    }
  }

  async function onSave() {
    await saveSettings(settings);
    setSaved(true);
  }

  async function testMail() {
    setMailTest({ status: 'testing' });
    try {
      const { mailbox } = await testMailConnection(settings.hub.baseUrl, settings.mcpKey);
      setMailTest({ status: 'ok', message: `Connected — ${mailbox}` });
    } catch (e) {
      setMailTest({
        status: 'err',
        message: e instanceof Error ? e.message : 'Connection failed',
      });
    }
  }

  const hasErrors = SERVICES.some((s) => errors[s] !== null);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-lg font-semibold">Connection settings</h2>
        <p className="text-sm text-text-secondary">
          Leave a service blank to keep it in demo mode. Nothing here is
          secret except the two credential fields below — those stay on this
          device.
        </p>
      </div>

      {SERVICES.map((service) => {
        const meta = SERVICE_META[service];
        const testState = tests[service];
        return (
          <Card key={service}>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{meta.label}</h3>
                {testState.status === 'ok' && (
                  <Badge tone="ok" size="sm" dot>
                    {testState.message ?? 'Connected'}
                  </Badge>
                )}
                {testState.status === 'err' && (
                  <Badge tone="err" size="sm" dot>
                    Failed
                  </Badge>
                )}
              </div>
              <p className="text-sm text-text-secondary">{meta.description}</p>
              <QInput
                label={`${meta.label} base URL`}
                hint={errors[service] ?? testState.message ?? 'Empty = demo mode.'}
                placeholder="https://…"
                value={settings[service].baseUrl}
                onChange={(v) => updateUrl(service, v)}
                isInvalid={errors[service] !== null}
              />
              <div className="flex flex-wrap gap-2">
                <QButton
                  color="secondary"
                  size="md"
                  onPress={() => useRecommended(service)}
                >
                  Use recommended
                </QButton>
                <QButton
                  color="secondary"
                  size="md"
                  onPress={() => test(service)}
                  isDisabled={testState.status === 'testing'}
                  isLoading={testState.status === 'testing'}
                >
                  Test connection
                </QButton>
              </div>
            </div>
          </Card>
        );
      })}

      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">{MAIL_META.label}</h3>
            {mailTest.status === 'ok' && (
              <Badge tone="ok" size="sm" dot>
                {mailTest.message ?? 'Connected'}
              </Badge>
            )}
            {mailTest.status === 'err' && (
              <Badge tone="err" size="sm" dot>
                Failed
              </Badge>
            )}
          </div>
          <p className="text-sm text-text-secondary">{MAIL_META.description}</p>
          <p className="text-sm text-text-secondary">{mailStatusLine(settings)}</p>
          {mailTest.message && mailTest.status !== 'ok' && (
            <p className="text-sm text-text-danger">{mailTest.message}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <QButton
              color="secondary"
              size="md"
              onPress={() => void testMail()}
              isDisabled={mailTest.status === 'testing'}
              isLoading={mailTest.status === 'testing'}
            >
              Test mail connection
            </QButton>
          </div>
          <p className="text-xs text-text-tertiary">{MAIL_META.note}</p>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">Credentials (this device only)</h3>
          <QInput
            label="MCP worker key"
            type="password"
            hint="Bearer key for the hub /mcp gateway. Stored on-device; never sent anywhere else."
            value={settings.mcpKey}
            onChange={(v) => setSettings((s) => ({ ...s, mcpKey: v }))}
          />
          <QInput
            label="Nebula passphrase"
            type="password"
            hint="Only needed off-tailnet. On the tailnet, identity headers handle auth."
            value={settings.nebulaPassphrase}
            onChange={(v) => setSettings((s) => ({ ...s, nebulaPassphrase: v }))}
          />
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <QButton color="primary" onPress={onSave} isDisabled={hasErrors}>
          Save settings
        </QButton>
        {saved && (
          <Badge tone="ok" size="sm">
            Saved
          </Badge>
        )}
      </div>

      <Card>
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">Appearance</h3>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block font-medium">Dark theme</span>
              <span className="block text-sm text-text-secondary">
                DSECT Light is the default; dark is available. The choice is
                remembered on this device.
              </span>
            </span>
            <QToggle
              aria-label="Dark theme"
              isSelected={theme === 'dark'}
              onChange={onThemeToggle}
            />
          </label>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">About this app · diagnostics</h3>
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-text-secondary">App</dt>
              <dd className="font-mono">Quantum {APP_VERSION}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-text-secondary">Theme</dt>
              <dd className="font-mono">{theme}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-text-secondary">Mode</dt>
              <dd>
                {isDemoMode(settings) ? (
                  <Badge tone="warn" size="sm" dot>
                    Demo mode
                  </Badge>
                ) : (
                  <Badge tone="ok" size="sm" dot>
                    Configured
                  </Badge>
                )}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-text-secondary">MCP key</dt>
              <dd>
                {mcpKeyConfigured(settings) ? (
                  <Badge tone="ok" size="sm" dot>
                    Entered
                  </Badge>
                ) : (
                  <Badge tone="slate" size="sm">
                    Not entered
                  </Badge>
                )}
              </dd>
            </div>
          </dl>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-text-secondary">Connection tests</span>
            {SERVICES.map((service) => {
              const t = tests[service];
              return (
                <div key={service} className="flex items-center justify-between gap-2 text-sm">
                  <span>{SERVICE_META[service].label}</span>
                  {t.status === 'ok' ? (
                    <Badge tone="ok" size="sm" dot>
                      {t.message ?? 'Connected'}
                    </Badge>
                  ) : t.status === 'err' ? (
                    <Badge tone="err" size="sm" dot>
                      Failed
                    </Badge>
                  ) : (
                    <Badge tone="slate" size="sm">
                      Not tested
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-text-secondary">
            Keys never leave this device; they appear here only as "entered /
            not entered", never as values.
          </p>
        </div>
      </Card>
    </div>
  );
}
