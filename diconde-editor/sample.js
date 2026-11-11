/* Synthetic DICONDE DR file for trying the editor and for tests. Not a real inspection image. */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dicom.js'));
  else root.Sample = factory(root.Dicom);
})(typeof self !== 'undefined' ? self : this, function (D) {
  function makeSample(opts = {}) {
    const rows = opts.rows || 240, cols = opts.cols || 640, bits = opts.bitsStored || 16;
    const max = 2 ** bits - 1, img = new Uint16Array(rows * cols);
    let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const wall = Math.abs(y - rows / 2) / (rows / 2);            // thicker steel near the centre line
      let v = max * (0.25 + 0.5 * wall * wall) * (0.9 + 0.1 * x / cols);
      if (Math.abs(y - rows / 2) < rows * 0.08) v *= 0.82;         // weld cap
      if (x % 80 === 40 && y > rows * 0.1 && y < rows * 0.3) v *= 0.7; // IQI wires
      v += (rnd() - 0.5) * max * 0.02;
      img[y * cols + x] = Math.max(0, Math.min(max, Math.round(v)));
    }
    for (const [x, y] of [[17, 23], [300, 120], [611, 200]]) img[y * cols + x] = max; // hot pixels
    const file = { meta: D.newDataset(), ds: D.newDataset(), transferSyntax: D.TS.EXPLICIT_LE };
    const ds = file.ds, set = (t, v, vr) => D.setText(ds, t, v, vr);
    set(0x00080005, 'ISO_IR 100'); set(0x00080008, 'ORIGINAL\\PRIMARY'); set(0x00080016, '1.2.840.10008.5.1.4.1.1.1.1');
    set(0x00080018, opts.sopUID || D.newUID()); set(0x00080020, '20261014'); set(0x00080030, '101500'); set(0x00080060, 'DX');
    set(0x00080070, 'Sample Systems'); set(0x00080080, 'Sample Inspection Co'); set(0x00081070, 'Tech^Sample');
    set(0x00100010, 'Pipe Spool 12'); set(0x00100020, 'WELD-0042'); set(0x00102160, 'Carbon steel');
    set(0x00140030, '8.74'); set(0x00140054, '168.3'); set(0x00181164, '0.1\\0.1'); set(0x00181110, '700');
    set(0x0020000D, D.newUID()); set(0x0020000E, D.newUID()); set(0x00200013, '1'); set(0x00204000, 'Synthetic sample');
    set(0x00280002, '1', 'US'); set(0x00280004, 'MONOCHROME2'); set(0x00280010, String(rows), 'US'); set(0x00280011, String(cols), 'US');
    set(0x00280100, '16', 'US'); set(0x00280101, String(bits), 'US'); set(0x00280102, String(bits - 1), 'US'); set(0x00280103, '0', 'US');
    set(0x00281050, String(Math.round(max * 0.49))); set(0x00281051, String(Math.round(max * 0.7)));
    ds.el.set(D.PIXEL, { tag: D.PIXEL, vr: 'OW', value: new Uint8Array(img.buffer) });
    return file;
  }
  return { makeSample };
});
