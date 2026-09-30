# Review brief

## Intended behavior to preserve

Offline Ir-192 calculator for carbon-steel double-wall pipe radiography. Darkroom UI with compact results. All six film types use the owner's approximate calculator-reference targets, with density 3.5 interpolated. See README's authoritative target table and calculator.js. Reference activity is 26 Ci. Small-film targets use 3-inch STD; large-film targets use 4-inch STD.

Small belts: 1–3 inches, D4/MX125/Fuji IX50. Medium and large belts: 4–16 inches, D5/T200/Fuji IX80. One film per group. Pipe sizes and schedules are multi-select; schedule aliases must not duplicate rows. Density choices are 2, 2.5, 3, 3.5 and 4.

SFD is 12 inches for 1-inch pipe and OD +0.125 inches otherwise. 73 geometry rows × 3 applicable films × 5 densities = 1,095 exposure combinations. Runtime exposure calculation scales stored original Ci·s by a reference-target ratio. A successful reference-target check is not independent validation of attenuation across every thickness.

Film-wide and size/schedule correction factors multiply together and are density-specific. Reset means 1.00 against the current built-in baseline. Preserve effective exposure on supported saved-factor migration; do not reapply migrations on restart. Older model namespaces are retained but generally inactive. Approximate external-calculator targets are not measured film-density calibrations.

Normal and Internal times round to nearest second. Internal = unrounded final time /9; Internal offset = unrounded final time ×1.15 /4 rounded upward. Both internal columns apply only to 6-inch and larger pipes. The owner explicitly chose to retain possible 0-second display values.

Print only activity, target density and local date above a narrow vertical table. Table columns: Pipe, Schedule, Time, Internal, Internal offset, with centered time headers/values. No film column, wall/SFD columns, notes or footer. Do not reintroduce the removed Starting estimates banner or Detailed view.

## Areas deserving scrutiny

1. Native print callbacks and cleanup: preparation timeout, renderer failure, repeated printing/canceling, rapid taps, Activity recreation and app-background interactions. Main UI and snapshot WebViews may share a renderer. Do not interrupt active document writes when recovering.
2. Saved-factor namespaces and migrations: previous models, baseline changes, legacy localStorage keys, incomplete/malformed settings, failed writes and retry. Review tiny migrated factors and form validation consistency.
3. Draft restoration: dependent select options, pending helper review, current source versus edited source, density changes, rotating, and restoring during printing.
4. Calibration helper: distinction between film-wide and per-size factors, existing multipliers, and whether displayed explanations match the result.
5. Date/decay behavior: local civil dates, leap dates, midnight, DST and timezone changes, and manual versus decay source provenance.
6. Print/UI parity across all film/density combinations and correction settings, including floating-point boundary rounding and very large/short times.
7. Compatibility: Android 8 minimum does not guarantee compatibility with every old WebView. Test modern JS, dialogs, localStorage and viewport CSS on supported devices.
8. Accessibility: TalkBack, font scaling, keyboard focus, contrast and modal behavior. Dark UI is not a certified film-safe safelight.
9. Build reproducibility and signing: preserve app ID/key; review-only unsigned build avoids credentials. No Gradle wrapper is used.

## Existing validation and limits

The three active suites passed in the original workspace. The cleanup was compared against the previous release: all 1,095 exposures and the six density-3 migration multipliers matched exactly. APK v2/v3 signatures validated. These are software checks only.

The owner reports the app appears to work. No physical Android emulator/device integration tests were run by the build assistant. Print-service, upgrade-installation, rotation, process-recreation and accessibility tests still require device verification. Historical tests and screenshots are not current evidence.

## Requested review output

Lead with actionable findings, most severe first. Include file/line, reproduction or reasoning, affected users, and proposed remedy. Identify any test gaps and stale documentation separately. Mark unsupported suspicions clearly. If no high-severity issues are found, say so rather than inventing issues. Keep the current numerical behavior unchanged unless a demonstrated bug is discussed with the owner.
