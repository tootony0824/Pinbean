<script setup lang="ts">
import { createCellProgress, syncCellProgressColors, hashPattern, hashPatternContent, type CellProgress, type NormalizedImage } from '@pinbean/bead-core'
import { COLOR_SYSTEMS, type ColorSystem } from '@pinbean/palette-data'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'

import { putImageOnCanvas } from '@/adapters/canvasAdapter'
import {
  chooseSingleImage,
  decodeImageFromCanvas,
  inspectImage,
  type SelectedImageInfo,
} from '@/adapters/imageAdapter'
import { loadLastProject, saveLastProject } from '@/adapters/projectStorage'
import {
  loadProjectHistory,
  saveProjectHistory,
} from '@/adapters/projectHistoryStorage'
import { chooseProjectFile, deliverProjectFile } from '@/adapters/projectFileAdapter'
import {
  loadProductionProgress,
} from '@/adapters/progressStorage'
import {
  canvasToPng,
  copyText,
  deliverPng,
  drawBoardAtlasCanvas,
  drawBoardExportCanvas,
  drawMaterialListCanvas,
  drawPatternExportCanvas,
  drawShareCoverCanvas,
} from '@/adapters/patternExportAdapter'
import { previewCellSize, renderPatternRgba } from '@/rendering/patternRenderer'
import {
  DEFAULT_PATTERN_SETTINGS,
  generatePattern,
  MAX_PATTERN_GRID_SIZE,
  MIN_PATTERN_GRID_SIZE,
  type PatternMode,
} from '@/services/generation'
import { gridIndexFromCanvasPoint } from '@/services/patternEditing'
import {
  buildBoardAtlasExportModel,
  buildBoardExportModel,
  buildBoardPlan,
  buildMaterialListExportModel,
  buildMaterialListText,
  buildPatternExportModel,
  DEFAULT_PATTERN_EXPORT_OPTIONS,
  type BoardPiece,
  type PatternExportOptions,
} from '@/services/patternExport'
import {
  encodePatternProjectFile,
  parsePatternProjectFile,
  PROJECT_FILE_EXTENSION,
  restorePatternProject,
  storePatternProject,
  type ProjectIdentity,
  type RestoredPatternProject,
  type StoredPatternProject,
} from '@/services/projectPersistence'
import {
  buildRecentProjectSummary,
  mergeRecentProjectHistory,
  PROJECT_HISTORY_FORMAT_VERSION,
  type RecentProjectRecord,
} from '@/services/projectHistory'
import {
  buildPublishReviewSummary,
  createPublishReview,
  formatPublishReviewMetrics,
  formatPublishReviewTime,
  type PublishReview,
} from '@/services/publishReview'
import {
  buildPublishKit,
  buildPublishPost,
  createProjectWorkflow,
  inferProjectType,
  PROJECT_TYPE_OPTIONS,
  type ProjectType,
  type PublishTone,
} from '@/services/publishing'
import {
  buildCraftAssessment,
  buildCraftPlanText,
  buildProgressReviewText,
} from '@/services/productionAssessment'
import { PRODUCTION_TIME_BASIS_TEXT } from '@/services/productionTime'
import {
  createProductionProgress,
  restoreProductionProgress,
  summarizeProductionProgress,
  toggleProductionBoard,
  toggleProductionColor,
  type ProductionProgress,
} from '@/services/productionProgress'
import { usePatternStore, type PatternStoreSnapshot } from '@/stores/pattern'
import { buildShareCoverExportModel } from '@/services/shareCoverExport'
import { commitCandidate, createProjectTransaction } from '@/services/projectTransaction'
import { createProgressCache } from '@/services/progressCache'

const SOURCE_CANVAS_ID = 'sourceDecodeCanvas'
const PATTERN_CANVAS_ID = 'patternPreviewCanvas'
const EXPORT_CANVAS_ID = 'patternExportCanvas'
const MAX_DECODE_PIXELS = 16_000_000

const patternStore = usePatternStore()
const { history, palette, pattern, statistics } = storeToRefs(patternStore)

type EditTool = 'paint' | 'erase' | 'fill' | 'replace' | 'pipette'
type PatternExportKind = 'legend' | 'plain'
type ExportPreviewMode = 'clean' | 'grid'

interface CanvasPoint {
  offsetX?: number
  offsetY?: number
  x?: number
  y?: number
}

interface CanvasTapEvent extends CanvasPoint {
  changedTouches?: CanvasPoint[]
  detail?: CanvasPoint
  touches?: CanvasPoint[]
}

interface CanvasRect {
  left: number
  top: number
}

interface PublishReviewDraft {
  comments: string
  conversions: string
  favorites: string
  likes: string
  note: string
  topic: string
}

const gridSize = ref(DEFAULT_PATTERN_SETTINGS.gridSize)
const similarityThreshold = ref(DEFAULT_PATTERN_SETTINGS.similarityThreshold)
const mode = ref<PatternMode>(DEFAULT_PATTERN_SETTINGS.mode)
const selectedColorSystem = ref<ColorSystem>(DEFAULT_PATTERN_SETTINGS.colorSystem)
const activePatternColorSystem = ref<ColorSystem | null>(null)
const projectType = ref<ProjectType>('gift')
const publishTone = ref<PublishTone>('showcase')
const isBusy = ref(false)
const statusText = ref('选择一张图片开始制作')
const persistenceWarning = ref('')
const previewWarning = ref('')
const progressCache = createProgressCache()
const runProjectTransaction = createProjectTransaction()
const sourceImage = ref<SelectedImageInfo | null>(null)
const sourceCanvasWidth = ref(1)
const sourceCanvasHeight = ref(1)
const previewCanvasWidth = ref(1)
const previewCanvasHeight = ref(1)
const exportCanvasWidth = ref(1)
const exportCanvasHeight = ref(1)
const isEditing = ref(false)
const editTool = ref<EditTool>('paint')
const selectedPaletteIndex = ref<number | null>(null)
const selectedColorId = ref<string | null>(null)
const showFullEditPalette = ref(false)
const exportPreviewMode = ref<ExportPreviewMode>('grid')
const exportSettings = ref<PatternExportOptions>({ ...DEFAULT_PATTERN_EXPORT_OPTIONS })
const exportSettingsDraft = ref<PatternExportOptions>({ ...DEFAULT_PATTERN_EXPORT_OPTIONS })
const showExportSettings = ref(false)
const savedProjectLabel = ref('')
const productionProgress = ref<ProductionProgress | null>(null)
const cellProgress = ref<CellProgress | undefined>(undefined)
const projectNameDraft = ref('')
const recentProjects = ref<RecentProjectRecord[]>([])
const publishReview = ref<PublishReview | null>(null)
const publishReviewDraft = ref<PublishReviewDraft>({
  comments: '0',
  conversions: '0',
  favorites: '0',
  likes: '0',
  note: '',
  topic: '',
})

const GRID_LINE_COLORS = [
  { label: '深灰色', value: '#555555' },
  { label: '红色', value: '#FF0000' },
  { label: '蓝色', value: '#0000FF' },
  { label: '绿色', value: '#008000' },
  { label: '紫色', value: '#800080' },
  { label: '橙色', value: '#FFA500' },
]

const PUBLISH_TONE_OPTIONS: { label: string, value: PublishTone }[] = [
  { label: '成品展示', value: 'showcase' },
  { label: '制作教程', value: 'tutorial' },
  { label: '挑战记录', value: 'challenge' },
]

let decodedImage: NormalizedImage | null = null
let activeProjectIdentity: ProjectIdentity | null = null
const restorableProject = shallowRef<RestoredPatternProject | null>(null)

interface PageStateSnapshot {
  cellProgress: CellProgress | undefined
  gridSize: number
  similarityThreshold: number
  mode: PatternMode
  projectType: ProjectType
  selectedColorSystem: ColorSystem
  publishReviewDraft: PublishReviewDraft
  previewCanvasWidth: number
  previewCanvasHeight: number
  savedProjectLabel: string
  restorableProject: RestoredPatternProject | null
  persistenceWarning: string
  activePatternColorSystem: ColorSystem | null
  activeProjectIdentity: ProjectIdentity | null
  decodedImage: NormalizedImage | null
  isEditing: boolean
  productionProgress: ProductionProgress | null
  projectNameDraft: string
  publishReview: PublishReview | null
  selectedColorId: string | null
  selectedPaletteIndex: number | null
  sourceCanvasHeight: number
  sourceCanvasWidth: number
  sourceImage: SelectedImageInfo | null
  store: PatternStoreSnapshot
}

function capturePageState(): PageStateSnapshot {
  if (activeProjectIdentity && productionProgress.value) {
    progressCache.set(activeProjectIdentity.id, { ...productionProgress.value, cellProgress: cellProgress.value })
  }
  return {
    cellProgress: cellProgress.value,
    gridSize: gridSize.value,
    similarityThreshold: similarityThreshold.value,
    mode: mode.value,
    projectType: projectType.value,
    selectedColorSystem: selectedColorSystem.value,
    publishReviewDraft: { ...publishReviewDraft.value },
    previewCanvasWidth: previewCanvasWidth.value,
    previewCanvasHeight: previewCanvasHeight.value,
    savedProjectLabel: savedProjectLabel.value,
    restorableProject: restorableProject.value,
    persistenceWarning: persistenceWarning.value,
    activePatternColorSystem: activePatternColorSystem.value,
    activeProjectIdentity,
    decodedImage,
    isEditing: isEditing.value,
    productionProgress: productionProgress.value,
    projectNameDraft: projectNameDraft.value,
    publishReview: publishReview.value,
    selectedColorId: selectedColorId.value,
    selectedPaletteIndex: selectedPaletteIndex.value,
    sourceCanvasHeight: sourceCanvasHeight.value,
    sourceCanvasWidth: sourceCanvasWidth.value,
    sourceImage: sourceImage.value,
    store: patternStore.snapshot(),
  }
}

async function restorePageState(snapshot: PageStateSnapshot, repaint = true): Promise<void> {
  cellProgress.value = snapshot.cellProgress
  gridSize.value = snapshot.gridSize
  similarityThreshold.value = snapshot.similarityThreshold
  mode.value = snapshot.mode
  projectType.value = snapshot.projectType
  selectedColorSystem.value = snapshot.selectedColorSystem
  publishReviewDraft.value = snapshot.publishReviewDraft
  previewCanvasWidth.value = snapshot.previewCanvasWidth
  previewCanvasHeight.value = snapshot.previewCanvasHeight
  savedProjectLabel.value = snapshot.savedProjectLabel
  restorableProject.value = snapshot.restorableProject
  persistenceWarning.value = snapshot.persistenceWarning
  patternStore.restore(snapshot.store)
  activePatternColorSystem.value = snapshot.activePatternColorSystem
  activeProjectIdentity = snapshot.activeProjectIdentity
  decodedImage = snapshot.decodedImage
  isEditing.value = snapshot.isEditing
  productionProgress.value = snapshot.productionProgress
  projectNameDraft.value = snapshot.projectNameDraft
  publishReview.value = snapshot.publishReview
  selectedColorId.value = snapshot.selectedColorId
  selectedPaletteIndex.value = snapshot.selectedPaletteIndex
  sourceCanvasHeight.value = snapshot.sourceCanvasHeight
  sourceCanvasWidth.value = snapshot.sourceCanvasWidth
  sourceImage.value = snapshot.sourceImage
  if (repaint && pattern.value && palette.value) {
    try {
      await renderCurrentPattern()
    } catch {
      previewWarning.value = '原项目数据已恢复，但预览不可用，请重试'
    }
  }
}

const modeLabel = computed(() => mode.value === 'cartoon' ? '轮廓模式' : '细腻模式')
const currentColorSystemLabel = computed(() => activePatternColorSystem.value ?? selectedColorSystem.value)
const hasPendingColorSystemChange = computed(() => Boolean(
  pattern.value && activePatternColorSystem.value && selectedColorSystem.value !== activePatternColorSystem.value,
))
const canUndo = computed(() => (history.value?.undoStack.length ?? 0) > 0)
const canRedo = computed(() => (history.value?.redoStack.length ?? 0) > 0)
const canRestoreProject = computed(() => Boolean(restorableProject.value) && !pattern.value)
const sourceDescription = computed(() => {
  if (!sourceImage.value) return ''
  const megapixels = sourceImage.value.width * sourceImage.value.height / 1_000_000
  return `${sourceImage.value.width} × ${sourceImage.value.height} · ${megapixels.toFixed(1)} MP`
})
const usedColors = computed(() => {
  if (!statistics.value || !pattern.value || !palette.value) return []
  const colorsById = new Map(palette.value.colors.map(color => [color.id, color]))
  return statistics.value.colors.map(item => {
    const id = pattern.value?.paletteTable[item.paletteIndex]
    const color = id ? colorsById.get(id) : undefined
    return {
      colorId: id ?? '',
      code: color?.code ?? '?',
      completed: id ? productionProgress.value?.completedColorIds.includes(id) ?? false : false,
      count: item.count,
      hex: color?.hex ?? '#FFFFFF',
      paletteIndex: item.paletteIndex,
    }
  })
})
const fullEditPalette = computed(() => {
  if (!palette.value || !pattern.value) return []
  const indexById = new Map(pattern.value.paletteTable.map((id, index) => [id, index]))
  return palette.value.colors.map(color => ({
    ...color,
    paletteIndex: indexById.get(color.id) ?? null,
  }))
})
const boardPlan = computed(() => {
  if (!pattern.value || !palette.value) return null
  return buildBoardPlan(pattern.value, palette.value)
})
const craftAssessment = computed(() => {
  if (!pattern.value || !palette.value || !boardPlan.value) return null
  return buildCraftAssessment(pattern.value, palette.value, boardPlan.value)
})
const hasMultipleBoards = computed(() => (boardPlan.value?.count ?? 0) > 1)
const productionSummary = computed(() => {
  if (!pattern.value || !boardPlan.value || !productionProgress.value) return null
  if (productionProgress.value.patternHash !== hashPatternContent(pattern.value)) return null
  return summarizeProductionProgress(pattern.value, boardPlan.value, productionProgress.value)
})
const completedBoardIds = computed(() => new Set(productionProgress.value?.completedBoardIds ?? []))
const pendingBoardPieces = computed(() => boardPlan.value?.pieces.filter(
  piece => !completedBoardIds.value.has(piece.id),
) ?? [])

function selectExportPreviewMode(nextMode: ExportPreviewMode): void {
  exportPreviewMode.value = nextMode
  exportSettings.value = {
    ...exportSettings.value,
    showGrid: nextMode === 'grid',
  }
}

function openExportSettings(): void {
  exportSettingsDraft.value = { ...exportSettings.value }
  showExportSettings.value = true
}

function closeExportSettings(): void {
  showExportSettings.value = false
}

function saveExportSettings(): void {
  exportSettings.value = { ...exportSettingsDraft.value }
  exportPreviewMode.value = exportSettings.value.showGrid ? 'grid' : 'clean'
  showExportSettings.value = false
  statusText.value = '导出设置已保存'
}

function updateExportBoolean(
  key: 'includeStats' | 'showCellNumbers' | 'showCoordinates' | 'showGrid',
  event: Event,
): void {
  const value = (event as CustomEvent<{ value: boolean }>).detail?.value
  exportSettingsDraft.value = {
    ...exportSettingsDraft.value,
    [key]: Boolean(value),
  }
}

function updateExportGridInterval(event: { detail: { value: number } }): void {
  exportSettingsDraft.value = {
    ...exportSettingsDraft.value,
    gridInterval: Number(event.detail.value),
  }
}

function selectExportGridColor(value: string): void {
  exportSettingsDraft.value = {
    ...exportSettingsDraft.value,
    gridLineColor: value,
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function selectMode(nextMode: PatternMode): void {
  if (isBusy.value) return
  mode.value = nextMode
}

function selectColorSystem(nextSystem: ColorSystem): void {
  if (isBusy.value) return
  selectedColorSystem.value = nextSystem
  statusText.value = decodedImage
    ? `已切换到 ${nextSystem} 色板，请按当前设置重新生成`
    : `已选择 ${nextSystem} 色板`
}

function selectProjectType(nextType: ProjectType): void {
  if (isBusy.value) return
  const option = PROJECT_TYPE_OPTIONS.find(item => item.value === nextType)
  if (!option) return
  projectType.value = nextType
  gridSize.value = option.gridSize
  mode.value = option.mode
  if (pattern.value) persistCurrentProjectSafely()
  statusText.value = pattern.value
    ? `发布用途已切换为${option.label}；尺寸和模式将在重新生成后生效`
    : `已应用${option.label}预设 · ${option.gridSize} 格 · ${option.mode === 'cartoon' ? '轮廓模式' : '细腻模式'}`
}

function onGridSizeChange(event: { detail: { value: number } }): void {
  if (isBusy.value) return
  gridSize.value = Number(event.detail.value)
}

function onSimilarityChange(event: { detail: { value: number } }): void {
  if (isBusy.value) return
  similarityThreshold.value = Number(event.detail.value)
}

function editToolLabel(tool: EditTool): string {
  return ({ paint: '画笔', erase: '橡皮', fill: '填充', replace: '整色替换', pipette: '吸管' })[tool]
}

function projectNameFromSource(): string {
  const filename = sourceImage.value?.name ?? sourceImage.value?.path.split('/').pop()
  if (!filename || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:\.[^.]+)?$/i.test(filename)) {
    return '我的拼豆图纸'
  }
  return filename?.replace(/\.[^.]+$/, '') || '我的拼豆图纸'
}

function projectSummary(restored: RestoredPatternProject): string {
  return `${restored.project.name} · ${restored.pattern.grid.width} × ${restored.pattern.grid.height} · ${restored.statistics.total} 颗`
}

function boardMainColorSummary(piece: BoardPiece): string {
  return piece.colors.slice(0, 3).map(color => `${color.code} ${color.count}`).join('、')
}

function currentProjectName(): string {
  return activeProjectIdentity?.name ?? projectNameFromSource()
}

function currentPatternColorSystem(): ColorSystem {
  if (!pattern.value) return selectedColorSystem.value
  const active = activePatternColorSystem.value
  if (!active || !palette.value
    || palette.value.id !== `pinbean:supplier:${active}`
    || pattern.value.paletteId !== palette.value.id
    || pattern.value.paletteVersion !== palette.value.version) {
    throw new Error('当前图纸与色号品牌不一致，请重新生成后再操作')
  }
  return active
}

function updateProjectNameDraft(event: Event): void {
  if (isBusy.value) return
  const value = (event as CustomEvent<{ value: string }>).detail?.value
  projectNameDraft.value = String(value ?? '')
}

function ensureProjectIdentity(timestamp = Date.now()): ProjectIdentity {
  activeProjectIdentity ??= {
    id: `project-${timestamp.toString(36)}`,
    createdAt: timestamp,
    name: projectNameFromSource(),
  }
  return activeProjectIdentity
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'pinbean-pattern'
}

function buildCurrentStoredProject(updatedAt = Date.now(), progress = productionProgress.value, cells = cellProgress.value): StoredPatternProject {
  if (!pattern.value) throw new Error('请先生成或导入图纸')
  return storePatternProject(
    pattern.value,
    currentPatternColorSystem(),
    ensureProjectIdentity(updatedAt),
    updatedAt,
    progress ?? undefined,
    createProjectWorkflow(projectType.value),
    publishReview.value ?? undefined,
    palette.value ?? undefined,
    cells,
  )
}

function syncPublishReviewDraft(review: PublishReview | null): void {
  publishReviewDraft.value = {
    comments: String(review?.comments ?? 0),
    conversions: String(review?.conversions ?? 0),
    favorites: String(review?.favorites ?? 0),
    likes: String(review?.likes ?? 0),
    note: review?.note ?? '',
    topic: review?.topic ?? currentProjectName(),
  }
}

function updatePublishReviewDraft(key: keyof PublishReviewDraft, event: Event): void {
  if (isBusy.value) return
  const value = (event as CustomEvent<{ value: string }>).detail?.value
  publishReviewDraft.value = {
    ...publishReviewDraft.value,
    [key]: String(value ?? ''),
  }
}

function parseReviewCount(value: string, label: string): number {
  const normalized = value.trim()
  if (!normalized) return 0
  if (!/^\d+$/.test(normalized)) throw new Error(`${label}必须是 0 或正整数`)
  const count = Number(normalized)
  if (!Number.isSafeInteger(count)) throw new Error(`${label}数值过大`)
  return count
}

function initializeProductionProgress(imported?: ProductionProgress, importedCells?: CellProgress, activating = false): void {
  if (!pattern.value || !palette.value || !boardPlan.value) {
    productionProgress.value = null
    cellProgress.value = undefined
    return
  }
  const identity = ensureProjectIdentity()
  const cached = activating ? undefined : progressCache.get(identity.id, hashPatternContent(pattern.value))
  cellProgress.value = activating ? importedCells : cached?.cellProgress
  const colorIds = new Set(pattern.value.paletteTable.slice(1))
  const boardIds = new Set(boardPlan.value.pieces.map(piece => piece.id))
  if (imported !== undefined) {
    const restored = restoreProductionProgress(
      loadProductionProgress(identity.id, pattern.value, imported),
      pattern.value,
      colorIds,
      boardIds,
      hashPattern(pattern.value),
    )
    productionProgress.value = restored
    return
  }

  let next: ProductionProgress
  try {
    const stored = cached
      ?? loadProductionProgress(identity.id, pattern.value)
    next = stored
      ? restoreProductionProgress(stored, pattern.value, colorIds, boardIds, hashPattern(pattern.value))
      : createProductionProgress(pattern.value)
  } catch (error) {
    next = createProductionProgress(pattern.value)
    productionProgress.value = next
    const message = error instanceof Error ? error.message : '制作进度恢复失败'
    statusText.value = `检测到无法恢复的制作进度，已保留原记录并从空进度开始：${message}`
    uni.showToast({ title: '旧制作进度已保留，当前从空进度开始', icon: 'none', duration: 3500 })
    return
  }
  productionProgress.value = next
}

function persistProductionProgress(candidate: ProductionProgress, reset = false): void {
  if (!pattern.value) return
  const identity = ensureProjectIdentity()
  const cells = reset ? createCellProgress(identity.id, pattern.value, [], candidate.updatedAt)
    : syncCellProgressColors(cellProgress.value, identity.id, pattern.value,
      productionProgress.value?.completedColorIds ?? [], candidate.completedColorIds, candidate.updatedAt)
  commitCandidate(candidate,
    progress => saveLastProject(buildCurrentStoredProject(Date.now(), progress, cells)),
    progress => { productionProgress.value = progress; cellProgress.value = cells },
  )
  afterProjectCommit(Date.now())
}

function persistCurrentProject(): void {
  if (!pattern.value) return
  const stored = buildCurrentStoredProject()
  saveLastProject(stored)
  savedProjectLabel.value = `${stored.project.name} · ${pattern.value.grid.width} × ${pattern.value.grid.height}`
  afterProjectCommit(stored.project.updatedAt)
}

function afterProjectCommit(updatedAt: number): void {
  persistenceWarning.value = ''
  if (productionProgress.value) progressCache.set(ensureProjectIdentity().id, { ...productionProgress.value, cellProgress: cellProgress.value })
  try { updateRecentProjectHistory(updatedAt) } catch { warnHistoryFailure() }
}

function warnHistoryFailure(): void {
  persistenceWarning.value = '项目已保存，但最近制作摘要更新失败'
}

function updateRecentProjectHistory(updatedAt: number): void {
  if (!pattern.value || !statistics.value || !craftAssessment.value || !activeProjectIdentity) return
  const summary = productionSummary.value
  const next = mergeRecentProjectHistory(recentProjects.value, {
    boardPercent: summary?.boardPercent ?? 0,
    colorCount: statistics.value.colors.length,
    colorPercent: summary?.colorPercent ?? 0,
    difficulty: craftAssessment.value.level,
    formatVersion: PROJECT_HISTORY_FORMAT_VERSION,
    height: pattern.value.grid.height,
    patternHash: hashPatternContent(pattern.value),
    projectId: activeProjectIdentity.id,
    projectName: activeProjectIdentity.name,
    projectType: projectType.value,
    ...(publishReview.value ? { publishReview: publishReview.value } : {}),
    totalBeads: statistics.value.total,
    updatedAt,
    width: pattern.value.grid.width,
  })
  saveProjectHistory(next)
  recentProjects.value = next
}

function persistCurrentProjectSafely(): void {
  try {
    persistCurrentProject()
  } catch {
    persistenceWarning.value = '当前修改未保存，请重试保存或导出项目'
    uni.showToast({ title: '图纸已修改，但自动保存失败', icon: 'none', duration: 3000 })
  }
}

async function renderCurrentPattern(): Promise<void> {
  if (!pattern.value || !palette.value) throw new Error('请先生成图纸')
  const cellSize = previewCellSize(pattern.value)
  const preview = renderPatternRgba(pattern.value, palette.value, { cellSize })
  previewCanvasWidth.value = preview.width
  previewCanvasHeight.value = preview.height
  await nextTick()
  await delay(20)
  await putImageOnCanvas(PATTERN_CANVAS_ID, preview)
  previewWarning.value = ''
}

async function generateAndRender(rollbackState = capturePageState()): Promise<void> {
  if (!decodedImage) throw new Error('请先选择图片')
  statusText.value = '正在生成拼豆图纸…'
  const result = generatePattern(decodedImage, {
    colorSystem: selectedColorSystem.value,
    gridSize: gridSize.value,
    mode: mode.value,
    similarityThreshold: similarityThreshold.value,
  })
  try {
    patternStore.setGeneratedResult(result.pattern, result.palette, result.statistics)
    const firstPaletteIndex = result.statistics.colors[0]?.paletteIndex ?? null
    selectedPaletteIndex.value = firstPaletteIndex
    selectedColorId.value = firstPaletteIndex === null ? null : result.pattern.paletteTable[firstPaletteIndex] ?? null
    isEditing.value = false
    await renderCurrentPattern()
    activePatternColorSystem.value = selectedColorSystem.value
    initializeProductionProgress()
    projectNameDraft.value = currentProjectName()
    syncPublishReviewDraft(publishReview.value)
    persistCurrentProject()
    statusText.value = `${result.pattern.grid.width} × ${result.pattern.grid.height} · ${result.statistics.total} 颗 · ${result.statistics.colors.length} 色`
  } catch (error) {
    await restorePageState(rollbackState)
    throw error
  }
}

function toggleEditing(): void {
  if (isBusy.value) return
  isEditing.value = !isEditing.value
  if (isEditing.value && selectedColorId.value === null) {
    const firstPaletteIndex = statistics.value?.colors[0]?.paletteIndex ?? null
    selectedPaletteIndex.value = firstPaletteIndex
    selectedColorId.value = firstPaletteIndex === null ? null : pattern.value?.paletteTable[firstPaletteIndex] ?? null
  }
  statusText.value = isEditing.value
    ? `编辑模式 · ${editToolLabel(editTool.value)}`
    : `${pattern.value?.grid.width ?? 0} × ${pattern.value?.grid.height ?? 0} · ${statistics.value?.total ?? 0} 颗`
}

function selectEditTool(tool: EditTool): void {
  if (isBusy.value) return
  editTool.value = tool
  statusText.value = `编辑模式 · ${editToolLabel(tool)}`
}

function selectEditColor(paletteIndex: number): void {
  if (isBusy.value) return
  selectedPaletteIndex.value = paletteIndex
  selectedColorId.value = pattern.value?.paletteTable[paletteIndex] ?? null
}

function selectFullEditColor(colorId: string): void {
  if (isBusy.value) return
  selectedColorId.value = colorId
  selectedPaletteIndex.value = patternStore.ensureColor(colorId)
  const selected = palette.value?.colors.find(color => color.id === colorId)
  statusText.value = selected ? `画笔颜色 · ${selected.code}` : '画笔颜色已更新'
}

function syncSelectedPaletteIndexFromColorId(): void {
  if (!selectedColorId.value) {
    selectedPaletteIndex.value = null
    return
  }
  const nextIndex = pattern.value?.paletteTable.indexOf(selectedColorId.value) ?? -1
  selectedPaletteIndex.value = nextIndex > 0 ? nextIndex : null
}

function localTouchPoint(event: CanvasTapEvent): CanvasPoint | null {
  const candidates = [event.changedTouches?.[0], event.touches?.[0], event]
  for (const point of candidates) {
    const x = point?.offsetX ?? point?.x
    const y = point?.offsetY ?? point?.y
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y }
  }
  return null
}

function editLayerRect(): Promise<CanvasRect> {
  return new Promise((resolve, reject) => {
    uni.createSelectorQuery()
      .select('.edit-hit-layer')
      .boundingClientRect(result => {
        const rect = Array.isArray(result) ? result[0] : result
        if (!rect || typeof rect.left !== 'number' || typeof rect.top !== 'number') {
          reject(new Error('无法读取图纸位置'))
          return
        }
        resolve({ left: rect.left, top: rect.top })
      })
      .exec()
  })
}

async function canvasPoint(event: CanvasTapEvent): Promise<CanvasPoint | null> {
  const touch = localTouchPoint({
    changedTouches: event.changedTouches,
    touches: event.touches,
  })
  if (touch) return touch

  const clientX = event.detail?.x ?? event.x
  const clientY = event.detail?.y ?? event.y
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null
  const rect = await editLayerRect()
  return { x: Number(clientX) - rect.left, y: Number(clientY) - rect.top }
}

async function handleCanvasTap(event: Event): Promise<void> {
  if (!isEditing.value || !pattern.value || isBusy.value) return
  const rollbackState = capturePageState()
  isBusy.value = true
  try {
  const point = await canvasPoint(event as unknown as CanvasTapEvent)
  if (!point || point.x === undefined || point.y === undefined) {
    statusText.value = '无法识别触点位置'
    uni.showToast({ title: '无法识别触点位置', icon: 'none' })
    return
  }
  const index = gridIndexFromCanvasPoint(
    pattern.value,
    previewCanvasWidth.value,
    previewCanvasHeight.value,
    point.x,
    point.y,
  )
  if (index === null) {
    statusText.value = '触点超出图纸范围'
    return
  }

    const targetColorId = selectedColorId.value
    let changed = 0
    if (editTool.value === 'pipette') {
      const pickedPaletteIndex = pattern.value.grid.cells[index] ?? 0
      if (pickedPaletteIndex === 0) throw new Error('空白格没有可吸取的颜色')
      selectedPaletteIndex.value = pickedPaletteIndex
      selectedColorId.value = pattern.value.paletteTable[pickedPaletteIndex] ?? null
      statusText.value = '已吸取当前格颜色'
      return
    }
    if (editTool.value === 'erase') {
      changed = patternStore.erase(index)
    } else {
      if (targetColorId === null) throw new Error('请先选择一个颜色')
      if (editTool.value === 'paint') changed = patternStore.paint(index, targetColorId)
      if (editTool.value === 'fill') changed = patternStore.fill(index, targetColorId)
      if (editTool.value === 'replace') {
        const sourcePaletteIndex = pattern.value.grid.cells[index] ?? 0
        if (sourcePaletteIndex === 0) throw new Error('空白格不能作为整色替换来源')
        const sourceColorId = pattern.value.paletteTable[sourcePaletteIndex]
        if (!sourceColorId) throw new Error('来源颜色不可用')
        changed = patternStore.replace(sourceColorId, targetColorId)
      }
    }
    if (changed > 0) {
      syncSelectedPaletteIndexFromColorId()
      await renderCurrentPattern()
      initializeProductionProgress()
      persistCurrentProjectSafely()
    }
    statusText.value = changed > 0
      ? `${editToolLabel(editTool.value)}已修改 ${changed} 格`
      : '当前操作没有产生变化'
  } catch (error) {
    await restorePageState(rollbackState)
    const message = error instanceof Error ? error.message : '编辑失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none' })
  } finally {
    isBusy.value = false
  }
}

async function handleCanvasDrag(event: Event): Promise<void> {
  if (editTool.value !== 'paint' && editTool.value !== 'erase') return
  await handleCanvasTap(event)
}

async function handleHistory(direction: 'undo' | 'redo'): Promise<void> {
  if (isBusy.value) return
  const rollbackState = capturePageState()
  isBusy.value = true
  try {
    const changed = direction === 'undo' ? patternStore.undo() : patternStore.redo()
    if (changed > 0) {
      syncSelectedPaletteIndexFromColorId()
      await renderCurrentPattern()
      initializeProductionProgress()
      persistCurrentProjectSafely()
    }
    statusText.value = changed > 0
      ? `${direction === 'undo' ? '已撤销' : '已重做'} ${changed} 格`
      : direction === 'undo' ? '没有可撤销的操作' : '没有可重做的操作'
  } catch (error) {
    await restorePageState(rollbackState)
    const message = error instanceof Error ? error.message : '历史操作失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none' })
  } finally {
    isBusy.value = false
  }
}

async function handleRemoveBackground(): Promise<void> {
  if (isBusy.value) return
  const rollbackState = capturePageState()
  isBusy.value = true
  try {
    const result = patternStore.removeBackground()
    if (result.changed > 0) {
      await renderCurrentPattern()
      initializeProductionProgress()
      persistCurrentProjectSafely()
    }
    statusText.value = result.changed > 0
      ? `已去背景 ${result.changed} 格`
      : '未识别到可移除的外部背景'
    if (result.changed === 0) {
      uni.showToast({ title: statusText.value, icon: 'none' })
    }
  } catch (error) {
    await restorePageState(rollbackState)
    const message = error instanceof Error ? error.message : '去背景失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none' })
  } finally {
    isBusy.value = false
  }
}

async function handleChooseImage(): Promise<void> {
  if (isBusy.value) return
  const rollbackState = capturePageState()
  isBusy.value = true
  statusText.value = '正在读取图片…'
  try {
    const selected = await chooseSingleImage()
    const inspected = await inspectImage(selected)
    if (inspected.width * inspected.height > MAX_DECODE_PIXELS) {
      throw new Error('图片分辨率过高，请先在系统相册中裁剪或压缩到 1600 万像素以内')
    }
    sourceImage.value = inspected
    activeProjectIdentity = null
    publishReview.value = null
    sourceCanvasWidth.value = inspected.width
    sourceCanvasHeight.value = inspected.height
    await nextTick()
    await delay(30)
    decodedImage = await decodeImageFromCanvas(SOURCE_CANVAS_ID, inspected)
    await generateAndRender(rollbackState)
  } catch (error) {
    await restorePageState(rollbackState, false)
    console.error(
      '[PinBean] image processing failed',
      error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : error,
    )
    const message = error instanceof Error ? error.message : '图片处理失败'
    if (!/cancel/i.test(message)) {
      statusText.value = message
      uni.showToast({ title: message, icon: 'none', duration: 3000 })
    } else {
      statusText.value = pattern.value ? '已保留当前图纸' : '选择一张图片开始制作'
    }
  } finally {
    isBusy.value = false
  }
}

async function activateProject(restored: RestoredPatternProject, commitImport = true): Promise<void> {
  await runProjectTransaction({
    capture: capturePageState,
    activate: () => {
    patternStore.setGeneratedResult(restored.pattern, restored.palette, restored.statistics)
    activeProjectIdentity = {
      id: restored.project.id,
      createdAt: restored.project.createdAt,
      name: restored.project.name,
    }
    decodedImage = null
    sourceImage.value = null
    gridSize.value = restored.pattern.generationConfig.targetGrid.size
    mode.value = restored.pattern.generationConfig.mode
    projectType.value = restored.workflow?.projectType ?? inferProjectType(
      restored.pattern.generationConfig.targetGrid.size,
      restored.pattern.generationConfig.mode,
    )
    selectedColorSystem.value = restored.colorSystem
    activePatternColorSystem.value = restored.colorSystem
    projectNameDraft.value = restored.project.name
    publishReview.value = restored.publishReview ?? null
    syncPublishReviewDraft(publishReview.value)
    similarityThreshold.value = restored.pattern.generationConfig.similarityMerge.threshold
    const restoredFirstPaletteIndex = restored.statistics.colors[0]?.paletteIndex ?? null
    selectedPaletteIndex.value = restoredFirstPaletteIndex
    selectedColorId.value = restoredFirstPaletteIndex === null ? null : restored.pattern.paletteTable[restoredFirstPaletteIndex] ?? null
    isEditing.value = false
    initializeProductionProgress(restored.progress, restored.cellProgress, true)
    },
    render: renderCurrentPattern,
    save: () => {
      if (commitImport) saveLastProject(buildCurrentStoredProject(restored.project.updatedAt))
    },
    restore: restorePageState,
    afterCommit: () => {
      restorableProject.value = null
      savedProjectLabel.value = projectSummary(restored)
      if (commitImport) afterProjectCommit(restored.project.updatedAt)
      else {
        persistenceWarning.value = ''
        if (productionProgress.value) progressCache.set(restored.project.id, { ...productionProgress.value, cellProgress: cellProgress.value })
      }
    },
    warn: warnHistoryFailure,
  })
}

async function handleRestoreProject(): Promise<void> {
  if (!restorableProject.value || isBusy.value) return
  isBusy.value = true
  try {
    const restored = restorableProject.value
    await activateProject(restored, false)
    statusText.value = `已恢复 ${restored.pattern.grid.width} × ${restored.pattern.grid.height} · ${restored.statistics.total} 颗`
  } catch (error) {
    const message = error instanceof Error ? error.message : '恢复图纸失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none', duration: 3000 })
  } finally {
    isBusy.value = false
  }
}

function handleToggleProductionColor(colorId: string): void {
  if (isBusy.value || !productionProgress.value || !pattern.value || !colorId) return
  try {
    const candidate = toggleProductionColor(
      productionProgress.value,
      colorId,
      new Set(pattern.value.paletteTable.slice(1)),
    )
    persistProductionProgress(candidate)
    const summary = productionSummary.value
    statusText.value = summary
      ? `制作进度 ${summary.completedColors}/${summary.totalColors} 色 · ${summary.colorPercent}%`
      : '制作进度已更新'
  } catch (error) {
    const message = error instanceof Error ? error.message : '更新颜色进度失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none' })
  }
}

function handleToggleProductionBoard(boardId: string): void {
  if (isBusy.value || !productionProgress.value || !boardPlan.value) return
  try {
    const candidate = toggleProductionBoard(
      productionProgress.value,
      boardId,
      new Set(boardPlan.value.pieces.map(piece => piece.id)),
    )
    persistProductionProgress(candidate)
    const summary = productionSummary.value
    statusText.value = summary
      ? `分板进度 ${summary.completedBoards}/${summary.totalBoards} · ${summary.boardPercent}%`
      : '分板进度已更新'
  } catch (error) {
    const message = error instanceof Error ? error.message : '更新分板进度失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none' })
  }
}

function handleResetProductionProgress(): void {
  if (isBusy.value || !pattern.value) return
  try {
    persistProductionProgress(createProductionProgress(pattern.value), true)
    statusText.value = '制作进度已重置'
  } catch (error) {
    statusText.value = error instanceof Error ? error.message : '重置失败，已保留原进度'
    uni.showToast({ title: '重置失败，已保留原进度', icon: 'none' })
  }
}

async function handleExportProjectFile(): Promise<void> {
  if (!pattern.value || isBusy.value) return
  isBusy.value = true
  statusText.value = '正在生成项目文件…'
  try {
    const stored = buildCurrentStoredProject()
    const text = encodePatternProjectFile(stored)
    saveLastProject(stored)
    afterProjectCommit(stored.project.updatedAt)
    const fileName = `${safeFileName(stored.project.name)}${PROJECT_FILE_EXTENSION}`
    const delivery = await deliverProjectFile(text, fileName)
    statusText.value = delivery === 'share' ? '项目文件已打开分享' : '项目文件已下载'
    uni.showToast({ title: statusText.value, icon: 'success' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出项目文件失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none', duration: 3000 })
  } finally {
    isBusy.value = false
  }
}

async function handleImportProjectFile(): Promise<void> {
  if (isBusy.value) return
  isBusy.value = true
  statusText.value = '正在读取项目文件…'
  try {
    const selected = await chooseProjectFile()
    const restored = parsePatternProjectFile(selected.text)
    await activateProject(restored)
    statusText.value = `已导入 ${restored.project.name} · ${restored.pattern.grid.width} × ${restored.pattern.grid.height} · ${restored.statistics.total} 颗`
    uni.showToast({ title: '项目文件已导入', icon: 'success' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '导入项目文件失败'
    if (!/cancel/i.test(message)) {
      statusText.value = message
      uni.showToast({ title: message, icon: 'none', duration: 3500 })
    } else {
      statusText.value = pattern.value ? '已保留当前图纸' : '选择一张图片或导入项目文件'
    }
  } finally {
    isBusy.value = false
  }
}

onMounted(() => {
  try {
    recentProjects.value = loadProjectHistory()
  } catch {
    recentProjects.value = []
  }
  try {
    const stored = loadLastProject()
    if (!stored) return
    restorableProject.value = restorePatternProject(stored)
    savedProjectLabel.value = projectSummary(restorableProject.value)
  } catch {
    statusText.value = '检测到无法恢复的旧图纸，请重新选择图片'
  }
})

function formatRecentProjectTime(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '刚刚'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function handleSaveProjectName(): void {
  if (!pattern.value || isBusy.value) return
  const name = projectNameDraft.value.trim().slice(0, 40)
  if (!name) {
    uni.showToast({ title: '作品名称不能为空', icon: 'none' })
    return
  }
  const identity = ensureProjectIdentity()
  activeProjectIdentity = { ...identity, name }
  projectNameDraft.value = name
  persistCurrentProjectSafely()
  statusText.value = '作品名称已保存'
}

async function handleCopyRecentProject(record: RecentProjectRecord): Promise<void> {
  if (isBusy.value) return
  isBusy.value = true
  try {
    await copyText(buildRecentProjectSummary(record))
    statusText.value = '作品摘要已复制'
  } catch (error) {
    const message = error instanceof Error ? error.message : '复制作品摘要失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none' })
  } finally {
    isBusy.value = false
  }
}

function handleDeleteRecentProject(projectId: string): void {
  if (isBusy.value) return
  recentProjects.value = recentProjects.value.filter(record => record.projectId !== projectId)
  saveProjectHistory(recentProjects.value)
  statusText.value = '最近制作记录已删除'
}

function handleSavePublishReview(): void {
  if (!pattern.value || isBusy.value) return
  try {
    const now = Date.now()
    publishReview.value = createPublishReview({
      comments: parseReviewCount(publishReviewDraft.value.comments, '评论'),
      conversions: parseReviewCount(publishReviewDraft.value.conversions, '转化'),
      favorites: parseReviewCount(publishReviewDraft.value.favorites, '收藏'),
      likes: parseReviewCount(publishReviewDraft.value.likes, '点赞'),
      note: publishReviewDraft.value.note,
      publishedAt: publishReview.value?.publishedAt ?? now,
      topic: publishReviewDraft.value.topic,
      updatedAt: now,
    })
    syncPublishReviewDraft(publishReview.value)
    persistCurrentProject()
    statusText.value = '发布复盘已保存'
    uni.showToast({ title: statusText.value, icon: 'success' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存发布复盘失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none' })
  }
}

function handleClearPublishReview(): void {
  if (!pattern.value || isBusy.value) return
  publishReview.value = null
  syncPublishReviewDraft(null)
  persistCurrentProjectSafely()
  statusText.value = '发布复盘已清空'
}

async function handleCopyPublishReview(): Promise<void> {
  if (!publishReview.value || isBusy.value) return
  isBusy.value = true
  try {
    await copyText(buildPublishReviewSummary(currentProjectName(), publishReview.value))
    statusText.value = '发布复盘摘要已复制'
  } catch (error) {
    const message = error instanceof Error ? error.message : '复制发布复盘失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none' })
  } finally {
    isBusy.value = false
  }
}

async function handleRegenerate(): Promise<void> {
  if (!decodedImage || isBusy.value) return
  isBusy.value = true
  try {
    await generateAndRender()
  } catch (error) {
    const message = error instanceof Error ? error.message : '重新生成失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none', duration: 3000 })
  } finally {
    isBusy.value = false
  }
}

async function handleExportPattern(kind: PatternExportKind): Promise<void> {
  if (!pattern.value || !palette.value || isBusy.value) return
  isBusy.value = true
  statusText.value = '正在生成高清图纸…'
  try {
    const model = buildPatternExportModel(
      pattern.value,
      palette.value,
      currentPatternColorSystem(),
      currentProjectName(),
      {
        ...exportSettings.value,
        includeStats: kind === 'legend' && exportSettings.value.includeStats,
        showCellNumbers: kind === 'legend' && exportSettings.value.showCellNumbers,
        showGrid: exportPreviewMode.value === 'grid',
      },
    )
    exportCanvasWidth.value = model.layout.width
    exportCanvasHeight.value = model.layout.height
    await nextTick()
    await delay(30)
    await drawPatternExportCanvas(EXPORT_CANVAS_ID, model)
    const tempFilePath = await canvasToPng(
      EXPORT_CANVAS_ID,
      model.layout.width,
      model.layout.height,
    )
    const delivery = await deliverPng(
      tempFilePath,
      `${safeFileName(model.projectName)}-${model.width}x${model.height}-${kind === 'legend' ? '色卡图纸' : '图纸'}.png`,
    )
    statusText.value = delivery === 'album' ? '高清图纸已保存到相册' : '高清图纸已下载'
    uni.showToast({ title: statusText.value, icon: 'success' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出图纸失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none', duration: 3000 })
  } finally {
    isBusy.value = false
  }
}

async function exportBoardPieces(pieces: readonly BoardPiece[], successLabel: string): Promise<void> {
  if (!pattern.value || !palette.value || pieces.length === 0) return
  statusText.value = `正在生成 ${pieces.length} 张分板图纸…`
  try {
    for (const piece of pieces) {
      const model = buildBoardExportModel(
        pattern.value,
        palette.value,
        currentPatternColorSystem(),
        currentProjectName(),
        piece,
      )
      exportCanvasWidth.value = model.layout.width
      exportCanvasHeight.value = model.layout.height
      await nextTick()
      await delay(30)
      await drawBoardExportCanvas(EXPORT_CANVAS_ID, model)
      const tempFilePath = await canvasToPng(
        EXPORT_CANVAS_ID,
        model.layout.width,
        model.layout.height,
      )
      await deliverPng(
        tempFilePath,
        `${safeFileName(model.projectName)}-${piece.title}-${piece.startColumn}-${piece.endColumn}列-${piece.startRow}-${piece.endRow}行.png`,
      )
      await delay(40)
    }
    statusText.value = successLabel
    uni.showToast({ title: statusText.value, icon: 'success' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出分板图纸失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none', duration: 3000 })
  }
}

async function handleExportBoardImages(): Promise<void> {
  if (!boardPlan.value || isBusy.value) return
  if (boardPlan.value.count <= 1) {
    uni.showToast({ title: '当前图纸只需要一块标准板', icon: 'none' })
    return
  }
  isBusy.value = true
  try {
    await exportBoardPieces(
      boardPlan.value.pieces,
      `${boardPlan.value.count} 张分板图纸已导出`,
    )
  } finally {
    isBusy.value = false
  }
}

async function handleExportPendingBoardImages(): Promise<void> {
  if (!boardPlan.value || isBusy.value) return
  if (pendingBoardPieces.value.length === 0) {
    uni.showToast({ title: '所有分板都已完成', icon: 'none' })
    return
  }
  isBusy.value = true
  try {
    await exportBoardPieces(
      pendingBoardPieces.value,
      `${pendingBoardPieces.value.length} 张未完成分板已导出`,
    )
  } finally {
    isBusy.value = false
  }
}

async function handleExportBoardAtlas(): Promise<void> {
  if (!pattern.value || !palette.value || !boardPlan.value || isBusy.value) return
  if (boardPlan.value.count <= 1) {
    uni.showToast({ title: '当前图纸只需要一块标准板', icon: 'none' })
    return
  }
  isBusy.value = true
  statusText.value = '正在生成分板合集…'
  try {
    const model = buildBoardAtlasExportModel(
      pattern.value,
      palette.value,
      currentPatternColorSystem(),
      currentProjectName(),
      boardPlan.value,
    )
    exportCanvasWidth.value = model.layout.width
    exportCanvasHeight.value = model.layout.height
    await nextTick()
    await delay(30)
    await drawBoardAtlasCanvas(EXPORT_CANVAS_ID, model)
    const tempFilePath = await canvasToPng(
      EXPORT_CANVAS_ID,
      model.layout.width,
      model.layout.height,
    )
    const delivery = await deliverPng(
      tempFilePath,
      `${safeFileName(model.projectName)}-${model.plan.count}板-分板合集.png`,
    )
    statusText.value = delivery === 'album' ? '分板合集已保存到相册' : '分板合集已下载'
    uni.showToast({ title: statusText.value, icon: 'success' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出分板合集失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none', duration: 3000 })
  } finally {
    isBusy.value = false
  }
}

async function handleExportMaterialList(): Promise<void> {
  if (!pattern.value || !palette.value || isBusy.value) return
  isBusy.value = true
  statusText.value = '正在生成备料清单…'
  try {
    const model = buildMaterialListExportModel(
      pattern.value,
      palette.value,
      currentPatternColorSystem(),
      currentProjectName(),
      productionProgress.value?.completedColorIds ?? [],
    )
    exportCanvasWidth.value = model.layout.width
    exportCanvasHeight.value = model.layout.height
    await nextTick()
    await delay(30)
    await drawMaterialListCanvas(EXPORT_CANVAS_ID, model)
    const tempFilePath = await canvasToPng(
      EXPORT_CANVAS_ID,
      model.layout.width,
      model.layout.height,
    )
    const delivery = await deliverPng(
      tempFilePath,
      `${safeFileName(model.projectName)}-备料清单.png`,
    )
    statusText.value = delivery === 'album' ? '备料清单已保存到相册' : '备料清单已下载'
    uni.showToast({ title: statusText.value, icon: 'success' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出备料清单失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none', duration: 3000 })
  } finally {
    isBusy.value = false
  }
}

async function handleCopyMaterialList(): Promise<void> {
  if (!pattern.value || !palette.value || isBusy.value) return
  isBusy.value = true
  try {
    const text = buildMaterialListText(
      pattern.value,
      palette.value,
      currentPatternColorSystem(),
      currentProjectName(),
      productionProgress.value?.completedColorIds ?? [],
    )
    await copyText(text)
    statusText.value = '备料清单已复制'
  } catch (error) {
    const message = error instanceof Error ? error.message : '复制备料清单失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none', duration: 3000 })
  } finally {
    isBusy.value = false
  }
}

async function handleCopyCraftPlan(): Promise<void> {
  if (!craftAssessment.value || isBusy.value) return
  isBusy.value = true
  try {
    await copyText(buildCraftPlanText(currentProjectName(), craftAssessment.value))
    statusText.value = '制作计划已复制'
    uni.showToast({ title: statusText.value, icon: 'success' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '复制制作计划失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none', duration: 3000 })
  } finally {
    isBusy.value = false
  }
}

async function handleCopyProgressReview(): Promise<void> {
  if (!craftAssessment.value || !productionSummary.value || isBusy.value) return
  isBusy.value = true
  try {
    await copyText(buildProgressReviewText(
      currentProjectName(),
      craftAssessment.value,
      productionSummary.value,
    ))
    statusText.value = productionSummary.value.colorPercent === 100
      || productionSummary.value.boardPercent === 100
      ? '完成复盘文案已复制'
      : '制作进度文案已复制'
    uni.showToast({ title: statusText.value, icon: 'success' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '复制制作进度失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none', duration: 3000 })
  } finally {
    isBusy.value = false
  }
}

async function handleCopyPublishPost(): Promise<void> {
  if (!craftAssessment.value || isBusy.value) return
  isBusy.value = true
  try {
    await copyText(buildPublishPost(craftAssessment.value, publishTone.value))
    statusText.value = '发布文案已复制'
    uni.showToast({ title: statusText.value, icon: 'success' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '复制发布文案失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none', duration: 3000 })
  } finally {
    isBusy.value = false
  }
}

async function handleCopyPublishKit(): Promise<void> {
  if (!craftAssessment.value || isBusy.value) return
  isBusy.value = true
  try {
    const kit = buildPublishKit({
      assessment: craftAssessment.value,
      ...(productionSummary.value ? { progress: productionSummary.value } : {}),
      projectName: currentProjectName(),
      projectType: projectType.value,
    })
    await copyText(kit.text)
    statusText.value = '发布包已复制'
    uni.showToast({ title: statusText.value, icon: 'success' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '复制发布包失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none', duration: 3000 })
  } finally {
    isBusy.value = false
  }
}

async function handleExportShareCover(): Promise<void> {
  if (!pattern.value || !palette.value || !craftAssessment.value || isBusy.value) return
  isBusy.value = true
  statusText.value = '正在生成 3:4 发布封面…'
  try {
    const model = buildShareCoverExportModel(
      pattern.value,
      palette.value,
      currentPatternColorSystem(),
      currentProjectName(),
      craftAssessment.value,
      productionSummary.value ?? undefined,
    )
    exportCanvasWidth.value = model.layout.width
    exportCanvasHeight.value = model.layout.height
    await nextTick()
    await delay(30)
    await drawShareCoverCanvas(EXPORT_CANVAS_ID, model)
    const tempFilePath = await canvasToPng(
      EXPORT_CANVAS_ID,
      model.layout.width,
      model.layout.height,
    )
    const delivery = await deliverPng(
      tempFilePath,
      `${safeFileName(model.projectName)}-3x4-发布封面.png`,
    )
    statusText.value = delivery === 'album' ? '发布封面已保存到相册' : '发布封面已下载'
    uni.showToast({ title: statusText.value, icon: 'success' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出发布封面失败'
    statusText.value = message
    uni.showToast({ title: message, icon: 'none', duration: 3000 })
  } finally {
    isBusy.value = false
  }
}
</script>

<template>
  <view class="page-shell">
    <view class="hero-card">
      <text class="eyebrow">PINBEAN STUDIO</text>
      <text class="title">把照片变成可制作的拼豆图纸</text>
      <text class="description">导入图片，选择生成方式，再逐步校对、去背景和导出。</text>
    </view>

    <view v-if="sourceImage" class="source-card">
      <image class="source-image" :src="sourceImage.path" mode="aspectFit" />
      <view class="source-copy">
        <text class="section-title">原始图片</text>
        <text class="muted">{{ sourceDescription }}</text>
      </view>
      <button class="text-button" :disabled="isBusy" @click="handleChooseImage">更换</button>
    </view>

    <view class="settings-card">
      <view class="section-heading">
        <text class="section-title">生成设置</text>
        <text class="status-pill">{{ previewWarning || persistenceWarning || statusText }}</text>
      </view>

      <text class="field-label">作品用途</text>
      <view class="project-presets">
        <button
          v-for="option in PROJECT_TYPE_OPTIONS"
          :key="option.value"
          class="project-preset"
          :class="{ active: projectType === option.value }"
          :disabled="isBusy"
          @click="selectProjectType(option.value)"
        >
          <text class="project-preset-title">{{ option.label }}</text>
          <text class="project-preset-description">{{ option.description }}</text>
        </button>
      </view>
      <text class="field-help">用途会给出推荐尺寸和模式，也会进入项目文件与发布内容；之后仍可手动调整</text>

      <text class="field-label">色号品牌</text>
      <view class="color-system-options">
        <button
          v-for="system in COLOR_SYSTEMS"
          :key="system"
          class="color-system-option"
          :class="{ active: selectedColorSystem === system }"
          :disabled="isBusy"
          @click="selectColorSystem(system)"
        >{{ system }}</button>
      </view>
      <text class="field-help">生成、备料清单和所有导出会使用同一品牌色号；切换后需重新生成当前图片</text>
      <text v-if="hasPendingColorSystemChange" class="field-warning">当前图纸仍使用 {{ activePatternColorSystem }}，导出和进度不会使用未重新生成的 {{ selectedColorSystem }}</text>

      <text class="field-label">生成方式</text>
      <view class="segmented-control">
        <button
          class="segment"
          :class="{ active: mode === 'cartoon' }"
          @click="selectMode('cartoon')"
        >轮廓模式</button>
        <button
          class="segment"
          :class="{ active: mode === 'realistic' }"
          @click="selectMode('realistic')"
        >细腻模式</button>
      </view>
      <text class="field-help">{{ modeLabel }}：{{ mode === 'cartoon' ? '优先保留描边和硬边色块' : '按区域平均色呈现照片层次' }}</text>

      <view class="slider-heading">
        <text class="field-label">横向格数</text>
        <text class="slider-value">{{ gridSize }}</text>
      </view>
      <slider
        :value="gridSize"
        :min="MIN_PATTERN_GRID_SIZE"
        :max="MAX_PATTERN_GRID_SIZE"
        step="1"
        activeColor="#D46B48"
        backgroundColor="#E9DDD0"
        @change="onGridSizeChange"
      />

      <view class="slider-heading">
        <text class="field-label">相似色合并</text>
        <text class="slider-value">{{ similarityThreshold }}</text>
      </view>
      <slider
        :value="similarityThreshold"
        min="0"
        max="100"
        step="1"
        activeColor="#478A73"
        backgroundColor="#E9DDD0"
        @change="onSimilarityChange"
      />

      <button
        class="primary-button"
        :loading="isBusy"
        :disabled="isBusy"
        @click="decodedImage ? handleRegenerate() : handleChooseImage()"
      >{{ decodedImage ? '按当前设置重新生成' : '选择图片并生成' }}</button>
      <button
        v-if="canRestoreProject"
        class="restore-button"
        :disabled="isBusy"
        @click="handleRestoreProject"
      >继续上次图纸 · {{ savedProjectLabel }}</button>
    </view>

    <view class="project-file-card">
      <view class="project-file-copy">
        <text class="project-file-title">PinBean 项目文件</text>
        <text class="project-file-hint">保存完整网格、稳定色号和生成参数，之后可以继续编辑</text>
      </view>
      <view class="project-file-actions">
        <button class="project-file-button import" :disabled="isBusy" @click="handleImportProjectFile">导入项目</button>
        <button class="project-file-button export" :disabled="isBusy || !pattern" @click="handleExportProjectFile">导出项目</button>
      </view>
    </view>

    <view v-if="recentProjects.length > 0" class="recent-projects-card">
      <view class="recent-projects-heading">
        <view>
          <text class="recent-projects-title">最近制作</text>
          <text class="recent-projects-hint">同一作品编辑后更新原记录，不会按图案版本重复出现</text>
        </view>
        <text class="recent-projects-count">{{ recentProjects.length }}/8</text>
      </view>
      <view class="recent-projects-list">
        <view v-for="record in recentProjects" :key="record.projectId" class="recent-project-record">
          <view class="recent-project-copy">
            <text class="recent-project-name">{{ record.projectName }}</text>
            <text class="recent-project-facts">
              {{ record.width }}×{{ record.height }} · {{ record.totalBeads }} 颗 · {{ record.colorCount }} 色 · {{ record.difficulty }}
            </text>
            <text class="recent-project-progress">色号 {{ record.colorPercent }}% · 分板 {{ record.boardPercent }}% · {{ formatRecentProjectTime(record.updatedAt) }}</text>
            <text v-if="record.publishReview" class="recent-project-review">{{ formatPublishReviewMetrics(record.publishReview) }}</text>
          </view>
          <view class="recent-project-actions">
            <button class="recent-project-copy-button" :disabled="isBusy" @click="handleCopyRecentProject(record)">复制</button>
            <button class="recent-project-delete-button" :disabled="isBusy" @click="handleDeleteRecentProject(record.projectId)">删除</button>
          </view>
        </view>
      </view>
    </view>

    <view v-if="pattern && statistics" class="result-card">
      <view class="section-heading">
        <view>
          <text class="section-title">拼豆图纸</text>
          <text class="result-summary">{{ pattern.grid.width }} × {{ pattern.grid.height }} · {{ statistics.total }} 颗</text>
        </view>
        <view class="result-actions">
          <text class="color-count">{{ statistics.colors.length }} 色</text>
          <button class="edit-toggle" :class="{ active: isEditing }" @click="toggleEditing">
            {{ isEditing ? '完成编辑' : '编辑图纸' }}
          </button>
        </view>
      </view>

      <view class="project-name-editor">
        <view class="project-name-copy">
          <text class="project-name-label">作品名称</text>
          <text class="project-name-hint">用于项目文件、导出文件名、封面和发布内容</text>
        </view>
        <input
          class="project-name-input"
          :value="projectNameDraft"
          maxlength="40"
          placeholder="给作品起一个名字"
          @input="updateProjectNameDraft"
        />
        <button class="project-name-save" :disabled="isBusy" @click="handleSaveProjectName">保存</button>
      </view>

      <view v-if="isEditing" class="editor-panel">
        <view class="tool-row">
          <button
            v-for="tool in (['paint', 'erase', 'fill', 'replace', 'pipette'] as EditTool[])"
            :key="tool"
            class="tool-button"
            :class="{ active: editTool === tool }"
            @click="selectEditTool(tool)"
          >{{ editToolLabel(tool) }}</button>
        </view>
        <view class="history-row">
          <button class="history-button" :disabled="!canUndo || isBusy" @click="handleHistory('undo')">撤销</button>
          <button class="history-button" :disabled="!canRedo || isBusy" @click="handleHistory('redo')">重做</button>
          <button class="background-button" :disabled="isBusy" @click="handleRemoveBackground">去背景</button>
          <text class="editor-help">在图纸上点按格子应用工具</text>
        </view>
        <button
          class="full-palette-toggle"
          :class="{ active: showFullEditPalette }"
          @click="showFullEditPalette = !showFullEditPalette"
        >{{ showFullEditPalette ? '收起完整色板' : `从 ${currentColorSystemLabel} 完整色板选色` }}</button>
        <scroll-view v-if="showFullEditPalette" class="full-edit-palette" scroll-y>
          <view class="full-edit-palette-grid">
            <button
              v-for="color in fullEditPalette"
              :key="color.id"
              class="edit-palette-color"
              :class="{ selected: color.id === selectedColorId }"
              :aria-label="`${currentColorSystemLabel} ${color.code}`"
              @click="selectFullEditColor(color.id)"
            >
              <view class="edit-palette-dot" :style="{ backgroundColor: color.hex }" />
              <text>{{ color.code }}</text>
            </button>
          </view>
        </scroll-view>
      </view>

      <scroll-view class="canvas-scroll" :scroll-x="!isEditing">
        <view
          class="canvas-frame"
          :class="{ editing: isEditing }"
          :style="{ width: previewCanvasWidth + 'px', height: previewCanvasHeight + 'px' }"
        >
          <canvas
            :id="PATTERN_CANVAS_ID"
            :canvas-id="PATTERN_CANVAS_ID"
            class="pattern-canvas"
            :width="previewCanvasWidth"
            :height="previewCanvasHeight"
            :style="{ width: previewCanvasWidth + 'px', height: previewCanvasHeight + 'px' }"
          />
          <view
            v-if="isEditing"
            class="edit-hit-layer"
            :style="{
              backgroundSize: `${previewCanvasWidth / pattern.grid.width}px ${previewCanvasHeight / pattern.grid.height}px`,
            }"
            @click="handleCanvasTap"
            @touchmove.stop.prevent="handleCanvasDrag"
          />
        </view>
      </scroll-view>

      <view v-if="craftAssessment" class="craft-assessment">
        <view class="assessment-head">
          <text class="assessment-title">制作评估</text>
          <text class="assessment-level" :class="craftAssessment.levelClass">{{ craftAssessment.level }}</text>
        </view>
        <view class="assessment-metrics">
          <view class="assessment-metric">
            <text class="assessment-metric-value">{{ craftAssessment.sizeText }}</text>
            <text class="assessment-metric-label">图纸尺寸</text>
          </view>
          <view class="assessment-metric">
            <text class="assessment-metric-value">{{ craftAssessment.beadText }}</text>
            <text class="assessment-metric-label">豆子数量</text>
          </view>
          <view class="assessment-metric">
            <text class="assessment-metric-value">{{ craftAssessment.colorText }}</text>
            <text class="assessment-metric-label">用色数量</text>
          </view>
          <view class="assessment-metric">
            <text class="assessment-metric-value">{{ craftAssessment.timeText }}</text>
            <text class="assessment-metric-label">粗略摆豆</text>
          </view>
        </view>
        <text class="assessment-time-basis">{{ PRODUCTION_TIME_BASIS_TEXT }}</text>
        <view class="assessment-board-summary">
          <view>
            <text class="assessment-board-main">{{ craftAssessment.boardText }}</text>
            <text class="assessment-board-hint">{{ craftAssessment.boardHint }}</text>
          </view>
          <text v-if="productionSummary" class="assessment-board-progress">
            {{ productionSummary.completedBoards }}/{{ productionSummary.totalBoards }} 板 · {{ productionSummary.boardPercent }}%
          </text>
        </view>
        <view class="work-steps">
          <text class="work-steps-title">推荐制作顺序</text>
          <view class="work-step-list">
            <view v-for="step in craftAssessment.workSteps" :key="step.index" class="work-step">
              <text class="work-step-index">{{ step.index }}</text>
              <view class="work-step-copy">
                <text class="work-step-title">{{ step.title }}</text>
                <text class="work-step-detail">{{ step.detail }}</text>
              </view>
            </view>
          </view>
        </view>
        <view class="assessment-tags">
          <text v-for="tag in craftAssessment.tags" :key="tag" class="assessment-tag">{{ tag }}</text>
        </view>
        <text class="assessment-suggestion">{{ craftAssessment.suggestion }}</text>
        <view class="assessment-actions">
          <button class="assessment-copy-button" :disabled="isBusy" @click="handleCopyCraftPlan">复制制作计划</button>
          <button class="assessment-copy-button progress" :disabled="isBusy" @click="handleCopyProgressReview">
            {{ productionSummary && (productionSummary.colorPercent === 100 || productionSummary.boardPercent === 100)
              ? '复制完成复盘'
              : '复制进度文案' }}
          </button>
        </view>
      </view>

      <view class="color-stats-panel">
        <view class="stats-head">
          <view>
            <text class="stats-title">🎨 颜色消耗清单（共 {{ statistics.total }} 颗）</text>
            <text class="stats-hint">编辑时点击色卡切换画笔；右侧可标记整色完成</text>
            <text v-if="productionSummary" class="progress-text">
              制作进度：{{ productionSummary.completedColors }}/{{ productionSummary.totalColors }} 色 ·
              {{ productionSummary.completedBeads }}/{{ productionSummary.totalBeads }} 颗 ·
              {{ productionSummary.colorPercent }}%
            </text>
          </view>
          <button class="stats-copy-button" :disabled="isBusy" @click="handleCopyMaterialList">复制清单</button>
        </view>
        <view v-if="productionSummary" class="progress-track">
          <view class="progress-fill" :style="{ width: productionSummary.colorPercent + '%' }" />
        </view>
        <view class="color-list">
          <view
            v-for="color in usedColors"
            :key="color.colorId"
            class="color-chip"
            :class="{
              completed: color.completed,
              selected: isEditing && selectedColorId === color.colorId,
            }"
            @click="isEditing && selectEditColor(color.paletteIndex)"
          >
            <view class="color-dot" :style="{ backgroundColor: color.hex }" />
            <text class="color-code">{{ color.code }}</text>
            <text class="color-amount">{{ color.count }}</text>
            <button
              class="color-progress-toggle"
              :class="{ done: color.completed }"
              :disabled="isBusy"
              @click.stop="handleToggleProductionColor(color.colorId)"
            >{{ color.completed ? '完成' : '待拼' }}</button>
          </view>
        </view>
        <button
          v-if="productionSummary && (productionSummary.completedColors > 0 || productionSummary.completedBoards > 0)"
          class="progress-reset-button"
          :disabled="isBusy"
          @click="handleResetProductionProgress"
        >重置制作进度</button>
      </view>

      <view class="export-panel">
        <view class="export-heading">
          <view>
            <text class="export-title">导出图纸</text>
            <text class="export-hint">纯图纸、色卡图纸和备料清单都可单独保存</text>
          </view>
          <view class="export-heading-actions">
            <view class="export-mode-control">
              <button
                class="export-mode"
                :class="{ active: exportPreviewMode === 'grid' }"
                @click="selectExportPreviewMode('grid')"
              >网格图</button>
              <button
                class="export-mode"
                :class="{ active: exportPreviewMode === 'clean' }"
                @click="selectExportPreviewMode('clean')"
              >纯净图</button>
            </view>
            <button class="export-settings-button" :disabled="isBusy" @click="openExportSettings">详细设置</button>
          </view>
        </view>
        <view class="export-actions">
          <button class="export-action" :disabled="isBusy" @click="handleExportPattern('plain')">
            <text class="export-icon">💾</text>
            <text class="export-label">保存图纸</text>
          </button>
          <button class="export-action highlight" :disabled="isBusy" @click="handleExportPattern('legend')">
            <text class="export-icon">📋</text>
            <text class="export-label">色卡图纸</text>
          </button>
          <button class="export-action" :disabled="isBusy" @click="handleExportMaterialList">
            <text class="export-icon">🧾</text>
            <text class="export-label">备料清单</text>
          </button>
        </view>
      </view>

      <view v-if="hasMultipleBoards && boardPlan" class="board-panel">
        <view class="board-heading">
          <view>
            <text class="board-title">29×29 标准板分板</text>
            <text class="board-hint">{{ boardPlan.columns }}×{{ boardPlan.rows }} 拼板 · 共 {{ boardPlan.count }} 块，按从左到右、从上到下编号</text>
          </view>
        </view>
        <view class="board-piece-list">
          <view
            v-for="piece in boardPlan.pieces"
            :key="piece.id"
            class="board-piece"
            :class="{ completed: completedBoardIds.has(piece.id) }"
            @click="handleToggleProductionBoard(piece.id)"
          >
            <view class="board-piece-head">
              <text class="board-piece-title">{{ piece.title }}</text>
              <text class="board-piece-size">{{ completedBoardIds.has(piece.id) ? '已完成' : piece.sizeText }}</text>
            </view>
            <text class="board-piece-range">{{ piece.rangeText }}</text>
            <text class="board-piece-colors">{{ piece.total }} 颗 · {{ piece.colors.length }} 色</text>
            <text v-if="piece.colors.length" class="board-piece-main-colors">主色 {{ boardMainColorSummary(piece) }}</text>
          </view>
        </view>
        <view class="board-actions">
          <button class="board-action" :disabled="isBusy" @click="handleExportBoardImages">
            <text class="export-icon">🧩</text>
            <text class="export-label">分板图纸</text>
          </button>
          <button class="board-action atlas" :disabled="isBusy" @click="handleExportBoardAtlas">
            <text class="export-icon">🗂️</text>
            <text class="export-label">分板合集</text>
          </button>
        </view>
        <button
          v-if="productionSummary && productionSummary.completedBoards > 0"
          class="pending-board-button"
          :disabled="isBusy"
          @click="handleExportPendingBoardImages"
        >只导出未完成分板（{{ pendingBoardPieces.length }} 张）</button>
      </view>

      <view v-if="craftAssessment" class="publishing-panel">
        <view class="publishing-heading">
          <view>
            <text class="publishing-title">发布助手</text>
            <text class="publishing-hint">根据当前用途、制作评估和真实进度生成，可直接继续编辑</text>
          </view>
          <text class="publishing-project-type">{{ PROJECT_TYPE_OPTIONS.find(option => option.value === projectType)?.label }}</text>
        </view>
        <view class="publishing-tones">
          <button
            v-for="option in PUBLISH_TONE_OPTIONS"
            :key="option.value"
            class="publishing-tone"
            :class="{ active: publishTone === option.value }"
            :disabled="isBusy"
            @click="publishTone = option.value"
          >{{ option.label }}</button>
        </view>
        <view class="publishing-actions">
          <button class="publishing-action primary" :disabled="isBusy" @click="handleCopyPublishPost">复制发布文案</button>
          <button class="publishing-action" :disabled="isBusy" @click="handleCopyPublishKit">复制发布包</button>
          <button class="publishing-action cover" :disabled="isBusy" @click="handleExportShareCover">保存 3:4 封面</button>
        </view>
        <text class="publishing-note">发布包包含 20 字以内标题、首图建议、正文、标签和发布前检查清单</text>
        <view class="publish-review-panel">
          <view class="publish-review-heading">
            <view>
              <text class="publish-review-title">发布复盘</text>
              <text class="publish-review-hint">第一次保存会记录发布时间，后续可以持续更新互动数据</text>
            </view>
            <text v-if="publishReview" class="publish-review-time">{{ formatPublishReviewTime(publishReview.publishedAt) }}</text>
          </view>
          <input
            class="publish-review-topic"
            :value="publishReviewDraft.topic"
            maxlength="40"
            placeholder="内容主题，例如：照片转拼豆教程"
            @input="updatePublishReviewDraft('topic', $event)"
          />
          <view class="publish-review-metrics">
            <label v-for="metric in ([
              { key: 'likes', label: '点赞' },
              { key: 'favorites', label: '收藏' },
              { key: 'comments', label: '评论' },
              { key: 'conversions', label: '转化' },
            ] as const)" :key="metric.key" class="publish-review-metric">
              <text>{{ metric.label }}</text>
              <input
                :class="`publish-review-${metric.key}`"
                type="number"
                :value="publishReviewDraft[metric.key]"
                placeholder="0"
                @input="updatePublishReviewDraft(metric.key, $event)"
              />
            </label>
          </view>
          <input
            class="publish-review-note"
            :value="publishReviewDraft.note"
            maxlength="80"
            placeholder="复盘备注，例如：收藏率高，下次继续做教程"
            @input="updatePublishReviewDraft('note', $event)"
          />
          <view class="publish-review-actions">
            <button class="publish-review-save" :disabled="isBusy" @click="handleSavePublishReview">保存复盘</button>
            <button class="publish-review-copy" :disabled="isBusy || !publishReview" @click="handleCopyPublishReview">复制摘要</button>
            <button class="publish-review-clear" :disabled="isBusy || !publishReview" @click="handleClearPublishReview">清空</button>
          </view>
        </view>
      </view>
    </view>

    <view v-if="showExportSettings" class="modal-backdrop" @click.self="closeExportSettings">
      <view class="settings-modal">
        <view class="settings-modal-head">
          <view>
            <text class="settings-modal-title">下载图纸设置</text>
            <text class="settings-modal-hint">网格与坐标用于两种图纸；色号和统计仅用于色卡图纸</text>
          </view>
          <button class="modal-close" @click="closeExportSettings">×</button>
        </view>

        <view class="setting-row">
          <text class="setting-name">显示网格线</text>
          <switch
            color="#d95d5d"
            :checked="exportSettingsDraft.showGrid"
            @change="updateExportBoolean('showGrid', $event)"
          />
        </view>
        <view v-if="exportSettingsDraft.showGrid" class="grid-settings">
          <view class="setting-slider-head">
            <text class="setting-name">网格线间隔</text>
            <text class="setting-value">每 {{ exportSettingsDraft.gridInterval }} 格</text>
          </view>
          <slider
            :value="exportSettingsDraft.gridInterval"
            min="5"
            max="20"
            step="1"
            active-color="#d95d5d"
            background-color="#eadfd3"
            @change="updateExportGridInterval"
          />
          <text class="setting-name color-setting-title">网格线颜色</text>
          <view class="grid-color-list">
            <button
              v-for="color in GRID_LINE_COLORS"
              :key="color.value"
              class="grid-color"
              :class="{ selected: exportSettingsDraft.gridLineColor === color.value }"
              :style="{ backgroundColor: color.value }"
              :aria-label="color.label"
              @click="selectExportGridColor(color.value)"
            />
          </view>
        </view>
        <view class="setting-row">
          <text class="setting-name">显示坐标数字</text>
          <switch
            color="#d95d5d"
            :checked="exportSettingsDraft.showCoordinates"
            @change="updateExportBoolean('showCoordinates', $event)"
          />
        </view>
        <view class="setting-row">
          <text class="setting-name">显示格内色号</text>
          <switch
            color="#d95d5d"
            :checked="exportSettingsDraft.showCellNumbers"
            @change="updateExportBoolean('showCellNumbers', $event)"
          />
        </view>
        <view class="setting-row">
          <text class="setting-name">包含色号统计</text>
          <switch
            color="#d95d5d"
            :checked="exportSettingsDraft.includeStats"
            @change="updateExportBoolean('includeStats', $event)"
          />
        </view>
        <view class="settings-modal-actions">
          <button class="modal-secondary" @click="closeExportSettings">取消</button>
          <button class="modal-primary" @click="saveExportSettings">保存设置</button>
        </view>
      </view>
    </view>

    <canvas
      :id="SOURCE_CANVAS_ID"
      :canvas-id="SOURCE_CANVAS_ID"
      class="decode-canvas"
      :width="sourceCanvasWidth"
      :height="sourceCanvasHeight"
      :style="{ width: sourceCanvasWidth + 'px', height: sourceCanvasHeight + 'px' }"
    />
    <canvas
      :id="EXPORT_CANVAS_ID"
      :canvas-id="EXPORT_CANVAS_ID"
      class="export-canvas"
      :width="exportCanvasWidth"
      :height="exportCanvasHeight"
      :style="{ width: exportCanvasWidth + 'px', height: exportCanvasHeight + 'px' }"
    />
  </view>
</template>

<style scoped>
.page-shell {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 36rpx 28rpx 80rpx;
}

.hero-card,
.source-card,
.settings-card,
.project-file-card,
.recent-projects-card,
.result-card {
  border: 2rpx solid #e6d9ca;
  border-radius: 30rpx;
  background: #fffaf3;
  box-shadow: 0 12rpx 36rpx rgba(72, 54, 42, 0.07);
}

.hero-card,
.settings-card,
.result-card {
  padding: 34rpx;
}

.source-card,
.settings-card,
.project-file-card,
.recent-projects-card,
.result-card {
  margin-top: 24rpx;
}

.eyebrow,
.title,
.description,
.section-title,
.muted,
.field-label,
.field-help,
.field-warning,
.result-summary {
  display: block;
}

.eyebrow {
  margin-bottom: 14rpx;
  color: #b65a3b;
  font-size: 21rpx;
  font-weight: 700;
  letter-spacing: 5rpx;
}

.title {
  color: #2f2925;
  font-size: 44rpx;
  font-weight: 700;
  line-height: 1.3;
}

.description,
.muted,
.field-help {
  color: #786e66;
  font-size: 25rpx;
  line-height: 1.55;
}

.description {
  margin-top: 18rpx;
}

.source-card {
  display: flex;
  align-items: center;
  padding: 18rpx;
}

.source-image {
  width: 116rpx;
  height: 116rpx;
  border-radius: 20rpx;
  background: #eee5da;
}

.source-copy {
  flex: 1;
  min-width: 0;
  margin: 0 20rpx;
}

.section-heading,
.slider-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  color: #3c342f;
  font-size: 30rpx;
  font-weight: 650;
}

.status-pill {
  max-width: 62%;
  padding: 8rpx 14rpx;
  border-radius: 999rpx;
  color: #477765;
  background: #e7f0eb;
  font-size: 21rpx;
  text-align: right;
}

.field-label {
  margin-top: 30rpx;
  color: #514842;
  font-size: 26rpx;
  font-weight: 600;
}

.project-presets {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 9rpx;
  margin-top: 14rpx;
}

.color-system-options {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8rpx;
  margin-top: 14rpx;
}

.color-system-option {
  min-width: 0;
  margin: 0;
  padding: 0 4rpx;
  border: 2rpx solid #e2d6ca;
  border-radius: 15rpx;
  color: #75685f;
  background: #fffdf9;
  font-size: 19rpx;
  line-height: 56rpx;
}

.color-system-option.active {
  border-color: #478a73;
  color: #326b59;
  background: #e6f1ec;
  box-shadow: 0 4rpx 12rpx rgba(50, 107, 89, 0.09);
}

.project-preset {
  min-width: 0;
  margin: 0;
  padding: 14rpx 5rpx;
  border: 2rpx solid #e2d6ca;
  border-radius: 17rpx;
  color: #75685f;
  background: #fffdf9;
  line-height: 1.2;
}

.project-preset.active {
  border-color: #d46b48;
  color: #963f29;
  background: #fae8df;
  box-shadow: 0 4rpx 12rpx rgba(150, 63, 41, 0.09);
}

.project-preset-title,
.project-preset-description {
  display: block;
}

.project-preset-title {
  font-size: 22rpx;
  font-weight: 700;
}

.project-preset-description {
  margin-top: 5rpx;
  overflow: hidden;
  font-size: 17rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.segmented-control {
  display: flex;
  gap: 12rpx;
  margin-top: 14rpx;
  padding: 8rpx;
  border-radius: 22rpx;
  background: #eee4d8;
}

.segment {
  flex: 1;
  margin: 0;
  border-radius: 17rpx;
  color: #71665e;
  background: transparent;
  font-size: 26rpx;
}

.segment.active {
  color: #963f29;
  background: #fffaf3;
  box-shadow: 0 4rpx 12rpx rgba(76, 54, 39, 0.08);
}

.field-help {
  margin-top: 12rpx;
}

.field-warning {
  margin-top: 10rpx;
  color: #b65a3b;
  font-size: 24rpx;
  line-height: 1.5;
}

.slider-heading {
  margin-top: 24rpx;
}

.slider-heading .field-label {
  margin-top: 0;
}

.slider-value {
  color: #b65a3b;
  font-size: 28rpx;
  font-weight: 700;
}

.primary-button {
  margin-top: 28rpx;
  border-radius: 22rpx;
  color: #fff;
  background: #d46b48;
  font-size: 29rpx;
  font-weight: 650;
}

.primary-button[disabled] {
  color: rgba(255, 255, 255, 0.82);
  background: #bd9e8d;
}

.restore-button {
  margin-top: 16rpx;
  border: 2rpx solid #8bb3a4;
  border-radius: 22rpx;
  color: #326753;
  background: #edf6f1;
  font-size: 25rpx;
}

.project-file-card {
  display: flex;
  align-items: center;
  gap: 22rpx;
  padding: 24rpx 28rpx;
}

.project-file-copy {
  flex: 1;
  min-width: 0;
}

.project-file-title,
.project-file-hint {
  display: block;
}

.project-file-title {
  color: #3c342f;
  font-size: 27rpx;
  font-weight: 700;
}

.project-file-hint {
  margin-top: 7rpx;
  color: #83776f;
  font-size: 20rpx;
  line-height: 1.45;
}

.project-file-actions {
  display: flex;
  flex: none;
  gap: 10rpx;
}

.project-file-button {
  margin: 0;
  padding: 0 17rpx;
  border: 2rpx solid #d7cabe;
  border-radius: 17rpx;
  color: #655950;
  background: #fff;
  font-size: 21rpx;
  line-height: 58rpx;
}

.project-file-button.export {
  border-color: #84aa9c;
  color: #326753;
  background: #edf6f1;
}

.project-file-button[disabled] {
  border-color: #ddd6d0;
  color: #aba29c;
  background: #eeeae6;
}

.recent-projects-card {
  padding: 24rpx 28rpx;
}

.recent-projects-heading,
.recent-project-record,
.recent-project-actions,
.project-name-editor {
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.recent-projects-heading {
  justify-content: space-between;
}

.recent-projects-title,
.recent-projects-hint,
.recent-project-name,
.recent-project-facts,
.recent-project-progress,
.project-name-label,
.project-name-hint {
  display: block;
}

.recent-projects-title {
  color: #3c342f;
  font-size: 27rpx;
  font-weight: 700;
}

.recent-projects-hint {
  margin-top: 5rpx;
  color: #8a7d74;
  font-size: 18rpx;
}

.recent-projects-count {
  flex: none;
  color: #8f7a6c;
  font-size: 20rpx;
}

.recent-projects-list {
  display: flex;
  flex-direction: column;
  gap: 11rpx;
  margin-top: 17rpx;
}

.recent-project-record {
  padding: 15rpx;
  border: 2rpx solid #e9ddd2;
  border-radius: 18rpx;
  background: #fff;
}

.recent-project-copy {
  flex: 1;
  min-width: 0;
}

.recent-project-name {
  overflow: hidden;
  color: #443a34;
  font-size: 22rpx;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-project-facts,
.recent-project-progress {
  margin-top: 4rpx;
  color: #897b72;
  font-size: 17rpx;
  line-height: 1.35;
}

.recent-project-actions {
  flex: none;
  gap: 7rpx;
}

.recent-project-copy-button,
.recent-project-delete-button {
  margin: 0;
  padding: 0 12rpx;
  border: 2rpx solid #d8ccc2;
  border-radius: 13rpx;
  color: #695d55;
  background: #faf6f2;
  font-size: 18rpx;
  line-height: 46rpx;
}

.recent-project-delete-button {
  border-color: #e6baba;
  color: #a84c4c;
  background: #fff4f4;
}

.project-name-editor {
  margin-top: 20rpx;
  padding: 16rpx;
  border: 2rpx solid #e7dbcf;
  border-radius: 18rpx;
  background: #fffdf9;
}

.project-name-copy {
  flex: none;
}

.project-name-label {
  color: #50463f;
  font-size: 21rpx;
  font-weight: 700;
}

.project-name-hint {
  max-width: 185rpx;
  margin-top: 3rpx;
  color: #91847b;
  font-size: 16rpx;
  line-height: 1.3;
}

.project-name-input {
  flex: 1;
  min-width: 0;
  height: 58rpx;
  padding: 0 14rpx;
  border: 2rpx solid #ddd1c6;
  border-radius: 14rpx;
  color: #433a34;
  background: #fff;
  font-size: 20rpx;
}

.project-name-save {
  flex: none;
  margin: 0;
  padding: 0 15rpx;
  border: 2rpx solid #8bb3a4;
  border-radius: 14rpx;
  color: #326753;
  background: #edf6f1;
  font-size: 19rpx;
  line-height: 56rpx;
}

.craft-assessment,
.color-stats-panel,
.export-panel {
  margin-top: 28rpx;
  padding: 24rpx;
  border: 2rpx solid #eadfd3;
  border-radius: 24rpx;
  background: #fff;
}

.assessment-head,
.assessment-board-summary,
.assessment-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.assessment-title,
.assessment-metric-value,
.assessment-metric-label,
.assessment-board-main,
.assessment-board-hint,
.assessment-board-progress,
.work-steps-title,
.work-step-title,
.work-step-detail,
.assessment-suggestion {
  display: block;
}

.assessment-title {
  color: #3c342f;
  font-size: 28rpx;
  font-weight: 750;
}

.assessment-level {
  padding: 7rpx 16rpx;
  border-radius: 999rpx;
  font-size: 20rpx;
  font-weight: 750;
}

.assessment-level.easy {
  color: #287052;
  background: #ddf3e8;
}

.assessment-level.medium {
  color: #96591f;
  background: #fff0d8;
}

.assessment-level.hard {
  color: #a13f3f;
  background: #fde3e3;
}

.assessment-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10rpx;
  margin-top: 20rpx;
}

.assessment-metric {
  min-width: 0;
  padding: 16rpx 7rpx;
  border-radius: 17rpx;
  text-align: center;
  background: #faf5ef;
}

.assessment-metric-value {
  overflow: hidden;
  color: #3d352f;
  font-size: 22rpx;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assessment-metric-label {
  margin-top: 5rpx;
  color: #94877d;
  font-size: 18rpx;
}

.assessment-time-basis {
  display: block;
  margin-top: 18rpx;
  color: #94877d;
  font-size: 20rpx;
  line-height: 1.55;
  text-align: center;
}

.assessment-board-summary {
  margin-top: 18rpx;
  padding: 17rpx 19rpx;
  border-radius: 18rpx;
  background: #f3ece5;
}

.assessment-board-main {
  color: #4b4038;
  font-size: 23rpx;
  font-weight: 700;
}

.assessment-board-hint {
  margin-top: 4rpx;
  color: #8d8076;
  font-size: 19rpx;
}

.assessment-board-progress {
  flex: none;
  color: #b84e4e;
  font-size: 19rpx;
  font-weight: 650;
}

.work-steps {
  margin-top: 18rpx;
  padding: 18rpx;
  border: 2rpx solid #eee4da;
  border-radius: 19rpx;
  background: #fffdf9;
}

.work-steps-title {
  color: #3c342f;
  font-size: 23rpx;
  font-weight: 750;
}

.work-step-list {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  margin-top: 14rpx;
}

.work-step {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
}

.work-step-index {
  flex: none;
  width: 34rpx;
  height: 34rpx;
  border-radius: 50%;
  color: #fff;
  background: #d95d5d;
  font-size: 19rpx;
  font-weight: 750;
  line-height: 34rpx;
  text-align: center;
}

.work-step-copy {
  min-width: 0;
}

.work-step-title {
  color: #4a4039;
  font-size: 21rpx;
  font-weight: 700;
}

.work-step-detail {
  margin-top: 3rpx;
  color: #887b72;
  font-size: 19rpx;
  line-height: 1.45;
}

.assessment-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 9rpx;
  margin-top: 17rpx;
}

.assessment-tag {
  padding: 6rpx 13rpx;
  border-radius: 999rpx;
  color: #70645c;
  background: #eee6df;
  font-size: 19rpx;
}

.assessment-suggestion {
  margin-top: 15rpx;
  color: #5c5048;
  font-size: 21rpx;
  line-height: 1.55;
}

.assessment-actions {
  margin-top: 18rpx;
}

.assessment-copy-button {
  flex: 1;
  min-width: 0;
  margin: 0;
  border: 2rpx solid #4b4038;
  border-radius: 18rpx;
  color: #fff;
  background: #4b4038;
  font-size: 21rpx;
  line-height: 64rpx;
}

.assessment-copy-button.progress {
  border-color: #e48b8b;
  color: #b94747;
  background: #fff1f1;
}

.assessment-copy-button[disabled] {
  border-color: #ddd6d0;
  color: #aaa19a;
  background: #eeeae6;
}

.stats-head,
.export-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
}

.stats-title,
.stats-hint,
.progress-text,
.export-title,
.export-hint,
.export-icon,
.export-label {
  display: block;
}

.stats-title,
.export-title {
  color: #3c342f;
  font-size: 27rpx;
  font-weight: 700;
}

.stats-hint,
.export-hint {
  margin-top: 6rpx;
  color: #8b7f76;
  font-size: 20rpx;
}

.progress-text {
  margin-top: 8rpx;
  color: #b44c4c;
  font-size: 20rpx;
  font-weight: 600;
}

.progress-track {
  height: 14rpx;
  margin-top: 18rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background: #f0e7e1;
}

.progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #ef8b75, #d95656);
  transition: width 180ms ease;
}

.stats-copy-button {
  flex: none;
  margin: 0;
  padding: 0 20rpx;
  border: 2rpx solid #ff9b9b;
  border-radius: 999rpx;
  color: #d94f4f;
  background: #fff4f4;
  font-size: 22rpx;
  line-height: 54rpx;
}

.export-mode-control {
  display: flex;
  flex: none;
  padding: 5rpx;
  border-radius: 18rpx;
  background: #f0ebe6;
}

.export-heading-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10rpx;
}

.export-settings-button {
  margin: 0;
  padding: 0 16rpx;
  border: 2rpx solid #ded4ca;
  border-radius: 16rpx;
  color: #6d5d52;
  background: #fff;
  font-size: 20rpx;
  line-height: 58rpx;
}

.export-mode {
  margin: 0;
  padding: 0 16rpx;
  border-radius: 14rpx;
  color: #786e66;
  background: transparent;
  font-size: 21rpx;
  line-height: 50rpx;
}

.export-mode.active {
  color: #c94747;
  background: #fff;
  box-shadow: 0 3rpx 10rpx rgba(72, 54, 42, 0.08);
}

.export-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14rpx;
  margin-top: 22rpx;
}

.export-action {
  min-width: 0;
  margin: 0;
  padding: 18rpx 8rpx;
  border: 2rpx solid #ded4ca;
  border-radius: 20rpx;
  color: #5f554e;
  background: #fffaf7;
  line-height: 1.25;
}

.export-action.highlight {
  border-color: #ff7777;
  color: #c83f3f;
  background: linear-gradient(135deg, #fff2f2, #ffe3e3);
  box-shadow: 0 8rpx 20rpx rgba(255, 107, 107, 0.16);
}

.board-panel {
  margin-top: 22rpx;
  padding: 24rpx;
  border: 2rpx solid #d9dfeb;
  border-radius: 24rpx;
  background: #f8faff;
}

.board-title,
.board-hint,
.board-piece-title,
.board-piece-size,
  .board-piece-range,
  .board-piece-colors,
  .board-piece-main-colors {
    display: block;
  }


.board-title {
  color: #343b4c;
  font-size: 27rpx;
  font-weight: 700;
}

.board-hint {
  margin-top: 6rpx;
  color: #768096;
  font-size: 20rpx;
}

.board-piece-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
  margin-top: 20rpx;
}

.board-piece {
  min-width: 0;
  padding: 16rpx;
  border: 2rpx solid #dfe4ef;
  border-radius: 18rpx;
  background: #fff;
}

.board-piece.completed {
  border-color: #83c4a8;
  background: #effaf5;
  box-shadow: inset 0 0 0 2rpx rgba(75, 150, 117, 0.08);
}

.board-piece.completed .board-piece-title,
.board-piece.completed .board-piece-size {
  color: #347458;
}

.board-piece-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.board-piece-title {
  color: #384158;
  font-size: 23rpx;
  font-weight: 700;
}

.board-piece-size {
  color: #67728a;
  font-size: 20rpx;
  font-weight: 650;
}

  .board-piece-range,
  .board-piece-colors,
  .board-piece-main-colors {
    margin-top: 7rpx;
    color: #7c8597;
    font-size: 19rpx;
  }

  .board-piece-main-colors {
    color: #566170;
  }


.board-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
  margin-top: 18rpx;
}

.board-action {
  min-width: 0;
  margin: 0;
  padding: 17rpx 8rpx;
  border: 2rpx solid #cfd7e8;
  border-radius: 18rpx;
  color: #4a5772;
  background: #fff;
  line-height: 1.25;
}

.board-action.atlas {
  border-color: #b9a9df;
  color: #655091;
  background: #f7f3ff;
}

.pending-board-button {
  margin-top: 14rpx;
  border: 2rpx solid #efb36f;
  border-radius: 18rpx;
  color: #9a5b1d;
  background: #fff7e9;
  font-size: 22rpx;
  line-height: 64rpx;
}

.publishing-panel {
  margin-top: 22rpx;
  padding: 24rpx;
  border: 2rpx solid #ead7e7;
  border-radius: 24rpx;
  background: linear-gradient(145deg, #fffafd, #fff7f2);
}

.publishing-heading,
.publishing-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
}

.publishing-title,
.publishing-hint,
.publishing-note {
  display: block;
}

.publish-review-panel {
  margin-top: 20rpx;
  padding-top: 20rpx;
  border-top: 2rpx solid #eadde4;
}

.publish-review-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14rpx;
}

.publish-review-title,
.publish-review-hint,
.publish-review-time,
.recent-project-review {
  display: block;
}

.publish-review-title {
  color: #59434e;
  font-size: 24rpx;
  font-weight: 700;
}

.publish-review-hint {
  margin-top: 5rpx;
  color: #9a838e;
  font-size: 18rpx;
  line-height: 1.4;
}

.publish-review-time {
  flex: none;
  color: #9b6b7e;
  font-size: 18rpx;
}

.publish-review-topic,
.publish-review-note,
.publish-review-metric input {
  box-sizing: border-box;
  border: 2rpx solid #e4d3db;
  border-radius: 14rpx;
  color: #51404a;
  background: #fff;
  font-size: 20rpx;
}

.publish-review-topic,
.publish-review-note {
  width: 100%;
  height: 62rpx;
  margin-top: 14rpx;
  padding: 0 16rpx;
}

.publish-review-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8rpx;
  margin-top: 12rpx;
}

.publish-review-metric {
  color: #8a727e;
  font-size: 18rpx;
  text-align: center;
}

.publish-review-metric input {
  width: 100%;
  height: 56rpx;
  margin-top: 6rpx;
  padding: 0 5rpx;
  text-align: center;
}

.publish-review-actions {
  display: grid;
  grid-template-columns: 1.2fr 1fr 0.75fr;
  gap: 9rpx;
  margin-top: 14rpx;
}

.publish-review-actions button {
  min-width: 0;
  margin: 0;
  border-radius: 15rpx;
  font-size: 20rpx;
  line-height: 58rpx;
}

.publish-review-save {
  color: #fff;
  background: #8f4964;
}

.publish-review-copy {
  border: 2rpx solid #c9adc0;
  color: #805069;
  background: #fff;
}

.publish-review-clear {
  border: 2rpx solid #e1c8c8;
  color: #9a6262;
  background: #fff8f7;
}

.recent-project-review {
  margin-top: 5rpx;
  color: #9b5870;
  font-size: 18rpx;
}

.publishing-title {
  color: #493741;
  font-size: 27rpx;
  font-weight: 700;
}

.publishing-hint {
  margin-top: 6rpx;
  color: #8e7583;
  font-size: 19rpx;
  line-height: 1.4;
}

.publishing-project-type {
  flex: none;
  padding: 7rpx 14rpx;
  border-radius: 999rpx;
  color: #a24a69;
  background: #f8dfeb;
  font-size: 19rpx;
  font-weight: 700;
}

.publishing-tones {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9rpx;
  margin-top: 20rpx;
  padding: 6rpx;
  border-radius: 18rpx;
  background: #f0e7eb;
}

.publishing-tone {
  min-width: 0;
  margin: 0;
  padding: 0 5rpx;
  border-radius: 14rpx;
  color: #806d77;
  background: transparent;
  font-size: 20rpx;
  line-height: 52rpx;
}

.publishing-tone.active {
  color: #a33f62;
  background: #fff;
  box-shadow: 0 3rpx 9rpx rgba(91, 57, 73, 0.09);
}

.publishing-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 17rpx;
}

.publishing-action {
  flex: 1;
  min-width: 0;
  margin: 0;
  border: 2rpx solid #d8b8c7;
  border-radius: 17rpx;
  color: #91435f;
  background: #fff;
  font-size: 21rpx;
  line-height: 62rpx;
}

.publishing-action.primary {
  border-color: #a84f70;
  color: #fff;
  background: #a84f70;
}

.publishing-action.cover {
  border-color: #9b8ac2;
  color: #65538e;
  background: #f6f2ff;
}

.publishing-note {
  margin-top: 13rpx;
  color: #927c87;
  font-size: 18rpx;
  line-height: 1.45;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 32rpx;
  background: rgba(33, 29, 26, 0.48);
}

.settings-modal {
  width: 100%;
  max-width: 680rpx;
  max-height: 88vh;
  box-sizing: border-box;
  padding: 28rpx;
  overflow-y: auto;
  border-radius: 28rpx;
  background: #fffaf6;
  box-shadow: 0 22rpx 70rpx rgba(40, 31, 26, 0.2);
}

.settings-modal-head,
.setting-row,
.setting-slider-head,
.settings-modal-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.settings-modal-title,
.settings-modal-hint,
.setting-name,
.setting-value {
  display: block;
}

.settings-modal-title {
  color: #352e2a;
  font-size: 31rpx;
  font-weight: 700;
}

.settings-modal-hint {
  margin-top: 7rpx;
  color: #897d74;
  font-size: 20rpx;
}

.modal-close {
  flex: none;
  width: 58rpx;
  height: 58rpx;
  margin: 0;
  padding: 0;
  border-radius: 50%;
  color: #756a62;
  background: #efe7df;
  font-size: 38rpx;
  line-height: 54rpx;
}

.setting-row {
  min-height: 84rpx;
  border-bottom: 2rpx solid #eee4dc;
}

.setting-name {
  color: #514842;
  font-size: 25rpx;
  font-weight: 600;
}

.setting-value {
  color: #c34d4d;
  font-size: 23rpx;
  font-weight: 650;
}

.grid-settings {
  margin: 4rpx 0 10rpx 14rpx;
  padding: 20rpx;
  border-left: 5rpx solid #f2a0a0;
  border-radius: 0 18rpx 18rpx 0;
  background: #fff4f2;
}

.color-setting-title {
  margin-top: 14rpx;
}

.grid-color-list {
  display: flex;
  gap: 16rpx;
  margin-top: 15rpx;
}

.grid-color {
  width: 46rpx;
  height: 46rpx;
  margin: 0;
  padding: 0;
  border: 5rpx solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 2rpx #d8cec6;
}

.grid-color.selected {
  box-shadow: 0 0 0 5rpx #e46a6a;
}

.settings-modal-actions {
  justify-content: flex-end;
  gap: 14rpx;
  margin-top: 26rpx;
}

.modal-secondary,
.modal-primary {
  flex: none;
  min-width: 150rpx;
  margin: 0;
  border-radius: 18rpx;
  font-size: 24rpx;
  line-height: 68rpx;
}

.modal-secondary {
  color: #665c55;
  background: #eee7e1;
}

.modal-primary {
  color: #fff;
  background: #d95d5d;
}

.export-icon {
  font-size: 30rpx;
}

.export-label {
  margin-top: 7rpx;
  font-size: 22rpx;
  font-weight: 650;
}

.text-button {
  margin: 0;
  padding: 0 18rpx;
  color: #b65a3b;
  background: transparent;
  font-size: 25rpx;
}

.result-summary {
  margin-top: 8rpx;
  color: #786e66;
  font-size: 24rpx;
}

.color-count {
  padding: 10rpx 18rpx;
  border-radius: 999rpx;
  color: #8f432e;
  background: #f6dfd4;
  font-size: 24rpx;
  font-weight: 650;
}

.result-actions {
  display: flex;
  align-items: flex-end;
  gap: 10rpx;
  flex-direction: column;
}

.edit-toggle,
.tool-button,
.history-button,
.background-button {
  margin: 0;
}

.edit-toggle {
  min-width: 136rpx;
  padding: 0 18rpx;
  border: 2rpx solid #d9c9bc;
  border-radius: 999rpx;
  color: #6d5d52;
  background: #fff;
  font-size: 23rpx;
  line-height: 56rpx;
}

.edit-toggle.active {
  border-color: #d46b48;
  color: #963f29;
  background: #fae8df;
}

.editor-panel {
  margin-top: 24rpx;
  padding: 18rpx;
  border: 2rpx solid #dfd2c5;
  border-radius: 22rpx;
  background: #f8f0e7;
}

.tool-row,
.history-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.tool-row {
  flex-wrap: wrap;
}

.tool-button,
.history-button,
.background-button {
  padding: 0 18rpx;
  border: 2rpx solid #dfd2c5;
  border-radius: 16rpx;
  color: #655950;
  background: #fff;
  font-size: 23rpx;
  line-height: 58rpx;
}

.tool-button.active {
  border-color: #478a73;
  color: #326753;
  background: #e4f0ea;
}

.history-row {
  margin-top: 14rpx;
}

.history-button[disabled] {
  color: #aaa099;
  background: #eee8e1;
}

.background-button {
  border-color: #d7b8a8;
  color: #9a4d34;
  background: #fff8f4;
}

.background-button[disabled] {
  color: #b5a39a;
  background: #eee8e1;
}

.editor-help {
  margin-left: auto;
  color: #786e66;
  font-size: 22rpx;
}

.full-palette-toggle {
  width: 100%;
  margin: 16rpx 0 0;
  border: 2rpx solid #d8c7b6;
  border-radius: 16rpx;
  color: #6b5e54;
  background: #fffaf5;
  font-size: 22rpx;
  line-height: 58rpx;
}

.full-palette-toggle.active {
  border-color: #478a73;
  color: #326753;
  background: #e4f0ea;
}

.full-edit-palette {
  height: 360rpx;
  margin-top: 12rpx;
  border: 2rpx solid #e1d4c8;
  border-radius: 16rpx;
  background: #fffdf9;
}

.full-edit-palette-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8rpx;
  padding: 12rpx;
}

.edit-palette-color {
  min-width: 0;
  margin: 0;
  padding: 8rpx 2rpx;
  border: 2rpx solid transparent;
  border-radius: 13rpx;
  color: #665b53;
  background: #f8f3ed;
  font-size: 19rpx;
  line-height: 28rpx;
}

.edit-palette-color.selected {
  border-color: #478a73;
  color: #2f6754;
  background: #e5f1eb;
}

.edit-palette-dot {
  width: 30rpx;
  height: 30rpx;
  margin: 0 auto 4rpx;
  border: 2rpx solid rgba(68, 60, 54, 0.16);
  border-radius: 50%;
}

.canvas-scroll {
  width: 100%;
  margin-top: 26rpx;
  border-radius: 22rpx;
  background-color: #f4ede4;
  background-image: linear-gradient(45deg, #e9ded2 25%, transparent 25%),
    linear-gradient(-45deg, #e9ded2 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e9ded2 75%),
    linear-gradient(-45deg, transparent 75%, #e9ded2 75%);
  background-position: 0 0, 0 10rpx, 10rpx -10rpx, -10rpx 0;
  background-size: 20rpx 20rpx;
}

.canvas-frame {
  position: relative;
  margin: 0 auto;
}

.canvas-frame.editing {
  outline: 4rpx solid rgba(71, 138, 115, 0.55);
  outline-offset: -4rpx;
}

.pattern-canvas {
  display: block;
}

.edit-hit-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  background-image: linear-gradient(to right, rgba(71, 65, 59, 0.2) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(71, 65, 59, 0.2) 1px, transparent 1px);
}

.color-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 24rpx;
}

.color-chip {
  display: flex;
  align-items: center;
  min-width: 116rpx;
  padding: 10rpx 14rpx;
  border: 2rpx solid #eadfd3;
  border-radius: 18rpx;
  background: #fff;
}

.color-chip.completed {
  border-color: #8cc5ad;
  background: #eff9f4;
}

.color-chip.selected {
  border-color: #478a73;
  background: #e4f0ea;
  box-shadow: 0 0 0 3rpx rgba(71, 138, 115, 0.18);
}

.color-dot {
  width: 26rpx;
  height: 26rpx;
  margin-right: 10rpx;
  border: 2rpx solid rgba(47, 41, 37, 0.15);
  border-radius: 50%;
}

.color-code {
  color: #3f3732;
  font-size: 23rpx;
  font-weight: 650;
}

.color-amount {
  margin-left: auto;
  padding-left: 12rpx;
  color: #8b7f76;
  font-size: 22rpx;
}

.color-progress-toggle {
  flex: none;
  margin: 0 0 0 10rpx;
  padding: 0 12rpx;
  border: 2rpx solid #ded4ca;
  border-radius: 999rpx;
  color: #8b7f76;
  background: #f7f3ef;
  font-size: 18rpx;
  line-height: 42rpx;
}

.color-progress-toggle.done {
  border-color: #71b696;
  color: #287052;
  background: #ddf3e8;
}

.progress-reset-button {
  margin-top: 18rpx;
  border: 2rpx solid #e0b4a1;
  border-radius: 17rpx;
  color: #9a4d34;
  background: #fff7f2;
  font-size: 21rpx;
  line-height: 58rpx;
}

.more-colors {
  margin-top: 16rpx;
  text-align: center;
}

.decode-canvas {
  position: fixed;
  top: -100000px;
  left: -100000px;
  z-index: -1;
  pointer-events: none;
  opacity: 0;
}

.export-canvas {
  position: fixed;
  left: -10000px;
  top: 0;
  pointer-events: none;
  opacity: 0;
}
</style>
