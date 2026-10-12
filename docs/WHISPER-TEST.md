# Whisper voice test build — 1.22.0-test.8 (51)

This build uses whisper.cpp v1.9.4 with English **small.en (5-bit quantized, about 190 MB)** on the phone's CPU, and the **Silero VAD v6.2.0** speech detector (about 0.9 MB) to find speech and pauses. No account, Internet permission, cloud upload or transcription charge in Phone mode. The APK contains ARM64 native code (Galaxy S26 Ultra target). Handset accuracy and speed have not been measured yet.

## What changed in test.8

- **Model:** small.en replaces base.en. In synthetic-voice tests on a PC (below) small.en got 5 of 8 instructions exactly right with no silently wrong rows, against 2 of 8 for base.en. Both models' files are copied out of the APK once; the old base.en copy (148 MB) is deleted on first use.
- **Speech and pauses:** Silero VAD replaces the loudness gate. Steady noise (generator, wind) no longer counts as speech, a pause is under 0.35 speech probability for one second, and a section that reaches 20 seconds is cut at the quietest moment in its last 4 seconds instead of mid-word; the rest carries into the next section. If the detector cannot load, the loudness gate is used.
- **Speed:** Whisper normally encodes a full 30-second window. When two or more sections are waiting, the app switches to a window sized to each section (about 3.5× faster, somewhat less accurate) so recording does not stop for falling behind.
- **Retry on repetition:** Whisper re-decodes at a higher temperature when a result looks like a loop ("XS, XS, XS, …").
- **Welder letters:** the hint tells Whisper that welder IDs are letters and lists the welder IDs already on the list. The parser accepts letter names ("dee dee", "oh", "are gee", "double you") and the NATO alphabet ("delta delta") as letters, "welded TS" without "by", and common Whisper habits ("CM61" for CN 61, "CN47", "welders, TS", "Weldero", punctuation commas).

## Use

Open Note Taker and an inspection list. Choose Phone microphone or Bluetooth headset. Tap Start recording and approve Android microphone access. Wait for **Listening** and the confirmed input label before speaking.

Speak complete pipe entries and pause about a second between pipes. Recognition is per section, not word by word. The current pipe stays pending so a trailing welder can attach; the next CN, a correction or Stop closes it.

Tips that help Whisper:
- Say **"welder D D"** (or "welded by D D"), with a small gap between letters. NATO words also work: "welder delta delta".
- Say CN numbers as digits when they could sound like a schedule ("CN six zero", not "CN sixty", which can be heard as "XS").
- Say "X S" or "extra strong" clearly; "standard" or "S T D".

Example: "CN four seven has six four inch standard welds, welder D D. CN three two has two two inch X S welds, welder O." With starting XF 101 expect 8 rows. Check IDs, quantities, sizes and schedules before exporting.

## PC test method (repeatable)

`whisper.cpp` was built for Linux and the app's own `WhisperEngine`, `SpeechDetector` and `AudioSegmenter` classes were run through JNI on synthetic espeak-ng speech (8 instructions, 1.4 s pauses, clean and with added hum/noise), in 1,536-sample reads like the phone. Each section's text went through the app's voice normalizer and parser and was scored per instruction: exactly right, sent to review, or silently wrong.

| Setup (clean synthetic voice) | Right | Review | Silently wrong |
|---|---:|---:|---:|
| test.7: base.en, loudness gate | 2/8 | 6 | 0 |
| test.8: small.en, Silero, letter hint, parser fixes | 5/8 | 3 | 0 |
| test.8 with the short window always on | 2/8 | 6 | 0 |

With a British synthetic voice: test.8 5/8 right; short window always on 3/8 right and 1 silently wrong (schedule 80 recorded as 8), which is why the short window is only used when transcription falls behind. The test.7 parser on the small.en transcripts got 2/8; the parser changes account for the rest of the gain.

Synthetic speech is not a phone microphone or a person: the remaining misses were the synthetic voice's pronunciation ("extra strong" heard as "CAC's restaurant"). With heavy added noise all setups failed. Record real site audio to measure properly. On the PC (2 threads, no AVX2) small.en took about 1.3 s per second of speech with the full window and 0.35 s with the short window; phone speed is unknown.

## Recovery and limitations

Completed recognized sections are saved atomically in app-private storage and replayed idempotently into their original list after a restart. Raw audio is held only in RAM. Force-stop, process death or a native crash can lose audio not yet transcribed; reopening reports the interruption and sends recovered text for review. A damaged native journal is set aside so recording keeps working.

Whisper may mishear or invent text; a successful parse is not proof the audio was understood. Real names can still be heard instead of letters (for example "Archie" for R G) and are accepted as IDs; check welder IDs. "Mike" is read as the NATO letter M.

## Build and provenance

Windows: `./build-voice.ps1`, then `./build-review.ps1`. Linux: `SDK_ROOT=... bash build-voice.sh`, then `bash build-review.sh`. JDK 21; Android platform/build tools 36; NDK `28.2.13676358`; SDK CMake `3.22.1`. The voice scripts now clear `build/voice-package` so the old base.en model is never packaged, and `build-review` refuses a payload that still has it.

Source ZIP: https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.4.zip — SHA-256 `873e67727d51213d3a14a6700c7415900a6645b78c4e6edad9328eea90e53572`

Weights: https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin — 190,098,681 bytes, SHA-256 `bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30`

Speech detector: https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin — 885,098 bytes, SHA-256 `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987`

whisper.cpp/GGML MIT notice is copied from the pinned source into the payload. OpenAI's model notice is at `assets/whisper-model-LICENSE.txt` and the Silero VAD MIT notice at `assets/silero-vad-LICENSE.txt`. Downloads stay under ignored `build/`; no binaries or signing credentials belong in Git.
