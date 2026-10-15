# HPX-DR 3543 PE Custom Shot estimate

Added 2026-10-14, after the signed 1.98 release. Included in the 1.99 release source (versionCode 121); the existing 1.98 APK on Drive does not contain this feature.

The owner confirmed the Carestream HPX-DR **3543 PE**, Ir-192, and raw **16-bit linear** pixel values in INDUSTREX. This choice exists only in Custom Shot. Pixel options are the published targets 3000, 6000, 9000, 12000, 15000, 18000 and 21000 (default 3000). Frame presets are 1, 2, 4, 8, 9, 16 and 32, plus a custom whole count 1–999 (default 9). The custom count cap is an application input limit, not a detector capability claim.

## Data and model

[Carestream's Digital R Factor table](https://www.carestream.com/en/us/-/media/publicsite/resources/ndt/other-references/r-factor-table-hpx-dr.pdf) gives Iridium factors for this panel of 0.0112, 0.0237, 0.0366, 0.0499, 0.0635, 0.0775 and 0.0918 R at the seven respective pixel targets above. The application uses these values directly, without interpolation or extrapolation. This uses the standalone published table through 21000; higher values from other papers are not included.

[Carestream's Part II whitepaper](https://www.carestream.com/en/us/-/media/publicsite/resources/ndt/certifications/pdf/carestreamhpxarcwhitepaper7800800250910part-2-the-howsltrloresen.pdf?display=inline&sc_lang=en-us), pages 6–8, describes nine averaged frames, 16-bit linear greyscale, and measurement through the 1-inch steel step for Iridium. Its table specifies R factors for a **single acquired frame**.

The app converts detector exposure to a starting integration estimate using an inverse-square and exponential attenuation approximation:

```
R(P) = published Iridium R factor for the selected pixel target
seconds/frame = R(P) × SDD_metres² × 3600 / (0.48 × activity_Ci)
                × 2^(total_steel_mm / 13)
total seconds = seconds/frame × frames
```

The fixed 13 mm steel HVL and 0.48 R·m²/(Ci·h) output follow [QSA Global's Ir-192 specifications](https://www.qsa-global.com/iridium-192-sealed-sources), also recorded in the project's CR research. DR keeps independent constants; changing CR calibration, HVL, dose limits, PMT, pixel target or film correction factors does not change DR. This is not a manufacturer-supplied integration-time algorithm. Beam hardening, scatter, source capsule, shielding, acquisition mode and detector integration limits are not modeled. Nine frames is a default consistent with the paper, not a guaranteed image-quality requirement.

For 0.5-inch steel, 24-inch SDD, 50 Ci and 3000 pixels, this approximation gives about 1.229 s/frame and 11.06 s for nine frames. Carestream's separate “Dose Is Still King” paper shows a third-party timer's rounded 2-second example at 6000 pixels with that geometry; this approximation would give about 2.60 seconds there. The constants have not been fitted to that rounded example. Physical validation against an approved technique and the actual panel remains outstanding.

Frame averaging does not divide integration time: each frame receives the specified exposure. Total excludes readout, dead time and other acquisition overhead. Results retain four significant digits to display subsecond estimates; displayed precision does not imply physical accuracy. No native timer is started or configured.

## Storage and verification

Existing `shottime.customShots.v1` presets gain additive `pixel` and `frames` fields for `film: "dr3543pe"`. Activity still comes from the current source when loading. Prototype presets with the former 2000–4000 targets are retained; a non-published value loads an empty pixel selection with an explicit reselection message, and cannot calculate until a published target is chosen. Existing film and CR presets retain their behavior. Input geometry follows the existing positive-distance and maximum 90 mm total-steel bounds.

`tests/test-dr-custom.cjs` covers all seven published R factors and rejection of intermediate targets, inverse square, activity and thickness scaling, independent per-frame and total times, and invalid inputs. `tests/test-dr-custom-ui.mjs` covers controls, subsecond output, preset/custom counts, invalidation, saved setup reload, unit conversion, film switching, browser errors and narrow mobile layout. Existing film fixture tests protect prior film and CR outputs. These checks validate software behavior, not actual radiographic quality or handset acquisition.

Verification on 2026-10-14: full `npm test` passed (Chrome on Windows), including the new DR suites. The DR browser suite also passed after the final label-spacing and saved-pixel validation changes. Log: `build/dr-regression.log`; mobile capture: `build/dr-custom-mobile.png`.

Published-target follow-up: DR unit/browser tests passed, including exact table lookup, all seven options, saved 21000-pixel setup and explicit reselection for an old 4000-pixel setup.
