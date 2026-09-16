import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { colorDistanceOklab, hashPattern, type BeadPattern } from '@pinbean/bead-core';
import { generateWebPattern, createWebCorePalette } from '../src/adapters/beadCoreAdapter';
import { createMardPalette, decodeFixture, realImageCases } from '../tests/support/realImageCases.mts';

// Predecoded, immutable inputs. Timing excludes gzip I/O; one warmup + five measured runs.
const out = resolve(process.argv[2] ?? 'quality-output');
mkdirSync(out, { recursive: true });
const currentPalette = createMardPalette();
const palette = createWebCorePalette(currentPalette, 'MARD').palette;
const colors = new Map(palette.colors.map(c => [c.id, c]));
const variants = [
  { name: 'v2', algorithmVersion: 2 as const },
  { name: 'v3-rgb-srgb', algorithmVersion: 3 as const, colorDistance: 'rgb' as const, averageColorSpace: 'srgb' as const },
  { name: 'v3-oklab-srgb', algorithmVersion: 3 as const, colorDistance: 'oklab' as const, averageColorSpace: 'srgb' as const },
  { name: 'v3-oklab-linear', algorithmVersion: 3 as const, colorDistance: 'oklab' as const, averageColorSpace: 'linear' as const },
  ...[8, 16, 32].map(maxColors => ({ name: `v3-oklab-k${maxColors}`, algorithmVersion: 3 as const, colorDistance: 'oklab' as const, averageColorSpace: 'srgb' as const, maxColors })),
];
function ids(pattern: BeadPattern) { return Array.from(pattern.grid.cells, c => pattern.paletteTable[c] ?? ''); }
function topology(pattern: BeadPattern) {
  const { width, height, cells } = pattern.grid;
  const seen = new Uint8Array(cells.length);
  let components = 0, isolated = 0, edges = 0;
  for (let i = 0; i < cells.length; i++) {
    if (i % width + 1 < width && cells[i] !== cells[i + 1]) edges++;
    if (i + width < cells.length && cells[i] !== cells[i + width]) edges++;
    if (!cells[i] || seen[i]) continue;
    components++;
    const stack = [i]; seen[i] = 1; let size = 0;
    while (stack.length) {
      const j = stack.pop() as number; size++;
      const x = j % width, y = Math.floor(j / width);
      for (const n of [x ? j - 1 : -1, x + 1 < width ? j + 1 : -1, y ? j - width : -1, y + 1 < height ? j + width : -1]) {
        if (n >= 0 && !seen[n] && cells[n] === cells[i]) { seen[n] = 1; stack.push(n); }
      }
    }
    if (size === 1) isolated++;
  }
  return { components, isolated, edges };
}
const rows: object[] = [];
for (const testCase of realImageCases) {
  const image = decodeFixture(testCase.fixtureName);
  let baseline: string[] = [];
  for (const variant of variants) {
    const input = { image, currentPalette, detailLevel: 50, similarityThreshold: 0, mode: testCase.mode, colorSystem: 'MARD' as const, ...variant };
    const first = generateWebPattern(input).pattern;
    const hash = hashPattern(first);
    const times: number[] = [];
    for (let n = 0; n < 5; n++) {
      const start = performance.now(); const result = generateWebPattern(input).pattern;
      times.push(performance.now() - start); assert.equal(hashPattern(result), hash);
    }
    const output = ids(first);
    if (variant.name === 'v2') baseline = output;
    let error = 0, weight = 0, coverageDifference = 0, changed = 0;
    for (let i = 0; i < output.length; i++) {
      if (output[i] !== baseline[i]) changed++;
      if (Boolean(output[i]) !== Boolean(baseline[i])) coverageDifference++;
    }
    // Source-pixel OKLab error against nearest output cell; alpha weighted.
    // This common reference is not a perceptual quality or semantic-detail score.
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const o = (y * image.width + x) * 4;
      const a = image.rgba[o + 3] / 255;
      if (!a) continue;
      const i = Math.min(first.grid.height - 1, Math.floor(y * first.grid.height / image.height)) * first.grid.width + Math.min(first.grid.width - 1, Math.floor(x * first.grid.width / image.width));
      const color = colors.get(output[i]);
      error += a * (color ? colorDistanceOklab({ r: image.rgba[o], g: image.rgba[o + 1], b: image.rgba[o + 2] }, color.rgb) : 1);
      weight += a;
    }
    if ('maxColors' in variant) assert.ok(first.paletteTable.length - 1 <= variant.maxColors);
    times.sort((a, b) => a - b);
    const name = `${testCase.fixtureName}-${testCase.mode}-${variant.name}`;
    const rectangles = output.map((id, i) => id ? `<rect x="${i % first.grid.width}" y="${Math.floor(i / first.grid.width)}" width="1" height="1" fill="${colors.get(id)?.hex}"/>` : '').join('');
    writeFileSync(resolve(out, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${first.grid.width} ${first.grid.height}" width="400" height="${400 * first.grid.height / first.grid.width}" shape-rendering="crispEdges">${rectangles}</svg>`);
    rows.push({ name, config: first.generationConfig, hash, width: first.grid.width, height: first.grid.height, colors: first.paletteTable.length - 1, changedFromV2: changed, coverageDifferenceFromV2: coverageDifference, sourceOklabError: error / weight, ...topology(first), medianMs: times[2], maxMs: times[4] });
  }
}
writeFileSync(resolve(out, 'report.json'), JSON.stringify({ node: process.version, platform: process.platform, cpu: cpus()[0]?.model, method: 'Five fixed RGBA fixtures, two modes, width 50; threshold 0 for all variants; V2 baseline isolates sampling/mapping from legacy threshold merge. One warmup + five measured runs. All runs asserted deterministic. Source OKLab error and topology are descriptive, not semantic acceptance. No cleanup, no browser/device timing.', rows }, null, 2));
console.log(`Wrote ${rows.length} cases and SVG previews to ${out}`);
