import { GridDownloadOptions } from '../types/downloadTypes';
import { MappedPixel, PaletteColor } from './pixelation';
import { getDisplayColorKey, getColorKeyByHex, ColorSystem } from './colorSystemUtils';

const MAX_CSV_BYTES = 256 * 1024;
const MAX_CSV_ROWS = 500;
const MAX_CSV_COLUMNS = 500;
const MAX_CSV_CELLS = 100_000;

function getContrastColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#000000';
  const luma = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luma > 0.5 ? '#000000' : '#FFFFFF';
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const formattedHex = hex.replace(shorthandRegex, (_match, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(formattedHex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function compactColorKey(key: string): string {
  return key.replace(/^([a-zA-Z]+)0+(\d+)$/, '$1$2');
}

function sortColorKeys(a: string, b: string): number {
  const regex = /^([A-Z]+)(\d+)$/;
  const matchA = a.match(regex);
  const matchB = b.match(regex);

  if (matchA && matchB) {
    if (matchA[1] !== matchB[1]) {
      return matchA[1].localeCompare(matchB[1]);
    }
    return parseInt(matchA[2], 10) - parseInt(matchB[2], 10);
  }
  return a.localeCompare(b);
}

export function exportCsvData({
  mappedPixelData,
  gridDimensions,
  selectedColorSystem
}: {
  mappedPixelData: MappedPixel[][] | null;
  gridDimensions: { N: number; M: number } | null;
  selectedColorSystem: ColorSystem;
}): void {
  if (!mappedPixelData || !gridDimensions) {
    console.error('导出失败: 映射数据或尺寸无效。');
    alert('无法导出CSV，数据未生成或无效。');
    return;
  }

  const { N, M } = gridDimensions;
  const csvLines: string[] = [];

  for (let row = 0; row < M; row++) {
    const rowData: string[] = [];
    for (let col = 0; col < N; col++) {
      const cellData = mappedPixelData[row][col];
      rowData.push(cellData && !cellData.isExternal ? cellData.color : 'TRANSPARENT');
    }
    csvLines.push(rowData.join(','));
  }

  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `bead-pattern-${N}x${M}-${selectedColorSystem}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function importCsvData(file: File): Promise<{
  mappedPixelData: MappedPixel[][];
  gridDimensions: { N: number; M: number };
}> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_CSV_BYTES) {
      reject(new Error(`CSV文件不能超过 ${Math.round(MAX_CSV_BYTES / 1024)}KB`));
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text || text.trim().length === 0) {
          reject(new Error('CSV文件为空'));
          return;
        }

        const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim().length > 0);
        const M = lines.length;
        if (M === 0) {
          reject(new Error('CSV文件为空'));
          return;
        }
        if (M > MAX_CSV_ROWS) {
          reject(new Error(`CSV行数不能超过 ${MAX_CSV_ROWS} 行`));
          return;
        }

        const N = lines[0].split(',').length;
        if (N === 0 || N > MAX_CSV_COLUMNS) {
          reject(new Error(`CSV列数必须在 1-${MAX_CSV_COLUMNS} 之间`));
          return;
        }
        if (N * M > MAX_CSV_CELLS) {
          reject(new Error(`CSV格子数不能超过 ${MAX_CSV_CELLS} 个`));
          return;
        }

        const mappedPixelData: MappedPixel[][] = [];
        for (let row = 0; row < M; row++) {
          const rowData = lines[row].split(',');
          if (rowData.length !== N) {
            reject(new Error(`第${row + 1}行的列数不匹配，期望${N}列，实际${rowData.length}列`));
            return;
          }

          const mappedRow: MappedPixel[] = [];
          for (let col = 0; col < N; col++) {
            const cellValue = rowData[col].trim();
            if (cellValue === 'TRANSPARENT' || cellValue === '') {
              mappedRow.push({
                key: 'TRANSPARENT',
                color: '#FFFFFF',
                isExternal: true
              });
              continue;
            }

            if (!/^#[0-9A-Fa-f]{6}$/.test(cellValue)) {
              reject(new Error(`第${row + 1}行第${col + 1}列的颜色值无效：${cellValue}`));
              return;
            }

            mappedRow.push({
              key: cellValue.toUpperCase(),
              color: cellValue.toUpperCase(),
              isExternal: false
            });
          }
          mappedPixelData.push(mappedRow);
        }

        resolve({ mappedPixelData, gridDimensions: { N, M } });
      } catch (error) {
        reject(new Error(`解析CSV文件失败：${error}`));
      }
    };

    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file, 'utf-8');
  });
}

export async function downloadImage({
  mappedPixelData,
  gridDimensions,
  colorCounts,
  totalBeadCount,
  options,
  activeBeadPalette,
  selectedColorSystem
}: {
  mappedPixelData: MappedPixel[][] | null;
  gridDimensions: { N: number; M: number } | null;
  colorCounts: { [key: string]: { count: number; color: string } } | null;
  totalBeadCount: number;
  options: GridDownloadOptions;
  activeBeadPalette: PaletteColor[];
  selectedColorSystem: ColorSystem;
}): Promise<void> {
  if (!mappedPixelData || !gridDimensions || gridDimensions.N === 0 || gridDimensions.M === 0 || activeBeadPalette.length === 0) {
    console.error('下载失败: 映射数据或尺寸无效。');
    alert('无法下载图纸，数据未生成或无效。');
    return;
  }
  if (!colorCounts) {
    console.error('下载失败: 色号统计数据无效。');
    alert('无法下载图纸，色号统计数据未生成或无效。');
    return;
  }

  const { N, M } = gridDimensions;
  const { showGrid, gridInterval, showCoordinates, gridLineColor, includeStats, showCellNumbers = true } = options;
  const cell = 24;
  const headerH = 80;
  const numberSize = showCoordinates ? cell : 0;
  const gridGap = showGrid ? 2 : 0;
  const gridWidth = N * cell;
  const gridHeight = M * cell;
  const contentWidth = gridWidth + numberSize * 2;
  const contentHeight = gridHeight + numberSize * 2;
  const colorKeys = Object.keys(colorCounts).sort((left, right) => {
    const leftKey = compactColorKey(getColorKeyByHex(left, selectedColorSystem));
    const rightKey = compactColorKey(getColorKeyByHex(right, selectedColorSystem));
    return sortColorKeys(leftKey, rightKey);
  });

  const legendPaddingX = 20;
  const legendPaddingY = 20;
  const legendItemWidth = 100;
  const legendItemHeight = 30;
  const itemsPerRow = Math.max(1, Math.min(colorKeys.length || 1, Math.floor((contentWidth - legendPaddingX * 2) / legendItemWidth)));
  const actualItemWidth = (contentWidth - legendPaddingX * 2) / itemsPerRow;
  const legendRows = Math.ceil(colorKeys.length / itemsPerRow);
  const footerH = includeStats && colorKeys.length > 0
    ? legendPaddingY * 2 + legendRows * legendItemHeight
    : 0;

  const canvas = document.createElement('canvas');
  canvas.width = contentWidth;
  canvas.height = headerH + contentHeight + footerH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    alert('无法下载图纸。');
    return;
  }
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = '#F7F8FA';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const exportTitle = '🎨 豆画';
  ctx.fillStyle = '#1C1C1E';
  ctx.font = '900 32px "Arial Rounded MT Bold", "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(exportTitle, 24, headerH / 2);

  const titleWidth = ctx.measureText(exportTitle).width;
  ctx.fillStyle = '#8E8E93';
  ctx.font = '600 18px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  ctx.fillText(`|   ${selectedColorSystem}色板 · 共 ${totalBeadCount} 颗`, 24 + titleWidth + 18, headerH / 2 + 2);

  const gridStartX = numberSize;
  const gridStartY = headerH + numberSize;
  ctx.fillStyle = showGrid ? '#F5F5F5' : '#FFFFFF';
  ctx.fillRect(gridStartX, gridStartY, gridWidth, gridHeight);

  if (showCoordinates) {
    ctx.fillStyle = '#E0E8F0';
    ctx.font = `bold ${Math.max(12, Math.floor(cell * 0.5))}px "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let col = 0; col < N; col++) {
      const x = gridStartX + col * cell;
      ctx.fillStyle = '#E0E8F0';
      ctx.fillRect(x + gridGap, headerH + gridGap, cell - gridGap, cell - gridGap);
      ctx.fillRect(x + gridGap, gridStartY + gridHeight + gridGap, cell - gridGap, cell - gridGap);
      ctx.fillStyle = '#333333';
      ctx.fillText(String(col + 1), x + cell / 2, headerH + cell / 2);
      ctx.fillText(String(col + 1), x + cell / 2, gridStartY + gridHeight + cell / 2);
    }

    for (let row = 0; row < M; row++) {
      const y = gridStartY + row * cell;
      ctx.fillStyle = '#E0E8F0';
      ctx.fillRect(gridGap, y + gridGap, cell - gridGap, cell - gridGap);
      ctx.fillRect(gridStartX + gridWidth + gridGap, y + gridGap, cell - gridGap, cell - gridGap);
      ctx.fillStyle = '#333333';
      ctx.fillText(String(row + 1), cell / 2, y + cell / 2);
      ctx.fillText(String(row + 1), gridStartX + gridWidth + cell / 2, y + cell / 2);
    }
  }

  for (let row = 0; row < M; row++) {
    for (let col = 0; col < N; col++) {
      const pixel = mappedPixelData[row][col];
      const x = gridStartX + col * cell;
      const y = gridStartY + row * cell;
      const isExternal = !pixel || pixel.isExternal;
      const color = isExternal ? '#F5F5F5' : pixel.color;
      const inset = gridGap / 2;

      ctx.fillStyle = color;
      ctx.fillRect(x + inset, y + inset, cell - gridGap, cell - gridGap);

      if (!isExternal && showCellNumbers) {
        const key = compactColorKey(getDisplayColorKey(pixel.color, selectedColorSystem));
        const fontSize = key.length <= 2 ? 15 : key.length === 3 ? 11 : 9;
        ctx.fillStyle = getContrastColor(pixel.color);
        ctx.font = `bold ${fontSize}px "PingFang SC", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(key, x + cell / 2, y + cell / 2);
      }
    }
  }

  if (showGrid && gridInterval > 0) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = gridLineColor;
    ctx.lineWidth = 1;
    for (let col = gridInterval; col < N; col += gridInterval) {
      const x = gridStartX + col * cell;
      ctx.beginPath();
      ctx.moveTo(x, gridStartY);
      ctx.lineTo(x, gridStartY + gridHeight);
      ctx.stroke();
    }
    for (let row = gridInterval; row < M; row += gridInterval) {
      const y = gridStartY + row * cell;
      ctx.beginPath();
      ctx.moveTo(gridStartX, y);
      ctx.lineTo(gridStartX + gridWidth, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (includeStats && footerH > 0) {
    const legendStartY = headerH + contentHeight;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, legendStartY, contentWidth, footerH);

    colorKeys.forEach((hex, index) => {
      const col = index % itemsPerRow;
      const row = Math.floor(index / itemsPerRow);
      const x = legendPaddingX + col * actualItemWidth;
      const y = legendStartY + legendPaddingY + row * legendItemHeight;
      const blockWidth = actualItemWidth - 10;
      const blockHeight = 24;
      const key = compactColorKey(getColorKeyByHex(hex, selectedColorSystem));
      const color = colorCounts[hex].color;

      ctx.fillStyle = color;
      ctx.fillRect(x, y + (legendItemHeight - blockHeight) / 2, blockWidth, blockHeight);
      ctx.strokeStyle = '#E0E0E0';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y + (legendItemHeight - blockHeight) / 2, blockWidth, blockHeight);
      ctx.fillStyle = getContrastColor(color);
      ctx.font = 'bold 12px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${key} (${colorCounts[hex].count})`, x + blockWidth / 2, y + legendItemHeight / 2);
    });
  }

  try {
    const link = document.createElement('a');
    link.download = showCellNumbers
      ? `bead-grid-${N}x${M}-keys-palette_${selectedColorSystem}.png`
      : `bead-grid-${N}x${M}-pixel-palette_${selectedColorSystem}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (options.exportCsv) {
      exportCsvData({ mappedPixelData, gridDimensions, selectedColorSystem });
    }
  } catch (error) {
    console.error('下载图纸失败:', error);
    alert('无法生成图纸下载链接。');
  }
}
