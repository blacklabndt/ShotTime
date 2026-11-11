'use strict';
// The Windows program (windows/Program.cs) talks to the editor through WebView2 messages. This test plays the
// host's part in Chromium: start-up file, Open dialog, Save dialog (including cancel), dirty flag and title.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const D = require('../dicom.js');
const { makeIndustrexJ2K } = require('./industrex-fixture.cjs');

(async () => {
  const fixture = Buffer.from(D.write(await makeIndustrexJ2K({ sopUID: '1.2.826.0.1.99' })));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BINARY || undefined });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  // Fake host, mirroring Program.cs: replies carry the request id; files travel as base64.
  await page.exposeFunction('__hostReceive', () => {});
  await page.addInitScript(b64 => {
    const listeners = [];
    window.__host = { posted: [], saved: [], written: [], cancelNextSave: false, startFile: b64[0], shotFiles: b64.slice(1) };
    const send = m => setTimeout(() => listeners.forEach(l => l({ data: m })), 0);
    window.chrome = { webview: {
      addEventListener: (t, l) => { if (t === 'message') listeners.push(l); },
      postMessage: m => {
        window.__host.posted.push({ cmd: m.cmd, dirty: m.dirty, text: m.text, name: m.name });
        if (m.cmd === 'ready' && window.__host.startFile) send({ cmd: 'openFile', ok: true, name: 'start.dcm', path: 'C:\\jobs\\start.dcm', data: window.__host.startFile });
        if (m.cmd === 'open') send({ id: m.id, ok: true, name: 'picked.dcm', path: 'C:\\jobs\\picked.dcm', data: window.__host.startFile });
        if (m.cmd === 'openMany') {
          ['shot1.dcm', 'shot2.dcm'].forEach((n, i) => send({ cmd: 'addShot', ok: true, name: n, path: 'C:\\jobs\\' + n, data: window.__host.shotFiles[i] }));
          send({ cmd: 'addShotsDone', count: 2 }); send({ id: m.id, ok: true, count: 2 });
        }
        if (m.cmd === 'pickFolder') { window.__host.near = m.near; send({ id: m.id, ok: true, folder: 'C:\\jobs\\out' }); }
        if (m.cmd === 'writeFile') { window.__host.written.push({ folder: m.folder, name: m.name, data: m.data }); send({ id: m.id, ok: true, name: m.name, path: m.folder + '\\' + m.name }); }
        if (m.cmd === 'save') {
          if (window.__host.cancelNextSave) { window.__host.cancelNextSave = false; send({ id: m.id, ok: false, cancelled: true }); return; }
          window.__host.saved.push({ name: m.name, data: m.data });
          send({ id: m.id, ok: true, name: m.name, path: 'C:\\jobs\\' + m.name });
        }
      }
    } };
  }, [fixture.toString('base64'), ...(await Promise.all([1, 2].map(async i => { const f = await makeIndustrexJ2K({ rows: 40, cols: 60 }); D.setText(f.ds, 0x0008103E, 'X-' + i); return Buffer.from(D.write(f)).toString('base64'); })))]);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  let n = 0; const ok = () => n++;

  // Start-up file (double-click / Open with) arrives after "ready".
  await page.waitForFunction(() => /Opened start\.dcm/.test(document.getElementById('toast').textContent));
  assert.ok(await page.evaluate(() => window.__editor.S.decoded));
  let posted = await page.evaluate(() => window.__host.posted);
  assert.strictEqual(posted[0].cmd, 'ready');
  assert.ok(posted.some(p => p.cmd === 'title' && p.text === 'start.dcm')); ok();

  // Open button uses the host dialog, not the browser file picker.
  await page.click('#btn-open');
  await page.waitForFunction(() => /Opened picked\.dcm/.test(document.getElementById('toast').textContent));
  assert.strictEqual(await page.evaluate(() => window.__editor.S.path), 'C:\\jobs\\picked.dcm'); ok();

  // An edit makes the host's close prompt active; saving clears it.
  const cid = page.locator('.field[data-tag="(0010,0020)"] input'); await cid.fill('HOST-1'); await cid.press('Enter');
  await page.waitForFunction(() => window.__host.posted.some(p => p.cmd === 'dirty' && p.dirty === true));
  // Cancelled save is not reported as saved and stays dirty.
  await page.evaluate(() => { window.__host.cancelNextSave = true; });
  await page.click('#btn-save');
  await page.waitForFunction(() => /Not saved/.test(document.getElementById('toast').textContent));
  assert.ok(await page.isVisible('#dirty')); ok();
  // Real save: bytes reach the host intact, path shown, dirty cleared.
  await page.click('#btn-save');
  await page.waitForFunction(() => /Saved C:\\jobs\\picked_edited\.dcm/.test(document.getElementById('toast').textContent));
  const saved = await page.evaluate(() => window.__host.saved[0]);
  assert.strictEqual(saved.name, 'picked_edited.dcm');
  const out = await D.parse(Buffer.from(saved.data, 'base64'));
  assert.strictEqual(D.getString(out.ds, 0x00100020), 'HOST-1');
  assert.deepStrictEqual(D.industrexXmlValues(out.ds, 0x00100020), ['HOST-1']);
  await page.waitForFunction(() => window.__host.posted.filter(p => p.cmd === 'dirty').slice(-1)[0].dirty === false);
  await page.click('[data-tab=history]');
  await page.waitForFunction(() => /All checks passed for picked_edited\.dcm/.test(document.getElementById('compat').textContent)); ok();

  // Exports go through the host too.
  await page.click('#btn-export'); await page.click('[data-export=tiff]');
  await page.waitForFunction(() => window.__host.saved.some(s => s.name === 'picked.tif'));
  const tif = Buffer.from(await page.evaluate(() => window.__host.saved.find(s => s.name === 'picked.tif').data), 'base64');
  assert.strictEqual(tif.toString('latin1', 0, 2), 'II'); ok();

  // Shots window: files arrive one message each; edited copies are written one by one into a chosen folder.
  await page.click('[data-view=shots]');
  await page.click('#sh-add');
  await page.waitForFunction(() => /Added 2 shots/.test(document.getElementById('toast').textContent));
  await page.click('#sh-select-all');
  await page.fill('#sb-00181004', 'PL-HOST'); await page.click('#sh-apply');
  await page.waitForFunction(() => /Batch edit/.test(document.getElementById('toast').textContent));
  await page.click('#sh-save');
  await page.waitForFunction(() => /Saved 2 copies to C:\\jobs\\out/.test(document.getElementById('sh-result').textContent));
  const written = await page.evaluate(() => window.__host.written);
  assert.deepStrictEqual(written.map(w => w.name).sort(), ['shot1_edited.dcm', 'shot2_edited.dcm']);
  assert.strictEqual(await page.evaluate(() => window.__host.near), 'C:\\jobs\\shot1.dcm', 'folder dialog starts near the originals');
  const w0 = await D.parse(Buffer.from(written[0].data, 'base64'));
  assert.strictEqual(D.getString(w0.ds, 0x00181004), 'PL-HOST');
  assert.match(await page.textContent('#sh-result'), /all passed/); ok();

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log(`diconde Windows host bridge: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
