# Test.10 MT verification

User requirements: sequential per-list MT numbers with selectable start, one per fitting, linked current CN; TOL/threadolet/threadys, WOL/weld olet, SW/socket weld; normal schedules plus 3M/6M/9M; side-by-side CSV with CN#, MT#, Size, Schedule, Description to the right of XF columns.

Implemented and verified with new unit/browser suites. All twelve app suites passed; notes suites rerun after parser changes and targeted model/MT/browser checks passed after final numbering validation. Coverage includes aliases, optional schedules, ambiguous inputs, welder-ID collisions, numbering, CN association, edit/delete/undo, replay, persistence, schema-1 history migration, export padding and 360px layout. Independent code review found no remaining actionable issue in this change.

Final Android build succeeded: versionCode 53 / 1.22.0-test.10, same package and replacement signing key. APK v2/v3 signature and 16 KB alignment verified. Every packaged top-level asset matches final source, both CPU speech libraries match existing test.9 payload, and no base.en is packaged. Sample CSV was independently read with Python csv: 11 columns, correct independent rows and blank padding.

Notes schema becomes 2 with preserving migration from schema 1. Old app versions cannot read schema 2. No device or live paid cloud test performed; spoken recognition accuracy remains to be checked on the owner's phone. Ambiguous/incomplete inputs require review. Existing test.8 review findings outside this feature remain unchanged.

APK SHA-256: a8415f0bf3d74ce0e19fa08696e5eb05896b0e6313d6a2d2bcf4cad625d39c45
