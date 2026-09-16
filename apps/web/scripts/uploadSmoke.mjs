import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1194, height: 834 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { errors.push(dialog.message()); await dialog.accept(); });
  await page.goto(process.env.PINBEAN_WEB_URL || 'http://localhost:3016');
  console.log('Browser capabilities:', await page.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID })));
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.pinbean-dropzone:not(.is-waiting)').click();
  await (await chooser).setFiles(fileURLToPath(new URL('../tests/fixtures/real-images/cartoon.png', import.meta.url)));
  await page.getByRole('button', { name: '确认裁剪', exact: true }).click();
  await page.waitForFunction(() => !!localStorage.getItem('pinbean_web_project_v2'));
  const readProject = () => page.evaluate(() => JSON.parse(localStorage.getItem('pinbean_web_project_v2')).project);
  const initial = await readProject();
  assert.match(initial.id, /^[0-9a-f-]{36}$/);
  assert.ok(initial.grid.cells.some(cell => cell > 0));
  await page.getByRole('button', { name: '色彩细腻', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('pinbean_web_project_v2')).project.generation.config.mode === 'realistic');
  const regenerated = await readProject();
  assert.equal(regenerated.id, initial.id);
  await page.getByRole('button', { name: '校对细节', exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('.pinbean-canvas-stage canvas'));
  assert.deepEqual((await readProject()).grid, regenerated.grid);
  assert.deepEqual(errors, []);
  console.log('PASS: fresh image upload, crop, both generation modes, stable project identity, editor and reload');
} finally { await browser.close(); }
