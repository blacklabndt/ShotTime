# Shot timer — 1.88

Tap an external, internal or internal-offset time in Shot Time Calc to prepare a countdown. Start begins it; Pause/Resume, Reset, Close and minimize are available. Only available values from 1 second through 7 days are linked. The timer freezes the exact displayed rounded seconds and context; later calculator changes do not affect it.

The compact native card has rolling digits, system reduced-motion support and a draggable header. Position is remembered. Float enables the optional overlay after Android's Display over other apps access is granted. Without it, a notification supplies background controls; the in-app card still works. Notifications and Alarms & reminders access are required before starting, with no automatic start after granting access.

The native elapsed-time deadline includes sleep. An independent exact alarm-clock event handles completion, with the system default alarm sound and vibration through a dedicated notification channel. Android volume, channel preferences and Do Not Disturb still apply. The alarm may appear as Android's next alarm. No fullscreen or lock-screen overlay is used. Completed background overlays clear after about one minute, retaining the completion notification.

One timer is active at a time. A different shot requires replacement confirmation; old notification actions and alarm deliveries carry obsolete tokens and cannot replace or cancel the new timer. State transitions persist privately. Reboot interrupts an unfinished timer. Force-stop, Android's Stop control and permission revocation are not promised to preserve an alert; check the displayed state on return.

Implementation: ShotTimerState and ShotTimerStore hold immutable snapshots; ShotTimer serializes actions and hosts views; ShotTimerService owns foreground execution; ShotTimerAlarmReceiver receives the independent completion event; ShotTimerCard renders the compact controls. MainActivity accepts only a user-gesture main-WebView timer URI with bounded parameters. No general JavaScript bridge was added.

Validation: pure Java state tests; new timer-link browser tests for film and CR rounding, unavailable entries, context, three mobile widths and print isolation; existing calculator, current UI, opening-roll and release consistency tests. Android compiled successfully. No connected Android device was available; actual overlay placement, permission prompts, default alarm playback, screen-off delivery and process recovery still require Samsung handset testing.

Original CR chart data, provisional CR analysis, film factors and all calculation rules are unchanged. This release implements the timer, not the extrapolated CR entries. Signed build verification is recorded separately in dist.
