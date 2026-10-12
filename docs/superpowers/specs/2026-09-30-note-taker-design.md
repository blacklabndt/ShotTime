# ShotTime Note Taker design

Date: 2026-09-30
Status: Proposed for owner review; not implemented.

## Outcome

Add Note Taker to the existing hamburger navigation. The owner walks through a bunker, dictates multiple pipe batches, then transfers individual weld rows into an Excel report on a computer. Target phone: Samsung Galaxy S26 Ultra. Internet is normally available. Support phone and Bluetooth microphones, and recording during an explicitly started session with the phone locked. Device testing must establish actual reliability.

## Agreed requirements

- Lists are titled by date and LSD; owner supplies starting XF number.
- Exact export order: CN#s, XF#s, WID, Weld Size, Weld Schedule.
- One row per weld. CN can repeat; XF increments in dictated order.
- CN/XF formats support configurable prefix, separator and minimum numeric width. Preserve identifier text and leading zeroes. Formatting changes ask whether to affect existing rows or only future rows; duplicate identifiers must be prevented.
- WID is text: O, X, RG, DD, W-24, W-69. Spoken welder, welded by, Welder ID and WID identify the same field. Assign it by batch, individual XF, or XF range.
- Remember current CN and welder and display them. Understand common size/schedule variations; preserve STD, XS and numeric schedules distinctly rather than silently equating them.
- Large microphone control starts/stops continuous listening. Pauses do not deliberately end a session. Show connection and recording status separately.
- Natural spoken corrections, undo last batch, and direct manual editing.
- Deleting rows asks whether to keep XF numbers or renumber subsequent rows, with Cancel.
- No mandatory confirmation between clear batches. Ambiguities are queued for review; no guessed identifiers or quantities.

## Proposed screens

1. List library: date/LSD title, weld count, last update, create/open list.
2. Inspection: editable date/LSD, format settings and initial XF; prominent listening control, current CN/welder, next XF, latest transcript, weld rows, unresolved items and undo. On narrow screens use readable row cards; export remains tabular.
3. Computer view: same list and column order, review/edit, copy rows without headers. Also support an export file as a fallback.

## Recommended architecture and alternatives

Recommended: retain ShotTime's existing interface and calculator; separate note data and command interpretation into testable modules. Native Android recording owns the microphone and session lifecycle. A narrowly scoped channel connects the notes interface to native functions. An authenticated backend provides speech-service access and synchronized lists; provider credentials stay on the server.

Alternative: Android platform recognition could simplify an initial experiment, but should not be assumed to meet continuous, locked-screen recognition requirements. Alternative: a separate web app would simplify computer access but would not by itself establish reliable Android background recording. Neither alternative should silently replace the agreed native recording goal.

Existing offline/no-bridge repository guidance predates this feature. The owner's request authorizes designing the required notes-specific network and native integration. Keep the calculator usable offline and its exposure calculations, settings and print flow intact. Do not open general WebView navigation or give arbitrary content native access.

## Data and interpretation

Each list has a stable ID, revision, date, LSD, format defaults, next sequence number, current context and ordered weld records. Each weld has an immutable internal ID independent of its displayed XF. Store CN, XF numeric sequence and formatting, welder text, size and schedule separately. Use a separately versioned note store; do not reset calculator settings.

Keep interim recognition visually distinct from committed entries. Only finalized speech segments can create commands. Segment IDs make retries idempotent. A trailing 'welded by DD' belongs to the preceding batch before its rows are finalized. A new CN closes the preceding complete batch. On stop, incomplete speech stays available for review. Unclear corrections do not mutate saved rows.

Interpret commands into explicit operations: add batch, update welder, correct a batch/row, undo, and delete. Validate and apply each operation atomically. An ambiguous batch's quantity or boundary holds subsequent numbering until resolved; otherwise later XF references could become incorrect. Continue collecting speech while such a batch awaits review.

Undo reverses the latest operation as a unit. Changes to batch quantity show resulting numbering effects. Failed persistence must be visible; never report unsaved data as saved.

## Recording and synchronization

Start microphone access from a visible user action. Native recording design includes Android permissions, an ongoing recording notification, Stop control, input-route indication and interruption reporting. Verify current Android requirements before implementation. Headset disconnects must trigger a visible/audible indication; do not claim that recording continued unless the active input is confirmed.

Persist completed commands locally before attempting sync. Distinguish listening, reconnecting, stopped and needs-review states. Retain recoverable unfinished transcript data. Bound any queued audio; disclose its retention and deletion behavior in the implemented design. No automatic recording on app launch.

Use authenticated access to synchronized lists. Concurrent edits require revision checks and explicit conflict handling rather than silent overwrite. Computer transcription is not required. Select/configure provider, hosting and authentication after checking available accounts and current official documentation; do not purchase services or embed production secrets in the APK.

## Delivery sequence

1. Implement usable list creation, persistence, formats, manual editing, batch-command interpretation, undo, deletion choices and Excel-compatible export. Typed transcript input is a development/test path, not completed voice functionality.
2. Integrate native microphone lifecycle and streaming transcription; test ordinary phrases, interruptions, lock screen and Bluetooth on the actual phone.
3. Add authenticated synchronization and computer review/copy workflow.
4. Run integration/regression checks, compile an unsigned APK, then arrange owner device testing. Signing credentials remain untouched unless release work is separately requested.

## Acceptance checks

Starting at XF-101, 'CN-47 has 6 4 inch STD welds welded by DD, CN-32 has 2 2 inch XS welds welded by O, CN-22 has 3 3 inch STD welds welded by TS' produces exactly 11 rows: XF-101–106/DD/CN-47, XF-107–108/O/CN-32, XF-109–111/TS/CN-22.

Cover repeated finalized segments, trailing welders, inherited context, O versus zero, leading zeroes, fractional sizes, malformed/ambiguous quantities, corrections by XF and range, both deletion choices, undo, restart persistence and save failures. Copying produces exactly five cells per row in the agreed order; guard spreadsheet formula interpretation in identifier fields.

Run all existing calculator/UI/storage suites. Test new interface at phone widths and keyboard/accessibility navigation. Native compilation and physical recording tests are separate from browser checks. Do not describe background recording, Bluetooth, sync or voice accuracy as verified until exercised.

## Remaining implementation decisions

Speech provider, hosted service and account setup require evaluation and actual configuration. These do not block local list/command implementation once this design is reviewed. Exact recording latency and recognition accuracy are measured outcomes rather than promised guarantees.
