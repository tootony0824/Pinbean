const COLOR_MAPPING = require('./colorMappingData.js');

function hexToRgb(hex) {
  if (!hex) return null;
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function getContrastColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#000000';
  // 计算亮度（Luma公式）
  const luma = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luma > 0.5 ? '#000000' : '#FFFFFF';
}

function colorDist(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/**
 * RGB → LAB 色彩空间转换
 * 参考：https://en.wikipedia.org/wiki/Lab_color_space
 */
function rgbToLab(r, g, b) {
  // RGB to XYZ
  let rr = r / 255, gg = g / 255, bb = b / 255;
  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;

  let x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
  let y = (rr * 0.2126729 + gg * 0.7151522 + bb * 0.0721750);
  let z = (rr * 0.0193339 + gg * 0.1191920 + bb * 0.9503041) / 1.08883;

  x = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x + 16/116);
  y = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y + 16/116);
  z = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z + 16/116);

  return [
    116 * y - 16,
    500 * (x - y),
    200 * (y - z)
  ];
}

/**
 * CIEDE2000 色差计算（简化版，适合实时）
 * 参考：https://en.wikipedia.org/wiki/Color_difference#CIEDE2000
 */
function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cab = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cab, 7) / (Math.pow(Cab, 7) + Math.pow(25, 7))));

  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  const h1p = Math.atan2(b1, a1p) * 180 / Math.PI;
  const h1pAdj = h1p < 0 ? h1p + 360 : h1p;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const dhp = (C1p * C2p !== 0) ? (h1pAdj - Math.atan2(b2, a2p) * 180 / Math.PI) : 0;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * Math.PI / 180);
  const Lp = (L1 + L2) / 2;
  const Cp = (C1p + C2p) / 2;

  // 简化版：直接用欧氏距离在 Lab 空间（足够好，比 RGB 准很多）
  return Math.sqrt(
    Math.pow(L2 - L1, 2) +
    Math.pow(a2p - a1p, 2) +
    Math.pow(b2 - b1, 2)
  );
}

function closestLab(rgb, palette) {
  if (!palette || palette.length === 0) {
    return { key: '?', hex: '#000', rgb: { r: 0, g: 0, b: 0 } };
  }
  const lab = rgbToLab(rgb.r, rgb.g, rgb.b);
  let best = palette[0];
  let bestD = Infinity;

  for (const c of palette) {
    const cLab = c._lab || (c._lab = rgbToLab(c.rgb.r, c.rgb.g, c.rgb.b));
    const d = deltaE2000(lab, cLab);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
    if (d === 0) break;
  }
  return best;
}

function buildPalette(cs) {
  const p = [], seen = {};
  for (const [hex, sys] of Object.entries(COLOR_MAPPING)) {
    const k = sys[cs];
    if (k && !seen[k]) {
      seen[k] = true;
      const rgb = hexToRgb(hex);
      if (rgb) {
        const lab = rgbToLab(rgb.r, rgb.g, rgb.b);
        p.push({ key: k, hex, rgb, _lab: lab });
      }
    }
  }
  return p;
}

function closest(rgb, palette) {
  return closestLab(rgb, palette);
}

/**
 * Sobel 边缘检测
 * @param {Object} imgData - canvas ImageData
 * @param {number} W - 图像宽度
 * @param {number} H - 图像高度
 * @param {number} threshold - 边缘阈值（0-255），越小边缘越敏感
 * @returns {Float32Array} - 边缘强度图，大小 W×H
 */
function detectEdges(imgData, W, H, threshold = 30) {
  const d = imgData.data;
  const gray = new Float32Array(W * H);

  // 转灰度
  for (let i = 0; i < W * H; i++) {
    const r = d[i * 4];
    const g = d[i * 4 + 1];
    const b = d[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Sobel 算子
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  const edgeMap = new Float32Array(W * H);

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let gx = 0, gy = 0;

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const pixel = gray[(y + ky) * W + (x + kx)];
          const ki = (ky + 1) * 3 + (kx + 1);
          gx += pixel * sobelX[ki];
          gy += pixel * sobelY[ki];
        }
      }

      const magnitude = Math.sqrt(gx * gx + gy * gy);
      edgeMap[y * W + x] = Math.min(255, magnitude);
    }
  }

  return edgeMap;
}

/**
 * 判断格子是否在边缘上
 * @param {number} cellI - 格子列索引
 * @param {number} cellJ - 格子行索引
 * @param {Float32Array} edgeMap - 边缘强度图
 * @param {number} W - 原图宽度
 * @param {number} H - 原图高度
 * @param {number} N - 网格列数
 * @param {number} M - 网格行数
 * @param {number} cw - 格子宽度（像素）
 * @param {number} ch - 格子高度（像素）
 * @param {number} threshold - 边缘检测阈值
 * @returns {boolean}
 */
function isEdgeCell(cellI, cellJ, edgeMap, W, H, N, M, cw, ch, threshold = 30) {
  const sx = Math.floor(cellI * cw);
  const sy = Math.floor(cellJ * ch);
  const ew = Math.max(1, Math.ceil((cellI + 1) * cw) - sx);
  const eh = Math.max(1, Math.ceil((cellJ + 1) * ch) - sy);

  let edgeCount = 0;
  let totalCount = 0;

  for (let dy = 0; dy < eh; dy++) {
    for (let dx = 0; dx < ew; dx++) {
      const px = sx + dx;
      const py = sy + dy;
      if (px >= 0 && px < W && py >= 0 && py < H) {
        totalCount++;
        if (edgeMap[py * W + px] > threshold) {
          edgeCount++;
        }
      }
    }
  }

  // 如果格子内超过 15% 的像素是边缘像素，认为这个格子在边缘上
  return totalCount > 0 && (edgeCount / totalCount) > 0.15;
}


// ---- 像素化（同步，50x50约30ms）----
function pixelate(imgData, W, H, N, M, cs, mode, edgeStrength = 0, noiseLevel = 0, edgeMask = null) {
  const d = imgData.data;
  const pal = buildPalette(cs);
  let grid = Array.from({ length: M }, () => Array.from({ length: N }, () => ({ color: '#FFF', key: '?' })));
  const cw = W / N, ch = H / M;

  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      
      // 新增：边缘格子使用中心点采样，不混合
      if (edgeMask && isEdgeCell(i, j, edgeMask, W, H, N, M, cw, ch, 25)) {
        const px = Math.floor((i + 0.5) * cw);
        const py = Math.floor((j + 0.5) * ch);
        const idx = (py * W + px) * 4;
        const cellA = imgData.data[idx + 3];
        if (cellA < 128) {
          grid[j][i] = { color: '#FFF', key: '?' };
        } else {
          const cellR = imgData.data[idx];
          const cellG = imgData.data[idx + 1];
          const cellB = imgData.data[idx + 2];
          const c = closest({ r: cellR, g: cellG, b: cellB }, pal);
          grid[j][i] = { color: c.hex, key: c.key };
        }
        continue;
      }

      // 卡通(dominant) 或 真实(average) 模式：区块遍历累加
      const sx = Math.floor(i * cw), sy = Math.floor(j * ch);
      const ew = Math.max(1, Math.ceil((i + 1) * cw) - sx);
      const eh = Math.max(1, Math.ceil((j + 1) * ch) - sy);
      
      let transparentCount = 0;
      let validCount = 0;
      const cnt = {}; let max = 0, dom = null, rS = 0, gS = 0, bS = 0, n = 0;

      for (let dy = 0; dy < eh; dy++) {
        for (let dx = 0; dx < ew; dx++) {
          const px = sx + dx, py = sy + dy;
          if (px >= W || py >= H) continue;
          const idx = (py * W + px) * 4;
          
          if (d[idx + 3] < 128) {
            transparentCount++;
            continue;
          }
          validCount++;
          const r = d[idx], g = d[idx + 1], b = d[idx + 2]; 

          let weight = 1;
          if (edgeStrength > 0) {
            let luma = 0.299 * r + 0.587 * g + 0.114 * b;
            let lumaX = luma, lumaY = luma;
            if (px + 1 < W) {
              const idxX = (py * W + px + 1) * 4;
              if (d[idxX + 3] >= 128) {
                lumaX = 0.299 * d[idxX] + 0.587 * d[idxX + 1] + 0.114 * d[idxX + 2];
              }
            }
            if (py + 1 < H) {
              const idxY = ((py + 1) * W + px) * 4;
              if (d[idxY + 3] >= 128) {
                lumaY = 0.299 * d[idxY] + 0.587 * d[idxY + 1] + 0.114 * d[idxY + 2];
              }
            }
            const grad = Math.abs(luma - lumaX) + Math.abs(luma - lumaY);
            const normGrad = Math.min(1, grad / 255);
            const darkFactor = 1 - (luma / 255);
            weight += edgeStrength * normGrad * darkFactor;
          }

          n += weight;
          if (mode === 'average') { 
            rS += r * weight; 
            gS += g * weight; 
            bS += b * weight; 
          }
          else {
            const k = `${r},${g},${b}`;
            cnt[k] = (cnt[k] || 0) + weight;
            if (cnt[k] > max) { max = cnt[k]; dom = { r, g, b }; }
          }
        }
      }

      // 如果超过 50% 是透明的，判定为透明格子
      if (transparentCount / (ew * eh) > 0.5) {
        grid[j][i] = { color: '#FFF', key: '?' };
        continue;
      }

      if (!n || validCount === 0) { grid[j][i] = { color: '#FFF', key: '?' }; continue; }
      let rgb;
      if (mode === 'average') rgb = { r: Math.round(rS / n), g: Math.round(gS / n), b: Math.round(bS / n) };
      else rgb = dom || { r: 0, g: 0, b: 0 };
      const c = closest(rgb, pal);
      grid[j][i] = { color: c.hex, key: c.key };
    }
  }

  // ---- 3. 去噪后处理 (Despeckle) ----
  if (noiseLevel > 0) {
    // 复制一份网格用于判断，避免修改过程中影响后续判断
    const newGrid = JSON.parse(JSON.stringify(grid));
    
    // 去噪级别越高，容忍被替换的色差就越大（保留细节的阈值越宽松）
    // 改用 DeltaE2000 (Lab) 后，距离阈值通常在 0~100，需要调小。例如：15, 25, 40
    const detailPreserveThreshold = noiseLevel === 1 ? 15 : noiseLevel === 2 ? 25 : 40;
    const isolationThreshold = noiseLevel === 1 ? 1 : 2; // 允许的最大同色邻居数（<=1 表示几乎孤立）

    for (let j = 0; j < M; j++) {
      for (let i = 0; i < N; i++) {
        // 跳过边缘格子
        if (edgeMask && isEdgeCell(i, j, edgeMask, W, H, N, M, cw, ch, 25)) continue;

        const centerCell = grid[j][i];
        if (centerCell.color === '#FFFFFF' || centerCell.color === '#FFF') continue;

        // 收集 3x3 邻域的颜色
        const neighbors = [];
        let sameColorCount = 0;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = j + dy, nx = i + dx;
            if (nx >= 0 && nx < N && ny >= 0 && ny < M) {
              const nColor = grid[ny][nx].color;
              if (nColor !== '#FFFFFF' && nColor !== '#FFF') {
                neighbors.push(nColor);
                if (nColor === centerCell.color) {
                  sameColorCount++;
                }
              }
            }
          }
        }

        // 如果周围（包含自己）同色豆子数量 <= 孤立阈值，说明它是孤立的噪点
        if (sameColorCount <= isolationThreshold && neighbors.length > 3) {
          // 找出邻域中最多的颜色 (众数)
          const counts = {};
          let maxCount = 0;
          let modeColor = centerCell.color;

          for (const c of neighbors) {
            counts[c] = (counts[c] || 0) + 1;
            if (counts[c] > maxCount) {
              maxCount = counts[c];
              modeColor = c;
            }
          }

          // 计算当前孤立色与最常见邻居色的色差
          const rgbCenter = hexToRgb(centerCell.color);
          const rgbMode = hexToRgb(modeColor);
          if (rgbCenter && rgbMode) {
            const dist = deltaE2000(rgbToLab(rgbCenter.r, rgbCenter.g, rgbCenter.b), rgbToLab(rgbMode.r, rgbMode.g, rgbMode.b));
            // 如果色差小于保留阈值（说明只是颜色相近的杂色，不是明显的五官/结构细节）
            if (dist < detailPreserveThreshold) {
              // 只替换孤立像素的颜色，不修改调色板或进行全局相似颜色合并
              // 从调色板中找到众数颜色对应的 key，如果没找到直接用 modeColor（一般都能找到，因为周围已经是拼豆颜色了）
              const modePaletteItem = pal.find(c => c.hex === modeColor);
              if (modePaletteItem) {
                newGrid[j][i] = { color: modePaletteItem.hex, key: modePaletteItem.key };
              }
            }
          }
        }
      }
    }
    grid = newGrid;
  }

  const counts = {};
  for (const row of grid) {
    for (const cell of row) {
      if (cell.key === '?') continue;
      if (!counts[cell.color]) counts[cell.color] = { count: 0, key: cell.key };
      counts[cell.color].count++;
    }
  }
  let total = 0;
  const list = Object.entries(counts).filter(([hex]) => hex !== '#FFFFFF' && hex !== '#FFF').map(([hex, data]) => {
    total += data.count;
    // 从调色板中查找对应的颜色和色号，确保不会出现"?"
    const paletteColor = pal.find(c => c.hex === hex);
    const key = paletteColor ? paletteColor.key : '?';
    return { hex, color: hex, key: key, count: data.count };
  });
  list.sort((a, b) => b.count - a.count);
  return { grid, list, total, N, M };
}

module.exports = {
  hexToRgb,
  getContrastColor,
  colorDist,
  buildPalette,
  closest,
  pixelate,
  detectEdges,
  isEdgeCell
};
