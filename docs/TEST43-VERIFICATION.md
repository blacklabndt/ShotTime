# Test.43 verification

Version 1.22.0-test.43, code 86.

Passed: custom-shot, custom-shot-ui, current-calculator, current-ui, settings-storage, consistency, floating-recorder. Custom math checks every film/density against reference geometry plus inverse-square/HVL ratios, total thickness, invalid ranges and CR rejection. UI covers three-screen ordering/hiding, manual and current activity, film factor, stale result invalidation, invalid inputs and geometry-only preset persistence. Existing tests cover all 1710 combinations, CR tables, calculator settings, calibration, decay, print and recording visibility. Inspected build/custom-shot-mobile.png.

Build and v2/v3 signature verification passed; 16KB alignment checked. Signed assets match current source. Existing signing identity retained.

Physical exposure accuracy and handset behavior remain unverified. Custom CR has no arbitrary-geometry calculation; existing CR chart stays unchanged. New geometry presets use a separate versioned key; existing settings and notes schemas are unchanged.

APK SHA256: B8308D67D4735AF704CA7DE82162E191388018BAD8B905327466A4B5CC3D301E
