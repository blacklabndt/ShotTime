/* Corner text overlay: which fields appear in which corner of the viewer, and how values are written.
   Display and export only; nothing here is written into the DICONDE file. */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dicom.js'));
  else root.Overlay = factory(root.Dicom);
})(typeof self !== 'undefined' ? self : this, function (D) {
  const CORNERS = ['tl', 'tr', 'bl', 'br'];
  const CORNER_NAMES = { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right' };
  // Items that are not DICOM tags: worked out from the current view.
  const LIVE = { 'live:wl': 'Window / level', 'live:zoom': 'Zoom', 'live:size': 'Image size', 'live:view': 'View rotation', 'live:file': 'File name', 'live:frame': 'Frame' };
  // Default layout, in the spirit of INDUSTREX's corner annotations: identification top left, company and
  // people top right, technique bottom left, live display state bottom right.
  const DEFAULT_LAYOUT = {
    tl: ['00100010', '00100020', '00081030', '0008103E', '00080020'],
    tr: ['00080080', '00081048', '00081060', '00080090'],
    bl: ['00102160', '00140030', '00181260', '00204000'],
    br: ['live:wl', 'live:zoom', 'live:view']
  };
  const DEFAULT_OPTIONS = { enabled: false, labels: true, size: 'm', inExports: true };

  const hexOf = t => (t >>> 0).toString(16).toUpperCase().padStart(8, '0');
  const tagOf = k => (/^[0-9A-F]{8}$/i.test(k) ? parseInt(k, 16) >>> 0 : null);
  function itemName(key, ds) { return LIVE[key] || (tagOf(key) != null ? D.describeTag(ds, tagOf(key)).name : key); }

  // Writes a value the way a person reads it: names without ^, dates as YYYY-MM-DD, times as HH:MM:SS.
  function formatValue(vr, text) {
    if (!text) return '';
    const vals = ['LT', 'ST', 'UT', 'UR'].includes(vr) ? [text] : text.split('\\');
    return vals.map(v => {
      v = v.trim();
      if (vr === 'PN') return v.split('=')[0].split('^').filter(Boolean).join(' ');
      if (vr === 'DA' && /^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
      if (vr === 'TM' && /^\d{2,6}/.test(v)) { const d = v.replace(/\..*$/, ''); return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 6)].filter(Boolean).join(':'); }
      if (vr === 'DT' && /^\d{8}/.test(v)) return formatValue('DA', v.slice(0, 8)) + (v.length > 8 ? ' ' + formatValue('TM', v.slice(8)) : '');
      return v.replace(/\s+/g, ' ');
    }).filter(Boolean).join(', ');
  }

  // Lines per corner. `live` supplies values for live:* items; empty fields are left out.
  function lines(ds, layout, live = {}, opts = {}) {
    const out = {}, utf8 = D.charsetIsUtf8(ds);
    for (const c of CORNERS) {
      out[c] = [];
      for (const key of layout[c] || []) {
        let value = '';
        if (LIVE[key]) value = live[key] || '';
        else {
          const t = tagOf(key), el = t != null && ds.el.get(t);
          if (el && el.value) value = formatValue(el.vr, D.valueToText(el, utf8));
        }
        if (!value) continue;
        const text = opts.labels ? `${itemName(key, ds)}: ${value}` : value;
        out[c].push(text.length > 90 ? text.slice(0, 87) + '…' : text);
      }
    }
    return out;
  }

  // Keeps only known corners and well-formed keys, so a damaged saved layout cannot break the page.
  function cleanLayout(l) {
    const out = {};
    for (const c of CORNERS) out[c] = Array.isArray(l && l[c]) ? l[c].filter(k => typeof k === 'string' && (LIVE[k] || tagOf(k) != null)).slice(0, 20) : DEFAULT_LAYOUT[c].slice();
    return out;
  }
  const cornerOf = (layout, key) => CORNERS.find(c => (layout[c] || []).includes(key)) || null;

  // Draws the corner text on a 2D context inside the box (x, y, w, h). Light text with a dark outline so it
  // reads on both bright and dark parts of a radiograph.
  function draw(ctx, box, cornerLines, px) {
    const pad = Math.round(px * 0.6), lh = Math.round(px * 1.3);
    ctx.save();
    ctx.font = `600 ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, px / 4); ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.fillStyle = '#fff6b0';
    for (const c of CORNERS) {
      const ls = cornerLines[c] || [], right = c[1] === 'r', bottom = c[0] === 'b';
      ctx.textAlign = right ? 'right' : 'left'; ctx.textBaseline = 'top';
      ls.forEach((t, i) => {
        const x = right ? box.x + box.w - pad : box.x + pad;
        const y = bottom ? box.y + box.h - pad - (ls.length - i) * lh : box.y + pad + i * lh;
        ctx.strokeText(t, x, y); ctx.fillText(t, x, y);
      });
    }
    ctx.restore();
  }

  return { CORNERS, CORNER_NAMES, LIVE, DEFAULT_LAYOUT, DEFAULT_OPTIONS, hexOf, tagOf, itemName, formatValue, lines, cleanLayout, cornerOf, draw };
});
