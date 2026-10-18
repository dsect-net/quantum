/**
 * Capacitor config — The Singularity on Android & Apple platforms.
 *
 * The same Vite build (`dist/`) is synced into native shells:
 *   npx cap add android && npx cap sync android
 *   npx cap add ios && npx cap sync ios
 * Package id `net.dsect.singularity` (sibling of `net.dsect.quantum`).
 * See docs/SINGULARITY-PLATFORMS.md for Google TV / WearOS / Android Auto.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'net.dsect.singularity',
  appName: 'The Singularity',
  webDir: 'dist',
  backgroundColor: '#f6f7f9',
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
