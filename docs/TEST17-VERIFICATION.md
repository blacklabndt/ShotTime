# test.17 Job-specific required fields

All 16 npm test suites passed, including all 48 XF/MT field-rule combinations, optional voice/manual entries, required-field review, persistence, migration and CSV blanks. Existing calculator, voice, correction, numbering, replay and mobile layout checks passed.

Review identified a new-list default inheritance mismatch; corrected new lists to store explicit default rules before the full test run. Existing lists retain legacy behavior until job requirements are configured.

APK version code 60/test.17 built and verified with the existing af4e70b2 signing certificate (v2/v3) and 16 KB alignment. Packaged assets match source; native libraries and models are byte-identical to test.16. No physical phone installation test performed locally.

SHA256: 903fd0256991cf4c3a746586bbbae90901be80aeab4a718c9b9a9990dbf1ad3b
