# Test.12 recording restart

Evidence: pinned whisper.cpp 1.9.4 allocates h_state/c_state without clearing them; the streaming no_reset path assumes initialized state. JNI now calls whisper_vad_reset_state once after a successful load. Every recording creates a fresh detector. No reset between audio reads.

Validation:
- Both ARM64 native variants rebuilt successfully. Disassembly of both vadLoad exports confirms the reset call.
- Existing Java AudioSegmenter tests pass, including detector probabilities, hysteresis, pauses, and stop flush.
- APK version 1.22.0-test.12 (55); signature v2/v3 and 16 KB alignment pass with existing certificate.
- Packaged assets and native payload exactly match build outputs. Voice models unchanged from test.11.
- No device/audio reproduction available. This fixes a verified initialization defect; its causal link to the reported restart symptom remains to be confirmed on the phone.

Phone check: start, wait for Listening, dictate first CN, stop and wait for processing; start again, wait for Listening, dictate another CN, stop. Repeat a third time and confirm new speech and rows each time.

SHA256: 2ddc8d82ab1dde114a921d32d08964218e12c44b57ae90241c37a17598a9ed9c
