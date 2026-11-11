/* DICONDE Editor UI. The opened file is never modified on disk; every save writes a new file. */
'use strict';
(function () {
  const D = window.Dicom, I = window.Imaging, X = window.Exporters, O = window.Overlay;
  const $ = id => document.getElementById(id);
  const MAX_UNDO = 12;
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
    });
    return {
      call: (cmd, args) => new Promise(res => { const id = ++next; pending.set(id, res); window.chrome.webview.postMessage(Object.assign({ id, cmd }, args)); }),
      post: (cmd, args) => window.chrome.webview.postMessage(Object.assign({ cmd }, args))
    };
  })() : null;
  function toB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  function fromB64(b64) { const s = atob(b64), o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
  async function openFromHost(m) {
    if (hasChanges() && stateKey() !== savedState && !confirm('Discard unsaved changes to the current file?')) return;
    await busy(async () => { await openBytes(fromB64(m.data), m.name); S.path = m.path || ''; }, 'Opening…');
  }
  // Saves through the native dialog (Windows program) or as a browser download. Resolves { saved, name, path }.
  async function download(bytes, name, type) {
    if (HOST) {
      const r = await HOST.call('save', { name, data: toB64(bytes) });
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
    S.orig = file; S.file = D.clone(file); S.name = name;
    S.undo = []; S.redo = []; S.ops = []; S.turns = 0; S.origEls = new Map(); S.crop = null; S.regions = []; S.frame = 0; S.comparing = false; savedState = '';
    let img = D.getImage(S.file);
    S.decoded = false; S.edge.on = false; S.edgeCache = null; S.rawAutoWidth = null;
    if (img.compressed && window.Codec && Codec.canDecode(file.transferSyntax)) {
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
    $('save-format').value = S.decoded ? 'j2k' : 'raw';
    $('save-format').disabled = !S.img || S.img.bitsAllocated > 16;
    $('empty').classList.add('hidden');
    ['btn-save', 'btn-export'].forEach(id => { $(id).disabled = false; });
    const rows = D.getNumber(S.file.ds, 0x00280010), cols = D.getNumber(S.file.ds, 0x00280011);
    $('fileinfo').textContent = `${name} · ${cols || '?'}×${rows || '?'} · ${D.TS_NAMES[file.transferSyntax] || file.transferSyntax}`;
    $('fileinfo').title = $('fileinfo').textContent;
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
    if (S.img) { resetWindow('file'); S.dirtyImage = true; fit(); }
    else { S.bmp = null; draw(); }
    syncEdgeInputs(); showEdgeFileSettings(); $('btn-overlay').disabled = !S.img; renderOverlayTab();
    renderMeta(); refreshImageUi(); renderRegions(); renderHistory();
    toast(`Opened ${name}`);
    if (HOST) HOST.post('title', { text: name });
  }
  async function openFile(f) { if (!f) return; if (hasChanges() && !confirm('Discard unsaved changes to the current file?')) return; await busy(async () => openBytes(new Uint8Array(await f.arrayBuffer()), f.name), 'Opening…'); }

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
    const before = ds.el.get(tag);
    remember(key, ds, tag);
    try {
      if (text === '' && !before) { if (sameAsOrig(key, ds, tag)) S.origEls.delete(key); return ''; }
      D.setText(ds, tag, text, vr, S.file.ds);
    } catch (e) { if (sameAsOrig(key, ds, tag)) S.origEls.delete(key); return e.message; }
    if (sameAsOrig(key, ds, tag)) S.origEls.delete(key);
    afterMetaChange(tag);
    return '';
  }
  function deleteField(ds, tag, path) { const key = keyOf(path, tag); remember(key, ds, tag); D.remove(ds, tag); if (sameAsOrig(key, ds, tag)) S.origEls.delete(key); afterMetaChange(tag); renderMeta(); }
  function revertField(ds, tag, path) {
    const key = keyOf(path, tag), o = S.origEls.get(key);
    if (o) ds.el.set(tag, D.clone(o)); else ds.el.delete(tag);
    S.origEls.delete(key); afterMetaChange(tag); renderMeta();
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
    for (const [hex, v] of Object.entries(f)) {
      const tag = parseInt(hex, 16) >>> 0;
      if (v.remove) { if (S.file.ds.el.has(tag)) deleteField(S.file.ds, tag, ''); continue; }
      const msg = setField(S.file.ds, tag, v.text, '', v.vr); if (msg) problems.push(`${D.tagInfo(tag).name}: ${msg}`);
    }
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
  }
  function onUp(ev) {
    const d = S.drag; S.drag = null; if (!d) return;
    if (d.mode === 'crop' && S.crop && (S.crop.w < 2 || S.crop.h < 2)) S.crop = null;
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
    S.undo.push({ img: S.img, text, turns, crop: S.crop, regions: S.regions });
    if (S.undo.length > MAX_UNDO) { S.undo.shift(); toast(`Only the last ${MAX_UNDO} image steps can be undone.`); }
    S.redo = []; S.ops.push(text); S.turns += turns;
    setImg(next);
  }
  function setImg(next) {
    S.img = next; S.dirtyImage = true; S.rawAutoWidth = null;
    if (S.frame >= next.frames.length) S.frame = 0;
    refreshImageUi(); renderHistory(); syncCropInputs(); draw();
  }
  function undo() {
    const u = S.undo.pop(); if (!u) return;
    S.redo.push({ img: S.img, text: u.text, turns: u.turns, crop: S.crop, regions: S.regions });
    const g = dimsDiffer(u.img); S.ops.pop(); S.turns -= u.turns; S.crop = u.crop; S.regions = u.regions; renderRegions(); setImg(u.img); if (g) fit();
  }
  function redo() {
    const r = S.redo.pop(); if (!r) return;
    S.undo.push({ img: S.img, text: r.text, turns: r.turns, crop: S.crop, regions: S.regions });
    const g = dimsDiffer(r.img); S.ops.push(r.text); S.turns += r.turns; S.crop = r.crop; S.regions = r.regions; renderRegions(); setImg(r.img); if (g) fit();
  }
  const dimsDiffer = img => img.rows !== S.img.rows || img.cols !== S.img.cols;
  function revertImage() {
    if (!S.ops.length || !confirm('Revert all image changes? Metadata edits are kept.')) return;
    S.undo = []; S.redo = []; S.ops = []; S.turns = 0; S.crop = null; S.regions = []; renderRegions(); setImg(S.origImg); fit();
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
    $('btn-undo').disabled = !S.undo.length; $('btn-redo').disabled = !S.redo.length; $('btn-revert-img').disabled = !S.ops.length;
    $('btn-undo').textContent = S.undo.length ? `Undo: ${S.undo[S.undo.length - 1].text}` : 'Undo';
    if (S.img) syncWindowInputs();
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
        el('span', { class: 'dims' }, `${r.w}×${r.h} at (${r.x}, ${r.y})`)));
    });
    $('sp-clear').disabled = !S.regions.length; $('sp-export').disabled = !S.regions.length;
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

  // ---------- saving ----------
  function storeWindow(ds) {
    if (!$('store-window').checked || !S.img) return;
    const f = v => { let s = String(+v.toFixed(2)); if (s.length > 16) s = v.toExponential(6); return s; };
    D.setText(ds, 0x00281050, f(S.win.c), 'DS'); D.setText(ds, 0x00281051, f(S.win.w), 'DS');
  }
  function buildCopy(region, partInfo, removed) {
    const pixelsChanged = S.ops.length > 0 || !!region;
    const copy = D.clone(S.file);
    if (S.img && pixelsChanged) {
      const out = region ? I.crop(S.img, region) : S.img;
      D.setImage(copy, out, { swapSpacing: S.turns % 2 === 1 });
      copy.transferSyntax = D.TS.EXPLICIT_LE; copy.encapsulated = false;
      if (wantJ2k()) {
        // Follow the source codestream (INDUSTREX: 16-bit precision, RLCP) so INDUSTREX gets what it writes itself.
        const src = S.orig.encapsulated && Codec.codestreamInfo(Codec.frameStreams(S.orig.ds.el.get(D.PIXEL).fragments, 1)[0]) || {};
        const bits = src.precision >= out.bitsStored && src.precision <= out.bitsAllocated ? src.precision : out.bitsStored;
        D.setEncapsulated(copy, out.frames.map(a => Codec.encodeFrameLossless(a, { width: out.cols, height: out.rows, bitsPerSample: bits, isSigned: out.signed, progression: src.progression })), Codec.J2K_LOSSLESS);
      }
    }
    storeWindow(copy.ds);
    // INDUSTREX mirrors the fields in its XML presentation state; keep that copy in step (processed copies drop the XML).
    if (!pixelsChanged) copy.synced = D.syncIndustrexXml(copy.ds, changedTopLevel().concat($('store-window').checked ? [0x00281050, 0x00281051] : []));
    const steps = S.ops.slice(); if (partInfo) steps.push(partInfo.text);
    D.derive(copy, S.orig, { pixelsChanged, description: steps.join('; '), seriesUID: partInfo ? partInfo.series : (pixelsChanged ? D.newUID() : null), instanceNumber: partInfo ? partInfo.index : null, removed });
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
      const res = await download(bytes, `${baseName()}_edited.dcm`, 'application/dicom');
      if (!res.saved) { toast('Not saved.'); return; }
      let extra = removed.length ? ` Left out ${removed.length} element(s) that described the original pixels.` : '';
      if (copy.synced && copy.synced.length) extra += ` Updated ${copy.synced.length} field(s) in INDUSTREX's XML copy.`;
      toast(`Saved ${savedWhere(res)} (${(bytes.length / 1048576).toFixed(1)} MB). The original file is unchanged.${extra}`);
      markSaved();
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
  function markSaved() { savedState = stateKey(); updateDirty(); }

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
    const dirty = !!S.file && hasChanges() && stateKey() !== savedState;
    $('dirty').classList.toggle('hidden', !dirty); $('btn-save').classList.toggle('primary', dirty);
    if (HOST && dirty !== S.hostDirty) { S.hostDirty = dirty; HOST.post('dirty', { dirty }); }
    $('btn-compare').disabled = !S.img || !S.ops.length;
  }

  // ---------- wiring ----------
  function syncSeg(sel, attr, value) { document.querySelectorAll(sel).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === value))); }
  function setTool(t) { S.tool = t; $('stage').dataset.tool = t; syncSeg('[data-tool]', 'tool', t); }
  function init() {
    $('btn-open').onclick = $('btn-open-2').onclick = async () => {
      if (!HOST) { $('file-input').click(); return; }
      const r = await HOST.call('open', {});
      if (r.ok) openFromHost(r); else if (!r.cancelled) toast(`Could not open: ${r.error || 'unknown error'}`, true);
    };
    $('file-input').onchange = e => { openFile(e.target.files[0]); e.target.value = ''; };
    $('btn-sample').onclick = () => busy(() => openBytes(D.write(window.Sample.makeSample({ rows: 600, cols: 1600 })), 'sample-weld.dcm'));
    const stage = $('stage');
    ['dragenter', 'dragover'].forEach(t => stage.addEventListener(t, e => { e.preventDefault(); stage.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(t => stage.addEventListener(t, e => { e.preventDefault(); stage.classList.remove('drag'); }));
    stage.addEventListener('drop', e => openFile(e.dataTransfer.files[0]));
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
    $('btn-undo').onclick = undo; $('btn-redo').onclick = redo; $('btn-revert-img').onclick = revertImage;

    $('crop-draw').onclick = () => setTool('crop'); $('crop-apply').onclick = applyCrop; $('crop-clear').onclick = () => { S.crop = null; syncCropInputs(); draw(); };
    ['cr-x', 'cr-y', 'cr-w', 'cr-h'].forEach(id => $(id).addEventListener('change', cropFromInputs));
    $('sp-make').onclick = makeEqualParts; $('sp-clear').onclick = () => { S.regions = []; renderRegions(); draw(); }; $('sp-export').onclick = exportSplit;

    document.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea, select')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (!mod && e.key.toLowerCase() === 'f') fit();
      else if (!mod && e.key.toLowerCase() === 'v') rotateView();
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
  window.__editor = { S, openBytes, overlayLines }; // for tests
})();
