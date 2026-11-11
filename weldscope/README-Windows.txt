WeldScope - DICONDE image editor
================================

Start WeldScope.exe. No installation is needed; settings are kept for your Windows user.

Your files are never changed: every save writes a new file (a "copy").

Getting started
- Open folder: choose the folder with your .dcm files. They are listed on the left, grouped by weld.
- Click a file to edit it. Drag files or a folder onto the window to add them.
- Save copy (Ctrl+S) writes a new file next to the original by default. Every saved copy is read back and
  checked for INDUSTREX compatibility; the result is in the Changes tab.

Editing
- Metadata tab: edit fields as INDUSTREX names them. Values are checked before anything changes.
  The pin button shows a field on the image overlay. Templates store changed fields to reuse on other files.
- Image tab: window/level, EDGE-style enhancement (an approximation for viewing; not INDUSTREX's EDGE),
  rotate/flip, noise reduction, bad pixels, and scratch repair.
- Crop & split tab: Straighten & crop to film; Find film pieces; save each piece as its own file.
- Overlay tab: choose what text appears in each corner of the image (display and exports only).
- Undo / Redo (Ctrl+Z / Ctrl+Y) covers metadata and image changes.

Organize shots
- Shots are grouped by weld (Series Description by default). Select several and edit their metadata together;
  every shot is checked before any change is made. Renumber shots, apply templates, then Save all edited.
  Copies go into a folder you choose; originals and existing files are never overwritten.

Notes
- Scratch repair only changes thin lines that read as less radiation than the plate on both sides. Cracks,
  voids and IQI wires are left alone, and nothing is repaired without you asking.
- The program is not signed, so Windows SmartScreen may warn the first time: choose "More info", "Run anyway".
- If the window stays blank on an old or virtual PC, WeldScope switches from OpenGL to Direct3D/Vulkan by itself.

Third-party software and licences: THIRD-PARTY-NOTICES.txt
