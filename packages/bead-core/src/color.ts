import { cloneGrid, validateGrid } from './grid.js';
import { EMPTY_CELL, type BeadGrid, type Palette, type PaletteColor, type RgbColor } from './types.js';

function assertByte(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`${label} must be an integer from 0 to 255`);
  }
}

function rgbFromHex(hex: string): RgbColor {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

export function colorDistance(a: RgbColor, b: RgbColor): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function rgbToOklab(color: RgbColor): RgbColor {
  const f = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const r = f(color.r), g = f(color.g), b = f(color.b);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l3 = Math.cbrt(l), m3 = Math.cbrt(m), s3 = Math.cbrt(s);
  return { r: 0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3, g: 1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3, b: 0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3 };
}

export function colorDistanceOklab(a: RgbColor, b: RgbColor): number {
  return colorDistance(rgbToOklab(a), rgbToOklab(b));
}

export function validatePalette(palette: Palette): void {
  if (!palette || typeof palette !== 'object' || Array.isArray(palette)) {
    throw new TypeError('palette must be an object');
  }
  if (typeof palette.id !== 'string' || palette.id.length === 0
    || typeof palette.version !== 'string' || palette.version.length === 0) {
    throw new Error('palette id and version are required');
  }
  if (!Array.isArray(palette.colors)) throw new TypeError('palette colors must be an array');
  if (palette.colors.length === 0) throw new Error('palette must contain at least one color');
  if (palette.colors.length > 65_535) throw new RangeError('palette exceeds Uint16 capacity');
  const ids = new Set<string>();
  for (let index = 0; index < palette.colors.length; index += 1) {
    if (!(index in palette.colors)) throw new TypeError(`palette color at index ${index} must not be a hole`);
    const color = palette.colors[index];
    if (!color || typeof color !== 'object' || Array.isArray(color)) {
      throw new TypeError(`palette color at index ${index} must be an object`);
    }
    if (typeof color.id !== 'string' || color.id.length === 0
      || typeof color.code !== 'string' || color.code.length === 0
      || (color.name !== undefined && (typeof color.name !== 'string' || color.name.length === 0))) {
      throw new Error('palette color id and code are required');
    }
    if (ids.has(color.id)) throw new Error(`duplicate palette color id: ${color.id}`);
    ids.add(color.id);
    if (!color.rgb || typeof color.rgb !== 'object' || Array.isArray(color.rgb)) {
      throw new TypeError(`${color.id}.rgb must be an object`);
    }
    assertByte(color.rgb.r, `${color.id}.rgb.r`);
    assertByte(color.rgb.g, `${color.id}.rgb.g`);
    assertByte(color.rgb.b, `${color.id}.rgb.b`);
    if (!/^#[0-9A-F]{6}$/i.test(color.hex)) throw new Error(`invalid hex for ${color.id}`);
    const expected = rgbFromHex(color.hex);
    if (color.rgb.r !== expected.r || color.rgb.g !== expected.g || color.rgb.b !== expected.b) {
      throw new Error(`palette color rgb and hex do not match for ${color.id}`);
    }
  }
}

export function findClosestPaletteIndex(target: RgbColor, colors: readonly PaletteColor[], metric: 'rgb' | 'oklab' = 'rgb'): number {
  if (colors.length === 0) throw new Error('cannot map a color with an empty palette');
  let closestIndex = 0;
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < colors.length; index += 1) {
    const color = colors[index];
    if (!color) continue;
    const distance = metric === 'oklab' ? colorDistanceOklab(target, color.rgb) : colorDistance(target, color.rgb);
    if (distance < minimumDistance) { minimumDistance = distance; closestIndex = index; }
    if (distance === 0) break;
  }
  return closestIndex + 1;
}

export function createPaletteTable(palette: Palette): string[] {
  return ['', ...palette.colors.map(color => color.id)];
}

export function compactPaletteTable(
  grid: BeadGrid,
  palette: Palette,
): { grid: BeadGrid; paletteTable: string[] } {
  validateGrid(grid, palette.colors.length);
  const used = new Uint8Array(palette.colors.length + 1);
  for (const cell of grid.cells) {
    if (cell !== EMPTY_CELL) used[cell] = 1;
  }
  const remap = new Uint16Array(palette.colors.length + 1);
  const paletteTable = [''];
  for (let sourceIndex = 1; sourceIndex <= palette.colors.length; sourceIndex += 1) {
    if (!used[sourceIndex]) continue;
    const color = palette.colors[sourceIndex - 1];
    if (!color) continue;
    remap[sourceIndex] = paletteTable.length;
    paletteTable.push(color.id);
  }
  const compacted = cloneGrid(grid);
  for (let index = 0; index < compacted.cells.length; index += 1) {
    const sourceIndex = compacted.cells[index] ?? EMPTY_CELL;
    compacted.cells[index] = remap[sourceIndex] ?? EMPTY_CELL;
  }
  return { grid: compacted, paletteTable };
}
