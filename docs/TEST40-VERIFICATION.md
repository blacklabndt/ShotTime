# Test.40 verification

Version 1.22.0-test.40, code 83. CSV spacing toggle beside LSD is per list and defaults off. XF and MT stay separate, each inserting an empty row at its own CN transitions. Export does not reorder or renumber entries.

Passed: spool-spacing (new independent-table expectations failed against aligned implementation first), spool-spacing-ui, export-columns, export-columns-ui, notes-storage, notes-model, consistency. Cases include differing XF/MT spool boundaries, recurring CN, unequal table lengths, MT-only/XF-only/empty exports, custom columns and spacers, reload, per-list isolation, undo preference preservation and 320px long-LSD layout. Inspected build/spool-spacing-mobile.png.

Android build succeeded; existing key signs APK, v2/v3 signature and 16KB alignment verified. Packaged HTML and all three changed notes modules match source.

APK SHA256: D2F7F9CF87FACB0E12CE5D0F49DD56F59B36730D60593BF420A22123B5D7906B
