# ShotTime review handoff

Source version: 1.21.0, Android versionCode 42, package ca.kylekeith.shottime (not yet built, signed or device-tested). The last signed release is 1.19.1, versionCode 40, in release/.
The owner reports the current app is working. This package is for an independent code review, not a requested redesign or automatic deployment.

## Give Claude Code this task

Review this Android application end to end. Read START-HERE.md, README.md, and REVIEW-BRIEF.md first. Run the three active test suites where possible. Trace calculations independently and inspect saved settings, draft restoration, calibration, and Android print lifecycle. Report findings by severity with file/line references, concrete reproduction steps, impact, and proposed fixes. Distinguish reproduced failures from suspected risks and physical-device validation gaps. Do not change source, calculation assumptions, reference times, signing identity, or publish a release without discussing findings with me. Do not claim that matching the supplied targets validates physical radiographic exposures.

## Test setup

Prerequisites: Node.js compatible with Playwright 1.62.1, npm and Python 3. This handoff has no node_modules and no lockfile; the directly used Playwright version is pinned in package.json.

```sh
npm install
npx playwright install chromium
npm test
```

On Linux, browser system dependencies may also be required. For an existing browser executable, run `CHROME_BINARY=/absolute/path/to/chromium npm test` instead. The tests use a routed local origin and do not require hosting the app.

## Android compilation without private credentials

Prerequisites: Bash, Python 3, JDK 17, Android SDK platform android-36 and build-tools 36.0.0.

```sh
SDK_ROOT=/absolute/path/to/android-sdk bash build-review.sh
```

This creates dist/ShotTime-review-unsigned.apk. It checks packaging and compilation but is not directly installable. Signing it with a review-only key would not let it update the owner's existing installation. Use a separate emulator/profile for independently signed testing.

The original build.sh is included unchanged and requires the owner's private signing files. Those files are deliberately absent. Do not generate a replacement production key. The signed APK in release/ is the existing reference release, not a newly modified build.

## Contents and provenance

- assets/: HTML/JS UI, calculation module, baseline geometry/film data.
- src/ and res/: native Android wrapper, print flow, icon and styles.
- tests/: three active suites; tests/legacy/ are archived, non-runnable historical harnesses.
- scripts/: original baseline data and regeneration script; workbook-baselines.json is historical and unused by the current calculator.
- release/: the signed 1.19.1 APK matching the supplied production source assets.
- SHA256SUMS: hashes of every included file except the manifest itself.

No signing keystore, signing password, browser profile, node_modules, build cache or private signing backup is included. Prior source-backup versions contained credentials; do not request or redistribute them for review.
