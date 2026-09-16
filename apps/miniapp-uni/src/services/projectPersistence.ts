import {
  CURRENT_SCHEMA_VERSION,
  encodeProjectEnvelope,
  restoreProjectEnvelope,
  storeProjectEnvelope,
  MAX_PROJECT_FILE_CHARACTERS,
  type BeadPattern,
  type BeadProject,
  type Palette,
  type CellProgress,
  type ProductionProgress,
  type ProjectWorkflow,
  type PublishReview,
  type RestoredProjectEnvelope,
  type StoredPatternProject as CoreStoredPatternProject,
} from '@pinbean/bead-core'
import { LEGACY_ID_ONLY_SELECTION_VERSION, getSupplierPalette, type ColorSystem } from '@pinbean/palette-data'

export { STORED_PROJECT_FORMAT_VERSION, PROJECT_FILE_EXTENSION, MAX_PROJECT_FILE_CHARACTERS } from '@pinbean/bead-core'
export type ProjectImportErrorCode = 'invalid-json' | 'invalid-project' | 'palette-unavailable' | 'unsupported-format' | 'unsupported-schema'
export class ProjectImportError extends Error {
  readonly cause?: unknown
  readonly code: ProjectImportErrorCode
  constructor(code: ProjectImportErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'ProjectImportError'
    this.code = code
    this.cause = cause
  }
}
export interface ProjectIdentity { createdAt: number; id: string; name: string }
export interface StoredPatternProject extends CoreStoredPatternProject { colorSystem: ColorSystem }
export interface RestoredPatternProject extends RestoredProjectEnvelope { colorSystem: ColorSystem }
const options = { legacyPaletteVersions: [LEGACY_ID_ONLY_SELECTION_VERSION] }
function resolvePalette(colorSystem: string, selectedColorIds?: readonly string[]): Palette {
  return getSupplierPalette(colorSystem as ColorSystem, selectedColorIds)
}

export function storePatternProject(
  pattern: BeadPattern, colorSystem: ColorSystem, identity: ProjectIdentity, updatedAt: number,
  progress?: ProductionProgress, workflow?: ProjectWorkflow, publishReview?: PublishReview,
  palette: Palette = getSupplierPalette(colorSystem), cellProgress?: CellProgress,
): StoredPatternProject {
  // Resolve the supplied selection to verify supplier identity, data version and order.
  const expected = resolvePalette(colorSystem, palette.colors.map(color => color.id))
  if (pattern.paletteId !== palette.id || pattern.paletteVersion !== palette.version
    || palette.id !== expected.id || palette.version !== expected.version
    || palette.colors.some((color, index) => color.id !== expected.colors[index]?.id)) {
    throw new Error('当前图纸与色号品牌不一致，请重新生成后再保存')
  }
  const generation = pattern.sourceGeneration === null ? undefined
    : pattern.sourceGeneration ?? { config: pattern.generationConfig }
  const project: BeadProject = {
    id: identity.id, schemaVersion: CURRENT_SCHEMA_VERSION, createdAt: identity.createdAt,
    updatedAt, name: identity.name, grid: pattern.grid, paletteId: pattern.paletteId,
    paletteVersion: pattern.paletteVersion, paletteTable: pattern.paletteTable,
    ...(generation ? { generation } : {}),
  }
  return storeProjectEnvelope(project, colorSystem, palette, {
    ...(progress ? { progress } : {}), ...(workflow ? { workflow } : {}),
    ...(publishReview ? { publishReview } : {}), ...(cellProgress ? { cellProgress } : {}),
  }) as StoredPatternProject
}
export function restorePatternProject(input: unknown): RestoredPatternProject {
  return restoreProjectEnvelope(input, resolvePalette, options) as RestoredPatternProject
}
export function encodePatternProjectFile(project: StoredPatternProject): string {
  return encodeProjectEnvelope(project, resolvePalette, options)
}
export function parsePatternProjectFile(text: string): RestoredPatternProject {
  const normalized = text.replace(/^\uFEFF/, '').trim()
  if (!normalized) throw new ProjectImportError('invalid-json', '项目文件是空的')
  if (text.length > MAX_PROJECT_FILE_CHARACTERS) throw new ProjectImportError('invalid-project', '项目文件过大，无法在当前设备安全打开')
  let input: unknown
  try { input = JSON.parse(normalized) as unknown }
  catch (error) { throw new ProjectImportError('invalid-json', '项目文件不是有效的 JSON', error) }
  try { return restorePatternProject(input) }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (/unsupported stored project format/.test(detail)) throw new ProjectImportError('unsupported-format', '项目文件格式版本过新，当前版本无法打开', error)
    if (/unsupported schema version/.test(detail)) throw new ProjectImportError('unsupported-schema', '项目数据版本不受支持，请升级 PinBean 后重试', error)
    if (/palette identity is unavailable|references unavailable color|unknown palette color/.test(detail)) throw new ProjectImportError('palette-unavailable', '项目使用的色板版本当前不可用，无法安全还原颜色', error)
    throw new ProjectImportError('invalid-project', `项目文件内容损坏或不完整：${detail}`, error)
  }
}
