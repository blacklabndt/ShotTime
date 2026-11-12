WeldScope - DICONDE image editor
================================

Start WeldScope.exe. No installation is needed; settings are kept for your Windows user.

Your files are never changed: every save writes a new file (a "copy").

Getting started
- Open folder: choose the folder with your .dcm files. They are listed on the left, grouped by weld, as
  "weld · shot number" with the file name underneath.
- Click a file to edit it (Page Down / Page Up for the next / previous file). Drag files or a folder onto the
  window to add them.
- Save as new file (Ctrl+S) writes a new file without asking, into an "Edited" folder next to your originals.
  The folder is shown at the bottom of the window; Change picks another one, which is remembered.
  Export > Save as... lets you choose the name and folder for one file.
- Every saved file is read back and checked for INDUSTREX compatibility. A green or red mark appears next to
  the Save button and in the file list; click it for the details.

Process this plate (Crop & split tab)
- One button finds every piece of film, straightens and crops each, and shows a preview of each piece as it is
  now and as it will be saved. Untick a piece to skip it, fix its label, then Save. Nothing is written before
  you confirm. The saved files can be added to the list straight away to edit their details.
- Straighten & crop to film and "Preview and save files" use the same preview.

Editing
- Metadata tab: edit fields as INDUSTREX names them. Values are checked before anything changes. The small
  arrow next to a field offers values you used before (and values other files in the folder have).
  The pin button shows a field on the image overlay. Templates store changed fields to reuse on other files.
- Image tab: window/level, EDGE-style enhancement (an approximation for viewing; not INDUSTREX's EDGE),
  rotate/flip, noise reduction, bad pixels, and scratch repair (the repaired line flashes green and the number
  of changed pixels is shown).
- Image tab > Possible indications: marks spots inside the weld band for you to look at, numbered with the
  strongest first. Use the sensitivity slider to see fewer or more; click an entry in the list to go to it;
  press M to hide or show the marks. It is an aid for the interpreter only: it does not measure, accept or
  reject anything, it can miss indications, and it marks things that are not indications. The type it shows is
  a guess. Nothing is written to the file or to exported pictures. Best used on a cropped piece. It needs the
  file indication-models.bin in the same folder as WeldScope.exe.
- Mouse: wheel zooms; right-drag changes brightness and contrast with any tool (hold Shift for finer steps);
  middle-drag moves the image. The − and + buttons beside Level and Width make small steps.
- The ? button (top right) lists all shortcuts.
- Undo / Redo (Ctrl+Z / Ctrl+Y) covers metadata and image changes.

Process whole job
- Open the job folder, then press Process whole job… (file list, or the Organize shots tab). WeldScope goes
  through every plate: finds each piece of film, straightens it, crops it to the film and saves it as its own
  new file in the folder shown, with its coverage where the numbers read cleanly.
- It asks once before starting and shows a summary at the end; there is no preview for each plate. Lines in
  amber in the summary need a look. Plates that already have pieces made from them are left out, so running
  it again only does new plates. Originals are never changed and nothing is overwritten.
- Each piece is saved turned the way the plate is shown on screen, so it reads left to right when opened.

Organize shots
- Shots are grouped by weld (Series Description by default), each showing its weld, shot number and date.
- Drag a shot (or the selected shots) onto another weld to move it there. Rename weld changes the weld on every
  shot in a group. Both are one undo step.
- Coverage: WeldScope reads the lead location numbers on each film when the folder opens and shows the range
  on every shot (for example Coverage 0-35). Green means every number it read was in step; it is written into
  the file when you save it. Amber with a ? means some numbers were unclear or missing: check it, then confirm
  or correct it in the Coverage box (Metadata tab, or Batch edit). You can always type over it. It is a reading
  aid, so check it against the image; numbers cut off at the film edge cannot be read.
- Within a weld the shots are listed in coverage order (0-35, then 35-70 …); shots with no coverage come last.
- Select several shots and edit their metadata together; every shot is checked before any change is made.
  Renumber shots, apply templates, then Save all edited. Originals and existing files are never overwritten.

Notes
- Scratch repair only changes thin lines that read as less radiation than the plate on both sides. Cracks,
  voids and IQI wires are left alone, and nothing is repaired without you asking.
- The program is not signed, so Windows SmartScreen may warn the first time: choose "More info", "Run anyway".
- If the window stays blank on an old or virtual PC, WeldScope switches from OpenGL to Direct3D/Vulkan by itself.

Third-party software and licences: THIRD-PARTY-NOTICES.txt
