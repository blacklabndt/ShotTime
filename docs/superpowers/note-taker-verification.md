# Local Note Taker verification — 2026-09-30

Stage: local lists, typed instruction parser, editing and export. Voice and synchronization remain separate work.

## Evidence

- Original calculator, UI and settings suites passed after integration.
- Note model, parser, storage and browser UI suites passed before independent review.
- Independent reviewer found three Important defects: configured CN format ignored by typed batches, historical CN formats breaking later changes, ambiguous CN/XF targets updating multiple interpretations.
- Added failing regression checks for all three and implemented fixes: numeric CN identity is retained, unchanged CN formatting is not rewritten when changing XF only, and competing CN/XF correction targets require review.
- Additional browser regression covers future-only CN settings followed by typed entry and an all-row format change.
- Phone layout inspected at 412 × 915; browser behavior checks cover 360 and 1280 pixels.
- SHA-256 comparison against the supplied ZIP confirms calculator.js and techniques.json are byte-for-byte unchanged.

## Limits and deferred minor findings

- No Android SDK/JDK found in PATH or the standard local Android SDK location. Native compilation and installation were not run. No signed build produced; signing backup untouched.
- Actual Excel paste appearance, including protected numeric identifiers, still needs checking in the owner's template.
- Reviewer identified additional desirable UI coverage: clipboard success, keyboard focus/back and corrupt-storage screen. Current tests cover clipboard rejection, storage corruption at the data layer, and future-only formatting. More UI coverage is deferred.
- New JavaScript follows the existing compact style; expanding long lines for easier maintenance is deferred.

## Execution rulings

- Used the imported source folder on codex/note-taker instead of moving untracked source into another checkout. Cost: this remains the single working checkout.
- Used per-command Codex commit identity because the local repository has no configured Git author; no global Git configuration changed.
- Retained the local feature branch. There is no configured upstream/base branch or publication request; no push or merge attempted.

The local-lists milestone does not establish speech accuracy, Bluetooth support, screen-locked recording, or computer synchronization.

Final verification: npm test completed with exit code 0 after all three review fixes; all seven suites passed.


### Build tool installation follow-up — 2026-09-30

Installed Temurin JDK 21.0.12.1, Android command-line tools, Android platform 36, Build Tools 36.0.0 and platform-tools. Reused the existing SDK directory, preserving older packages. Added build-review.ps1 for native PowerShell builds. The unsigned APK compiled, zipaligned and passed aapt package inspection (package ca.kylekeith.shottime, min 26, target 36). This supersedes the earlier missing-toolchain limitation. Device behavior remains untested; signing backup remains untouched.
