'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MappedPixel } from '../utils/pixelation';
import { TRANSPARENT_KEY } from '../utils/pixelEditingUtils';
import { ColorReplaceState } from '../hooks/useManualEditingState';
import { ColorSystem, getColorKeyByHex } from '../utils/colorSystemUtils';

interface FloatingColorPaletteProps {
  colors: { key: string; color: string }[];
  selectedColor: MappedPixel | null;
  onColorSelect: (colorData: { key: string; color: string; isExternal?: boolean }) => void;
  selectedColorSystem: ColorSystem;
  isEraseMode: boolean;
  onEraseToggle: () => void;
  isFillMode: boolean;
  onFillToggle: () => void;
  isFillSuggested: boolean;
  fullPaletteColors: { key: string; color: string }[];
  showFullPalette: boolean;
  onToggleFullPalette: () => void;
  colorReplaceState: ColorReplaceState;
  onColorReplaceToggle: () => void;
  onColorReplace: (sourceColor: { key: string; color: string }, targetColor: { key: string; color: string }) => void;
  onHighlightColor: (colorHex: string | null) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  isActive: boolean;
  onActivate: () => void;
}

const FloatingColorPalette: React.FC<FloatingColorPaletteProps> = ({
  colors,
  selectedColor,
  onColorSelect,
  selectedColorSystem,
  isEraseMode,
  onEraseToggle,
  isFillMode,
  onFillToggle,
  isFillSuggested,
  fullPaletteColors,
  showFullPalette,
  onToggleFullPalette,
  colorReplaceState,
  onColorReplaceToggle,
  onColorReplace,
  onHighlightColor,
  isOpen,
  onToggleOpen,
  isActive,
  onActivate
}) => {
  // 计算初始位置，确保左边缘在屏幕内（小屏幕时右边缘可以超出）
  const getInitialPosition = () => ({
    x: Math.max(0, Math.min(20, window.innerWidth - 280)), // 确保左边缘至少是0
    y: Math.max(0, Math.min(100, window.innerHeight - 400)) // 确保上边缘至少是0
  });
  
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [paletteHeight, setPaletteHeight] = useState(400);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const paletteRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef({ y: 0, height: 400 });

  // 处理拖拽开始
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!paletteRef.current) return;
    
    onActivate(); // 激活调色板，置于最上层
    const rect = paletteRef.current.getBoundingClientRect();
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
    e.preventDefault();
  }, [onActivate]);

  // 处理触摸开始
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!paletteRef.current) return;
    
    onActivate(); // 激活调色板，置于最上层
    const rect = paletteRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    setIsDragging(true);
    setDragOffset({
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top
    });
    e.preventDefault();
  }, [onActivate]);

  // 处理移动
  useEffect(() => {
    const handleMove = (clientX: number, clientY: number) => {
      if (!isDragging) return;

      const newX = Math.min(
        Math.max(8, clientX - dragOffset.x),
        Math.max(8, window.innerWidth - 288)
      );
      const newY = Math.min(
        Math.max(8, clientY - dragOffset.y),
        Math.max(8, window.innerHeight - 308)
      );

      setPosition({ x: newX, y: newY });
    };

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleMove(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleEnd = () => {
      setIsDragging(false);
      // 恢复页面滚动
      document.body.style.overflow = '';
    };

    if (isDragging) {
      // 阻止页面滚动
      document.body.style.overflow = 'hidden';
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleEnd);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleEnd);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleEnd);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleEnd);
        // 清理时恢复滚动
        document.body.style.overflow = '';
      };
    }
  }, [isDragging, dragOffset]);

  // 移除窗口大小变化时的边界调整，允许调色盘保持在任何位置

    // 每次打开调色盘时重置位置到屏幕内
  useEffect(() => {
    if (isOpen && typeof window !== 'undefined') {
      const initialPosition = getInitialPosition();
      setPosition(initialPosition);
      setPaletteHeight(Math.min(520, Math.max(300, window.innerHeight - initialPosition.y - 12)));
    }
  }, [isOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const maxHeight = Math.max(300, window.innerHeight - position.y - 12);
    setPaletteHeight(currentHeight => Math.min(currentHeight, maxHeight));
  }, [position.y]);

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    resizeStartRef.current = { y: event.clientY, height: paletteHeight };
    setIsResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handleResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return;
    const maxHeight = Math.max(300, window.innerHeight - position.y - 12);
    const nextHeight = resizeStartRef.current.height + event.clientY - resizeStartRef.current.y;
    setPaletteHeight(Math.min(maxHeight, Math.max(300, nextHeight)));
  };

  const handleResizePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return;
    setIsResizing(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  // 处理颜色点击
  const handleColorClick = (colorData: { key: string; color: string }) => {
    if (colorReplaceState.isActive && colorReplaceState.step === 'select-target' && colorReplaceState.sourceColor) {
      // 执行颜色替换
      onColorReplace(colorReplaceState.sourceColor, colorData);
    } else {
      // 选择颜色
      onColorSelect(colorData);
    }
  };

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const colorFamilyAliases: Array<{ family: string; aliases: string[] }> = [
    { family: 'red', aliases: ['红', '红色', 'red'] },
    { family: 'orange', aliases: ['橙', '橙色', 'orange'] },
    { family: 'yellow', aliases: ['黄', '黄色', 'yellow'] },
    { family: 'green', aliases: ['绿', '绿色', 'green'] },
    { family: 'cyan', aliases: ['青', '青色', 'cyan'] },
    { family: 'blue', aliases: ['蓝', '蓝色', 'blue'] },
    { family: 'purple', aliases: ['紫', '紫色', 'purple'] },
    { family: 'pink', aliases: ['粉', '粉色', 'pink'] },
    { family: 'brown', aliases: ['棕', '棕色', '褐', '褐色', 'brown'] },
    { family: 'beige', aliases: ['米', '米色', 'beige'] },
    { family: 'white', aliases: ['白', '白色', 'white'] },
    { family: 'gray', aliases: ['灰', '灰色', 'gray', 'grey'] },
    { family: 'black', aliases: ['黑', '黑色', 'black'] },
  ];

  const getColorFamily = (hex: string): string => {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16) / 255;
    const g = parseInt(value.slice(2, 4), 16) / 255;
    const b = parseInt(value.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    const delta = max - min;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

    if (saturation < 0.12) {
      if (lightness > 0.88) return 'white';
      if (lightness < 0.18) return 'black';
      return 'gray';
    }

    let hue = 0;
    if (delta !== 0) {
      if (max === r) hue = 60 * (((g - b) / delta) % 6);
      else if (max === g) hue = 60 * ((b - r) / delta + 2);
      else hue = 60 * ((r - g) / delta + 4);
    }
    if (hue < 0) hue += 360;

    if ((hue >= 315 || hue < 15) && lightness > 0.6) return 'pink';
    if (hue >= 15 && hue < 45 && lightness < 0.48) return 'brown';
    if (hue >= 35 && hue < 60 && lightness > 0.68 && saturation < 0.7) return 'beige';
    if (hue >= 340 || hue < 15) return 'red';
    if (hue < 45) return 'orange';
    if (hue < 70) return 'yellow';
    if (hue < 165) return 'green';
    if (hue < 200) return 'cyan';
    if (hue < 260) return 'blue';
    if (hue < 340) return 'purple';
    return 'red';
  };

  const requestedFamily = colorFamilyAliases.find(item =>
    item.aliases.some(alias => normalizedSearch === alias)
  )?.family;
  const paletteSource = normalizedSearch ? fullPaletteColors : (showFullPalette ? fullPaletteColors : colors);
  const displayColors = paletteSource.filter(colorData => {
    if (!normalizedSearch) return true;
    const displayKey = getColorKeyByHex(colorData.color, selectedColorSystem).toLowerCase();
    const directMatch = displayKey.includes(normalizedSearch)
      || colorData.key.toLowerCase().includes(normalizedSearch)
      || colorData.color.toLowerCase().includes(normalizedSearch);
    return directMatch || (requestedFamily ? getColorFamily(colorData.color) === requestedFamily : false);
  });

  // 如果调色盘关闭，完全不渲染
  if (!isOpen) {
    return null;
  }

  return (
    <div
      ref={paletteRef}
      className={`pinbean-floating-palette fixed flex flex-col select-none ${
        isActive ? 'z-[60]' : 'z-[50]'
      }`}
      style={{
        left: position.x,
        top: position.y,
        width: '280px',
        height: `${paletteHeight}px`
      }}
      onClick={onActivate}
    >
      {/* 标题栏和控制按钮 */}
      <div
        className="pinbean-floating-palette-head flex items-center justify-between p-3 text-white cursor-move"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z" clipRule="evenodd" />
          </svg>
          <span className="text-sm font-medium">调色盘</span>
        </div>
        
        <div className="flex items-center gap-1">
          {/* 关闭按钮 */}
          <button
            onClick={onToggleOpen}
            className="p-1 hover:bg-white/20 rounded transition-colors"
            title="关闭调色盘"
          >
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              className="h-4 w-4"
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {/* 模式状态指示器 */}
          {(colorReplaceState.isActive || isFillMode || isFillSuggested) && (
            <div className={`mb-3 rounded-lg border p-2 text-xs ${
              isFillMode
                ? 'border-emerald-900 bg-emerald-700 text-white shadow-sm'
                : 'border-orange-300 bg-orange-100 text-orange-950 dark:border-orange-700 dark:bg-orange-900/60 dark:text-orange-100'
            }`}>
              <div className="flex items-center gap-1 font-medium text-inherit">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
                <span>
                  {isFillMode
                    ? '区域填充：点击刚才擦除或需要换色的连续区域'
                    : colorReplaceState.isActive
                      ? colorReplaceState.step === 'select-source'
                        ? '点击画布选择要替换的颜色'
                        : '选择目标颜色'
                      : selectedColor
                        ? '颜色已选好，下一步点击“区域填充”'
                        : '区域已擦除，请搜索并选择要填充的颜色'}
                </span>
              </div>
            </div>
          )}

          {/* 工具按钮行 */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {/* 橡皮擦按钮 */}
            <button
              onClick={() => handleColorClick({ key: TRANSPARENT_KEY, color: '#FFFFFF' })}
              className={`flex-1 p-2 rounded-lg border transition-all duration-200 flex items-center justify-center gap-1 text-xs ${
                selectedColor?.key === TRANSPARENT_KEY
                  ? 'bg-red-500 text-white border-red-500'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-red-50 dark:hover:bg-red-900/20'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              橡皮擦
            </button>

            {/* 一键擦除按钮 */}
            <button
              onClick={onEraseToggle}
              className={`flex-1 p-2 rounded-lg border transition-all duration-200 flex items-center justify-center gap-1 text-xs ${
                isEraseMode
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-orange-50 dark:hover:bg-orange-900/20'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              区域擦除
            </button>

            {/* 区域填充按钮 */}
            <button
              onClick={onFillToggle}
              disabled={!selectedColor || selectedColor.key === TRANSPARENT_KEY}
              className={`p-2 rounded-lg border transition-all duration-200 flex items-center justify-center gap-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                isFillMode
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : isFillSuggested && selectedColor
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-500 ring-2 ring-emerald-200'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
              }`}
              title={!selectedColor || selectedColor.key === TRANSPARENT_KEY ? '请先选择要填充的颜色' : '填充与点击格子相连的同色区域'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l5-5 5 5m-5-5V3m-7 16h14" />
              </svg>
              {isFillSuggested ? '下一步：填充' : '区域填充'}
            </button>

            {/* 颜色替换按钮 */}
            <button
              onClick={onColorReplaceToggle}
              className={`flex-1 p-2 rounded-lg border transition-all duration-200 flex items-center justify-center gap-1 text-xs ${
                colorReplaceState.isActive
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-blue-50 dark:hover:bg-blue-900/20'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
              批量替换
            </button>
          </div>

          {/* 颜色搜索 */}
          <div className="mb-3">
            <label htmlFor="paletteColorSearch" className="sr-only">搜索色号或颜色</label>
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m2.35-5.65a8 8 0 11-16 0 8 8 0 0116 0z" />
              </svg>
              <input
                id="paletteColorSearch"
                type="search"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="搜索色号、#Hex、红色/蓝色…"
                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-8 pr-3 text-xs text-gray-800 outline-none transition focus:border-[#397568] focus:ring-2 focus:ring-[#397568]/15"
              />
            </div>
            {normalizedSearch && (
              <p className="mt-1.5 text-[11px] text-gray-500">找到 {displayColors.length} 个颜色</p>
            )}
          </div>

          {/* 色板切换 */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={onToggleFullPalette}
              className="w-full text-xs py-2 px-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              {showFullPalette ? `当前色板 (${colors.length})` : `完整色板 (${fullPaletteColors.length})`}
            </button>
          </div>

          {/* 颜色网格 */}
          <div className="grid grid-cols-6 gap-1.5">
            {displayColors.map((colorData) => {
              const isSelected = selectedColor?.key === colorData.key && selectedColor?.color === colorData.color;
              const displayKey = getColorKeyByHex(colorData.color, selectedColorSystem);
              
              return (
                <button
                  key={`${colorData.key}-${colorData.color}`}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    onHighlightColor(colorData.color);
                  }}
                  onPointerUp={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                    onHighlightColor(null);
                  }}
                  onPointerCancel={() => onHighlightColor(null)}
                  onLostPointerCapture={() => onHighlightColor(null)}
                  onClick={() => handleColorClick(colorData)}
                  className={`group relative aspect-square rounded-lg border-2 transition-all duration-200 hover:scale-110 ${
                    isSelected
                      ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-200 dark:ring-blue-800 scale-110'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                  style={{ backgroundColor: colorData.color }}
                  title={`${displayKey} (${colorData.color})`}
                >
                  {/* 选中指示器 */}
                  {isSelected && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-2 h-2 bg-white rounded-full shadow-lg"></div>
                    </div>
                  )}
                  
                  {/* 悬停时显示色号 */}
                  <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 dark:bg-gray-700 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                    {displayKey}
                  </div>
                </button>
              );
            })}
          </div>
          {displayColors.length === 0 && (
            <p className="py-5 text-center text-xs text-gray-500">没有找到匹配颜色，请换一个色号或颜色词。</p>
          )}

          {/* 当前选中颜色信息 */}
          {selectedColor && selectedColor.key !== TRANSPARENT_KEY && (
            <div className="mt-3 p-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <div className="flex items-center gap-2 text-xs">
                <div
                  className="w-4 h-4 rounded border border-gray-300 dark:border-gray-500"
                  style={{ backgroundColor: selectedColor.color }}
                ></div>
                <span className="text-gray-700 dark:text-gray-300">
                  当前: {getColorKeyByHex(selectedColor.color, selectedColorSystem)}
                </span>
              </div>
            </div>
          )}
      </div>

      <div
        role="separator"
        aria-label="调整调色板高度"
        aria-orientation="horizontal"
        title="上下拖动调整调色板高度"
        className={`flex h-6 flex-none touch-none cursor-ns-resize items-center justify-center border-t border-[#ddd2c1] bg-[#f3ecdf] ${isResizing ? 'text-[#397568]' : 'text-[#766f66]'}`}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
      >
        <span className="h-1 w-10 rounded-full bg-current opacity-50" />
      </div>
    </div>
  );
};

export default FloatingColorPalette;
