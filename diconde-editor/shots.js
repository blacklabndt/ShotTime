/* Shots workspace: many files, grouped by weld, with batch metadata editing. Pure logic (no DOM), so it
   runs in browsers and Node. Originals are never changed; saving writes new copies. */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dicom.js'));
  else root.Shots = factory(root.Dicom);
})(typeof self !== 'undefined' ? self : this, function (D) {
  // Fields that can identify the weld. Series Description holds the weld/shot ID in INDUSTREX exports.
  const GROUP_FIELDS = [0x0008103E, 0x00100020, 0x00100010, 0x00081030, 0x00204000, 0x00101000];
  const NO_WELD = '';
  let nextId = 1;

  // An entry is one shot: the parsed original (never edited), a working copy for metadata, and the record of
  // original values of the fields changed (same shape as the editor's, so a shot can be opened there).
  async function load(bytes, name, path) {
    const orig = await D.parse(bytes);
    return { id: nextId++, name, path: path || '', orig, file: D.clone(orig), origEls: new Map(), savedAs: '' };
  }
  const text = (e, tag) => D.getString(e.file.ds, tag);
  const hex = t => (t >>> 0).toString(16).padStart(8, '0');
  const changedTags = e => [...e.origEls.keys()].filter(k => !k.includes('/')).map(k => parseInt(k, 16) >>> 0);
  const isEdited = e => e.origEls.size > 0;

  // Shot order inside a weld: Instance Number, then acquisition date/time, then file name.
  function shotOrder(a, b) {
    const n = e => { const v = D.getNumber(e.file.ds, 0x00200013); return v == null ? Infinity : v; };
    const t = e => text(e, 0x00080022) + text(e, 0x00080032);
    return n(a) - n(b) || t(a).localeCompare(t(b)) || a.name.localeCompare(b.name);
  }
  // Groups shots by the value of `tag` (trimmed). Shots without a value are grouped under NO_WELD, listed last.
  function groups(entries, tag) {
    const m = new Map();
    for (const e of entries) { const k = text(e, tag).trim(); if (!m.has(k)) m.set(k, []); m.get(k).push(e); }
    return [...m.entries()].sort(([a], [b]) => (a === NO_WELD) - (b === NO_WELD) || a.localeCompare(b, undefined, { numeric: true }))
      .map(([key, list]) => ({ key, shots: list.sort(shotOrder) }));
  }

  // For the selected shots: each tag's shared value, or mixed when they differ.
  function commonValues(entries, tags) {
    const out = {};
    for (const t of tags) {
      const vals = new Set(entries.map(e => text(e, t)));
      out[hex(t)] = vals.size === 1 ? { value: [...vals][0], mixed: false } : { value: '', mixed: true, count: vals.size };
    }
    return out;
  }

  // Sets or removes one field on one shot, keeping the record of original values (as the editor does).
  function setOn(e, tag, value, vr) {
    const key = hex(tag), ds = e.file.ds;
    if (!e.origEls.has(key)) { const cur = ds.el.get(tag); e.origEls.set(key, cur ? D.clone(cur) : null); }
    if (value === null) D.remove(ds, tag); else D.setText(ds, tag, value, vr || (ds.el.get(tag) || {}).vr, ds);
    const o = e.origEls.get(key), cur = ds.el.get(tag);
    const same = (!o && !cur) || (o && cur && o.vr === cur.vr && o.value && cur.value && o.value.length === cur.value.length && o.value.every((b, i) => b === cur.value[i]));
    if (same) e.origEls.delete(key);
  }

  // Checks every change against every shot before changing anything; then applies all of them.
  // changes: { 'ggggeeee': text | null (remove) }. Returns { applied, errors: [{ name, field, message }] }.
  function applyBatch(entries, changes) {
    const errors = [];
    for (const e of entries) for (const [k, v] of Object.entries(changes)) {
      if (v === null) continue;
      const tag = parseInt(k, 16) >>> 0, vr = (e.file.ds.el.get(tag) || {}).vr || D.tagInfo(tag).vr;
      if (!vr) { errors.push({ name: e.name, field: D.tagHex(tag), message: 'unknown value representation' }); continue; }
      const msg = D.validate(vr, v);
      if (msg) { errors.push({ name: e.name, field: D.describeTag(e.file.ds, tag).name, message: msg }); continue; }
      try { D.textToBytes(vr, vr === 'CS' ? v.toUpperCase() : v, D.charsetMode(e.file.ds)); } catch (err) { errors.push({ name: e.name, field: D.describeTag(e.file.ds, tag).name, message: err.message }); }
    }
    if (errors.length) return { applied: 0, errors };
    for (const e of entries) for (const [k, v] of Object.entries(changes)) {
      const tag = parseInt(k, 16) >>> 0;
      if (v === null && !e.file.ds.el.has(tag)) continue;
      setOn(e, tag, v, (e.file.ds.el.get(tag) || {}).vr || D.tagInfo(tag).vr);
    }
    return { applied: entries.length, errors };
  }

  // Numbers shots 1…n (Instance Number) in their current order.
  function renumber(shots, start = 1) { shots.forEach((e, i) => setOn(e, 0x00200013, String(start + i), 'IS')); }

  // Metadata state of shots, for undo (pixels are never part of it and are not copied).
  function snapshot(entries) {
    return entries.map(e => {
      const el = new Map(); for (const [t, v] of e.file.ds.el) if (t !== D.PIXEL) el.set(t, D.clone(v));
      return { e, el, origEls: new Map([...e.origEls].map(([k, v]) => [k, v ? D.clone(v) : null])) };
    });
  }
  function restore(snap) {
    for (const s of snap) {
      const px = s.e.file.ds.el.get(D.PIXEL);
      s.e.file.ds.el = new Map(s.el); if (px) s.e.file.ds.el.set(D.PIXEL, px);
      s.e.origEls = s.origEls;
    }
  }

  // A metadata-only copy of an edited shot: INDUSTREX's XML copy updated, new SOP Instance UID, original kept.
  function buildCopy(e) {
    const copy = D.clone(e.file), tags = changedTags(e);
    const synced = D.syncIndustrexXml(copy.ds, tags);
    D.derive(copy, e.orig, {});
    return { copy, bytes: D.write(copy), edited: tags, synced };
  }
  // File names for saved copies: name_edited.dcm, made unique within the batch.
  function copyNames(entries) {
    const used = new Set();
    return entries.map(e => {
      const base = e.name.replace(/\.(dcm|dicom|dic)$/i, '') + '_edited';
      let n = base + '.dcm', i = 2;
      while (used.has(n.toLowerCase())) n = `${base}_${i++}.dcm`;
      used.add(n.toLowerCase());
      return n;
    });
  }

  return { GROUP_FIELDS, NO_WELD, load, groups, shotOrder, commonValues, applyBatch, setOn, renumber, snapshot, restore, buildCopy, copyNames, changedTags, isEdited, hex };
});
