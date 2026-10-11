# Shot-time countdown

Status: implemented for 1.88 after the owner approved the compact rolling-digit preview, default alarm sound and explicitly requested the build. See docs/SHOT-TIMER-1.88.md for delivered behavior and verification limits.

## Intended result

The owner can tap an external, internal or internal-offset time in the Shot Time Calc list, prepare a floating countdown, and press Start when ready. One timer continues while RT Handbook is backgrounded. An optional draggable overlay keeps it visible above other apps. A notification supplies controls and completion alerts, including with the screen locked.

The timer counts a selected duration. It does not control radiography equipment or change exposure calculations. The CR estimation study remains separate and is not enabled by this feature.

## Approved interaction and defaults

- Tap a numeric shot time to prepare a timer; tapping never starts it automatically.
- The card shows spool size, schedule, film/CR and shot type, followed by large remaining time. Use the existing charcoal/copper appearance and accessible contrast.
- Preview refinement requested by owner: compact card (approximately 280 px wide and 232 px tall in the web preview), with 44 px minimum action targets. Roll only changed countdown digits vertically in about 280 ms with the same easing as the calculator's opening numbers. Keep the colon and unchanged digits stationary; do not reanimate per redraw. Respect reduced-motion/system animator settings and show the exact current value immediately when motion is disabled. Pause stops digit changes; animations never determine elapsed time. Preview: outputs/shot-timer-preview.html under the workspace root.
- Start, Pause/Resume, Reset and Close are available as appropriate to the current state. Reset returns to the original selected duration and waits for Start. Close cancels the timer and removes its alarm and notifications.
- Drag the card by its header; control taps must not initiate dragging. Keep the window within usable screen bounds after rotation, resizing and keyboard changes. Remember the preferred position as relative coordinates.
- One active timer. Tapping the same time reopens it. Tapping a different time while a timer is running or paused prompts to replace it. Cancel preserves the original deadline and label; replacement returns to Ready and requires Start.
- Minimize hides the card without cancelling; the ongoing notification reopens it. Use an explicit minimize icon distinct from Close.
- On completion show 00:00 and Time up, with sound and vibration subject to Android alarm volume, notification settings and Do Not Disturb. Acknowledge silences the alert; Reset prepares the same duration again.
- Do not display an overlay over the lock screen or launch a full-screen activity. The lock-screen notification is the supported locked-screen presentation.
- Prepared durations and labels are snapshots: subsequent source-decay updates, filter changes and corrections do not change a running timer.

## Entry points and values

`assets/index.html` currently creates external, internal and internal-offset values in the shot-list renderer. Convert only available numeric values to accessible buttons with contextual labels. Preserve the visual layout, opening number animation and print output. Missing chart entries, unavailable internal values and displayed zero seconds are not startable.

Use the exact rounded whole-second duration displayed to the user, obtained from calculator functions, not parsed from visible text or the number animation. Film internal/offset and CR internal/offset must retain their different existing rounding rules. Accept durations from 1 second through 7 days; display an explicit explanation for longer values instead of overflowing a timer or truncating time. This limit affects the timer only.

Custom Shot and multiple simultaneous timers are outside this first version. No calculator, QC storage or signing-identity changes are needed.

## Architecture

Use a native timer subsystem separate from VoiceService and the WebView:

1. `ShotTimerState.java`: platform-independent state machine with injected elapsed time. Ready, Running, Paused, Finished, Interrupted and Closed states; original duration, paused remainder, monotonic deadline, revision and unique timer/run identifiers.
2. `ShotTimerStore.java`: one bounded private persistent record. Store label fields, state, deadline, boot identity and action revision. Persist state transitions, not per-second ticks. A failed write must leave the previous state intact and report failure.
3. `ShotTimerService.java`: sole coordinator for native commands, notification, current timer and overlay. Use a dedicated `specialUse` foreground-service declaration and explanation for the user-visible floating countdown. Never reuse the microphone service type.
4. `ShotTimerAlarmReceiver.java`: explicit, non-exported exact-alarm endpoint. Validate run identity and current persisted state before completing the timer. Both service deadline detection and alarm delivery enter the same idempotent completion transition.
5. `ShotTimerView.java`: shared native card presentation. Attach inside MainActivity when visible, or as `TYPE_APPLICATION_OVERLAY` when the app is backgrounded and overlay access is granted. Never show both copies. The notification is available independently of overlay permission.
6. MainActivity integration: a narrowly allowlisted `shottime://timer/prepare` navigation from the main WebView and a user gesture. Validate bounded numeric duration, enumerated shot type and length-limited plain-text labels. No new general JavaScript bridge, arbitrary Intent URI handling, remote navigation or print-WebView command access.

Native service intents, alarms and notification actions use explicit components, immutable PendingIntents and separate identities from voice/backup actions. Stale Pause, Resume, Close or completion actions cannot affect a replacement timer. Serialize transitions on one coordinator thread and validate revision/run ID before mutation.

## Timing and background operation

- Compute remaining time from `SystemClock.elapsedRealtime()`, which includes device sleep. UI tick frequency affects redraw only; missed ticks must never extend the countdown.
- Store the elapsed deadline and boot identity. A same-boot process recreation restores the current remainder, rather than restarting the duration. An expired deadline becomes Finished once. A device reboot makes a previously running timer Interrupted; it never silently starts again.
- Schedule a user-visible `AlarmManager.setAlarmClock` completion alarm when Start or Resume succeeds. This supports waking from idle; Android may show it as the next alarm. Derive the alarm's wall-clock trigger from the monotonic remainder. Reconcile system clock changes by rescheduling while preserving elapsed duration.
- Persist the running record before scheduling. If scheduling fails, roll back to a recoverable non-running state and show the error. On pause/reset/close cancel the exact alarm; cancelled/stale deliveries are also rejected by run ID and state.
- Start the foreground service from a visible user action. The service restores its record after ordinary process reclamation; the scheduled explicit alarm is independent of the WebView. Do not promise survival of force-stop, reboot or Android's user-initiated service Stop action.
- Do not hold a CPU wake lock throughout the countdown. Use a bounded wake lock only while delivering completion and release on all failure paths. Per-second redraws stop when no timer window is visible; use the native notification countdown chronometer.
- At zero use an alert notification with alarm audio attributes and vibration. No silent-mode/DND bypass, maximum-volume changes or audio-route changes. Alert delivery is idempotent and cancellable. A completed background overlay is dismissed after 60 seconds to release the service; the completion notification and Finished record remain available. If the app is visible, its finished card remains until dismissed/reset.
- Paused timers retain their notification and optional visible overlay; they have no scheduled completion alarm. Closing or resetting ends active foreground work when there is no background window to maintain. Any service termination detaches windows and releases resources without deleting a legitimately running persisted deadline.

## Permission handling

- Request notifications at first Start when required by Android, and explain that they provide background controls and completion alerts. If notification access is denied, preserve Ready and explain how to enable it; do not claim an alerting background timer was started.
- Request Alarms & reminders access on Android versions requiring it before scheduling. On returning from settings, recheck access and keep the timer Ready so the user explicitly starts it. Do not silently substitute an inexact alarm.
- Offer Show over other apps as an optional toggle on the card. The first enable opens Android overlay settings. Denial/revocation leaves the timer and notification working without an overlay. Keep a native in-app card even without overlay access.
- Recheck relevant permissions on resume and before actions. If Android revokes exact-alarm access, restore a truthful Interrupted state on next launch instead of showing a working countdown. Foreground-service launch failure leaves Ready/Paused and does not consume the requested duration.
- Respect notification-channel sound/vibration preferences. If the completion channel is muted, show a brief status next to Start rather than suggesting sound is guaranteed.

## Alternatives considered

A WebView-only popup cannot reliably remain visible over other apps or deliver screen-off completion. Notification-only timing needs fewer permissions but does not provide the requested floating window. The native card plus optional overlay and independent alarm supplies both, with notification fallback when overlay access is declined. Picture-in-picture is not used for this non-video utility.

## Verification and completion criteria

- Pure Java state tests: prepare/start/pause/resume/reset/close, delayed ticks, wall-clock changes, same-boot recovery, reboot interruption, zero/invalid/oversized durations, duplicate completion and stale actions after replacement.
- Browser tests: all three time columns launch the right rounded duration and context; unavailable values are inert; keyboard activation works; running snapshot remains unchanged after filters or source updates; current print output and opening animations remain intact.
- Native compilation and tests: exact URI/Intent validation, separate notification identities, persistence failure, permission denial/revocation, alarm cancellation, overlay cleanup and timer/voice coexistence.
- Device test on the owner's Samsung: start then Home, overlay drag and controls, lock/unlock, completion while asleep, pause beyond the original deadline, replace/cancel, denied permissions, rotation, process recreation and explicit force-stop recovery. State clearly which handset tests remain unperformed.
- Do not call background reliability verified based solely on a browser test or APK compilation.
- Preserve existing exposure data, source calculations, voice recording, exports, offline charts, CSP and storage. No CR candidate exposure is enabled by this work.

## Android references reviewed

- Overlay permission: https://developer.android.com/reference/android/provider/Settings#canDrawOverlays(android.content.Context)
- Foreground service types: https://developer.android.com/develop/background-work/services/fgs/service-types
- Exact alarms, permission and alarm-clock behavior: https://developer.android.com/develop/background-work/services/alarms

## Next stage

Implementation plan: docs/superpowers/plans/2026-10-08-shot-countdown-plan.md. The coordinator is shared by the service, receiver and Activity on the main thread. Actual Samsung overlay, alarm-sound and screen-off behavior still need handset verification; no connected device was available during the build.
