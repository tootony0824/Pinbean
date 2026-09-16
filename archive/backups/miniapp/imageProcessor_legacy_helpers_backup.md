# imageProcessor.js 旧版重复工具函数备份

目的：当前项目已将 RGB 相关实现统一到 `miniapp/utils/rgbCore.js`。本文件仅用于备份之前 `imageProcessor.js` 内部那套重复实现，便于回看与对照。

## 旧实现（已从 imageProcessor.js 移除）

```js
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function getContrastColor(hexColor) {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return '#000000';
  const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return brightness > 125 ? '#000000' : '#FFFFFF';
}

function colorDist(rgb1, rgb2) {
  const dr = rgb1.r - rgb2.r;
  const dg = rgb1.g - rgb2.g;
  const db = rgb1.b - rgb2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function buildPalette(cs) {
  return rgbCore.buildPalette(cs);
}

function closest(targetRgb, palette) {
  if (!palette || palette.length === 0) {
    return { key: '?', hex: '#000000', rgb: { r: 0, g: 0, b: 0 } };
  }

  let minDistance = Infinity;
  let closestColor = palette[0];

  for (const paletteColor of palette) {
    const distance = colorDist(targetRgb, paletteColor.rgb);
    if (distance < minDistance) {
      minDistance = distance;
      closestColor = paletteColor;
    }
    if (distance === 0) break;
  }
  return closestColor;
}
```
