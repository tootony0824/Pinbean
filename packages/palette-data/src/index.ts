import type { Palette, PaletteColor } from '@pinbean/bead-core';
import { SUPPLIER_COLOR_SYSTEM_MAPPING as RAW_SUPPLIER_COLOR_SYSTEM_MAPPING } from './colorSystemMapping.js';

export const COLOR_SYSTEMS = ['MARD', 'COCO', '漫漫', '盼盼', '咪小窝'] as const;
export const PALETTE_DATA_VERSION = 'color-system-mapping-v1';
export const LEGACY_ID_ONLY_SELECTION_VERSION = `${PALETTE_DATA_VERSION}:selection-147258d1`;

export type ColorSystem = typeof COLOR_SYSTEMS[number];
export type ColorSystemCodes = Record<ColorSystem, string>;
export type ColorSystemMapping = Record<string, ColorSystemCodes>;

function parseHex(hex: string): PaletteColor['rgb'] {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function updateFnv1a(hash: number, value: string): number {
  let updated = hash;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    updated = Math.imul((updated ^ (codeUnit & 0xff)) >>> 0, 0x01000193) >>> 0;
    updated = Math.imul((updated ^ ((codeUnit >>> 8) & 0xff)) >>> 0, 0x01000193) >>> 0;
  }
  return updated;
}

function selectionVersion(colors: readonly PaletteColor[]): string {
  let hash = 0x811c9dc5;
  for (const [index, color] of colors.entries()) {
    hash = updateFnv1a(hash, String(index));
    hash = updateFnv1a(hash, '\0');
    hash = updateFnv1a(hash, color.id);
    hash = updateFnv1a(hash, '\0');
    hash = updateFnv1a(hash, color.hex);
    hash = updateFnv1a(hash, '\0');
    hash = updateFnv1a(hash, `${color.rgb.r},${color.rgb.g},${color.rgb.b}`);
    hash = updateFnv1a(hash, '\0');
    hash = updateFnv1a(hash, color.code);
    hash = updateFnv1a(hash, '\0');
    hash = updateFnv1a(hash, color.name ?? '');
    hash = updateFnv1a(hash, '\u0001');
  }
  return `${PALETTE_DATA_VERSION}:selection-${hash.toString(16).padStart(8, '0')}`;
}

function assertColorSystem(colorSystem: string): asserts colorSystem is ColorSystem {
  if (!(COLOR_SYSTEMS as readonly string[]).includes(colorSystem)) {
    throw new Error(`unsupported color system: ${colorSystem}`);
  }
}

function assertColorSystemCodes(value: unknown, hex: string): asserts value is ColorSystemCodes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`palette mapping for ${hex} must be an object`);
  }
  const codes = value as Partial<Record<ColorSystem, unknown>>;
  for (const colorSystem of COLOR_SYSTEMS) {
    const code = codes[colorSystem];
    if (typeof code !== 'string' || code.length === 0) {
      throw new Error(`missing color code for ${hex}`);
    }
  }
}

function normalizeColorSystemMapping(mapping: ColorSystemMapping): ColorSystemMapping {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    throw new TypeError('color system mapping must be an object');
  }
  const normalized: ColorSystemMapping = {};
  for (const [rawHex, rawCodes] of Object.entries(mapping)) {
    const hex = rawHex.toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(hex)) throw new Error(`invalid palette hex: ${rawHex}`);
    if (Object.prototype.hasOwnProperty.call(normalized, hex)) {
      throw new Error(`duplicate normalized palette hex: ${hex}`);
    }
    assertColorSystemCodes(rawCodes, hex);
    const codes = {} as ColorSystemCodes;
    for (const colorSystem of COLOR_SYSTEMS) codes[colorSystem] = rawCodes[colorSystem];
    normalized[hex] = codes;
  }
  return normalized;
}

function cloneColorSystemMapping(mapping: ColorSystemMapping): ColorSystemMapping {
  const clone: ColorSystemMapping = {};
  for (const [hex, codes] of Object.entries(mapping)) clone[hex] = { ...codes };
  return clone;
}

const SUPPLIER_COLOR_SYSTEM_MAPPING = normalizeColorSystemMapping(RAW_SUPPLIER_COLOR_SYSTEM_MAPPING);

export function createSupplierPalette(
  mapping: ColorSystemMapping,
  colorSystem: ColorSystem,
  selectedHexes?: readonly string[],
): Palette {
  assertColorSystem(colorSystem);
  const normalizedMapping = normalizeColorSystemMapping(mapping);
  const normalizedSelection = selectedHexes === undefined
    ? undefined
    : new Set(selectedHexes.map(hex => {
      if (typeof hex !== 'string') throw new TypeError('selected palette hex must be a string');
      const normalizedHex = hex.toUpperCase();
      if (!/^#[0-9A-F]{6}$/.test(normalizedHex)) throw new Error(`invalid palette hex: ${hex}`);
      return normalizedHex;
    }));
  if (normalizedSelection?.size === 0) throw new Error('palette selection must not be empty');

  const knownHexes = new Set(Object.keys(normalizedMapping));
  for (const hex of normalizedSelection ?? []) {
    if (!knownHexes.has(hex)) throw new Error(`unknown palette color: ${hex}`);
  }

  const seenIds = new Set<string>();
  const colors: PaletteColor[] = [];
  for (const [hex, codes] of Object.entries(normalizedMapping)) {
    if (normalizedSelection && !normalizedSelection.has(hex)) continue;
    const baseCode = codes.MARD;
    const displayCode = codes[colorSystem];
    const id = `pinbean:color:${baseCode}`;
    if (seenIds.has(id)) throw new Error(`duplicate stable color id: ${id}`);
    seenIds.add(id);
    colors.push({
      id,
      code: displayCode,
      name: `${colorSystem} ${displayCode}`,
      rgb: parseHex(hex),
      hex,
    });
  }
  if (colors.length === 0) throw new Error('palette selection must contain at least one known color');

  return {
    id: `pinbean:supplier:${colorSystem}`,
    version: selectionVersion(colors),
    colors,
  };
}

function selectedHexesForColorIds(mapping: ColorSystemMapping, selectedColorIds: readonly string[]): string[] {
  if (selectedColorIds.length === 0) throw new Error('palette selection must not be empty');
  const selected = new Set(selectedColorIds);
  if (selected.size !== selectedColorIds.length) throw new Error('palette selection contains duplicate color ids');
  const normalizedMapping = normalizeColorSystemMapping(mapping);
  const hexes: string[] = [];
  for (const [hex, codes] of Object.entries(normalizedMapping)) {
    const colorId = `pinbean:color:${codes.MARD}`;
    if (selected.has(colorId)) hexes.push(hex);
  }
  if (hexes.length !== selected.size) {
    const knownIds = new Set(Object.values(normalizedMapping).map(codes => `pinbean:color:${codes.MARD}`));
    const missing = selectedColorIds.find(colorId => !knownIds.has(colorId));
    throw new Error(`unknown palette color id: ${missing ?? 'unknown'}`);
  }
  return hexes;
}

export function createSupplierPaletteFromColorIds(
  mapping: ColorSystemMapping,
  colorSystem: ColorSystem,
  selectedColorIds?: readonly string[],
): Palette {
  return createSupplierPalette(
    mapping,
    colorSystem,
    selectedColorIds === undefined ? undefined : selectedHexesForColorIds(mapping, selectedColorIds),
  );
}

export function getSupplierPaletteFromHexes(
  colorSystem: ColorSystem,
  selectedHexes?: readonly string[],
): Palette {
  return createSupplierPalette(SUPPLIER_COLOR_SYSTEM_MAPPING, colorSystem, selectedHexes);
}

export function getSupplierPalette(
  colorSystem: ColorSystem,
  selectedColorIds?: readonly string[],
): Palette {
  return createSupplierPaletteFromColorIds(
    SUPPLIER_COLOR_SYSTEM_MAPPING,
    colorSystem,
    selectedColorIds,
  );
}

export function getSupplierColorSystemMapping(): ColorSystemMapping {
  return cloneColorSystemMapping(SUPPLIER_COLOR_SYSTEM_MAPPING);
}
