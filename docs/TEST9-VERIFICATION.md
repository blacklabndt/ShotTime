# Test.9 performance trial verification

- All ten npm app/browser suites passed with installed Chrome.
- AudioSegmenterTest, VoiceBackendTest and new NativeVoiceTest passed.
- Both ARM64 libraries compiled. Optimized CPU object flags include -march=armv8.2-a+fp16+dotprod, and CMake reports HAVE_DOTPROD=1 and HAVE_FP16_VECTOR_ARITHMETIC=1. Portable build uses armv8-a.
- Both ELF libraries have 16 KB LOAD alignment and expected JNI symbols; both exact compiled payloads are packaged.
- Packaged model hashes verified against pinned values. Old base.en absent.
- APK built as versionCode 52 / 1.22.0-test.9 and signed with the same replacement key as test.8. APK v2/v3 signature and 16 KB zip alignment passed.
- Independent code review found no actionable regression in the tuning changes.
- No phone runtime or performance measurements were made. Native library selection/loading, recognition parity, and actual speedup still require the owner's test. Unknown CPU capabilities fall back to portable code.
- JNI decode settings, model, segmentation, recording flow and calculator data/module match the supplied test.8 source. Known test.8 review findings are not changed in this tuning trial.

Signed APK SHA-256: 6456190d9e7fe1abb10c9e502b161614f0f087ec9512e53893ea5fcfbe1da2f9
