import type { CapacitorConfig } from '@capacitor/cli';

// Quantum — DSECT's everything app.
// Fully static: the bundled web app runs offline inside the native shell.
// All backends are optional; empty settings = honest demo mode.
const config: CapacitorConfig = {
  appId: 'net.dsect.quantum',
  appName: 'Quantum',
  webDir: 'dist',
  android: {
    // Edge-to-edge like Sol: the kit's safe-area tokens handle insets.
    backgroundColor: '#0A0C10',
  },
};

export default config;
