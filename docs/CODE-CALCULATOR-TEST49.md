# Test.49: circumference defaults

Total weld length follows the selected pipe outside circumference using the existing pipe-chart OD values. NPS is not treated as actual OD. Manual lengths, including intentionally blank values, remain unchanged on size changes. Use circumference returns to automatic mode. Unit changes convert values. Spot radiograph evaluation length has a separate draft and is never populated from circumference.

Validation: calculator unit tests and calculator browser suite passed, including defaults, manual overrides, reset, unit conversion, spot-profile switching and 320/393/430 px layouts. Android build succeeded (versionCode 92); v2/v3 signing and 16 KB alignment verified. Packaged UI/index/pipe-chart assets match tested sources. Physical phone test pending.

APK SHA-256: c18d3cbcbba120a494b4cf9cabbfc63e2dba39063df9d8288ebb73d9990a2899
