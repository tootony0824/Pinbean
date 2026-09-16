import { cloneGenerationConfig } from './generation.js';
import { createGrid, validateGrid } from './grid.js';
import {
  CURRENT_SCHEMA_VERSION,
  type BeadProject,
  type SerializedBeadProject,
} from './types.js';
import { parseGenerationConfig, parsePaletteTable, parseSerializedProject } from './validation.js';

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
}

function assertOptionalNonEmptyString(value: unknown, label: string): asserts value is string | undefined {
  if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
    throw new TypeError(`${label} must be a non-empty string when present`);
  }
}

function assertSafeTimestamp(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function validateMetadata(project: BeadProject): void {
  assertRecord(project, 'project');
  assertNonEmptyString(project.id, 'project id');
  assertNonEmptyString(project.name, 'project name');
  assertNonEmptyString(project.paletteId, 'project paletteId');
  assertNonEmptyString(project.paletteVersion, 'project paletteVersion');
  assertSafeTimestamp(project.createdAt, 'project createdAt');
  assertSafeTimestamp(project.updatedAt, 'project updatedAt');
  if (project.updatedAt < project.createdAt) throw new RangeError('updatedAt must not precede createdAt');
  const paletteTable = parsePaletteTable(project.paletteTable, 'project palette table');
  validateGrid(project.grid, paletteTable.length - 1);
  if (project.generation !== undefined) {
    assertRecord(project.generation, 'project generation');
    assertOptionalNonEmptyString(project.generation.sourceImageId, 'project generation sourceImageId');
    parseGenerationConfig(project.generation.config, {
      paletteId: project.paletteId,
      paletteVersion: project.paletteVersion,
    });
  }
}

export function serializeProject(project: BeadProject): SerializedBeadProject {
  if (project.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`unsupported schema version: ${project.schemaVersion}`);
  }
  validateMetadata(project);
  return {
    id: project.id,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    name: project.name,
    grid: {
      width: project.grid.width,
      height: project.grid.height,
      cells: Array.from(project.grid.cells),
    },
    paletteId: project.paletteId,
    paletteVersion: project.paletteVersion,
    paletteTable: [...project.paletteTable],
    ...(project.generation ? {
      generation: {
        ...(project.generation.sourceImageId ? { sourceImageId: project.generation.sourceImageId } : {}),
        config: cloneGenerationConfig(project.generation.config),
      },
    } : {}),
  };
}

export function migrateSerializedProject(input: unknown): SerializedBeadProject {
  assertRecord(input, 'serialized project');
  if (input.schemaVersion === CURRENT_SCHEMA_VERSION) return parseSerializedProject(input);
  if (input.schemaVersion === 0) {
    const legacy = parseSerializedProject({
      ...input,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      updatedAt: input.createdAt,
    });
    return {
      ...legacy,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
  }
  throw new Error(`unsupported schema version: ${String(input.schemaVersion)}`);
}

export function deserializeProject(input: unknown): BeadProject {
  const serialized = migrateSerializedProject(input);
  const project: BeadProject = {
    id: serialized.id,
    schemaVersion: serialized.schemaVersion,
    createdAt: serialized.createdAt,
    updatedAt: serialized.updatedAt,
    name: serialized.name,
    grid: createGrid(serialized.grid.width, serialized.grid.height, serialized.grid.cells),
    paletteId: serialized.paletteId,
    paletteVersion: serialized.paletteVersion,
    paletteTable: [...serialized.paletteTable],
    ...(serialized.generation ? {
      generation: {
        ...(serialized.generation.sourceImageId ? { sourceImageId: serialized.generation.sourceImageId } : {}),
        config: cloneGenerationConfig(serialized.generation.config),
      },
    } : {}),
  };
  if (project.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`unsupported schema version: ${project.schemaVersion}`);
  }
  validateMetadata(project);
  return project;
}
