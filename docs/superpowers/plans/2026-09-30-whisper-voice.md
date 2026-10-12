# Whisper voice implementation

The owner selected Whisper after comparing offline engines, continuing the earlier direct-implementation request. No further engine-selection approval is needed.

1. Test and implement deterministic transcript assembly: pauses, trailing welder, ordered review, duplicate replay and undo. Keep calculator logic unchanged.
2. Pin whisper.cpp v1.9.4 and base.en weights by SHA-256; compile ARM64 JNI with NDK 28.2 and 16 KB ELF alignment; bundle weights and MIT notices.
3. Add a user-initiated microphone foreground service, permission handling, explicit phone/Bluetooth input, bounded audio segmentation/decoder backlog, private durable transcript and Stop notification. No Internet permission or paid API.
4. Connect the existing Note Taker to native status using restricted local navigation commands and native JSON callbacks. Hold current pipe until next pipe/correction/Stop; persist accepted rows/review items before allowing a new native session.
5. Exercise browser workflows and Java audio segmentation, run the full regression suite, request independent review, fix important findings, compile/sign with the existing identity, and deliver test.2. Physical-device accuracy, Bluetooth and screen-lock behavior remain user acceptance tests.
