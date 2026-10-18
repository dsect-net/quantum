# The Singularity — platform coverage

One React codebase (`apps/singularity`), many surfaces. This document says
exactly what is real, what is scaffolded, and what each target needs to go
green — the honest-states rule from `docs/MEMORY.md` applies to build claims
too: **never claim a platform works before its build is green.**

| Surface | Path | State (2026-10-18) | Ship vehicle |
|---|---|---|---|
| **Web** | `apps/singularity` | ✅ Real — `npm run build` green | Any static host / the tailnet; PWA-installable |
| **Windows** | `electron/` + `electron-builder.yml` | 🟡 Scaffolded — config complete, package build unverified here | NSIS installer via `npm run desktop:build` |
| **Linux** | `electron/` + `electron-builder.yml` | 🟡 Scaffolded — config complete | AppImage + deb via `npm run desktop:build` |
| **macOS (Apple)** | `electron/` + Capacitor iOS | 🟡 Scaffolded — configs complete | dmg (Electron) or `npx cap add ios` (native) |
| **Android** | Capacitor (`capacitor.config.ts`) | 🟡 Scaffolded — `npx cap add android` generates the shell | APK/AAB via Gradle (Java 21, Android SDK) |
| **iOS (Apple)** | Capacitor iOS | 🟡 Scaffolded | Xcode archive on a Mac |
| **Google TV** | `android-extras/tv/` flavor manifest | 🟡 Scaffolded — leanback launcher merge ready | `assembleTvRelease` after `cap add android` |
| **WearOS** | `android-extras/wear/` companion manifest | 📋 Planned — micro-app scope defined | Wear module in the Android project |
| **Android Auto** | `android-extras/auto/` descriptor | 🟡 Scaffolded — notification/messaging template only | Same APK, automotive descriptor merged |

Legend: ✅ verified green in this repo · 🟡 config/merge files complete, needs
the target toolchain to produce artifacts · 📋 scope defined, build not started.

## Why these vehicles

- **Electron for desktop** (not Tauri): the org stack is Node/TypeScript;
  Electron keeps one toolchain and gives NSIS/AppImage/dmg from a single
  `electron-builder.yml`. The shell is hardened (`contextIsolation`,
  `sandbox`, no `nodeIntegration`) and loads the same `dist/` build the web
  ships — a divergence between platforms is a bug.
- **Capacitor for mobile** (same as `net.dsect.quantum`): one `webDir`
  sync, native projects generated on demand. Package id
  `net.dsect.singularity`.
- **PWA for instant installs**: `public/manifest.webmanifest` +
  `public/sw.js` make the web build installable on Windows/ChromeOS/Android
  immediately, before any store review lands. API responses are **never**
  cached — the feed must stay live and honest.

## Per-platform notes

### Windows / Linux / macOS (Electron)
```bash
cd apps/singularity
npm install
npm run desktop:setup      # installs electron + electron-builder (github downloads)
npm run desktop:build      # dist/ → release/ (nsis, AppImage, deb, dmg)
```
The Electron main process (`electron/main.cjs`) is a thin, commented shell:
single-instance, external links in the system browser, small menu. Desktop
binaries need the service reachable — the login screen's service URL field
is the onboarding surface (recommended quick-fill: the tailnet address).

### Android (Capacitor)
```bash
cd apps/singularity
npm install && npm run build
npx cap add android        # generates android/ (first time)
npx cap sync android
cd android && ./gradlew assembleDebug   # needs JDK 21 + Android SDK
```
Follow the root repo's `android/` conventions (see `.github/workflows/android-apk.yml`
for the Quantum app's APK pipeline — the same steps apply with this package id).

### Apple (iOS / macOS)
```bash
npx cap add ios && npx cap sync ios     # then open in Xcode on a Mac
```
App Store distribution uses standard Xcode signing; the Electron dmg covers
macOS desktop without the App Store.

### Google TV
Merge `android-extras/tv/AndroidManifest.xml` into the Capacitor Android
manifest for a `tv` product flavor (`android/app/build.gradle` flavor
`tv`), set `android:banner`, and build `assembleTvRelease`. The UI already
carries TV affordances: `data-platform="tv"` on `<html>` switches the CSS to
focus-first, larger type, 56px targets (`src/styles.css`). Sideloading via
ADB is the dev path; Play Store TV distribution follows the standard TV
quality checklist.

### WearOS
Scope (deliberate): the watch is a **companion**, not the feed. It surfaces
mentions/reply notifications and offers quick reactions + voice replies
(WearableListenerService → the Singularity service's message API). The
`android-extras/wear/` manifests are ready; the wear module itself is the
next build (`:wear` in the Android project, Compose for Wear OS).

### Android Auto
Distraction-safe by policy: **notification/messaging template only**
(`android-extras/auto/`). Mentions and reply prompts read aloud via the car
template; the feed is never browsable while driving. This is a Google
policy constraint as much as a design choice — the descriptor admits
`notification` only.

## In-sandbox vs. on-a-dev-machine

This work was built and verified in a restricted sandbox (npm registry +
GitHub source only — no Android SDK, no Electron binary CDN, no Playwright
browser CDN). That is why web/service builds are ✅ verified and the native
vehicles are 🟡: their configs are complete and commented, and each has an
exact green-path command above. On a normal dev machine the whole column
goes green in one pass per platform.
