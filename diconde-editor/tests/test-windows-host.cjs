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
    window.__host = { posted: [], saved: [], cancelNextSave: false, startFile: b64 };
    const send = m => setTimeout(() => listeners.forEach(l => l({ data: m })), 0);
    window.chrome = { webview: {
      addEventListener: (t, l) => { if (t === 'message') listeners.push(l); },
      postMessage: m => {
        window.__host.posted.push({ cmd: m.cmd, dirty: m.dirty, text: m.text, name: m.name });
        if (m.cmd === 'ready' && window.__host.startFile) send({ cmd: 'openFile', ok: true, name: 'start.dcm', path: 'C:\\jobs\\start.dcm', data: window.__host.startFile });
        if (m.cmd === 'open') send({ id: m.id, ok: true, name: 'picked.dcm', path: 'C:\\jobs\\picked.dcm', data: window.__host.startFile });
        if (m.cmd === 'save') {
          if (window.__host.cancelNextSave) { window.__host.cancelNextSave = false; send({ id: m.id, ok: false, cancelled: true }); return; }
          window.__host.saved.push({ name: m.name, data: m.data });
          send({ id: m.id, ok: true, name: m.name, path: 'C:\\jobs\\' + m.name });
        }
      }
    } };
  }, fixture.toString('base64'));
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

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log(`diconde Windows host bridge: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
