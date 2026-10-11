# test.18 Microphone waveform

Live microphone amplitude history appears behind the Stop recording label. RMS levels from the existing 16 kHz recorder are held only in memory; a separate foreground 100 ms Activity poll updates the bars without journal writes or transcript reconciliation. Native stale levels expire after 400 ms, UI stale feed after 450 ms; stop and restart clear history. Reduced-motion disables bar transitions. Speech models, decoding, numbering and notes schema unchanged.

All 17 npm test suites passed. Waveform tests cover amplitude display, accessible Stop button, no storage mutation, stale-feed reset, invalid level, processing and restart. Mobile screenshot inspected. Android Java compilation passed; APK code61 signed with existing af4e70b2 certificate, v2/v3 verified and 16 KB alignment checked. Packaged assets match source; native libraries/models match test.17. Physical microphone response awaits phone testing.

SHA256: 1a3fba5c84391372b4856611979a70761b116f0f0ef60318a72cf69177a17bf3
