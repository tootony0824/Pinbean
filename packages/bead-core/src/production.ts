import { calculateStatistics } from './statistics.js';
import { EMPTY_CELL, type BeadPattern, type Palette, type PaletteColor } from './types.js';
import { hashPatternContent } from './hash.js';
import { validateBeadPattern } from './validation.js';

export const MATERIAL_RESERVE_RATE = 0.08;
export const STANDARD_BOARD_SIZE = 29;
export const FAST_BEADS_PER_HOUR = 650;
export const CAREFUL_BEADS_PER_HOUR = 400;
export const PRODUCTION_TIME_BASIS_TEXT = '按每小时约 400-650 颗粗略估算，不含分装、返工、熨烫和装裱';
export const PRODUCTION_PROGRESS_FORMAT_VERSION = 2;

export interface MaterialListItem {
  code: string;
  isCompleted?: boolean;
  count: number;
  hex: string;
  name?: string | undefined;
  paletteIndex: number;
  reserveCount: number;
  textColor: '#000000' | '#FFFFFF';
}

export interface PatternExportCell {
  code: string;
  column: number;
  hex: string;
  isEmpty: boolean;
  row: number;
  textColor: '#000000' | '#FFFFFF';
}

export interface BoardPiece {
  boardColumn: number;
  boardRow: number;
  cells: PatternExportCell[];
  colors: MaterialListItem[];
  endColumn: number;
  endRow: number;
  height: number;
  id: string;
  index: number;
  rangeText: string;
  sizeText: string;
  startColumn: number;
  startRow: number;
  title: string;
  total: number;
  width: number;
}

export interface BoardPlan {
  boardSize: number;
  columns: number;
  count: number;
  pieces: BoardPiece[];
  rows: number;
}

export interface ProductionTimeRange {
  fastHours: number;
  slowHours: number;
}

export type CraftDifficultyClass = 'easy' | 'hard' | 'medium';

export interface CraftWorkStep {
  detail: string;
  index: number;
  title: string;
}

export interface CraftAssessment {
  beadText: string;
  boardCount: number;
  boardHint: string;
  boardText: string;
  colorText: string;
  hasMultipleBoards: boolean;
  level: string;
  levelClass: CraftDifficultyClass;
  sizeText: string;
  suggestion: string;
  tags: string[];
  timeText: string;
  workSteps: CraftWorkStep[];
}

export interface ProductionProgress {
  completedBoardIds: string[];
  completedColorIds: string[];
  formatVersion: typeof PRODUCTION_PROGRESS_FORMAT_VERSION;
  patternHash: string;
  legacyPatternHash?: string;
  updatedAt: number;
}

export interface ProductionProgressSummary {
  boardPercent: number;
  colorPercent: number;
  completedBeads: number;
  completedBoards: number;
  completedColors: number;
  totalBeads: number;
  totalBoards: number;
  totalColors: number;
}

function assertPatternPalette(pattern: BeadPattern, palette: Palette): Map<string, PaletteColor> {
  validateBeadPattern(pattern, palette);
  return new Map(palette.colors.map(color => [color.id, color]));
}

function assertSafeTimestamp(value: unknown, label = 'production progress timestamp'): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function acceptedPatternHash(
  storedPatternHash: unknown,
  patternHash: string,
  legacyPatternHash?: string,
): { isLegacy: boolean; storedHash: string } {
  if (typeof storedPatternHash !== 'string' || storedPatternHash.length === 0) {
    throw new Error('production progress pattern hash must be a non-empty string');
  }
  const legacyHash = legacyPatternHash && legacyPatternHash.length > 0 ? legacyPatternHash : undefined;
  if (storedPatternHash !== patternHash && storedPatternHash !== legacyHash) {
    throw new Error('production progress does not match the project pattern');
  }
  return { isLegacy: storedPatternHash === legacyHash, storedHash: storedPatternHash };
}

export function compactColorCode(code: string): string {
  return code.replace(/^([a-zA-Z]+)0+(\d+)$/, '$1$2');
}

function compareColorCodes(left: string, right: string): number {
  const leftMatch = left.match(/^([A-Za-z]+)(\d+)$/);
  const rightMatch = right.match(/^([A-Za-z]+)(\d+)$/);
  if (leftMatch && rightMatch) {
    const leftFamily = leftMatch[1];
    const leftNumber = leftMatch[2];
    const rightFamily = rightMatch[1];
    const rightNumber = rightMatch[2];
    if (leftFamily !== undefined && rightFamily !== undefined) {
      const family = leftFamily.localeCompare(rightFamily);
      if (family !== 0) return family;
    }
    if (leftNumber !== undefined && rightNumber !== undefined) return Number(leftNumber) - Number(rightNumber);
  }
  return left.localeCompare(right);
}

export function contrastTextColor(hex: string): '#000000' | '#FFFFFF' {
  const normalized = /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : '#FFFFFF';
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const luma = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luma > 0.5 ? '#000000' : '#FFFFFF';
}

export function buildMaterialList(
  pattern: BeadPattern,
  palette: Palette,
  completedColorIds: readonly string[] = [],
): MaterialListItem[] {
  const colorsById = assertPatternPalette(pattern, palette);
  const completed = new Set(completedColorIds);
  const statistics = calculateStatistics(pattern.grid, pattern.paletteTable.length - 1);
  return statistics.colors.map(item => {
    const colorId = pattern.paletteTable[item.paletteIndex];
    const color = colorId ? colorsById.get(colorId) : undefined;
    if (!color) throw new Error(`图纸色板索引无效：${item.paletteIndex}`);
    return {
      code: compactColorCode(color.code),
      count: item.count,
      hex: color.hex,
      isCompleted: completed.has(color.id),
      name: color.name,
      paletteIndex: item.paletteIndex,
      reserveCount: Math.ceil(item.count * (1 + MATERIAL_RESERVE_RATE)),
      textColor: contrastTextColor(color.hex),
    };
  }).sort((left, right) => compareColorCodes(left.code, right.code));
}

export function buildMaterialListText(
  pattern: BeadPattern,
  palette: Palette,
  colorSystem: string,
  projectName: string,
  completedColorIds: readonly string[] = [],
): string {
  const items = buildMaterialList(pattern, palette, completedColorIds);
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const reserveTotal = items.reduce((sum, item) => sum + item.reserveCount, 0);
  return [
    `PinBean 备料清单｜${projectName}`,
    `${pattern.grid.width} × ${pattern.grid.height}｜${colorSystem} 色板｜${items.length} 色`,
    `实际 ${total} 颗｜建议备料 ${reserveTotal} 颗（含约 8% 余量）`,
    `制作进度 ${items.filter(item => item.isCompleted).length}/${items.length} 色｜${items.filter(item => item.isCompleted).reduce((sum, item) => sum + item.count, 0)}/${total} 颗`,
    '',
    ...items.map(item => `${item.code}\t实际 ${item.count} 颗\t建议 ${item.reserveCount} 颗\t${item.isCompleted ? '已完成' : '待拼'}`),
  ].join('\n');
}

function materialItemForCell(
  paletteIndex: number,
  count: number,
  pattern: BeadPattern,
  colorsById: Map<string, PaletteColor>,
): MaterialListItem {
  const colorId = pattern.paletteTable[paletteIndex];
  const color = colorId ? colorsById.get(colorId) : undefined;
  if (!color) throw new Error(`图纸色板索引无效：${paletteIndex}`);
  return {
    code: compactColorCode(color.code),
    count,
    hex: color.hex,
    name: color.name,
    paletteIndex,
    reserveCount: Math.ceil(count * (1 + MATERIAL_RESERVE_RATE)),
    textColor: contrastTextColor(color.hex),
  };
}

export function buildBoardPlan(
  pattern: BeadPattern,
  palette: Palette,
  boardSize = STANDARD_BOARD_SIZE,
): BoardPlan {
  if (!Number.isInteger(boardSize) || boardSize <= 0) throw new RangeError('分板尺寸必须是正整数');
  const colorsById = assertPatternPalette(pattern, palette);
  const columns = Math.max(1, Math.ceil(pattern.grid.width / boardSize));
  const rows = Math.max(1, Math.ceil(pattern.grid.height / boardSize));
  const pieces: BoardPiece[] = [];

  for (let boardRow = 0; boardRow < rows; boardRow += 1) {
    for (let boardColumn = 0; boardColumn < columns; boardColumn += 1) {
      const startColumn = boardColumn * boardSize + 1;
      const endColumn = Math.min(pattern.grid.width, (boardColumn + 1) * boardSize);
      const startRow = boardRow * boardSize + 1;
      const endRow = Math.min(pattern.grid.height, (boardRow + 1) * boardSize);
      const width = endColumn - startColumn + 1;
      const height = endRow - startRow + 1;
      const cells: PatternExportCell[] = [];
      const counts = new Map<number, number>();

      for (let globalRow = startRow - 1; globalRow < endRow; globalRow += 1) {
        for (let globalColumn = startColumn - 1; globalColumn < endColumn; globalColumn += 1) {
          const paletteIndex = pattern.grid.cells[globalRow * pattern.grid.width + globalColumn] ?? EMPTY_CELL;
          const row = globalRow - (startRow - 1);
          const column = globalColumn - (startColumn - 1);
          if (paletteIndex === EMPTY_CELL) {
            cells.push({ code: '', column, hex: '#F5F5F5', isEmpty: true, row, textColor: '#000000' });
            continue;
          }
          const item = materialItemForCell(paletteIndex, 1, pattern, colorsById);
          cells.push({ code: item.code, column, hex: item.hex, isEmpty: false, row, textColor: item.textColor });
          counts.set(paletteIndex, (counts.get(paletteIndex) ?? 0) + 1);
        }
      }

      const colors = [...counts.entries()]
        .map(([paletteIndex, count]) => materialItemForCell(paletteIndex, count, pattern, colorsById))
        .sort((left, right) => right.count - left.count || compareColorCodes(left.code, right.code));
      const index = pieces.length + 1;
      pieces.push({
        boardColumn,
        boardRow,
        cells,
        colors,
        endColumn,
        endRow,
        height,
        id: `${boardRow + 1}-${boardColumn + 1}`,
        index,
        rangeText: `列 ${startColumn}-${endColumn} / 行 ${startRow}-${endRow}`,
        sizeText: `${width}×${height}`,
        startColumn,
        startRow,
        title: `第 ${index} 板`,
        total: colors.reduce((sum, item) => sum + item.count, 0),
        width,
      });
    }
  }

  return { boardSize, columns, count: columns * rows, pieces, rows };
}

export function estimateProductionTime(totalBeads: number): ProductionTimeRange {
  if (!Number.isSafeInteger(totalBeads) || totalBeads < 0) throw new RangeError('豆子数量必须是非负安全整数');
  if (totalBeads === 0) return { fastHours: 0, slowHours: 0 };
  const fastHours = Math.max(1, Math.ceil(totalBeads / FAST_BEADS_PER_HOUR));
  const slowHours = Math.max(fastHours, Math.ceil(totalBeads / CAREFUL_BEADS_PER_HOUR));
  return { fastHours, slowHours };
}

export function formatEstimatedTime(totalBeads: number): string {
  const { fastHours, slowHours } = estimateProductionTime(totalBeads);
  if (fastHours === slowHours) return `约 ${fastHours} 小时`;
  return `约 ${fastHours}-${slowHours} 小时`;
}

function boardCopy(plan: BoardPlan): Pick<CraftAssessment, 'boardHint' | 'boardText'> {
  if (plan.count === 1) return { boardHint: '适合先完成一块板的完整制作闭环', boardText: '1 块标准板' };
  return {
    boardHint: plan.count <= 4 ? '制作时需要对齐分板边缘' : '建议先缩小尺寸或分阶段制作',
    boardText: `${plan.columns}×${plan.rows} 拼板（共 ${plan.count} 块）`,
  };
}

function riskTags(width: number, height: number, colorCount: number, totalBeads: number): string[] {
  const maxSide = Math.max(width, height);
  const tags: string[] = [];
  if (colorCount > 28) tags.push('颜色偏多');
  if (maxSide > 58) tags.push('尺寸偏大');
  if (totalBeads > 2600) tags.push('耗时较长');
  if (colorCount <= 14 && maxSide <= 38 && totalBeads <= 1200) tags.push('适合入门');
  if (tags.length === 0) tags.push('难度适中');
  return tags.slice(0, 3);
}

function suggestion(width: number, height: number, colorCount: number, totalBeads: number): string {
  const maxSide = Math.max(width, height);
  if (maxSide > 58) return '建议先把尺寸降到 58 格以内，成品更容易摆板和熨烫。';
  if (colorCount > 28) return '颜色有点分散，可以在编辑模式中合并相近色。';
  if (totalBeads > 2600) return '颗数较多，建议按颜色清单分批摆放，先拼大色块。';
  if (maxSide <= 29) return '这张适合做挂件或试拼，可以直接导出色卡图纸。';
  return '整体可做，导出前建议检查脸部、文字和轮廓等关键细节。';
}

function compareMaterialPriority(left: MaterialListItem, right: MaterialListItem): number {
  return right.count - left.count || left.code.localeCompare(right.code, 'zh-CN', { numeric: true });
}

function workSteps(materials: MaterialListItem[], plan: BoardPlan): CraftWorkStep[] {
  const topColors = [...materials]
    .sort(compareMaterialPriority)
    .slice(0, 3)
    .map(item => `${item.code} ${item.count}颗`)
    .join('、');
  const steps: Omit<CraftWorkStep, 'index'>[] = [
    { detail: topColors ? `优先处理 ${topColors}` : '先从数量最多的颜色开始', title: '先拼大色块' },
    plan.count > 1
      ? { detail: '从第 1 板开始，按从左到右、从上到下推进，并逐块对齐边缘', title: '按分板推进' }
      : { detail: '先固定主体轮廓，再填充内部颜色', title: '一板完成' },
    materials.length > 20
      ? { detail: '颜色较多，熨烫前重点检查相近色号', title: '最后校对相近色' }
      : { detail: '少量颜色和边缘位置放到最后检查', title: '最后补细节' },
  ];
  return steps.map((step, index) => ({ ...step, index: index + 1 }));
}

export function buildCraftAssessment(pattern: BeadPattern, palette: Palette, plan: BoardPlan): CraftAssessment {
  assertPatternPalette(pattern, palette);
  validateBoardPlanForPattern(pattern, plan);
  if (plan.count < 1) throw new Error('制作评估需要有效的分板计划');
  const statistics = calculateStatistics(pattern.grid, pattern.paletteTable.length - 1);
  const materials = buildMaterialList(pattern, palette);
  const colorCount = statistics.colors.length;
  const totalBeads = statistics.total;
  const maxSide = Math.max(pattern.grid.width, pattern.grid.height);
  let level = '进阶挑战';
  let levelClass: CraftDifficultyClass = 'hard';
  if (colorCount <= 14 && totalBeads <= 1200 && maxSide <= 38) {
    level = '新手友好';
    levelClass = 'easy';
  } else if (colorCount <= 26 && totalBeads <= 2600 && maxSide <= 58) {
    level = '舒适可做';
    levelClass = 'medium';
  }
  const board = boardCopy(plan);
  return {
    beadText: `${totalBeads} 颗`,
    boardCount: plan.count,
    boardHint: board.boardHint,
    boardText: board.boardText,
    colorText: `${colorCount} 色`,
    hasMultipleBoards: plan.count > 1,
    level,
    levelClass,
    sizeText: `${pattern.grid.width}×${pattern.grid.height}`,
    suggestion: suggestion(pattern.grid.width, pattern.grid.height, colorCount, totalBeads),
    tags: riskTags(pattern.grid.width, pattern.grid.height, colorCount, totalBeads),
    timeText: formatEstimatedTime(totalBeads),
    workSteps: workSteps(materials, plan),
  };
}

export function buildCraftPlanText(projectName: string, assessment: CraftAssessment): string {
  const steps = assessment.workSteps.map(step => `${step.index}. ${step.title}：${step.detail}`).join('\n');
  return [
    `PinBean 制作计划｜${projectName || '我的拼豆图纸'}`,
    `${assessment.sizeText}｜${assessment.beadText}｜${assessment.colorText}｜${assessment.boardText}`,
    `难度：${assessment.level}｜粗略摆豆时间：${assessment.timeText}`,
    '',
    '推荐制作顺序：',
    steps,
    '',
    assessment.suggestion,
  ].join('\n');
}

export function buildProgressReviewText(
  projectName: string,
  assessment: CraftAssessment,
  progress: ProductionProgressSummary,
): string {
  const isComplete = progress.totalBeads > 0 && (progress.colorPercent === 100 || progress.boardPercent === 100);
  const title = isComplete ? '这张拼豆完成啦' : '拼豆制作进度';
  const status = isComplete
    ? '从图纸到一颗颗摆完，终于收尾。'
    : progress.completedBeads > 0 || progress.completedBoards > 0
      ? '慢慢拼，记录一下这次进度。'
      : '准备开拼，先把制作计划记下来。';
  return [
    `${title}｜${projectName || '我的拼豆图纸'}`,
    `${assessment.sizeText}｜${assessment.beadText}｜${assessment.colorText}｜${assessment.boardText}`,
    `色号进度：${progress.completedColors}/${progress.totalColors} 色｜${progress.completedBeads}/${progress.totalBeads} 颗｜${progress.colorPercent}%`,
    `分板进度：${progress.completedBoards}/${progress.totalBoards} 板｜${progress.boardPercent}%`,
    status,
    '',
    '#拼豆 #拼豆图纸 #手工DIY #制作过程 #PinBean',
  ].join('\n');
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array of non-empty strings`);
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) throw new TypeError(`${label}[${index}] must not be a hole`);
    const item = value[index];
    if (typeof item !== 'string' || item.length === 0) {
      throw new TypeError(`${label} must be an array of non-empty strings`);
    }
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicates`);
}

function assertProductionProgressShape(
  progress: ProductionProgress,
  availableColorIds?: ReadonlySet<string>,
  availableBoardIds?: ReadonlySet<string>,
): void {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
    throw new TypeError('production progress must be an object');
  }
  if (progress.formatVersion !== PRODUCTION_PROGRESS_FORMAT_VERSION) {
    throw new Error(`unsupported production progress format: ${String(progress.formatVersion)}`);
  }
  if (typeof progress.patternHash !== 'string' || progress.patternHash.length === 0) {
    throw new Error('production progress pattern hash must be a non-empty string');
  }
  if (progress.legacyPatternHash !== undefined
    && (typeof progress.legacyPatternHash !== 'string' || progress.legacyPatternHash.length === 0)) {
    throw new Error('legacy production progress pattern hash must be a non-empty string when present');
  }
  assertSafeTimestamp(progress.updatedAt);
  assertStringArray(progress.completedColorIds, 'completed color ids');
  assertStringArray(progress.completedBoardIds, 'completed board ids');
  if (availableColorIds) {
    for (const colorId of progress.completedColorIds) {
      if (!availableColorIds.has(colorId)) throw new Error(`production progress references unavailable color: ${colorId}`);
    }
  }
  if (availableBoardIds) {
    for (const boardId of progress.completedBoardIds) {
      if (!availableBoardIds.has(boardId)) throw new Error(`production progress references unavailable board: ${boardId}`);
    }
  }
}

function validateBoardPlanForPattern(pattern: BeadPattern, plan: BoardPlan): void {
  validateBeadPattern(pattern);
  if (!Number.isSafeInteger(plan.boardSize) || plan.boardSize <= 0) throw new RangeError('分板尺寸必须是正整数');
  const columns = Math.max(1, Math.ceil(pattern.grid.width / plan.boardSize));
  const rows = Math.max(1, Math.ceil(pattern.grid.height / plan.boardSize));
  const count = columns * rows;
  if (plan.columns !== columns || plan.rows !== rows || plan.count !== count || plan.pieces.length !== count) {
    throw new Error('分板计划与图纸尺寸不一致');
  }
  const seenIds = new Set<string>();
  for (let index = 0; index < plan.pieces.length; index += 1) {
    const piece = plan.pieces[index];
    if (!piece) throw new Error(`分板计划缺少第 ${index + 1} 板`);
    if (seenIds.has(piece.id)) throw new Error(`分板计划包含重复板号：${piece.id}`);
    seenIds.add(piece.id);
    const boardRow = Math.floor(index / columns);
    const boardColumn = index % columns;
    const startColumn = boardColumn * plan.boardSize + 1;
    const endColumn = Math.min(pattern.grid.width, (boardColumn + 1) * plan.boardSize);
    const startRow = boardRow * plan.boardSize + 1;
    const endRow = Math.min(pattern.grid.height, (boardRow + 1) * plan.boardSize);
    const width = endColumn - startColumn + 1;
    const height = endRow - startRow + 1;
    if (piece.boardRow !== boardRow || piece.boardColumn !== boardColumn || piece.index !== index + 1
      || piece.id !== `${boardRow + 1}-${boardColumn + 1}`
      || piece.startColumn !== startColumn || piece.endColumn !== endColumn
      || piece.startRow !== startRow || piece.endRow !== endRow
      || piece.width !== width || piece.height !== height
      || piece.cells.length !== width * height) {
      throw new Error(`分板计划第 ${index + 1} 板与图纸尺寸不一致`);
    }
    const nonEmptyCells = piece.cells.reduce((total, cell) => total + (cell.isEmpty ? 0 : 1), 0);
    const colorTotal = piece.colors.reduce((total, item) => total + item.count, 0);
    if (piece.total !== nonEmptyCells || piece.total !== colorTotal) {
      throw new Error(`分板计划第 ${index + 1} 板颗数不一致`);
    }
  }
}

export function createProductionProgress(pattern: BeadPattern, updatedAt = Date.now()): ProductionProgress {
  validateBeadPattern(pattern);
  assertSafeTimestamp(updatedAt);
  return {
    completedBoardIds: [],
    completedColorIds: [],
    formatVersion: PRODUCTION_PROGRESS_FORMAT_VERSION,
    patternHash: hashPatternContent(pattern),
    updatedAt,
  };
}

export function restoreProductionProgress(
  input: unknown,
  pattern: BeadPattern,
  availableColorIds: ReadonlySet<string>,
  availableBoardIds: ReadonlySet<string>,
  legacyPatternHash?: string,
): ProductionProgress {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('production progress must be an object');
  const stored = input as Record<string, unknown>;
  if (stored.formatVersion !== 1 && stored.formatVersion !== PRODUCTION_PROGRESS_FORMAT_VERSION) {
    throw new Error(`unsupported production progress format: ${String(stored.formatVersion)}`);
  }
  validateBeadPattern(pattern);
  const patternHash = hashPatternContent(pattern);
  const hashMatch = acceptedPatternHash(stored.patternHash, patternHash, legacyPatternHash);
  assertSafeTimestamp(stored.updatedAt);
  assertStringArray(stored.completedColorIds, 'completed color ids');
  assertStringArray(stored.completedBoardIds, 'completed board ids');
  for (const colorId of stored.completedColorIds) {
    if (!availableColorIds.has(colorId)) throw new Error(`production progress references unavailable color: ${colorId}`);
  }
  for (const boardId of stored.completedBoardIds) {
    if (!availableBoardIds.has(boardId)) throw new Error(`production progress references unavailable board: ${boardId}`);
  }
  return {
    completedBoardIds: [...stored.completedBoardIds].sort(),
    completedColorIds: [...stored.completedColorIds].sort(),
    formatVersion: PRODUCTION_PROGRESS_FORMAT_VERSION,
    ...(hashMatch.isLegacy ? { legacyPatternHash: hashMatch.storedHash } : {}),
    patternHash,
    updatedAt: stored.updatedAt as number,
  };
}

function toggleId(values: readonly string[], id: string): string[] {
  const next = new Set(values);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return [...next].sort();
}

export function toggleProductionColor(
  progress: ProductionProgress,
  colorId: string,
  availableColorIds: ReadonlySet<string>,
  updatedAt = Date.now(),
): ProductionProgress {
  assertProductionProgressShape(progress, availableColorIds);
  assertSafeTimestamp(updatedAt);
  if (!availableColorIds.has(colorId)) throw new Error(`cannot toggle unavailable color: ${colorId}`);
  return { ...progress, completedColorIds: toggleId(progress.completedColorIds, colorId), updatedAt };
}

export function toggleProductionBoard(
  progress: ProductionProgress,
  boardId: string,
  availableBoardIds: ReadonlySet<string>,
  updatedAt = Date.now(),
): ProductionProgress {
  assertProductionProgressShape(progress, undefined, availableBoardIds);
  assertSafeTimestamp(updatedAt);
  if (!availableBoardIds.has(boardId)) throw new Error(`cannot toggle unavailable board: ${boardId}`);
  return { ...progress, completedBoardIds: toggleId(progress.completedBoardIds, boardId), updatedAt };
}

export function summarizeProductionProgress(
  pattern: BeadPattern,
  plan: BoardPlan,
  progress: ProductionProgress,
  legacyPatternHash?: string,
): ProductionProgressSummary {
  validateBoardPlanForPattern(pattern, plan);
  const availableColorIds = new Set(pattern.paletteTable.slice(1));
  const availableBoardIds = new Set(plan.pieces.map(piece => piece.id));
  assertProductionProgressShape(progress, availableColorIds, availableBoardIds);
  const patternHash = hashPatternContent(pattern);
  acceptedPatternHash(progress.patternHash, patternHash, legacyPatternHash);
  const statistics = calculateStatistics(pattern.grid, pattern.paletteTable.length - 1);
  const completedColorIds = new Set(progress.completedColorIds);
  const totalBeads = statistics.total;
  const completedBeads = statistics.colors.reduce((total, item) => {
    const colorId = pattern.paletteTable[item.paletteIndex];
    return colorId && completedColorIds.has(colorId) ? total + item.count : total;
  }, 0);
  const totalColors = statistics.colors.length;
  const completedColors = statistics.colors.reduce((total, item) => {
    const colorId = pattern.paletteTable[item.paletteIndex];
    return colorId && completedColorIds.has(colorId) ? total + 1 : total;
  }, 0);
  const completedBoards = new Set(progress.completedBoardIds).size;
  return {
    boardPercent: plan.count > 0 ? Math.round(completedBoards / plan.count * 100) : 0,
    colorPercent: totalBeads > 0 ? Math.round(completedBeads / totalBeads * 100) : 0,
    completedBeads,
    completedBoards,
    completedColors,
    totalBeads,
    totalBoards: plan.count,
    totalColors,
  };
}

export function productionProgressStorageKey(projectId: string, pattern: BeadPattern): string {
  if (!projectId) throw new Error('project id is required for production progress');
  return `pinbean:production-progress:v2:${encodeURIComponent(projectId)}:${hashPatternContent(pattern)}`;
}

export function legacyProductionProgressStorageKey(projectId: string, legacyPatternHash: string): string {
  if (!projectId) throw new Error('project id is required for production progress');
  if (!legacyPatternHash) throw new Error('legacy pattern hash is required');
  return `pinbean:production-progress:v1:${encodeURIComponent(projectId)}:${legacyPatternHash}`;
}
