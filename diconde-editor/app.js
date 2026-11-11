/* DICONDE Editor UI. The opened file is never modified on disk; every save writes a new file. */
'use strict';
(function () {
  const D = window.Dicom, I = window.Imaging, X = window.Exporters, O = window.Overlay, SH = window.Shots;
  const $ = id => document.getElementById(id);
  const READ_ONLY = new Set([0x00080016, 0x00080018, 0x00280002, 0x00280004, 0x00280006, 0x00280008, 0x00280010, 0x00280011, 0x00280100, 0x00280101, 0x00280102, 0x00280103, D.PIXEL]);
  const COMMON = [
    // Grouped and named as INDUSTREX presents them (Carestream DICONDE Conformance Statement, rev. 10.0).
    ['Component', [0x00100010, 0x00100020, 0x00101000, 0x00101001, 0x00102160, 0x00140042, 0x00140030, 0x00140032, 0x00140054, 0x00100030, 0x00080090, 0x00104000]],
    ['Inspection', [0x00080020, 0x00080030, 0x00080050, 0x00200010, 0x00081030, 0x00180015, 0x0008103E, 0x00204000, 0x00324000]],
    ['Company & people', [0x00080080, 0x00081048, 0x00081050, 0x00081070, 0x00081060]],
    ['Equipment & technique', [0x00080060, 0x00080070, 0x00081090, 0x00181000, 0x00181004, 0x00181260, 0x00180060, 0x00181150, 0x00181110, 0x00181164, 0x00280030, 0x001440A0, 0x001440A1, 0x001440A2]],
    ['Display', [0x00281050, 0x00281051]]
  ];
  const VRS = ['LO', 'SH', 'LT', 'ST', 'PN', 'CS', 'DA', 'TM', 'DT', 'DS', 'IS', 'UI', 'AE', 'US', 'SS', 'UL', 'SL', 'FL', 'FD', 'UT', 'UC'];

  const S = {
    file: null, orig: null, name: '', img: null, imgError: '', origImg: null,
    undo: [], redo: [], ops: [], turns: 0,
    origEls: new Map(),       // key -> original element (or null if it did not exist)
    frame: 0, win: { c: 0, w: 1 }, invertView: false,
    view: { zoom: 1, x: 0, y: 0 }, viewRot: 0, tool: 'pan',
    edge: { on: false, gc: 1, dc: 1, sh: 1, nr: 0, mm: 20, br: 0, ds: false }, edgeCache: null, rawWin: null,
    crop: null, regions: [], metaView: 'common', drag: null, bmp: null, dirtyImage: true
  };

  // ---------- utilities ----------
  let toastTimer;
  function toast(msg, isErr) { const t = $('toast'); t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.textContent = ''; }, isErr ? 7000 : 4500); }
  // ---------- Windows host (DiCondeEditor.exe, Edge WebView2) ----------
  // In the Windows program, Open/Save use native dialogs through WebView2 messages; in a browser, nothing changes.
  const HOST = window.chrome && window.chrome.webview ? (() => {
    let next = 0; const pending = new Map();
    window.chrome.webview.addEventListener('message', ev => {
      const m = ev.data || {};
      if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      else if (m.cmd === 'openFile' && m.ok) openFromHost(m);
      else if (m.cmd === 'addShot' && m.ok) hostShots.push({ bytes: fromB64(m.data), name: m.name, path: m.path });
      else if (m.cmd === 'addShotsDone') { const list = hostShots.splice(0); if (m.folder) S.pendingFolder = m.folder; if (list.length) addShots(list, { replace: !!m.folder, folder: m.folder || '', open: true }); }
    });
    return {
      call: (cmd, args) => new Promise(res => { const id = ++next; pending.set(id, res); window.chrome.webview.postMessage(Object.assign({ id, cmd }, args)); }),
      post: (cmd, args) => window.chrome.webview.postMessage(Object.assign({ cmd }, args))
    };
  })() : null;
  const hostShots = [];
  function toB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  function fromB64(b64) { const s = atob(b64), o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
  // A file given to the Windows program (double-click / Open with): added to the list and opened.
  async function openFromHost(m) { await addShots([{ bytes: fromB64(m.data), name: m.name, path: m.path || '' }], { open: true, single: true }); }
  // Saves through the native dialog (Windows program) or as a browser download. Resolves { saved, name, path }.
  async function download(bytes, name, type, near) {
    if (HOST) {
      const r = await HOST.call('save', { name, data: toB64(bytes), near: near || S.path || '' });
      if (!r.ok && !r.cancelled) toast(`Could not save: ${r.error || 'unknown error'}`, true);
      return { saved: !!r.ok, name: r.name || name, path: r.path || '' };
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { saved: true, name, path: '' };
  }
  const savedWhere = r => (r.path ? r.path : r.name);
  async function busy(fn, label) {
    $('busy').textContent = label || 'Working…';
    $('busy').classList.add('on');
    await new Promise(r => setTimeout(r, 30));
    try { return await fn(); } catch (e) { console.error(e); toast(e.message || String(e), true); } finally { $('busy').classList.remove('on'); }
  }
  const baseName = () => (S.name || 'image').replace(/\.(dcm|dicom|dic)$/i, '');
  const fmt = n => (Math.abs(n) >= 1000 || Number.isInteger(n) ? Math.round(n) : +n.toFixed(3)).toString();
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); } kids.flat().forEach(c => e.append(c)); return e; };
  const hasChanges = () => S.origEls.size > 0 || S.ops.length > 0;

  // ---------- opening ----------
  async function openBytes(bytes, name) {
    let file;
    try { file = await D.parse(bytes); } catch (e) { toast(`Could not open ${name}: ${e.message}`, true); return; }
    return openParsed(file, name, null);
  }
  // Opens a parsed file. With a Shots workspace entry, the editor works on that entry's own working copy and
  // edit record, so changes made here show in the Shots window and the other way round.
  // When the editor moves to another file, the open file keeps its unsaved image steps and undo history.
  function stashCurrent() {
    const e = S.entry; if (!e) return;
    e.stash = S.ops.length || S.undo.length || S.redo.length ? { img: S.img, origImg: S.origImg, ops: S.ops.slice(), turns: S.turns, undo: S.undo, redo: S.redo, crop: S.crop, regions: S.regions, win: { ...S.win }, decoded: S.decoded, imgError: S.imgError } : null;
    if (e.stash && !e.stash.ops.length) { e.stash.img = null; e.stash.origImg = null; } // metadata history only: no image copies kept
  }
  async function openParsed(file, name, entry) {
    S.entry = entry || null;
    const stash = entry && entry.stash;
    S.orig = file; S.file = entry ? entry.file : D.clone(file); S.name = name;
    S.undo = []; S.redo = []; S.ops = []; S.turns = 0; S.origEls = entry ? entry.origEls : new Map(); S.crop = null; S.regions = []; S.scratches = []; S.frame = 0; S.comparing = false; savedState = (entry && entry.savedKey) || '';
    let img = D.getImage(S.file);
    S.decoded = false; S.edge.on = false; S.edgeCache = null; S.rawAutoWidth = null;
    if (stash && stash.origImg) { img = stash.origImg; S.decoded = stash.decoded; }
    else if (img.compressed && window.Codec && Codec.canDecode(file.transferSyntax)) {
      try {
        $('busy').textContent = 'Decompressing JPEG 2000…';
        await Codec.load();
        const g = D.imageGeometry(S.file);
        img = g.samplesPerPixel !== 1 ? { error: 'Only greyscale images can be processed. Metadata can still be edited.' }
          : D.imageFromFrames(S.file, Codec.decodeFrames(S.file.ds.el.get(D.PIXEL).fragments, g));
        S.decoded = !img.error;
      } catch (e) { console.warn(e); img = { error: `The JPEG 2000 image could not be decoded (${e.message}). Metadata can still be edited.` }; }
    }
    S.imgError = img.error || ''; S.img = img.error ? null : img; S.origImg = S.img;
    if (stash) {
      if (stash.img) { S.img = stash.img; S.ops = stash.ops.slice(); S.turns = stash.turns; S.crop = stash.crop; S.regions = stash.regions; }
      S.undo = stash.undo; S.redo = stash.redo;
    }
    $('save-format').value = S.decoded ? 'j2k' : 'raw';
    $('save-format').disabled = !S.img || S.img.bitsAllocated > 16;
    $('empty').classList.add('hidden');
    ['btn-save', 'btn-export'].forEach(id => { $(id).disabled = false; });
    const rows = D.getNumber(S.file.ds, 0x00280010), cols = D.getNumber(S.file.ds, 0x00280011);
    $('fileinfo').dataset.file = `${name} · ${cols || '?'}×${rows || '?'} · ${D.TS_NAMES[file.transferSyntax] || file.transferSyntax}`;
    updateFileInfo();
    const fs = $('frame'); fs.innerHTML = '';
    if (S.img && S.img.frames.length > 1) { S.img.frames.forEach((_, i) => fs.append(el('option', { value: i }, `${i + 1} of ${S.img.frames.length}`))); $('frame-wrap').classList.remove('hidden'); }
    else $('frame-wrap').classList.add('hidden');
    for (const [box, tools] of [['img-unavail', 'img-tools'], ['crop-unavail', 'crop-tools']]) {
      $(box).textContent = S.imgError; $(box).classList.toggle('hidden', !S.imgError); $(tools).classList.toggle('hidden', !!S.imgError);
    }
    $('export-menu').querySelectorAll('[data-export]').forEach(b => { b.disabled = !S.img; });
    // INDUSTREX stores its viewing angle as ANGLE "0,0,a" with a counter-clockwise (on the owner's files, 90
    // shows the location numbers upright and reading left to right); the viewer's rotation is clockwise.
    const angle = D.industrexXmlEntry(file.ds, 'ANGLE'), deg = angle ? Math.round(Number(angle[angle.length - 1])) : 0;
    const cw = (((360 - deg) % 360) + 360) % 360;
    S.viewRot = [0, 90, 180, 270].includes(cw) ? cw : 0;
    S.viewRotFrom = angle ? 'INDUSTREX' : ''; S.viewRotStart = S.viewRot;
    updateViewRotLabel(); $('btn-viewrot').disabled = !S.img;
    if (S.img) { if (stash && stash.img) { S.win = { ...stash.win }; syncWindowInputs(); } else resetWindow('file'); S.dirtyImage = true; fit(); }
    else { S.bmp = null; draw(); }
    syncEdgeInputs(); showEdgeFileSettings(); $('btn-overlay').disabled = !S.img; renderOverlayTab();
    renderMeta(); refreshImageUi(); renderRegions(); renderHistory();
    toast(`Opened ${name}`);
    if (HOST) HOST.post('title', { text: name });
  }
  // Files chosen or dropped: added to the list; the first is opened.
  async function openFile(f) { if (!f) return; await addFiles([f]); }
  async function addFiles(files) { const l = await filesToList(files); if (l.length) await addShots(l, { open: true, single: l.length === 1 }); }

  // ---------- metadata ----------
  const keyOf = (path, tag) => (path ? path + '/' : '') + tag.toString(16).padStart(8, '0');
  function remember(key, ds, tag) { if (!S.origEls.has(key)) { const cur = ds.el.get(tag); S.origEls.set(key, cur ? D.clone(cur) : null); } }
  function sameAsOrig(key, ds, tag) {
    const o = S.origEls.get(key), cur = ds.el.get(tag);
    if (!o || !cur) return !o && !cur;
    if (o.vr !== cur.vr || !o.value || !cur.value) return false;
    return o.value.length === cur.value.length && o.value.every((b, i) => b === cur.value[i]);
  }
  function setField(ds, tag, text, path, vr) {
    const key = keyOf(path, tag);
    const before = ds.el.get(tag), utf8 = D.charsetIsUtf8(S.file.ds), oldText = before ? D.valueToText(before, utf8) : '';
    const snap = metaSnapshot();
    remember(key, ds, tag);
    try {
      if (text === '' && !before) { if (sameAsOrig(key, ds, tag)) S.origEls.delete(key); return ''; }
      D.setText(ds, tag, text, vr, S.file.ds);
    } catch (e) { if (sameAsOrig(key, ds, tag)) S.origEls.delete(key); return e.message; }
    if (sameAsOrig(key, ds, tag)) S.origEls.delete(key);
    const now = ds.el.get(tag), newText = now ? D.valueToText(now, utf8) : '';
    if (newText !== oldText || !before) pushMeta(snap, before ? `${D.describeTag(S.file.ds, tag).name}: “${oldText}” → “${newText}”` : `Added ${D.describeTag(S.file.ds, tag).name}`);
    afterMetaChange(tag);
    return '';
  }
  function deleteField(ds, tag, path) {
    const key = keyOf(path, tag), snap = metaSnapshot();
    remember(key, ds, tag); D.remove(ds, tag); if (sameAsOrig(key, ds, tag)) S.origEls.delete(key);
    pushMeta(snap, `Removed ${D.describeTag(S.file.ds, tag).name}`);
    afterMetaChange(tag); renderMeta();
  }
  function revertField(ds, tag, path) {
    const key = keyOf(path, tag), o = S.origEls.get(key), snap = metaSnapshot();
    if (o) ds.el.set(tag, D.clone(o)); else ds.el.delete(tag);
    S.origEls.delete(key);
    pushMeta(snap, `Reverted ${D.describeTag(S.file.ds, tag).name}`);
    afterMetaChange(tag); renderMeta();
  }

  // ---------- undo / redo (metadata and image steps in one history) ----------
  // Each entry holds the state from before a change: either the metadata (all elements except the pixels, plus
  // the record of original values) or the image side (pixels, step list, rotation count, crop box, regions).
  // Undo swaps that state back in and puts the current one on the redo stack.
  const MAX_IMAGE_UNDO = 20;
  function metaSnapshot() {
    const el = new Map(); for (const [t, e] of S.file.ds.el) if (t !== D.PIXEL) el.set(t, D.clone(e));
    return { el, origEls: new Map([...S.origEls].map(([k, v]) => [k, v ? D.clone(v) : null])) };
  }
  function pushMeta(snap, text) {
    if (S.batch) { if (!S.batch.snap) S.batch.snap = snap; return; } // grouped (e.g. a template): one entry
    S.undo.push({ kind: 'meta', snap, text }); S.redo = []; trimUndo(); markEntryDirty(); refreshUndoUi();
  }
  // The open file's "edited" mark follows its real state (undoing back to the file as opened clears it).
  function markEntryDirty() { if (S.entry) { S.entry.dirty = hasChanges() && stateKey() !== savedState; if (typeof renderFilePane === 'function') renderFilePane(); } }
  function restoreMeta(snap) {
    const px = S.file.ds.el.get(D.PIXEL);
    S.file.ds.el = new Map(snap.el); if (px) S.file.ds.el.set(D.PIXEL, px);
    S.origEls = snap.origEls; if (S.entry) S.entry.origEls = S.origEls;
    renderMeta(); afterMetaChange(0x00281050);
  }
  const imageState = () => ({ img: S.img, ops: S.ops.slice(), turns: S.turns, crop: S.crop, regions: S.regions });
  function restoreImage(st) {
    const g = dimsDiffer(st.img);
    S.ops = st.ops.slice(); S.turns = st.turns; S.crop = st.crop; S.regions = st.regions; renderRegions(); setImg(st.img); if (g) fit();
  }
  // Keeps memory bounded: at most MAX_IMAGE_UNDO image snapshots (each holds a full image).
  function trimUndo() {
    let images = S.undo.filter(u => u.kind === 'image').length, dropped = false;
    while (images > MAX_IMAGE_UNDO) { const u = S.undo.shift(); if (u.kind === 'image') images--; dropped = true; }
    if (dropped) toast(`Only the last ${MAX_IMAGE_UNDO} image steps can be undone.`);
  }
  function undo() {
    if (S.mode === 'organize') return shotsUndo();
    const u = S.undo.pop(); if (!u) return;
    if (u.kind === 'meta') { S.redo.push({ kind: 'meta', snap: metaSnapshot(), text: u.text }); restoreMeta(u.snap); }
    else { S.redo.push({ kind: 'image', state: imageState(), text: u.text }); restoreImage(u.state); }
    markEntryDirty(); refreshUndoUi(); toast(`Undone: ${u.text}`);
  }
  function redo() {
    if (S.mode === 'organize') return shotsRedo();
    const r = S.redo.pop(); if (!r) return;
    if (r.kind === 'meta') { S.undo.push({ kind: 'meta', snap: metaSnapshot(), text: r.text }); restoreMeta(r.snap); }
    else { S.undo.push({ kind: 'image', state: imageState(), text: r.text }); restoreImage(r.state); }
    markEntryDirty(); refreshUndoUi(); toast(`Redone: ${r.text}`);
  }
  function refreshUndoUi() {
    const shots = S.mode === 'organize', U = shots ? S.shUndo : S.undo, R = shots ? S.shRedo : S.redo;
    const u = U[U.length - 1], r = R[R.length - 1];
    for (const [id, e, verb] of [['tb-undo', u, 'Undo'], ['tb-redo', r, 'Redo']]) {
      $(id).disabled = !e; $(id).title = e ? `${verb}: ${e.text} (${verb === 'Undo' ? 'Ctrl+Z' : 'Ctrl+Y'})` : `Nothing to ${verb.toLowerCase()}`;
      $(id).setAttribute('aria-label', e ? `${verb}: ${e.text}` : `${verb} (nothing to ${verb.toLowerCase()})`);
    }
    const eu = S.undo[S.undo.length - 1];
    $('btn-undo').disabled = !eu; $('btn-redo').disabled = !S.redo.length;
    $('btn-undo').textContent = eu ? `Undo: ${eu.text}` : 'Undo';
    renderHistory();
  }
  function afterMetaChange(tag) {
    if (S.img && [0x00281050, 0x00281051, 0x00281052, 0x00281053].includes(tag)) {
      const n = t => D.getNumber(S.file.ds, t);
      S.img.slope = n(0x00281053) ?? 1; S.img.intercept = n(0x00281052) ?? 0;
      S.img.windowCenter = n(0x00281050); S.img.windowWidth = n(0x00281051);
      S.dirtyImage = true; draw();
    }
    renderHistory(); updateTemplateButtons();
    if (S.ov.opts.enabled) draw();
  }

  function fieldRow(ds, tag, path, depth) {
    const info = D.describeTag(S.file.ds, tag), e = ds.el.get(tag), key = keyOf(path, tag);
    const vr = e ? e.vr : info.vr || 'LO';
    const changed = S.origEls.has(key);
    const ro = READ_ONLY.has(tag) && !path || (tag >>> 16) === 0x0002 || (e && !D.editable(e.vr));
    const utf8 = D.charsetIsUtf8(S.file.ds);
    const text = e ? D.valueToText(e, utf8) : '';
    const sub = `${D.tagHex(tag)} · ${vr}${info.ndeName ? ' · DICOM: ' + info.dicomName : ''}`;
    const row = el('div', { class: 'field' + (changed ? ' changed' : ''), 'data-tag': D.tagHex(tag) });
    const id = 'f-' + key.replace(/\//g, '-');
    row.append(el('div', { class: 'lbl' }, el('label', { for: id }, el('b', {}, info.name)), el('span', { class: 'sub' }, sub)));
    const err = el('div', { class: 'err', id: id + '-err' });
    if (ro || (e && e.items)) {
      row.append(el('div', { class: 'ro', id }, e ? text : '(not set)'));
      if (tag === 0x00080018) row.append(el('div', { class: 'note' }, 'A new UID is assigned when you save a copy.'));
    } else {
      const long = ['LT', 'UT'].includes(vr);
      const input = el(long ? 'textarea' : 'input', { class: 'val', id, 'aria-describedby': id + '-err', placeholder: e ? '' : 'Not set — type to add', spellcheck: 'false' });
      input.value = text;
      const commit = () => {
        if (input.value === (ds.el.get(tag) ? D.valueToText(ds.el.get(tag), utf8) : '')) return;
        const msg = setField(ds, tag, input.value, path, vr);
        err.textContent = msg; input.classList.toggle('bad', !!msg);
        if (!msg) { input.value = ds.el.get(tag) ? D.valueToText(ds.el.get(tag), utf8) : ''; row.classList.toggle('changed', S.origEls.has(key)); refreshRowActions(); }
      };
      input.addEventListener('change', commit);
      if (!long) input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); } });
      row.append(input);
    }
    const acts = el('div', { class: 'acts' });
    const refreshRowActions = () => {
      acts.innerHTML = '';
      if (!path && tag !== D.PIXEL && !(e && e.items)) {
        const on = !!O.cornerOf(S.ov.layout, O.hexOf(tag));
        acts.append(el('button', { class: 'icon pin', 'aria-pressed': String(on), title: on ? 'Shown in the image overlay (click to hide)' : 'Show in the image overlay', 'aria-label': `${on ? 'Hide' : 'Show'} ${info.name} in the image overlay`, onclick: () => togglePin(tag) }, '📌'));
      }
      if (S.origEls.has(key)) acts.append(el('button', { class: 'icon', title: 'Undo this change', 'aria-label': `Revert ${info.name}`, onclick: () => revertField(ds, tag, path) }, '↺'));
      if (ds.el.get(tag) && !ro && tag !== D.PIXEL) acts.append(el('button', { class: 'icon danger', title: 'Remove this tag', 'aria-label': `Remove ${info.name}`, onclick: () => deleteField(ds, tag, path) }, '×'));
    };
    refreshRowActions();
    row.append(acts, err);
    if (e && e.items && S.metaView === 'all') {
      const nest = el('div', { class: 'nest' });
      e.items.forEach((item, i) => {
        nest.append(el('div', { class: 'item-h' }, `Item ${i + 1}`));
        [...item.el.keys()].sort((a, b) => a - b).forEach(t => nest.append(fieldRow(item, t, `${key}/${i}`, depth + 1)));
      });
      row.append(el('div', { style: 'grid-column:1/-1' }, nest));
    }
    return row;
  }

  const SOP_NAMES = { '1.2.840.10008.5.1.4.1.1.1': 'CR image', '1.2.840.10008.5.1.4.1.1.1.1': 'DX image (for presentation)', '1.2.840.10008.5.1.4.1.1.1.1.1': 'DX image (for processing)', '1.2.840.10008.5.1.4.1.1.7': 'Secondary capture' };
  function summaryCard() {
    const ds = S.orig.ds, ix = D.industrexInfo(ds), sop = D.getString(ds, 0x00080016);
    const bits = S.img ? `${S.img.cols}×${S.img.rows}, ${S.img.bitsStored}-bit` : 'image not editable';
    const card = el('div', { class: 'summary', id: 'summary' },
      el('div', { class: 'chips' },
        el('span', { class: 'chip' }, SOP_NAMES[sop] || D.getString(ds, 0x00080060) || 'DICOM image'),
        ix ? el('span', { class: 'chip accent' }, `INDUSTREX${ix.version ? ' ' + ix.version : ''}`) : '',
        D.getString(ds, 0x00081090) ? el('span', { class: 'chip' }, D.getString(ds, 0x00081090)) : '',
        el('span', { class: 'chip' }, bits)));
    const stale = D.stalePresentationTags(ds);
    if (D.industrexXmlValues(ds, 0x00080060) || D.industrexXmlValues(ds, 0x00100010)) card.append(el('p', { class: 'note' }, 'INDUSTREX keeps a second copy of these fields in its XML presentation state. Your edits are copied into it when you save.'));
    if (stale.length) card.append(el('p', { class: 'note' }, `Processed copies (rotated, cropped, filtered) leave out ${stale.map(t => t === 0x00880200 ? 'icon thumbnail' : D.describeTag(ds, t).name.replace(/^INDUSTREX /, '')).filter((v, i, a) => a.indexOf(v) === i).join(', ')}, because ${stale.length === 1 ? 'it describes' : 'they describe'} the original pixels. Metadata-only copies keep everything.`));
    return card;
  }
  function matches(ds, tag, q) {
    if (!q) return true;
    const info = D.tagInfo(tag), e = ds.el.get(tag);
    return (info.name + ' ' + info.dicomName + ' ' + D.tagHex(tag) + ' ' + (e ? D.valueToText(e, D.charsetIsUtf8(S.file.ds)) : '')).toLowerCase().includes(q);
  }
  function renderMeta() {
    const list = $('meta-list'); list.innerHTML = '';
    if (!S.file) { list.append(el('p', { class: 'note' }, 'Open a file to see its tags.')); return; }
    const q = $('meta-search').value.trim().toLowerCase(), ds = S.file.ds;
    if (!q) list.append(summaryCard());
    if (S.metaView === 'common') {
      for (const [title, tags] of COMMON) {
        const rows = tags.filter(t => matches(ds, t, q));
        if (!rows.length) continue;
        list.append(el('h3', {}, title));
        const g = el('div', { class: 'group' }); rows.forEach(t => g.append(fieldRow(ds, t, '', 0))); list.append(g);
      }
      if (!list.children.length) list.append(el('p', { class: 'note' }, 'No common fields match. Try All tags.'));
    } else {
      const tags = [...ds.el.keys()].sort((a, b) => a - b).filter(t => matches(ds, t, q));
      const g = el('div', { class: 'group' });
      [...S.file.meta.el.keys()].sort((a, b) => a - b).filter(t => matches(S.file.meta, t, q)).forEach(t => g.append(fieldRow(S.file.meta, t, 'meta', 0)));
      tags.forEach(t => g.append(fieldRow(ds, t, '', 0)));
      list.append(g);
      list.append(el('p', { class: 'note' }, `${tags.length} tags. File meta (0002) tags are rewritten automatically when saving.`));
    }
  }

  // add-tag form
  function fillAddForm() {
    const dl = $('tag-list'); dl.innerHTML = '';
    for (const [t, d] of D.DICT) { if ((t >>> 16) === 0x0002 || READ_ONLY.has(t) || d.vr === 'SQ' || d.vr.startsWith('O')) continue; const i = D.tagInfo(t); dl.append(el('option', { value: `${D.tagHex(t)} ${i.name}` })); }
    VRS.forEach(v => $('add-vr').append(el('option', { value: v }, v)));
  }
  function addTagSubmit(ev) {
    ev.preventDefault();
    const raw = $('add-tag').value.trim(), err = $('add-err');
    const m = /^\(?[0-9a-f]{4},?[0-9a-f]{4}\)?/i.exec(raw.replace(/\s/g, ''));
    const tag = m ? D.parseTag(m[0]) : D.parseTag(raw) ?? (D.findTagsByText(raw).length === 1 ? D.findTagsByText(raw)[0] : null);
    if (tag == null) { err.textContent = 'Enter a tag number like (0018,1004), or pick a name from the list.'; return; }
    if ((tag >>> 16) === 0x0002 || READ_ONLY.has(tag)) { err.textContent = 'That tag is managed automatically and cannot be added by hand.'; return; }
    if ((tag >>> 16) & 1) { err.textContent = 'Private (odd-group) tags need a private creator and are not supported here.'; return; }
    const msg = setField(S.file.ds, tag, $('add-value').value, '', $('add-vr').value);
    if (msg) { err.textContent = msg; return; }
    err.textContent = ''; $('addform').classList.add('hidden'); $('addform').reset();
    S.metaView = 'all'; syncSeg('[data-metaview]', 'metaview', 'all'); $('meta-search').value = '';
    renderMeta();
    const row = document.querySelector(`[data-tag="${D.tagHex(tag)}"]`); if (row) row.scrollIntoView({ block: 'center' });
    toast(`Added ${D.tagInfo(tag).name}`);
  }
  function addTagGuessVr() { const raw = $('add-tag').value.trim(); const m = /^\(?\s*[0-9a-f]{4}\s*,?\s*[0-9a-f]{4}\s*\)?/i.exec(raw); const t = m ? D.parseTag(m[0]) : D.parseTag(raw); const vr = t != null && D.tagInfo(t).vr; if (vr && VRS.includes(vr)) $('add-vr').value = vr; }

  // templates (top-level changed fields only)
  const TPL_KEY = 'diconde-editor.templates.v1';
  function loadTemplates() { try { const t = JSON.parse(localStorage.getItem(TPL_KEY) || '{}'); return t && typeof t === 'object' ? t : {}; } catch (e) { return {}; } }
  function saveTemplates(t) { try { localStorage.setItem(TPL_KEY, JSON.stringify(t)); return true; } catch (e) { toast('Templates could not be saved in this browser.', true); return false; } }
  function changedTopLevel() { return [...S.origEls.keys()].filter(k => !k.includes('/')).map(k => parseInt(k, 16) >>> 0); }
  function renderTemplates() {
    const sel = $('tpl-select'), cur = sel.value, t = loadTemplates(); sel.innerHTML = '';
    sel.append(el('option', { value: '' }, Object.keys(t).length ? 'Templates…' : 'No templates yet'));
    Object.keys(t).sort().forEach(n => sel.append(el('option', { value: n }, `${n} (${Object.keys(t[n]).length} fields)`)));
    sel.value = t[cur] ? cur : ''; updateTemplateButtons();
  }
  function updateTemplateButtons() { const has = !!$('tpl-select').value; $('tpl-apply').disabled = !has || !S.file; $('tpl-del').disabled = !has; $('tpl-save').disabled = !S.file || !changedTopLevel().length; }
  function saveTemplate() {
    const tags = changedTopLevel(); if (!tags.length) return;
    const name = (prompt(`Template name for ${tags.length} changed field(s):`) || '').trim(); if (!name) return;
    const t = loadTemplates(), fields = {};
    for (const tag of tags) { const e = S.file.ds.el.get(tag); fields[tag.toString(16).padStart(8, '0')] = e ? { vr: e.vr, text: D.valueToText(e, D.charsetIsUtf8(S.file.ds)) } : { remove: true }; }
    t[name] = fields;
    if (saveTemplates(t)) { renderTemplates(); $('tpl-select').value = name; updateTemplateButtons(); toast(`Saved template “${name}”`); }
  }
  function applyTemplate() {
    const name = $('tpl-select').value, f = loadTemplates()[name]; if (!f || !S.file) return;
    const problems = [];
    S.batch = {};
    for (const [hex, v] of Object.entries(f)) {
      const tag = parseInt(hex, 16) >>> 0;
      if (v.remove) { if (S.file.ds.el.has(tag)) deleteField(S.file.ds, tag, ''); continue; }
      const msg = setField(S.file.ds, tag, v.text, '', v.vr); if (msg) problems.push(`${D.tagInfo(tag).name}: ${msg}`);
    }
    const batch = S.batch; S.batch = null;
    if (batch.snap) pushMeta(batch.snap, `Applied template “${name}”`);
    renderMeta();
    toast(problems.length ? `Applied with problems — ${problems.join('; ')}` : `Applied template “${name}”`, !!problems.length);
  }
  function deleteTemplate() { const name = $('tpl-select').value; if (!name || !confirm(`Delete template “${name}”?`)) return; const t = loadTemplates(); delete t[name]; saveTemplates(t); renderTemplates(); }

  // ---------- information overlay ----------
  const OV_KEY = 'diconde-editor.overlay.v1', OV_PX = { s: 11, m: 13, l: 16 };
  S.ov = (() => {
    try { const v = JSON.parse(localStorage.getItem(OV_KEY) || 'null'); if (v) return { layout: O.cleanLayout(v.layout), opts: Object.assign({}, O.DEFAULT_OPTIONS, v.opts) }; } catch (e) { /* storage unavailable */ }
    return { layout: O.cleanLayout(O.DEFAULT_LAYOUT), opts: Object.assign({}, O.DEFAULT_OPTIONS) };
  })();
  function saveOv() { try { localStorage.setItem(OV_KEY, JSON.stringify(S.ov)); } catch (e) { /* per-browser convenience only */ } }
  function liveValues(forExport) {
    if (!S.img) return {};
    const n = S.img.frames.length;
    return { 'live:wl': `W ${Math.round(S.win.w)} L ${Math.round(S.win.c)}${S.edge.on ? ' (enhanced)' : ''}`, 'live:zoom': forExport ? '' : `${Math.round(S.view.zoom * 100)}%`,
      'live:size': `${S.img.cols} × ${S.img.rows}`, 'live:view': S.viewRot ? viewRotText(S.viewRot) : '', 'live:file': S.name, 'live:frame': n > 1 ? `${S.frame + 1} of ${n}` : '' };
  }
  const overlayLines = forExport => O.lines(S.file.ds, S.ov.layout, liveValues(forExport), { labels: S.ov.opts.labels });
  function setOverlay(on) { S.ov.opts.enabled = on; saveOv(); syncOverlayUi(); draw(); }
  function syncOverlayUi() {
    const o = S.ov.opts;
    $('ov-on').checked = o.enabled; $('ov-labels').checked = o.labels; $('ov-size').value = o.size; $('ov-exports').checked = o.inExports;
    $('btn-overlay').setAttribute('aria-pressed', String(o.enabled));
  }
  function togglePin(tag) {
    const k = O.hexOf(tag), c = O.cornerOf(S.ov.layout, k);
    if (c) S.ov.layout[c] = S.ov.layout[c].filter(x => x !== k); else { S.ov.layout.tl.push(k); if (!S.ov.opts.enabled) S.ov.opts.enabled = true; }
    saveOv(); syncOverlayUi(); renderMeta(); renderOverlayTab(); draw();
    toast(c ? `${D.describeTag(S.file.ds, tag).name} removed from the overlay` : `${D.describeTag(S.file.ds, tag).name} shown top left; arrange it on the Overlay tab`);
  }
  function overlayChoices() {
    const ds = S.file ? S.file.ds : null, seen = new Set(), out = [];
    Object.keys(O.LIVE).forEach(k => out.push([k, O.LIVE[k] + ' (live)']));
    const add = t => { const k = O.hexOf(t); if (seen.has(k) || (t >>> 16) === 0x0002 || t === D.PIXEL) return; seen.add(k); out.push([k, `${D.describeTag(ds, t).name} ${D.tagHex(t)}`]); };
    COMMON.forEach(([, tags]) => tags.forEach(add));
    if (ds) [...ds.el.keys()].sort((a, b) => a - b).filter(t => { const e = ds.el.get(t); return e.value && D.editable(e.vr); }).forEach(add);
    return out;
  }
  function renderOverlayTab() {
    const box = $('ov-corners'); box.innerHTML = '';
    const ds = S.file ? S.file.ds : null, choices = overlayChoices();
    for (const c of O.CORNERS) {
      const list = S.ov.layout[c], wrap = el('div', { class: 'ov-corner' }, el('h3', {}, O.CORNER_NAMES[c]));
      if (!list.length) wrap.append(el('div', { class: 'note' }, 'Nothing here.'));
      list.forEach((k, i) => {
        const move = el('select', { 'aria-label': `Move ${O.itemName(k, ds)}` }, ...O.CORNERS.map(x => el('option', { value: x, selected: x === c }, O.CORNER_NAMES[x])));
        move.onchange = () => { S.ov.layout[c].splice(i, 1); S.ov.layout[move.value].push(k); ovChanged(); };
        wrap.append(el('div', { class: 'ov-item', 'data-key': k }, el('span', {}, O.itemName(k, ds)),
          el('span', { class: 'ctrls' },
            el('button', { class: 'icon', 'aria-label': `Move ${O.itemName(k, ds)} up`, disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; ovChanged(); } }, '↑'),
            el('button', { class: 'icon', 'aria-label': `Move ${O.itemName(k, ds)} down`, disabled: i === list.length - 1, onclick: () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; ovChanged(); } }, '↓'),
            move,
            el('button', { class: 'icon danger', 'aria-label': `Remove ${O.itemName(k, ds)} from the overlay`, onclick: () => { list.splice(i, 1); ovChanged(); } }, '×'))));
      });
      const pick = el('select', { 'aria-label': `Field to add to ${O.CORNER_NAMES[c].toLowerCase()}` }, el('option', { value: '' }, 'Add a field…'), ...choices.filter(([k]) => !O.cornerOf(S.ov.layout, k)).map(([k, label]) => el('option', { value: k }, label)));
      wrap.append(el('div', { class: 'ov-add' }, pick, el('button', { onclick: () => { if (pick.value) { list.push(pick.value); if (!S.ov.opts.enabled) S.ov.opts.enabled = true; ovChanged(); } } }, 'Add')));
      box.append(wrap);
    }
  }
  function ovChanged() { S.ov.layout = O.cleanLayout(S.ov.layout); saveOv(); syncOverlayUi(); renderOverlayTab(); if (S.file) renderMeta(); draw(); }
  function drawOverlay(c, w, h, px, forExport) { if (S.file && S.img && S.ov.opts.enabled) O.draw(c, { x: 0, y: 0, w, h }, overlayLines(forExport), px); }

  // ---------- viewer ----------
  const canvas = $('view'), ctx = canvas.getContext('2d');
  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
    if (S.fitted) fit(); else draw();
  }
  function frameData() { return S.img.frames[Math.min(S.frame, S.img.frames.length - 1)]; }
  // ---------- EDGE-style display enhancement ----------
  function pixelSpacingMm() { const ds = S.file.ds; return D.getNumber(ds, 0x00181164) || D.getNumber(ds, 0x00280030) || 0.1; }
  function edgeParams() {
    const e = S.edge, whiteSign = S.img.photometric === 'MONOCHROME1' ? -1 : 1;
    if (S.rawAutoWidth == null) S.rawAutoWidth = I.autoWindow(frameData(), 1, 0, 0.5, 99.8, S.img.padding).width;
    // Thresholds scale with the image's useful exposure range (the width of its automatic window).
    return { globalContrast: e.gc, detailContrast: e.dc, sharpness: e.sh, noiseReduction: e.nr, kernelPx: e.mm / pixelSpacingMm(),
      padding: S.img.padding, despeckle: e.ds, whiteSign, despeckleThreshold: e.ds ? 0.3 * S.rawAutoWidth : 0, detailLimit: 0.35 * S.rawAutoWidth };
  }
  function edgeFrameFor(img, frame) { return I.edgeEnhance(img.frames[frame], img.cols, img.rows, edgeParams()); }
  function edgeFrame() {
    const key = JSON.stringify([S.frame, edgeParams()]);
    if (!S.edgeCache || S.edgeCache.img !== S.img || S.edgeCache.key !== key) S.edgeCache = { img: S.img, key, data: edgeFrameFor(S.img, Math.min(S.frame, S.img.frames.length - 1)) };
    return S.edgeCache.data;
  }
  const EDGE_FIELDS = [['gc', 'edge-gc'], ['dc', 'edge-dc'], ['sh', 'edge-sh'], ['nr', 'edge-nr'], ['mm', 'edge-mm'], ['br', 'edge-br']];
  function syncEdgeInputs() {
    EDGE_FIELDS.forEach(([k, id]) => { $(id).value = S.edge[k]; $(id + '-r').value = S.edge[k]; });
    $('edge-on').checked = S.edge.on; $('edge-ds').checked = S.edge.ds;
    $('edge-controls').classList.toggle('dim', !S.edge.on);
    $('store-window').disabled = S.edge.on; if (S.edge.on) $('store-window').checked = false;
  }
  // Recomputes the enhanced frame (about a second for a full plate) and picks a window for it.
  function updateEdge(rewindow) {
    if (!S.img) return;
    if (!S.edge.on) { S.dirtyImage = true; draw(); return; }
    busy(() => {
      const f = edgeFrame();
      if (rewindow) { const w = I.autoWindow(f, S.img.slope, S.img.intercept); S.win = { c: w.center, w: w.width }; syncWindowInputs(); }
      S.dirtyImage = true; draw();
    }, 'Enhancing…');
  }
  function setEdgeOn(on) {
    if (!S.img || S.edge.on === on) return;
    if (on) S.rawWin = { ...S.win }; else if (S.rawWin) S.win = { ...S.rawWin };
    S.edge.on = on; syncEdgeInputs(); syncWindowInputs(); updateEdge(on);
  }
  function edgeFromFile() {
    const d = D.industrexDisplaySettings(S.orig.ds), st = d && d.settings, num = (k, def) => (typeof st[k] === 'number' ? st[k] : def);
    if (!st) return;
    Object.assign(S.edge, { gc: num('Global Contrast', 1), dc: num('Detail Contrast', 1), sh: num('Sharpness', 1), nr: Math.min(1, num('Noise Reduction', 0)), br: Math.max(-1, Math.min(1, num('Brightness', 0))), ds: !!num('Despeckle', 0) });
    syncEdgeInputs(); updateEdge(true);
  }
  function showEdgeFileSettings() {
    const d = S.orig && D.industrexDisplaySettings(S.orig.ds), box = $('edge-file'); box.innerHTML = '';
    if (!d) { box.classList.add('hidden'); return; }
    const parts = ['Image Class', 'Brightness', 'Global Contrast', 'Detail Contrast', 'Sharpness', 'Noise Reduction', 'Despeckle'].filter(k => k in d.settings).map(k => `${k} ${d.settings[k]}`);
    box.append(`This file's INDUSTREX display settings: ${d.filter || 'filter'}${parts.length ? ' · ' + parts.join(' · ') : ''}. `, el('button', { class: 'icon', id: 'edge-use-file', onclick: edgeFromFile }, 'Use these'));
    box.classList.remove('hidden');
  }
  function bakeEdge() {
    if (!S.img || !S.edge.on) return;
    busy(() => {
      const img = S.img, e = S.edge;
      const frames = img.frames.map((a, fi) => {
        const f = fi === Math.min(S.frame, img.frames.length - 1) ? edgeFrame() : edgeFrameFor(img, fi), o = new a.constructor(a.length);
        for (let i = 0; i < a.length; i++) { const v = f[i]; o[i] = v !== v ? a[i] : v < img.min ? img.min : v > img.max ? img.max : Math.round(v); }
        return o;
      });
      const text = `EDGE-style enhancement applied (global contrast ${e.gc}, detail contrast ${e.dc}, sharpness ${e.sh}, noise reduction ${e.nr}, kernel ${e.mm} mm${e.ds ? ', despeckle' : ''})`;
      const win = { ...S.win, c: S.win.c - e.br * S.win.w * 0.5 * (img.photometric === 'MONOCHROME1' ? -1 : 1) };
      S.edge.on = false; syncEdgeInputs();
      pushImage(Object.assign({}, img, { frames }), text);
      S.win = win; syncWindowInputs(); S.dirtyImage = true; draw();
      toast('Enhancement written into the image. Save a copy to keep it; the copy is marked DERIVED.');
    }, 'Applying…');
  }
  function rebuildBitmap() {
    if (!S.img) { S.bmp = null; return; }
    const w = S.img.cols, h = S.img.rows;
    if (!S.bmp || S.bmp.width !== w || S.bmp.height !== h) { S.bmp = document.createElement('canvas'); S.bmp.width = w; S.bmp.height = h; S.bmpData = S.bmp.getContext('2d').createImageData(w, h); }
    if (S.edge.on) {
      const f = edgeFrame(), whiteSign = S.img.photometric === 'MONOCHROME1' ? -1 : 1;
      // Brightness moves the window so the display gets lighter (+) or darker (−) whatever the photometric.
      I.render(f, Object.assign({}, S.img, { bitsAllocated: 32 }), S.win.c - S.edge.br * S.win.w * 0.5 * whiteSign, S.win.w, S.invertView, S.bmpData.data);
    } else I.render(frameData(), S.img, S.win.c, S.win.w, S.invertView, S.bmpData.data);
    S.bmp.getContext('2d').putImageData(S.bmpData, 0, 0);
    S.dirtyImage = false;
  }
  // Hold-to-compare: the original pixels with the current window, in the same place when the size is unchanged.
  // Hold-to-compare: the original pixels with the current window, in the same place when the size is unchanged.
  function drawOriginal() {
    const o = S.origImg, sameSize = o.rows === S.img.rows && o.cols === S.img.cols;
    const c = document.createElement('canvas'); c.width = o.cols; c.height = o.rows;
    const cx = c.getContext('2d'), id = cx.createImageData(o.cols, o.rows);
    I.render(o.frames[Math.min(S.frame, o.frames.length - 1)], o, S.win.c, S.win.w, S.invertView, id.data); cx.putImageData(id, 0, 0);
    const v = sameSize ? S.view : fitView(o);
    drawRotated(c, o, v);
    ctx.font = 'bold 13px system-ui'; ctx.fillStyle = '#4cc3ff'; const lab = S.edge.on ? 'ORIGINAL (not enhanced)' : 'ORIGINAL'; ctx.fillRect(8, 8, ctx.measureText(lab).width + 16, 22); ctx.fillStyle = '#000'; ctx.fillText(lab, 16, 24);
  }
  function drawRotated(bitmap, img, v) {
    ctx.save(); ctx.translate(v.x, v.y); ctx.scale(v.zoom, v.zoom);
    I.viewTransform(ctx, img.cols, img.rows, S.viewRot);
    ctx.imageSmoothingEnabled = v.zoom < 1;
    ctx.drawImage(bitmap, 0, 0);
    ctx.restore();
  }
  function setComparing(on) { if (S.comparing === on) return; S.comparing = on; $('btn-compare').setAttribute('aria-pressed', String(on)); draw(); }
  let raf = 0;
  function draw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawNow(); }); }
  // Screen rectangle of an image-space box, honouring zoom, pan and view rotation.
  function screenRect(r) { const q = I.rectToView(r, S.img.cols, S.img.rows, S.viewRot), v = S.view; return { x: v.x + q.x * v.zoom, y: v.y + q.y * v.zoom, w: q.w * v.zoom, h: q.h * v.zoom }; }
  function drawNow() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0d0f12'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!S.img) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (S.comparing && S.origImg && S.origImg !== S.img) { drawOriginal(); return; }
    if (S.dirtyImage) rebuildBitmap();
    drawRotated(S.bmp, S.img, S.view);
    const box = (r, color, label, dash) => {
      const { x, y, w, h } = screenRect(r);
      ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.setLineDash(dash ? [6, 4] : []); ctx.strokeRect(x + .5, y + .5, w, h); ctx.setLineDash([]);
      if (label) { ctx.font = 'bold 13px system-ui'; const tw = ctx.measureText(label).width + 10; ctx.fillStyle = color; ctx.fillRect(x, y, tw, 20); ctx.fillStyle = '#000'; ctx.fillText(label, x + 5, y + 14); }
    };
    if (S.crop) {
      const { x, y, w, h } = screenRect(S.crop);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.rect(0, 0, canvas.width / dpr, canvas.height / dpr); ctx.rect(x, y + h, w, -h); ctx.fill('evenodd');
      box(S.crop, '#4cc3ff', `${Math.round(S.crop.w)}×${Math.round(S.crop.h)}`, true);
    }
    S.regions.forEach((r, i) => box(r, '#f5a623', String(i + 1)));
    { // scratch candidates and the line being drawn
      const v = S.view, sc = (x, y) => { const q = I.toView(x, y, S.img.cols, S.img.rows, S.viewRot); return [v.x + q.x * v.zoom, v.y + q.y * v.zoom]; };
      const seg = (l, color, label) => { const p0 = sc(l.x0, l.y0), p1 = sc(l.x1, l.y1); ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.setLineDash([10, 6]); ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke(); ctx.setLineDash([]);
        if (label) { ctx.font = 'bold 13px system-ui'; ctx.fillStyle = color; ctx.fillRect(p0[0] + 4, p0[1] + 4, ctx.measureText(label).width + 10, 20); ctx.fillStyle = '#000'; ctx.fillText(label, p0[0] + 9, p0[1] + 18); } ctx.restore(); };
      (S.scratches || []).forEach((l, i) => seg(l, '#3df0ff', 'S' + (i + 1)));
      if (S.drag && S.drag.mode === 'scratch' && S.drag.line) seg(S.drag.line, '#3df0ff');
    }
    // Tilted dividing lines between pieces, drawn across each piece's rectangle.
    const toScreen = (x, y) => { const q = I.toView(x, y, S.img.cols, S.img.rows, S.viewRot), v = S.view; return [v.x + q.x * v.zoom, v.y + q.y * v.zoom]; };
    ctx.save(); ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 2; ctx.setLineDash([8, 5]);
    S.regions.forEach(r => (r.cuts || []).forEach(c => {
      const p0 = c.axis === 'x' ? toScreen(c.a + c.k * r.y, r.y) : toScreen(r.x, c.a + c.k * r.x);
      const p1 = c.axis === 'x' ? toScreen(c.a + c.k * (r.y + r.h), r.y + r.h) : toScreen(r.x + r.w, c.a + c.k * (r.x + r.w));
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    }));
    ctx.restore();
    if (S.drag && S.drag.rect && S.drag.mode === 'regions') box(S.drag.rect, '#f5a623', String(S.regions.length + 1), true);
    drawOverlay(ctx, canvas.width / dpr, canvas.height / dpr, OV_PX[S.ov.opts.size] || 13, false);
  }
  function fitView(img) {
    const r = canvas.getBoundingClientRect(), pad = 16, d = I.viewDims(img.cols, img.rows, S.viewRot);
    const z = Math.max(0.01, Math.min((r.width - pad * 2) / d.w, (r.height - pad * 2) / d.h));
    return { zoom: z, x: (r.width - d.w * z) / 2, y: (r.height - d.h * z) / 2 };
  }
  function fit() {
    if (!S.img) return;
    S.fitted = true; Object.assign(S.view, fitView(S.img)); draw();
  }
  function rotateView() {
    if (!S.img) return;
    S.viewRot = (S.viewRot + 90) % 360; updateViewRotLabel(); fit();
  }
  const viewRotText = r => ({ 0: 'upright', 90: '90° right', 180: '180°', 270: '90° left' }[r]);
  function updateViewRotLabel() {
    $('btn-viewrot').textContent = `⟳ View: ${viewRotText(S.viewRot)}`;
    $('btn-viewrot').setAttribute('aria-label', `Rotate view, now ${viewRotText(S.viewRot)}${S.viewRotFrom && S.viewRot === S.viewRotStart ? ' as in INDUSTREX' : ''} (display only)`);
  }
  function zoomAt(factor, cx, cy) {
    if (!S.img) return;
    const r = canvas.getBoundingClientRect(); if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    S.fitted = false; const nz = Math.min(32, Math.max(0.01, S.view.zoom * factor)), k = nz / S.view.zoom;
    S.view.x = cx - (cx - S.view.x) * k; S.view.y = cy - (cy - S.view.y) * k; S.view.zoom = nz; draw();
  }
  function toImage(ev) {
    const r = canvas.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top;
    if (!S.img) return { x: -1, y: -1, sx, sy };
    const p = I.fromView((sx - S.view.x) / S.view.zoom, (sy - S.view.y) / S.view.zoom, S.img.cols, S.img.rows, S.viewRot);
    return { x: p.x, y: p.y, sx, sy };
  }
  const clampRect = (a, b) => {
    const x0 = Math.max(0, Math.min(S.img.cols, Math.min(a.x, b.x))), y0 = Math.max(0, Math.min(S.img.rows, Math.min(a.y, b.y)));
    const x1 = Math.max(0, Math.min(S.img.cols, Math.max(a.x, b.x))), y1 = Math.max(0, Math.min(S.img.rows, Math.max(a.y, b.y)));
    return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1) - Math.round(x0), h: Math.round(y1) - Math.round(y0) };
  };
  function readout(p) {
    if (!S.img) { $('readout').textContent = ''; return; }
    const x = Math.floor(p.x), y = Math.floor(p.y);
    let s = `Zoom ${Math.round(S.view.zoom * 100)}%${S.viewRot ? ` · view ${viewRotText(S.viewRot)}` : ''} · W ${fmt(S.win.w)} L ${fmt(S.win.c)}`;
    if (x >= 0 && y >= 0 && x < S.img.cols && y < S.img.rows) {
      const raw = frameData()[y * S.img.cols + x];
      s = `x ${x}, y ${y} · value ${raw}${S.img.slope !== 1 || S.img.intercept !== 0 ? ` (${fmt(raw * S.img.slope + S.img.intercept)})` : ''} · ` + s;
    }
    $('readout').textContent = s;
  }
  function onDown(ev) {
    if (!S.img) return;
    canvas.setPointerCapture(ev.pointerId);
    const p = toImage(ev);
    let mode = S.tool;
    if (ev.button === 2) mode = 'window'; else if (ev.button === 1) mode = 'pan';
    S.drag = { mode, start: p, view: { ...S.view }, win: { ...S.win } };
    ev.preventDefault();
  }
  function onMove(ev) {
    const p = toImage(ev); readout(p);
    const d = S.drag; if (!d) return;
    const dx = p.sx - d.start.sx, dy = p.sy - d.start.sy;
    if (d.mode === 'pan') { S.fitted = false; S.view.x = d.view.x + dx; S.view.y = d.view.y + dy; draw(); }
    else if (d.mode === 'window') {
      const range = (S.img.max - S.img.min) * Math.abs(S.img.slope || 1), k = range / 600;
      S.win.w = Math.max(1, d.win.w + dx * k); S.win.c = d.win.c - dy * k; S.dirtyImage = true; syncWindowInputs(); draw();
    } else if (d.mode === 'crop') { S.crop = clampRect(d.start, p); syncCropInputs(); draw(); }
    else if (d.mode === 'regions') { d.rect = clampRect(d.start, p); draw(); }
    else if (d.mode === 'scratch') { d.line = { x0: d.start.x, y0: d.start.y, x1: p.x, y1: p.y }; draw(); }
  }
  function onUp(ev) {
    const d = S.drag; S.drag = null; if (!d) return;
    if (d.mode === 'crop' && S.crop && (S.crop.w < 2 || S.crop.h < 2)) S.crop = null;
    if (d.mode === 'scratch' && d.line && Math.hypot(d.line.x1 - d.line.x0, d.line.y1 - d.line.y0) >= 8) repairScratches([d.line], 'drawn');
    if (d.mode === 'regions' && d.rect && d.rect.w >= 4 && d.rect.h >= 4) { S.regions.push({ ...d.rect, label: String(S.regions.length + 1) }); renderRegions(); }
    syncCropInputs(); draw();
  }

  // ---------- window / level ----------
  function resetWindow(kind) {
    if (!S.img) return;
    const a = S.edge.on ? edgeFrame() : frameData(), sl = S.img.slope, ic = S.img.intercept;
    if (kind === 'file' && S.img.windowWidth > 0) { S.win = { c: S.img.windowCenter, w: S.img.windowWidth }; }
    else if (kind === 'full') { const st = I.stats(a, S.img.padding), lo = st.min * sl + ic, hi = st.max * sl + ic; S.win = { c: (lo + hi) / 2, w: Math.max(1, Math.abs(hi - lo)) }; }
    else { const w = I.autoWindow(a, sl, ic, undefined, undefined, S.img.padding); S.win = { c: w.center, w: w.width }; }
    S.dirtyImage = true; syncWindowInputs(); draw();
  }
  function windowRange() { const sl = S.img.slope, ic = S.img.intercept, a = S.img.min * sl + ic, b = S.img.max * sl + ic; return [Math.min(a, b), Math.max(a, b)]; }
  function syncWindowInputs() {
    if (!S.img) return;
    const [lo, hi] = windowRange(), step = (hi - lo) / 1000 || 1;
    for (const [r, n, v, min] of [['wl-c-r', 'wl-c', S.win.c, lo], ['wl-w-r', 'wl-w', S.win.w, 1]]) {
      Object.assign($(r), { min, max: r === 'wl-w-r' ? hi - lo : hi, step }); $(r).value = v;
      if (document.activeElement !== $(n)) $(n).value = String(Math.round(v * 10) / 10);
    }
    $('wl-file').disabled = !(S.img.windowWidth > 0);
  }

  // ---------- pixel operations ----------
  function pushImage(next, text, turns = 0) {
    S.undo.push({ kind: 'image', state: imageState(), text });
    S.redo = []; S.ops.push(text); S.turns += turns;
    trimUndo(); markEntryDirty();
    setImg(next);
  }
  function setImg(next) {
    if (next !== S.img) { S.scratches = []; if (typeof renderScratches === 'function') renderScratches(); }
    S.img = next; S.dirtyImage = true; S.rawAutoWidth = null;
    if (S.frame >= next.frames.length) S.frame = 0;
    refreshImageUi(); renderHistory(); syncCropInputs(); draw();
  }
  const dimsDiffer = img => img.rows !== S.img.rows || img.cols !== S.img.cols;
  // Back to the image as opened; metadata edits are kept, and this can itself be undone.
  function revertImage() {
    if (!S.ops.length) return;
    S.undo.push({ kind: 'image', state: imageState(), text: 'Reverted all image changes' }); S.redo = []; trimUndo();
    restoreImage({ img: S.origImg, ops: [], turns: 0, crop: null, regions: [] });
    refreshUndoUi(); toast('All image changes reverted. Undo brings them back.');
  }
  function numIn(id, lo, hi) { const v = parseFloat($(id).value); if (!isFinite(v) || v < lo || v > hi) throw new Error(`Enter a value from ${lo} to ${hi}.`); return v; }
  function runOp(op) {
    if (!S.img) return;
    busy(() => {
      const img = S.img;
      const geom = (next, text, turns) => { S.crop = null; S.regions = []; renderRegions(); pushImage(next, text, turns); fit(); };
      switch (op) {
        case 'rot-cw': return geom(I.rotate(img, 1), 'Rotated 90° clockwise', 1);
        case 'rot-ccw': return geom(I.rotate(img, -1), 'Rotated 90° anticlockwise', 1);
        case 'rot-180': return geom(I.rotate(img, 2), 'Rotated 180°', 0);
        case 'flip-h': return geom(I.flip(img, true), 'Flipped left–right', 0);
        case 'flip-v': return geom(I.flip(img, false), 'Flipped top–bottom', 0);
        case 'invert': return pushImage(I.invert(img), 'Inverted pixel values');
        case 'median': return pushImage(I.median(img), 'Noise reduced (3×3 median)');
        case 'smooth': { const s = numIn('sm-s', 0.3, 10); return pushImage(I.smooth(img, s), `Smoothed (Gaussian radius ${s})`); }
        case 'sharpen': { const s = numIn('sh-s', 0.3, 10), a = numIn('sh-a', 0.1, 10); return pushImage(I.sharpen(img, s, a), `Sharpened (unsharp mask radius ${s}, amount ${a})`); }
        case 'badpix': {
          const pct = numIn('bp-t', 1, 100), st = I.stats(frameData(), S.img.padding), thr = Math.max(1, (st.max - st.min) * pct / 100);
          const out = I.fixBadPixels(img, thr);
          if (!out.fixedCount) { toast('No bad pixels found at this limit.'); return; }
          pushImage(out, `Fixed ${out.fixedCount} bad pixel${out.fixedCount === 1 ? '' : 's'} (limit ${pct}% of range)`);
          toast(`Fixed ${out.fixedCount} pixel(s).`); return;
        }
      }
    });
  }
  function refreshImageUi() {
    $('btn-revert-img').disabled = !S.ops.length;
    refreshUndoUi();
    if (S.img) syncWindowInputs();
  }

  // ---------- scratch repair ----------
  function scratchOpts() {
    const img = S.img, a = frameData();
    if (S.noise == null || S.noiseFor !== img) { S.noise = I.noiseLevel(a, img.cols, img.rows, img.padding); S.noiseFor = img; }
    const maxWidth = Math.max(1, Math.min(15, parseInt($('scr-w').value, 10) || 7));
    const st = I.stats(a, img.padding), sign = I.lessRadiationSign(a, img.cols, img.rows, img.padding);
    const range = Math.abs(st.pct(50) - (sign > 0 ? st.pct(0.1) : st.pct(99.9)));
    // a repaired line must dip by at least 1% of the plate-to-background range, so plate texture is never smoothed
    return { sign, noise: S.noise, minContrast: 0.01 * range, maxWidth, band: Math.max(8, maxWidth + 6), min: img.min, max: img.max, padding: img.padding };
  }
  // Repairs each segment on every frame as one undoable step.
  function repairScratches(segs, kind) {
    if (!S.img || !segs.length) return;
    busy(() => {
      const img = S.img, o = scratchOpts(); let count = 0;
      const frames = img.frames.map(f => { let cur = f; for (const s of segs) { const r = I.repairScratch(cur, img.cols, img.rows, s, o); cur = r.frame; if (f === frameData()) count += r.count; } return cur; });
      if (!count) {
        toast(kind === 'drawn' ? 'No scratch found along that line. Only thin lines reading as less radiation than the plate on both sides are repaired; anything near a crack or void is left alone.' : 'Nothing was repaired.', !!0);
        return;
      }
      const r = n => Math.round(n);
      const text = kind === 'drawn' ? `Scratch repaired along (${r(segs[0].x0)}, ${r(segs[0].y0)})–(${r(segs[0].x1)}, ${r(segs[0].y1)}): ${count} pixels`
        : `Repaired ${segs.length} long scratch${segs.length === 1 ? '' : 'es'}: ${count} pixels`;
      S.scratches = []; renderScratches();
      pushImage(Object.assign({}, img, { frames }), text);
      toast(text + '. Undo is available.');
    }, 'Repairing…');
  }
  function findScratches() {
    if (!S.img) return;
    busy(() => {
      const img = S.img, o = scratchOpts();
      S.scratches = I.findScratches(frameData(), img.cols, img.rows, { padding: img.padding, sign: o.sign });
      renderScratches(); draw();
      toast(S.scratches.length ? `Found ${S.scratches.length} long scratch${S.scratches.length === 1 ? '' : 'es'} (shown in cyan). Check them, then Repair found scratches.` : 'No long scratches found. Draw over short ones with the Scratch tool.');
    }, 'Looking for scratches…');
  }
  function renderScratches() {
    const n = (S.scratches || []).length;
    $('scr-found').classList.toggle('hidden', !n); $('scr-repair').classList.toggle('hidden', !n); $('scr-clear').classList.toggle('hidden', !n);
    $('scr-found').textContent = n ? S.scratches.map((l, i) => `S${i + 1}: ${Math.round(Math.hypot(l.x1 - l.x0, l.y1 - l.y0))} px long, on ${Math.round(l.coverage * 100)}% of its length`).join(' · ') : '';
  }

  // ---------- crop & regions ----------
  function syncCropInputs() {
    const c = S.crop;
    [['cr-x', 'x'], ['cr-y', 'y'], ['cr-w', 'w'], ['cr-h', 'h']].forEach(([id, k]) => { if (document.activeElement !== $(id)) $(id).value = c ? c[k] : ''; });
    $('crop-apply').disabled = !c; $('crop-clear').disabled = !c;
  }
  function cropFromInputs() {
    if (!S.img) return;
    const v = ['cr-x', 'cr-y', 'cr-w', 'cr-h'].map(id => parseInt($(id).value, 10));
    if (v.some(n => !isFinite(n))) return;
    S.crop = clampRect({ x: v[0], y: v[1] }, { x: v[0] + v[2], y: v[1] + v[3] });
    if (S.crop.w < 1 || S.crop.h < 1) S.crop = null;
    syncCropInputs(); draw();
  }
  function applyCrop() {
    if (!S.crop) return;
    const c = S.crop;
    busy(() => { const next = I.crop(S.img, c); S.regions = []; renderRegions(); pushImage(next, `Cropped to ${c.w}×${c.h} at (${c.x}, ${c.y})`); S.crop = null; syncCropInputs(); fit(); });
  }
  function renderRegions() {
    const box = $('regions'); box.innerHTML = '';
    S.regions.forEach((r, i) => {
      const lab = el('input', { 'aria-label': `Label for part ${i + 1}`, value: r.label || '' });
      lab.addEventListener('input', () => { r.label = lab.value; });
      box.append(el('div', { class: 'region' }, el('span', { class: 'num' }, String(i + 1)), lab,
        el('button', { class: 'icon danger', 'aria-label': `Remove part ${i + 1}`, onclick: () => { S.regions.splice(i, 1); renderRegions(); draw(); } }, '×'),
        el('span', { class: 'dims' }, `${r.w}×${r.h} at (${r.x}, ${r.y})${r.tilt != null ? ` · tilt ${r.tilt.toFixed(2)}°` : ''}${r.cuts && r.cuts.length ? ' · meets a neighbour at a tilted line' : ''}`)));
    });
    $('sp-clear').disabled = !S.regions.length; $('sp-export').disabled = !S.regions.length;
    const anyCuts = S.regions.some(r => r.cuts && r.cuts.length);
    $('sp-fill-wrap').classList.toggle('hidden', !anyCuts || $('sp-straight').checked); // straightening already leaves the neighbour out
    $('sp-fill').disabled = !(S.img && S.img.padding != null);
    $('sp-fill-wrap').title = S.img && S.img.padding == null ? 'This file has no Pixel Padding Value, so slivers are kept.' : '';
  }
  function makeEqualParts() {
    if (!S.img) return;
    const n = parseInt($('sp-n').value, 10), o = Math.max(0, parseInt($('sp-o').value, 10) || 0);
    if (!(n >= 2 && n <= 50)) { toast('Choose 2 to 50 parts.', true); return; }
    // "Side by side" and "Stacked" follow the screen, so swap when the view is turned 90° and number parts left-to-right / top-to-bottom.
    let dir = $('sp-dir').value; if (S.viewRot % 180) dir = dir === 'cols' ? 'rows' : 'cols';
    const key = r => { const q = I.rectToView(r, S.img.cols, S.img.rows, S.viewRot); return $('sp-dir').value === 'cols' ? q.x : q.y; };
    S.regions = I.splitRegions(S.img.rows, S.img.cols, n, dir, o).sort((a, b) => key(a) - key(b)).map((r, i) => ({ ...r, label: String(i + 1) }));
    renderRegions(); draw();
  }

  function autoSplit() {
    if (!S.img) return;
    busy(() => {
      const m = parseInt($('sp-margin').value, 10) || 0;
      const found = I.findPieces(frameData(), S.img.cols, S.img.rows, { sensitivity: parseFloat($('sp-sens').value), margin: m, padding: S.img.padding });
      if (!found.length) { toast('No film pieces found. Try High sensitivity, or draw regions by hand.', true); return; }
      // Number pieces as they appear on screen: left to right, then top to bottom.
      const key = r => { const q = I.rectToView(r, S.img.cols, S.img.rows, S.viewRot); return [Math.round(q.y / 50), q.x]; };
      found.sort((a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1]; });
      const lv = I.plateLevels(frameData(), S.img.cols, S.img.rows, S.img.padding);
      S.regions = found.map((r, i) => {
        // measured tilt of each piece, shown in the list (straightening happens when the parts are saved)
        const pc = I.crop(S.img, r), f = pc.frames[0].slice(), fill = S.img.padding != null ? S.img.padding : Math.round(lv.sign * lv.bg);
        if (r.cuts && r.cuts.length) I.fillOutsideCuts(f, r, fill);
        return { ...r, label: String(i + 1), tilt: I.pieceTilt(f, pc.cols, pc.rows, lv).angle };
      });
      renderRegions(); draw();
      const tilted = found.filter(r => r.cuts && r.cuts.length).length;
      if (found.length === 1) { S.crop = { x: found[0].x, y: found[0].y, w: found[0].w, h: found[0].h }; syncCropInputs(); draw(); }
      toast(found.length === 1 ? 'Found one piece. It is also set as the crop box: use Apply crop, or save it as a split file.'
        : `Found ${found.length} pieces${tilted ? ', separated by a tilted line' : ''}. Check them, then Save split files.`);
    }, 'Finding film pieces…');
  }

  // One piece of film (the largest found): straighten and crop to the film, as one undoable step.
  function autoStraighten() {
    if (!S.img) return;
    busy(() => {
      const pieces = I.findPieces(frameData(), S.img.cols, S.img.rows, { padding: S.img.padding });
      if (!pieces.length) { toast('No film found to straighten.', true); return; }
      const p = pieces.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0], r = I.straightenPiece(S.img, p, {});
      if (r.img.cols === S.img.cols && r.img.rows === S.img.rows && !r.rotated) { toast('The film is already straight and fills the image.'); return; }
      const text = `${r.rotated ? `Straightened ${r.angle.toFixed(2)}° (bicubic resampling) and cropped` : 'Cropped'} to the film: ${r.img.cols}×${r.img.rows}`;
      S.crop = null; S.regions = []; renderRegions(); syncCropInputs();
      pushImage(r.img, text); fit();
      toast(text + (r.tooSteep ? ` (tilt ${r.measured.toFixed(1)}° is over 5°, so it was not rotated)` : '') + (pieces.length > 1 ? `. ${pieces.length} pieces were found; for all of them use Find film pieces and Save split files.` : '.'));
    }, 'Straightening…');
  }

  // ---------- saving ----------
  function storeWindow(ds, st) {
    if (!st.storeWin || !st.img) return;
    const f = v => { let s = String(+v.toFixed(2)); if (s.length > 16) s = v.toExponential(6); return s; };
    D.setText(ds, 0x00281050, f(st.win.c), 'DS'); D.setText(ds, 0x00281051, f(st.win.w), 'DS');
  }
  // Everything a saved copy is built from. The open file uses the editor's state; another file in the folder
  // uses what was kept for it when the editor moved on (its image steps), so it can be saved without opening.
  const currentState = () => ({ file: S.file, orig: S.orig, img: S.img, ops: S.ops, turns: S.turns, origEls: S.origEls, win: S.win, storeWin: $('store-window').checked, j2k: wantJ2k() });
  const stashState = e => ({ file: e.file, orig: e.orig, img: e.stash.img, ops: e.stash.ops, turns: e.stash.turns, origEls: e.origEls, win: e.stash.win, storeWin: false, j2k: !!(e.stash.decoded && window.Codec && Codec.isReady()) });
  function buildCopy(region, partInfo, removed, st) {
    st = st || currentState();
    const pixelsChanged = st.ops.length > 0 || !!region;
    const copy = D.clone(st.file);
    if (st.img && pixelsChanged) {
      let out = region ? I.crop(st.img, region) : st.img;
      if (region && $('sp-straight').checked) {
        // straighten the piece and crop it to the film (pixels across a dividing line are not part of it)
        const r = I.straightenPiece(st.img, region, {});
        out = r.img;
        if (partInfo) partInfo.text += r.rotated ? `; straightened ${r.angle.toFixed(2)}° (bicubic resampling) and cropped to the film` : '; cropped to the film';
      } else if (region && region.cuts && region.cuts.length && $('sp-fill').checked && st.img.padding != null) {
        out = Object.assign({}, out, { frames: out.frames.map(f => { const c = f.slice(); I.fillOutsideCuts(c, region, st.img.padding); return c; }) });
        if (partInfo) partInfo.text += '; pixels across the dividing line set to the Pixel Padding Value';
      }
      D.setImage(copy, out, { swapSpacing: st.turns % 2 === 1 });
      copy.transferSyntax = D.TS.EXPLICIT_LE; copy.encapsulated = false;
      if (st.j2k) {
        // Follow the source codestream (INDUSTREX: 16-bit precision, RLCP) so INDUSTREX gets what it writes itself.
        const src = st.orig.encapsulated && Codec.codestreamInfo(Codec.frameStreams(st.orig.ds.el.get(D.PIXEL).fragments, 1)[0]) || {};
        const bits = src.precision >= out.bitsStored && src.precision <= out.bitsAllocated ? src.precision : out.bitsStored;
        D.setEncapsulated(copy, out.frames.map(a => Codec.encodeFrameLossless(a, { width: out.cols, height: out.rows, bitsPerSample: bits, isSigned: out.signed, progression: src.progression })), Codec.J2K_LOSSLESS);
      }
    }
    storeWindow(copy.ds, st);
    // INDUSTREX mirrors the fields in its XML presentation state; keep that copy in step (processed copies drop the XML).
    const edited = [...st.origEls.keys()].filter(k => !k.includes('/')).map(k => parseInt(k, 16) >>> 0);
    if (!pixelsChanged) copy.synced = D.syncIndustrexXml(copy.ds, edited.concat(st.storeWin ? [0x00281050, 0x00281051] : []));
    copy.edited = edited;
    const steps = st.ops.slice(); if (partInfo) steps.push(partInfo.text);
    D.derive(copy, st.orig, { pixelsChanged, description: steps.join('; '), seriesUID: partInfo ? partInfo.series : (pixelsChanged ? D.newUID() : null), instanceNumber: partInfo ? partInfo.index : null, removed });
    return copy;
  }
  const wantJ2k = () => $('save-format').value === 'j2k' && !$('save-format').disabled && window.Codec && Codec.isReady();
  async function prepareCodec() { if ($('save-format').value === 'j2k' && !$('save-format').disabled && window.Codec) await Codec.load(); }
  const saveLabel = () => (S.ops.length && $('save-format').value === 'j2k' ? 'Compressing JPEG 2000…' : 'Saving…');
  function saveCopy() {
    if (!S.file) return;
    busy(async () => {
      await prepareCodec();
      const removed = [], copy = buildCopy(null, null, removed), bytes = D.write(copy);
      const res = await download(bytes, `${baseName()}_edited.dcm`, 'application/dicom', S.path);
      if (!res.saved) { toast('Not saved.'); return; }
      let extra = removed.length ? ` Left out ${removed.length} element(s) that described the original pixels.` : '';
      if (copy.synced && copy.synced.length) extra += ` Updated ${copy.synced.length} field(s) in INDUSTREX's XML copy.`;
      toast(`Saved ${savedWhere(res)} (${(bytes.length / 1048576).toFixed(1)} MB). The original file is unchanged.${extra}`);
      if (S.entry) { S.entry.dirty = false; S.entry.savedAs = res.path || res.name; }
      markSaved(); renderFilePane();
      runCompat(bytes, res.name, removed, S.ops.length > 0);
    }, saveLabel());
  }
  function exportSplit() {
    if (!S.regions.length || !S.img) return;
    busy(async () => {
      await prepareCodec();
      const series = D.newUID(), target = $('sp-target').value, files = [], used = new Set();
      S.regions.forEach((r, i) => {
        const label = (r.label || String(i + 1)).trim() || String(i + 1);
        const copy = buildCopy(r, { series, index: i + 1, text: `Split part ${i + 1} of ${S.regions.length} (${r.w}×${r.h} at ${r.x},${r.y})` });
        if (target === 'comments') D.setText(copy.ds, 0x00204000, label, 'LT');
        if (target === 'compid') {
          const id = D.getString(copy.ds, 0x00100020), next = (id ? id + '-' : '') + label;
          const err = D.validate('LO', next); if (err) throw new Error(`Part ${i + 1}: Component ID “${next}” — ${err}`);
          D.setText(copy.ds, 0x00100020, next);
        }
        let fname = `${baseName()}_${label.replace(/[^\w.-]+/g, '_')}.dcm`;
        while (used.has(fname)) fname = fname.replace(/\.dcm$/, '_' + (i + 1) + '.dcm');
        used.add(fname);
        files.push({ name: fname, data: D.write(copy) });
      });
      const z = X.zip(files);
      const res = await download(z, `${baseName()}_split.zip`, 'application/zip');
      toast(res.saved ? `Saved ${files.length} files in ${savedWhere(res)}. The original file is unchanged.` : 'Not saved.');
    }, $('save-format').value === 'j2k' ? 'Compressing JPEG 2000…' : 'Saving…');
  }
  // Re-reads the bytes just written and checks them against INDUSTREX's requirements and the original file.
  async function runCompat(bytes, name, removed, pixelsChanged) {
    if (!window.Compat) return;
    const box = $('compat'); box.textContent = 'Checking…';
    try {
      const r = await Compat.check(bytes, S.orig, { removed, edited: changedTopLevel(), pixelsChanged, xmlTag: (D.industrexInfo(S.orig.ds) || {}).xmlTag });
      const sm = Compat.summary(r); box.innerHTML = '';
      box.append(el('div', {}, el('b', {}, sm.fail ? `${sm.fail} problem(s) found` : sm.warn ? `Passed with ${sm.warn} warning(s)` : 'All checks passed'), ` for ${name} (${sm.pass} passed).`),
        el('ul', { class: 'compat-list' }, ...r.sort((a, b) => ['fail', 'warn', 'info', 'pass'].indexOf(a.level) - ['fail', 'warn', 'info', 'pass'].indexOf(b.level))
          .map(c => el('li', { class: c.level }, c.title, c.detail ? el('div', { class: 'd' }, c.detail) : ''))),
        el('div', {}, 'These checks follow Carestream\'s conformance statement and real INDUSTREX files. Opening the copy in INDUSTREX is the final confirmation.'));
      if (sm.fail) toast(`INDUSTREX compatibility check found ${sm.fail} problem(s) in the saved copy. See the Changes tab.`, true);
    } catch (e) { box.textContent = 'The check could not run: ' + e.message; }
  }
  let savedState = '';
  const stateKey = () => `${S.ops.length}:${S.ops.join('|')}:${[...S.origEls.keys()].join(',')}`;
  function markSaved() { savedState = stateKey(); if (S.entry) S.entry.savedKey = savedState; updateDirty(); }

  // ---------- export ----------
  // The image as displayed (window, invert and view rotation), at full resolution.
  function renderedCanvas() {
    if (S.dirtyImage) rebuildBitmap();
    if (S.ov.opts.enabled && S.ov.opts.inExports) {
      const d = I.viewDims(S.img.cols, S.img.rows, S.viewRot), c = document.createElement('canvas'); c.width = d.w; c.height = d.h;
      const cx = c.getContext('2d'); cx.save(); I.viewTransform(cx, S.img.cols, S.img.rows, S.viewRot); cx.drawImage(S.bmp, 0, 0); cx.restore();
      const scale = { s: 0.8, m: 1, l: 1.25 }[S.ov.opts.size] || 1;
      drawOverlay(cx, d.w, d.h, Math.max(12, Math.round(Math.min(d.w, d.h) / 45 * scale)), true);
      return c;
    }
    if (!S.viewRot) return S.bmp;
    const d = I.viewDims(S.img.cols, S.img.rows, S.viewRot), c = document.createElement('canvas'); c.width = d.w; c.height = d.h;
    const cx = c.getContext('2d'); I.viewTransform(cx, S.img.cols, S.img.rows, S.viewRot); cx.drawImage(S.bmp, 0, 0);
    return c;
  }
  async function exportAs(kind) {
    $('export-menu').classList.remove('open'); $('btn-export').setAttribute('aria-expanded', 'false');
    if (!S.img) return;
    await busy(async () => {
      if (kind === 'png') {
        const blob = await new Promise(r => renderedCanvas().toBlob(r, 'image/png'));
        await download(new Uint8Array(await blob.arrayBuffer()), `${baseName()}.png`, 'image/png');
      } else if (kind === 'tiff') {
        await download(X.tiff(S.img, S.frame), `${baseName()}.tif`, 'image/tiff');
      } else if (kind === 'pdf') {
        const src = renderedCanvas(), maxSide = 2400, s = Math.min(1, maxSide / Math.max(src.width, src.height));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(src.width * s)); c.height = Math.max(1, Math.round(src.height * s));
        const cx = c.getContext('2d'); cx.imageSmoothingEnabled = true; cx.drawImage(src, 0, 0, c.width, c.height);
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
        const ds = S.file.ds, utf8 = D.charsetIsUtf8(ds), fields = [];
        for (const [title, tags] of COMMON) for (const t of tags) { const e = ds.el.get(t); if (e && e.value) fields.push([D.tagInfo(t).name, D.valueToText(e, utf8)]); }
        fields.push(['Image size', `${S.img.cols} × ${S.img.rows} pixels`]);
        if (S.ops.length) fields.push(['Image processing', S.ops.join('; ')]);
        const changes = metaChangeList(); if (changes.length) fields.push(['Metadata edited', changes.join('; ')]);
        const now = new Date();
        const pdf = X.pdfReport({ title: 'Radiograph report', subtitle: `${S.name} · generated ${now.toLocaleString()} · DICONDE Editor (not an inspection record)`, fields,
          jpeg: new Uint8Array(await blob.arrayBuffer()), imageWidth: c.width, imageHeight: c.height, caption: `Window width ${fmt(S.win.w)}, level ${fmt(S.win.c)}${S.invertView ? ', inverted view' : ''}` });
        await download(pdf, `${baseName()}_report.pdf`, 'application/pdf');
      }
    });
  }

  // ---------- history ----------
  function metaChangeList() {
    const out = [], utf8 = S.file ? D.charsetIsUtf8(S.file.ds) : false;
    for (const [key, orig] of S.origEls) {
      const parts = key.split('/'), tag = parseInt(parts[parts.length - 1], 16) >>> 0;
      let ds = S.file.ds;
      for (let i = 0; i + 2 < parts.length; i += 2) { const sq = ds.el.get(parseInt(parts[i], 16) >>> 0); ds = sq && sq.items ? sq.items[+parts[i + 1]] : null; if (!ds) break; }
      const cur = ds && ds.el.get(tag), name = D.describeTag(S.file.ds, tag).name + (parts.length > 1 ? ' (in sequence)' : '');
      const a = orig ? D.valueToText(orig, utf8) : '', b = cur ? D.valueToText(cur, utf8) : '';
      out.push(!orig ? `${name}: added “${b}”` : !cur ? `${name}: removed (was “${a}”)` : `${name}: “${a}” → “${b}”`);
    }
    return out;
  }
  function renderHistory() {
    const hi = $('hist-img'), hm = $('hist-meta'); hi.innerHTML = ''; hm.innerHTML = '';
    if (!S.ops.length) hi.append(el('li', { class: 'note' }, 'No image changes.')); else S.ops.forEach(o => hi.append(el('li', {}, o)));
    const m = S.file ? metaChangeList() : [];
    if (!m.length) hm.append(el('li', { class: 'note' }, 'No metadata changes.')); else m.forEach(o => hm.append(el('li', {}, o)));
    const fd = $('file-details'); fd.innerHTML = '';
    if (S.file) {
      const ds = S.orig.ds;
      fd.append(el('div', {}, `Original SOP Instance UID: ${D.getString(ds, 0x00080018) || '—'}`), el('div', {}, `Transfer syntax: ${D.TS_NAMES[S.orig.transferSyntax] || S.orig.transferSyntax}`),
        el('div', {}, S.img ? `Pixels: ${S.img.bitsStored}-bit ${S.img.signed ? 'signed' : 'unsigned'}, ${S.img.photometric}, ${S.img.frames.length} frame(s)` : S.imgError));
    }
    updateTemplateButtons(); updateDirty();
  }
  function updateDirty() {
    // any file in the folder with unsaved changes (the open one included)
    const dirty = (!S.entry && !!S.file && hasChanges() && stateKey() !== savedState) || S.shots.some(e => e.dirty);
    $('dirty').classList.toggle('hidden', !dirty); $('btn-save').classList.toggle('primary', dirty);
    if (HOST && dirty !== S.hostDirty) { S.hostDirty = dirty; HOST.post('dirty', { dirty }); }
    $('btn-compare').disabled = !S.img || !S.ops.length;
  }

  // ---------- Shots window: many files grouped by weld, batch metadata edits ----------
  Object.assign(S, { mode: 'edit', folder: '', shots: [], shSel: new Set(), shGroup: 0x0008103E, shPending: {}, shUndo: [], shRedo: [], shThumbQueue: [] });
  const BATCH_TAGS = COMMON.filter(([t]) => t !== 'Display').flatMap(([, tags]) => tags);
  const shById = id => S.shots.find(e => e.id === id);
  const selected = () => S.shots.filter(e => S.shSel.has(e.id));
  function setView(v) {
    S.mode = v; // which window is showing (S.view is the viewer's zoom and pan)
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    $('shots-view').classList.toggle('hidden', v !== 'organize');
    document.querySelector('main.workspace').classList.toggle('hidden', v === 'organize');
    ['btn-save', 'export-menu'].forEach(id => $(id).classList.toggle('hidden', v === 'organize'));
    updateFileInfo();
    if (v === 'organize') renderShots(); else { renderFilePane(); renderMeta(); resize(); }
    refreshUndoUi();
  }
  // list: [{ bytes, name, path }]. opts.replace: a new working folder (replaces the list); opts.folder: its name;
  // opts.open: open the first file in the editor; opts.single: one file, so report problems as "could not open".
  async function addShots(list, opts = {}) {
    if (opts.replace && S.shots.some(e => e.dirty) && !confirm('Some files in the current folder have unsaved changes. Open the new folder anyway (their changes are lost)?')) return [];
    let result = [];
    await busy(async () => {
      if (opts.replace) {
        S.shots = []; S.shSel.clear(); S.shUndo = []; S.shRedo = []; S.shThumbQueue = []; S.shPending = {};
        S.entry = null; S.folder = opts.folder || '';
      }
      let added = 0; const bad = [];
      for (const f of list) {
        try {
          const e = await SH.load(f.bytes, f.name, f.path);
          // already listed: the same path, or the same name, SOP Instance UID and size (copies of one scan can share a UID)
          const uid = D.getString(e.orig.ds, 0x00080018), size = f.bytes.length;
          const dup = S.shots.find(x => (f.path && x.path === f.path) || (x.name === f.name && x.size === size && D.getString(x.orig.ds, 0x00080018) === uid));
          e.size = size;
          if (dup) { result.push(dup); continue; } // already in the list
          S.shots.push(e); S.shThumbQueue.push(e); result.push(e); added++;
        } catch (err) { bad.push(`${f.name}: ${err.message}`); }
      }
      if (opts.single && bad.length) toast(`Could not open ${bad[0]}`, true);
      else if (!opts.open || result.length !== 1) toast(`${opts.replace ? 'Opened folder' + (S.folder ? ' ' + S.folder : '') + ': ' : 'Added '}${added} file${added === 1 ? '' : 's'}${bad.length ? `; ${bad.length} could not be read (${bad.slice(0, 3).join('; ')})` : ''}.`, !!bad.length && !added);
      // open the first file as the pane lists it (by weld, then shot number)
      if (opts.open && result.length) { stashCurrent(); const e = SH.groups(result, S.shGroup)[0].shots[0]; await openParsed(e.orig, e.name, e); S.path = e.path; }
      renderFilePane(); if (S.mode === 'organize') renderShots(); updateFileInfo();
      pumpThumbs();
    }, opts.replace ? 'Reading folder…' : 'Reading files…');
    return result;
  }
  function updateFileInfo() {
    const n = S.shots.length, where = S.folder ? `${S.folder} · ` : '';
    if (S.mode === 'organize') $('fileinfo').textContent = `${where}${n} file${n === 1 ? '' : 's'} in ${SH.groups(S.shots, S.shGroup).length} weld group(s)`;
    else if (S.name) $('fileinfo').textContent = where + ($('fileinfo').dataset.file || S.name);
    else $('fileinfo').textContent = n ? `${where}${n} file${n === 1 ? '' : 's'}: choose one on the left` : 'No folder open. Files stay on this computer.';
    $('fileinfo').title = $('fileinfo').textContent;
  }
  // Choosing the working folder: native dialog in the Windows program, folder picker in a browser.
  async function openFolder() {
    if (!HOST) { $('folder-input').click(); return; }
    const r = await HOST.call('openFolder', {}); if (!r.ok && !r.cancelled) toast(`Could not open: ${r.error || 'error'}`, true);
  }
  async function addMoreFiles() {
    if (!HOST) { $('file-input').click(); return; }
    const r = await HOST.call('openMany', {}); if (!r.ok && !r.cancelled) toast(`Could not open: ${r.error || 'error'}`, true);
  }

  // File pane (Edit tab): every file in the folder, under its weld; click to edit.
  function renderFilePane() {
    const box = $('fp-list'); if (!box) return; box.innerHTML = '';
    const q = $('fp-search').value.trim().toLowerCase();
    const list = S.shots.filter(e => !q || [e.name, ...SH.GROUP_FIELDS.map(t => D.getString(e.file.ds, t))].join(' ').toLowerCase().includes(q));
    $('fp-title').textContent = S.shots.length ? `Files (${S.shots.length})` : 'Files';
    if (!S.shots.length) box.append(el('div', { class: 'fp-empty' }, 'Open a folder to list its .dcm files here.'));
    for (const g of SH.groups(list, S.shGroup)) {
      box.append(el('div', { class: 'fp-weld' }, g.key || `No ${D.tagInfo(S.shGroup).name}`));
      for (const e of g.shots) {
        const n = D.getString(e.file.ds, 0x00200013), cur = S.entry === e;
        const hasImg = cur ? S.ops.length > 0 : !!(e.stash && e.stash.ops && e.stash.ops.length);
        const item = el('div', { class: 'fp-item', role: 'option', 'aria-selected': String(cur), tabindex: cur ? '0' : '-1', 'data-id': e.id, title: e.name },
          e.thumb ? el('img', { src: e.thumb, alt: '' }) : el('div', { class: 'ph' }, '…'),
          el('div', {}, el('div', { class: 'nm' }, e.name),
            el('div', { class: 'meta' }, n ? `Shot ${n}` : 'No shot number',
              e.dirty ? el('span', { class: 'badge' }, hasImg ? 'edited + image' : 'edited') : e.savedAs ? el('span', { class: 'badge ok' }, 'saved') : '')));
        item.addEventListener('click', () => { if (S.entry !== e) openShot(e); });
        item.addEventListener('keydown', ev => {
          const items = [...box.querySelectorAll('.fp-item')], i = items.indexOf(item);
          if (ev.key === 'ArrowDown' && items[i + 1]) { ev.preventDefault(); items[i + 1].click(); }
          else if (ev.key === 'ArrowUp' && items[i - 1]) { ev.preventDefault(); items[i - 1].click(); }
        });
        box.append(item);
      }
    }
    const edited = S.shots.filter(e => e.dirty).length;
    $('fp-save-all').disabled = !edited; $('fp-save-all').textContent = edited ? `Save all edited (${edited})` : 'Save all edited';
  }

  async function filesToList(files) { const out = []; for (const f of files) if (!/^\./.test(f.name)) out.push({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name, path: f.webkitRelativePath || '' }); return out; }

  // Thumbnails, one at a time in the background, from a reduced copy of the image. (INDUSTREX's stored icon is not
  // used: on the owner's files its pixel data does not match its own description.)
  function viewAngleOf(file) { const a = D.industrexXmlEntry(file.ds, 'ANGLE'), deg = a ? Math.round(Number(a[a.length - 1])) : 0, cw = (((360 - deg) % 360) + 360) % 360; return [0, 90, 180, 270].includes(cw) ? cw : 0; }
  async function makeThumb(e) {
    let img = D.getImage(e.orig);
    if (img.compressed && window.Codec && Codec.canDecode(e.orig.transferSyntax)) { await Codec.load(); img = D.imageFromFrames(e.orig, Codec.decodeFrames(e.orig.ds.el.get(D.PIXEL).fragments, D.imageGeometry(e.orig))); }
    if (img.error) return null;
    const step = Math.max(1, Math.ceil(Math.max(img.cols, img.rows) / 320)), w = Math.floor(img.cols / step), h = Math.floor(img.rows / step);
    const small = new img.frames[0].constructor(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) small[y * w + x] = img.frames[0][(y * step) * img.cols + x * step];
    const win = I.autoWindow(small, img.slope, img.intercept, 0.5, 99.8, img.padding), rgba = I.render(small, img, win.center, win.width, false);
    const src = document.createElement('canvas'); src.width = w; src.height = h; src.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
    const rot = viewAngleOf(e.orig), d = I.viewDims(w, h, rot), out = document.createElement('canvas'); out.width = d.w; out.height = d.h;
    const cx = out.getContext('2d'); I.viewTransform(cx, w, h, rot); cx.drawImage(src, 0, 0);
    return out.toDataURL('image/png');
  }
  let pumping = false;
  async function pumpThumbs() {
    if (pumping) return; pumping = true;
    while (S.shThumbQueue.length) {
      const e = S.shThumbQueue.shift();
      try { e.thumb = await makeThumb(e); } catch (err) { console.warn(err); e.thumb = null; }
      if (e.thumb) document.querySelectorAll(`.sh-card[data-id="${e.id}"] .ph, .fp-item[data-id="${e.id}"] .ph`).forEach(ph => ph.replaceWith(el('img', { src: e.thumb, alt: '' })));
      await new Promise(r => setTimeout(r, 0));
    }
    pumping = false;
  }

  function renderShots() {
    const box = $('sh-groups'); box.innerHTML = '';
    const q = $('sh-search').value.trim().toLowerCase();
    const visible = S.shots.filter(e => !q || [e.name, ...SH.GROUP_FIELDS.map(t => D.getString(e.file.ds, t))].join(' ').toLowerCase().includes(q));
    const groups = SH.groups(visible, S.shGroup), gname = D.tagInfo(S.shGroup).name;
    $('sh-badge').textContent = S.shots.length ? `(${S.shots.length})` : '';
    $('sh-count').textContent = S.shots.length ? `${S.shots.length} shots · ${groups.length} group(s) · ${S.shSel.size} selected` : '';
    if (!S.shots.length) {
      box.append(el('div', { class: 'sh-empty' }, el('h2', {}, 'Organise shots by weld'), el('p', {}, 'Add shots or a whole folder, or drop .dcm files here. Shots are grouped by weld, and you can edit their metadata together. Nothing is uploaded and originals are never changed.'),
        el('div', { class: 'btns', style: 'justify-content:center' }, el('button', { class: 'primary', onclick: openFolder }, 'Open folder…'), el('button', { onclick: addMoreFiles }, 'Add files…'))));
    }
    for (const g of groups) {
      const all = g.shots.every(e => S.shSel.has(e.id)), edited = g.shots.filter(e => e.dirty).length;
      const tick = el('input', { type: 'checkbox', 'aria-label': `Select all shots in ${g.key || 'no weld'}` }); tick.checked = all;
      tick.onchange = () => { g.shots.forEach(e => (tick.checked ? S.shSel.add(e.id) : S.shSel.delete(e.id))); renderShots(); };
      const wrap = el('section', { class: 'sh-group', 'data-key': g.key },
        el('div', { class: 'sh-group-h' }, tick, el('b', {}, g.key || `No ${gname} set`), el('span', { class: 'note' }, `${g.shots.length} shot${g.shots.length === 1 ? '' : 's'}`), edited ? el('span', { class: 'badge' }, `${edited} edited`) : ''));
      // drop shots here to move them to this weld
      wrap.addEventListener('dragover', ev => { if (S.shDrag) { ev.preventDefault(); wrap.classList.add('drop'); } });
      wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
      wrap.addEventListener('drop', ev => { ev.preventDefault(); wrap.classList.remove('drop'); if (S.shDrag) { const ids = S.shDrag; S.shDrag = null; setWeld(g.key, ids.map(shById).filter(Boolean)); } });
      const cards = el('div', { class: 'sh-cards' });
      for (const e of g.shots) {
        const n = D.getString(e.file.ds, 0x00200013), date = D.getString(e.file.ds, 0x00080020) || D.getString(e.file.ds, 0x00080022);
        const cb = el('input', { type: 'checkbox', 'aria-label': `Select ${e.name}` }); cb.checked = S.shSel.has(e.id);
        const card = el('div', { class: 'sh-card' + (S.shSel.has(e.id) ? ' sel' : ''), 'data-id': e.id, draggable: 'true', tabindex: '0', title: `${e.name} — double-click to open in the editor` },
          e.thumb ? el('img', { src: e.thumb, alt: '' }) : el('div', { class: 'ph' }, 'thumbnail…'), cb,
          el('div', { class: 'nm' }, e.name),
          el('div', { class: 'meta' }, `${n ? 'Shot ' + n : 'No shot number'}${date ? ' · ' + O.formatValue('DA', date) : ''}`),
          el('div', { class: 'meta' }, e.dirty ? el('span', { class: 'badge' }, 'edited') : e.savedAs ? el('span', { class: 'badge ok' }, 'saved') : ''));
        const toggle = () => { S.shSel.has(e.id) ? S.shSel.delete(e.id) : S.shSel.add(e.id); renderShots(); };
        card.addEventListener('click', ev => { if (ev.detail > 1) return; if (ev.target === cb) return; toggle(); });
        cb.addEventListener('change', toggle);
        card.addEventListener('dblclick', async () => { await openShot(e); setView('edit'); });
        card.addEventListener('keydown', async ev => { if (ev.key === 'Enter') { await openShot(e); setView('edit'); } else if (ev.key === ' ') { ev.preventDefault(); toggle(); } });
        card.addEventListener('dragstart', ev => { S.shDrag = S.shSel.has(e.id) ? [...S.shSel] : [e.id]; ev.dataTransfer.setData('text/plain', 'shots'); ev.dataTransfer.effectAllowed = 'move'; });
        cards.append(card);
      }
      wrap.append(cards); box.append(wrap);
    }
    // weld suggestions and the panel
    const dl = $('sh-weld-list'); dl.innerHTML = ''; SH.groups(S.shots, S.shGroup).forEach(g => g.key && dl.append(el('option', { value: g.key })));
    renderBatch(); updateDirty();
    updateFileInfo(); renderFilePane();
  }

  function renderBatch() {
    const sel = selected(), box = $('sh-batch'); box.innerHTML = '';
    $('sh-sel-title').textContent = sel.length ? `Batch edit — ${sel.length} shot${sel.length === 1 ? '' : 's'} selected` : 'Batch edit';
    $('sh-sel-note').classList.toggle('hidden', !!sel.length);
    const pendingCount = Object.keys(S.shPending).length;
    ['sh-set-weld', 'sh-renumber', 'sh-tpl-apply', 'sh-remove'].forEach(id => { $(id).disabled = !sel.length; });
    $('sh-apply').disabled = !sel.length || !pendingCount; $('sh-reset').disabled = !pendingCount;
    $('sh-apply').textContent = sel.length ? `Apply ${pendingCount || ''} change${pendingCount === 1 ? '' : 's'} to ${sel.length} shot${sel.length === 1 ? '' : 's'}`.replace('  ', ' ') : 'Apply';
    const edited = S.shots.filter(e => e.dirty).length;
    $('sh-save').disabled = !edited; $('sh-save').textContent = edited ? `Save ${edited} edited shot${edited === 1 ? '' : 's'}` : 'Save edited shots';
    const t = loadTemplates(), tsel = $('sh-tpl'), cur = tsel.value; tsel.innerHTML = '';
    tsel.append(el('option', { value: '' }, Object.keys(t).length ? 'Templates…' : 'No templates yet')); Object.keys(t).sort().forEach(n => tsel.append(el('option', { value: n }, n))); tsel.value = t[cur] ? cur : '';
    if (!sel.length) return;
    const cv = SH.commonValues(sel, BATCH_TAGS);
    for (const tag of BATCH_TAGS) {
      const k = SH.hex(tag), c = cv[k], pend = Object.prototype.hasOwnProperty.call(S.shPending, k), id = 'sb-' + k;
      const name = D.describeTag(sel[0].file.ds, tag).name;
      const input = el('input', { id, placeholder: c.mixed ? `Multiple values (${c.count}) — type to set all` : 'Not set — type to set', spellcheck: 'false' });
      input.value = pend ? (S.shPending[k] ?? '') : c.value;
      const row = el('div', { class: 'bfield' + (pend ? ' changed' : '') }, el('label', { for: id }, name), input,
        el('button', { class: 'icon danger', title: `Remove ${name} from all selected shots`, 'aria-label': `Remove ${name} from all selected shots`, onclick: () => { S.shPending[k] = null; renderBatch(); } }, '×'));
      if (pend && S.shPending[k] === null) { input.value = ''; input.placeholder = 'Will be removed from all selected shots'; }
      input.addEventListener('input', () => {
        if (input.value === c.value && !c.mixed) delete S.shPending[k]; else S.shPending[k] = input.value;
        row.classList.toggle('changed', Object.prototype.hasOwnProperty.call(S.shPending, k));
        const n = Object.keys(S.shPending).length; $('sh-apply').disabled = !n; $('sh-reset').disabled = !n;
        $('sh-apply').textContent = `Apply ${n || ''} change${n === 1 ? '' : 's'} to ${sel.length} shot${sel.length === 1 ? '' : 's'}`.replace('  ', ' ');
      });
      box.append(row);
    }
  }

  // Every Shots change goes through here: one undo step, editor kept in step when its shot is affected.
  function shotsChange(entries, text, fn) {
    const snap = SH.snapshot(entries), res = fn();
    if (res && res.errors && res.errors.length) {
      $('sh-errors').textContent = 'Nothing was changed: ' + res.errors.slice(0, 6).map(e => `${e.name} — ${e.field}: ${e.message}`).join('; ') + (res.errors.length > 6 ? ` (and ${res.errors.length - 6} more)` : '');
      return false;
    }
    $('sh-errors').textContent = '';
    entries.forEach(e => { e.dirty = SH.isEdited(e) || e.dirty; });
    S.shUndo.push({ snap, text }); S.shRedo = [];
    syncEditorAfterShots(entries);
    renderShots(); refreshUndoUi(); toast(text + '. Undo is available.');
    return true;
  }
  function syncEditorAfterShots(entries) {
    if (S.entry && entries.includes(S.entry)) { S.origEls = S.entry.origEls; S.undo = S.undo.filter(u => u.kind !== 'meta'); S.redo = S.redo.filter(u => u.kind !== 'meta'); }
  }
  function applyPending() {
    const sel = selected(), changes = Object.assign({}, S.shPending), n = Object.keys(changes).length;
    if (!sel.length || !n) return;
    if (shotsChange(sel, `Batch edit: ${n} field${n === 1 ? '' : 's'} on ${sel.length} shot${sel.length === 1 ? '' : 's'}`, () => SH.applyBatch(sel, changes))) S.shPending = {}, renderBatch();
  }
  function setWeld(value, entries) {
    value = (value || '').trim(); if (!entries.length) return;
    const k = SH.hex(S.shGroup), name = D.tagInfo(S.shGroup).name;
    shotsChange(entries, `${name} set to “${value}” on ${entries.length} shot${entries.length === 1 ? '' : 's'}`, () => SH.applyBatch(entries, { [k]: value === '' ? null : value }));
  }
  function renumberSelected() {
    const welds = SH.groups(selected(), S.shGroup).map(g => g.key), targets = SH.groups(S.shots, S.shGroup).filter(g => welds.includes(g.key));
    const all = targets.flatMap(g => g.shots);
    shotsChange(all, `Numbered shots 1…n in ${targets.length} weld${targets.length === 1 ? '' : 's'}`, () => { targets.forEach(g => SH.renumber(g.shots)); return null; });
  }
  function applyTemplateToShots() {
    const name = $('sh-tpl').value, f = loadTemplates()[name], sel = selected(); if (!f || !sel.length) return;
    const changes = {}; for (const [hexKey, v] of Object.entries(f)) changes[hexKey] = v.remove ? null : v.text;
    shotsChange(sel, `Applied template “${name}” to ${sel.length} shot${sel.length === 1 ? '' : 's'}`, () => SH.applyBatch(sel, changes));
  }
  function shotsUndo() {
    const u = S.shUndo.pop(); if (!u) return;
    S.shRedo.push({ snap: SH.snapshot(u.snap.map(x => x.e)), text: u.text });
    SH.restore(u.snap); u.snap.forEach(x => { x.e.dirty = SH.isEdited(x.e); }); syncEditorAfterShots(u.snap.map(x => x.e));
    renderShots(); refreshUndoUi(); toast(`Undone: ${u.text}`);
  }
  function shotsRedo() {
    const r = S.shRedo.pop(); if (!r) return;
    S.shUndo.push({ snap: SH.snapshot(r.snap.map(x => x.e)), text: r.text });
    SH.restore(r.snap); r.snap.forEach(x => { x.e.dirty = SH.isEdited(x.e); }); syncEditorAfterShots(r.snap.map(x => x.e));
    renderShots(); refreshUndoUi(); toast(`Redone: ${r.text}`);
  }
  function removeSelected() {
    const sel = selected(); if (!sel.length) return;
    const unsaved = sel.filter(e => e.dirty).length;
    if (unsaved && !confirm(`${unsaved} selected shot(s) have unsaved edits. Remove them from the list anyway?`)) return;
    S.shots = S.shots.filter(e => !S.shSel.has(e.id)); S.shSel.clear();
    S.shUndo = S.shUndo.filter(u => u.snap.every(x => S.shots.includes(x.e))); S.shRedo = S.shRedo.filter(u => u.snap.every(x => S.shots.includes(x.e)));
    renderShots(); refreshUndoUi();
  }
  // Opens a file from the list. The file being left keeps its unsaved work (metadata and image steps).
  async function openShot(e) {
    if (S.entry !== e) { stashCurrent(); await busy(async () => { await openParsed(e.orig, e.name, e); S.path = e.path; }, 'Opening…'); }
    renderFilePane();
  }
  // Saves a new copy of every edited file in the folder: one ZIP in a browser, or files in a chosen folder in the
  // Windows program. A file with image steps (the open one, or one the editor moved away from) is saved with
  // them, exactly as Save copy would; other files get a metadata-only copy.
  async function saveShots() {
    const list = S.shots.filter(e => e.dirty); if (!list.length) return;
    await busy(async () => {
      if (window.Codec && list.some(e => (e === S.entry ? S.decoded : e.stash && e.stash.decoded))) await Codec.load();
      const names = SH.copyNames(list), results = [];
      let folder = null;
      if (HOST) { const r = await HOST.call('pickFolder', { near: (list[0].path || '') }); if (!r.ok) { toast('Not saved.'); return; } folder = r.folder; }
      const files = [];
      for (let i = 0; i < list.length; i++) {
        const e = list[i], st = e === S.entry && S.ops.length ? currentState() : e !== S.entry && e.stash && e.stash.img && e.stash.ops.length ? stashState(e) : null;
        let bytes, edited, removed = [];
        if (st) { const copy = buildCopy(null, null, removed, st); bytes = D.write(copy); edited = copy.edited; }
        else { const b = SH.buildCopy(e); bytes = b.bytes; edited = b.edited; }
        const chk = window.Compat ? await Compat.check(bytes, e.orig, { edited, removed, pixelsChanged: !!st, xmlTag: (D.industrexInfo(e.orig.ds) || {}).xmlTag }) : [];
        const fails = chk.filter(c => c.level === 'fail');
        if (HOST) {
          const r = await HOST.call('writeFile', { folder, name: names[i], data: toB64(bytes) });
          if (!r.ok) { results.push(`${e.name}: not saved (${r.error || 'error'})`); continue; }
          e.savedAs = r.path; results.push(`${r.name}${st ? ' (with image changes)' : ''}${fails.length ? ` — ${fails.length} compatibility problem(s)` : ''}`);
        } else { files.push({ name: names[i], data: bytes }); e.savedAs = names[i]; results.push(`${names[i]}${st ? ' (with image changes)' : ''}${fails.length ? ` — ${fails.length} compatibility problem(s)` : ''}`); }
        e.dirty = false;
        if (fails.length) e.compatFails = fails.map(c => c.title); else delete e.compatFails;
      }
      if (!HOST) await download(X.zip(files), 'shots_edited.zip', 'application/zip');
      if (S.entry && !S.entry.dirty) markSaved();
      const problems = list.filter(e => e.compatFails).length;
      $('sh-result').textContent = `Saved ${list.length} cop${list.length === 1 ? 'y' : 'ies'}${folder ? ' to ' + folder : ' in shots_edited.zip'}. INDUSTREX compatibility: ${problems ? problems + ' with problems' : 'all passed'}. ` + results.join(' · ');
      renderShots(); renderFilePane();
      toast(`Saved ${list.length} edited file${list.length === 1 ? '' : 's'}${folder ? ' to ' + folder : ''}. Originals unchanged.${problems ? ` ${problems} with compatibility problems: see Organize shots.` : ''}`, !!problems);
    }, 'Saving files…');
  }

  // ---------- hideable side panes (Edit tab) ----------
  const PANES_KEY = 'diconde-editor.panes.v1';
  S.panes = (() => { try { const v = JSON.parse(localStorage.getItem(PANES_KEY) || 'null'); return { files: v ? v.files !== false : true, tools: v ? v.tools !== false : true }; } catch (e) { return { files: true, tools: true }; } })();
  function applyPanes() {
    const ws = document.querySelector('main.workspace');
    ws.classList.toggle('no-files', !S.panes.files); ws.classList.toggle('no-tools', !S.panes.tools);
    $('tg-files').setAttribute('aria-pressed', String(S.panes.files)); $('tg-tools').setAttribute('aria-pressed', String(S.panes.tools));
    $('tg-files').title = `${S.panes.files ? 'Hide' : 'Show'} the file pane ( [ )`; $('tg-tools').title = `${S.panes.tools ? 'Hide' : 'Show'} the editing tools ( ] )`;
    resize(); // the image re-fits to the space it now has
  }
  function togglePane(which, show) {
    S.panes[which] = show == null ? !S.panes[which] : show;
    try { localStorage.setItem(PANES_KEY, JSON.stringify(S.panes)); } catch (e) { /* per-browser convenience only */ }
    applyPanes();
    const back = which === 'files' ? $('tg-files') : $('tg-tools');
    if (!S.panes[which] && document.activeElement && document.activeElement.closest && document.activeElement.closest(which === 'files' ? '#file-pane' : '#tools-panel')) back.focus();
  }

  // ---------- wiring ----------
  function syncSeg(sel, attr, value) { document.querySelectorAll(sel).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === value))); }
  function setTool(t) { S.tool = t; $('stage').dataset.tool = t; syncSeg('[data-tool]', 'tool', t); }
  function init() {
    $('btn-folder').onclick = $('btn-open-2').onclick = openFolder;
    $('btn-add-files').onclick = $('fp-add').onclick = addMoreFiles;
    $('file-input').onchange = async e => { const files = [...e.target.files]; e.target.value = ''; await addFiles(files); };
    $('folder-input').onchange = async e => {
      const all = [...e.target.files], files = all.filter(f => /\.(dcm|dicom|dic)$/i.test(f.name)); e.target.value = '';
      if (!files.length) { toast('No .dcm files in that folder.', true); return; }
      const folder = (files[0].webkitRelativePath || '').split('/')[0];
      await addShots(await filesToList(files), { replace: true, folder, open: true });
    };
    $('btn-sample').onclick = () => addShots([{ bytes: D.write(window.Sample.makeSample({ rows: 600, cols: 1600 })), name: 'sample-weld.dcm', path: '' }], { open: true, single: true });
    $('fp-search').oninput = renderFilePane;
    $('fp-save-all').onclick = saveShots;
    const stage = $('stage');
    ['dragenter', 'dragover'].forEach(t => stage.addEventListener(t, e => { e.preventDefault(); stage.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(t => stage.addEventListener(t, e => { e.preventDefault(); stage.classList.remove('drag'); }));
    stage.addEventListener('drop', e => { if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
    document.addEventListener('dragover', e => e.preventDefault()); document.addEventListener('drop', e => e.preventDefault());

    $('btn-save').onclick = saveCopy;
    $('btn-export').onclick = e => { e.stopPropagation(); const m = $('export-menu'); m.classList.toggle('open'); $('btn-export').setAttribute('aria-expanded', String(m.classList.contains('open'))); };
    document.addEventListener('click', () => { $('export-menu').classList.remove('open'); $('btn-export').setAttribute('aria-expanded', 'false'); });
    $('export-menu').querySelectorAll('[data-export]').forEach(b => { b.onclick = e => { e.stopPropagation(); exportAs(b.dataset.export); }; });

    document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
      document.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
      document.querySelectorAll('.tabpanel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
      if (b.dataset.tab === 'history') renderHistory();
    });
    document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
    document.querySelectorAll('[data-metaview]').forEach(b => b.onclick = () => { S.metaView = b.dataset.metaview; syncSeg('[data-metaview]', 'metaview', S.metaView); renderMeta(); });
    $('meta-search').oninput = renderMeta;
    $('btn-add-tag').onclick = () => { if (!S.file) return; $('addform').classList.toggle('hidden'); $('add-tag').focus(); };
    $('add-cancel').onclick = () => { $('addform').classList.add('hidden'); $('add-err').textContent = ''; };
    $('addform').onsubmit = addTagSubmit; $('add-tag').addEventListener('change', addTagGuessVr);
    $('tpl-select').onchange = updateTemplateButtons; $('tpl-apply').onclick = applyTemplate; $('tpl-save').onclick = saveTemplate; $('tpl-del').onclick = deleteTemplate;

    canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { e.preventDefault(); const p = toImage(e); zoomAt(Math.exp(-e.deltaY * 0.0015), p.sx, p.sy); readout(p); }, { passive: false });
    canvas.addEventListener('pointerleave', () => { if (S.img) readout({ x: -1, y: -1 }); });
    const cmp = $('btn-compare');
    cmp.addEventListener('pointerdown', e => { e.preventDefault(); setComparing(true); });
    ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(t => cmp.addEventListener(t, () => setComparing(false)));
    cmp.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setComparing(true); } });
    cmp.addEventListener('keyup', () => setComparing(false));
    $('btn-viewrot').onclick = rotateView;
    $('tg-files').onclick = () => togglePane('files'); $('tg-tools').onclick = () => togglePane('tools');
    document.querySelectorAll('[data-hide-pane]').forEach(b => b.onclick = () => togglePane(b.dataset.hidePane, false));
    applyPanes();
    document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
    $('sh-group').innerHTML = ''; SH.GROUP_FIELDS.forEach(t => $('sh-group').append(el('option', { value: SH.hex(t) }, D.tagInfo(t).name + (D.tagInfo(t).ndeName ? '' : ''))));
    $('sh-group').value = SH.hex(S.shGroup); $('sh-group').onchange = () => { S.shGroup = parseInt($('sh-group').value, 16) >>> 0; renderShots(); };
    $('sh-add').onclick = () => { if (HOST) addMoreFiles(); else $('sh-input').click(); };
    $('sh-input').onchange = async e => { const l = await filesToList([...e.target.files]); e.target.value = ''; if (l.length) addShots(l); };
    const sm = document.querySelector('.shots-main');
    sm.addEventListener('dragover', e => { if (!S.shDrag && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); sm.classList.add('drag'); } });
    sm.addEventListener('dragleave', () => sm.classList.remove('drag'));
    sm.addEventListener('drop', async e => { sm.classList.remove('drag'); if (S.shDrag || !e.dataTransfer.files.length) return; e.preventDefault(); addShots(await filesToList([...e.dataTransfer.files])); });
    renderFilePane();
    $('sh-search').oninput = renderShots;
    $('sh-select-all').onclick = () => { S.shots.forEach(e => S.shSel.add(e.id)); renderShots(); };
    $('sh-select-none').onclick = () => { S.shSel.clear(); renderShots(); };
    $('sh-apply').onclick = applyPending; $('sh-reset').onclick = () => { S.shPending = {}; renderBatch(); };
    $('sh-set-weld').onclick = () => setWeld($('sh-weld').value, selected());
    $('sh-renumber').onclick = renumberSelected; $('sh-tpl').onchange = () => {}; $('sh-tpl-apply').onclick = applyTemplateToShots;
    $('sh-save').onclick = saveShots; $('sh-remove').onclick = removeSelected;
    $('btn-overlay').onclick = () => setOverlay(!S.ov.opts.enabled);
    $('ov-on').onchange = e => setOverlay(e.target.checked);
    $('ov-labels').onchange = e => { S.ov.opts.labels = e.target.checked; saveOv(); draw(); };
    $('ov-size').onchange = e => { S.ov.opts.size = e.target.value; saveOv(); draw(); };
    $('ov-exports').onchange = e => { S.ov.opts.inExports = e.target.checked; saveOv(); };
    $('ov-reset').onclick = () => { S.ov.layout = O.cleanLayout(O.DEFAULT_LAYOUT); ovChanged(); };
    $('zoom-in').onclick = () => zoomAt(1.25); $('zoom-out').onclick = () => zoomAt(0.8); $('zoom-fit').onclick = fit;
    $('zoom-1').onclick = () => { if (!S.img) return; zoomAt(1 / S.view.zoom); };
    $('frame').onchange = e => { S.frame = +e.target.value; S.dirtyImage = true; draw(); };
    new ResizeObserver(resize).observe(canvas);

    const pair = (r, n, onSet) => { $(r).addEventListener('input', () => { $(n).value = fmt(+$(r).value); onSet(+$(r).value); }); $(n).addEventListener('change', () => { const v = parseFloat($(n).value); if (isFinite(v)) { $(r).value = v; onSet(v); } }); };
    pair('wl-c-r', 'wl-c', v => { S.win.c = v; S.dirtyImage = true; draw(); });
    pair('wl-w-r', 'wl-w', v => { S.win.w = Math.max(1, v); S.dirtyImage = true; draw(); });
    for (const id of ['bp-t', 'sm-s', 'sh-s', 'sh-a']) pair(id + '-r', id, () => {});
    $('edge-on').onchange = e => setEdgeOn(e.target.checked);
    EDGE_FIELDS.forEach(([k, id]) => {
      const set = v => { if (!isFinite(v)) return; S.edge[k] = v; $(id).value = v; $(id + '-r').value = v; updateEdge(k !== 'br'); };
      $(id + '-r').addEventListener('input', () => { $(id).value = $(id + '-r').value; });
      $(id + '-r').addEventListener('change', () => set(parseFloat($(id + '-r').value)));
      $(id).addEventListener('change', () => set(Math.min(+$(id).max, Math.max(+$(id).min, parseFloat($(id).value)))));
    });
    $('edge-ds').onchange = e => { S.edge.ds = e.target.checked; updateEdge(true); };
    $('edge-reset').onclick = () => { Object.assign(S.edge, { gc: 1, dc: 1, sh: 1, nr: 0, mm: 20, br: 0, ds: false }); syncEdgeInputs(); updateEdge(true); };
    $('edge-bake').onclick = bakeEdge;
    $('wl-auto').onclick = () => resetWindow('auto'); $('wl-full').onclick = () => resetWindow('full'); $('wl-file').onclick = () => resetWindow('file');
    $('view-invert').onchange = e => { S.invertView = e.target.checked; S.dirtyImage = true; draw(); };
    document.querySelectorAll('[data-op]').forEach(b => b.onclick = () => runOp(b.dataset.op));
    $('btn-undo').onclick = undo; $('btn-redo').onclick = redo; $('tb-undo').onclick = undo; $('tb-redo').onclick = redo; $('btn-revert-img').onclick = revertImage;

    $('scr-draw').onclick = () => { setTool('scratch'); toast('Drag along a scratch on the image. Right-drag still adjusts the window.'); };
    $('scr-find').onclick = findScratches; $('scr-repair').onclick = () => repairScratches(S.scratches.slice(), 'found');
    $('scr-clear').onclick = () => { S.scratches = []; renderScratches(); draw(); };
    $('scr-w-r').addEventListener('input', () => { $('scr-w').value = $('scr-w-r').value; });
    $('scr-w').addEventListener('change', () => { $('scr-w-r').value = $('scr-w').value; });
    $('crop-draw').onclick = () => setTool('crop'); $('crop-apply').onclick = applyCrop; $('crop-clear').onclick = () => { S.crop = null; syncCropInputs(); draw(); };
    ['cr-x', 'cr-y', 'cr-w', 'cr-h'].forEach(id => $(id).addEventListener('change', cropFromInputs));
    $('sp-make').onclick = makeEqualParts; $('sp-auto').onclick = autoSplit;
    $('auto-straight').onclick = $('auto-straight-2').onclick = autoStraighten; $('sp-straight').onchange = renderRegions; $('sp-clear').onclick = () => { S.regions = []; renderRegions(); draw(); }; $('sp-export').onclick = exportSplit;

    document.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea, select')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (!mod && e.key.toLowerCase() === 'f') fit();
      else if (!mod && e.key.toLowerCase() === 'v') rotateView();
      else if (!mod && S.mode === 'edit' && e.key === '[') togglePane('files');
      else if (!mod && S.mode === 'edit' && e.key === ']') togglePane('tools');
      else if (!mod && e.key.toLowerCase() === 'i' && S.img) setOverlay(!S.ov.opts.enabled);
      else if (!mod && e.key.toLowerCase() === 'c' && !e.repeat && !$('btn-compare').disabled) setComparing(true);
      else if (e.key === 'Escape') { S.crop = null; syncCropInputs(); draw(); }
    });
    document.addEventListener('keyup', e => { if (e.key.toLowerCase() === 'c') setComparing(false); });
    window.addEventListener('beforeunload', e => { if (hasChanges() && stateKey() !== savedState) { e.preventDefault(); e.returnValue = ''; } });

    if (HOST) { document.documentElement.classList.add('in-windows-app'); HOST.post('ready', {}); }
    fillAddForm(); syncOverlayUi(); renderOverlayTab(); renderTemplates(); renderMeta(); renderHistory(); resize();
  }
  init();
  window.__editor = { S, openBytes, overlayLines, addShots, setView }; // for tests
})();
