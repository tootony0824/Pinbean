'use client';

import React, { useRef, useEffect, PointerEvent, useState } from 'react';
import { CanvasPointerInput, sampleCanvasSegment } from '../utils/canvasPointerInput';
import { MappedPixel } from '../utils/pixelation';

interface PixelatedPreviewCanvasProps {
  mappedPixelData: MappedPixel[][] | null;
  gridDimensions: { N: number; M: number } | null;
  isManualColoringMode: boolean;
  isFreehandEraseEnabled: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onInteraction: (
    clientX: number,
    clientY: number,
    pageX: number,
    pageY: number,
    isClick: boolean,
    isTouchEnd?: boolean
  ) => void;
  beginStroke?: () => ((indexes: number[]) => void) | null;
  highlightColorKey?: string | null;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

// 绘制像素化画布的函数
const drawPixelatedCanvas = (
  dataToDraw: MappedPixel[][],
  canvas: HTMLCanvasElement | null,
  dims: { N: number; M: number } | null,
  highlightColorKey?: string | null,
  isHighlighting?: boolean
) => {
  if (!canvas || !dims || !dataToDraw) {
    console.warn("drawPixelatedCanvas: Missing required parameters");
    return;
  }
  
  const pixelatedCtx = canvas.getContext('2d');
  if (!pixelatedCtx) {
    console.error("Failed to get 2D context for pixelated canvas");
    return;
  }

  // Respect current dark mode preference
  const isDarkMode = typeof window !== 'undefined' && document.documentElement.classList.contains('dark');

  // Define colors based on mode
  const externalBackgroundColor = isDarkMode ? '#374151' : '#F3F4F6'; // gray-700 : gray-100
  const gridLineColor = isDarkMode ? '#4B5563' : '#DDDDDD'; // gray-600 : lighter gray

  const { N, M } = dims;
  const outputWidth = canvas.width;
  const outputHeight = canvas.height;
  const cellWidthOutput = outputWidth / N;
  const cellHeightOutput = outputHeight / M;

  pixelatedCtx.clearRect(0, 0, outputWidth, outputHeight);
  pixelatedCtx.lineWidth = 0.5; // Keep line width thin

  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const cellData = dataToDraw[j]?.[i];
      if (!cellData) continue;

      const drawX = i * cellWidthOutput;
      const drawY = j * cellHeightOutput;

      // Fill cell color using mode-specific background for external cells
      if (cellData.isExternal) {
        pixelatedCtx.fillStyle = externalBackgroundColor;
      } else {
        pixelatedCtx.fillStyle = cellData.color;
      }
      pixelatedCtx.fillRect(drawX, drawY, cellWidthOutput, cellHeightOutput);

      // 如果正在高亮且当前单元格不是目标颜色，添加半透明黑色蒙版
      if (isHighlighting && highlightColorKey) {
        let shouldDim = false;
        
        if (cellData.isExternal) {
          // 外部单元格总是变深色（因为它们不是要高亮的颜色）
          shouldDim = true;
        } else {
          // 内部单元格：如果颜色不匹配则变深色
          shouldDim = cellData.color.toUpperCase() !== highlightColorKey.toUpperCase();
        }
        
        if (shouldDim) {
          pixelatedCtx.fillStyle = 'rgba(0, 0, 0, 0.6)'; // 60% 透明度的黑色蒙版
          pixelatedCtx.fillRect(drawX, drawY, cellWidthOutput, cellHeightOutput);
        }
      }

      // Draw grid lines using mode-specific color
      pixelatedCtx.strokeStyle = gridLineColor;
      pixelatedCtx.strokeRect(drawX + 0.5, drawY + 0.5, cellWidthOutput, cellHeightOutput);
    }
  }
};

const PixelatedPreviewCanvas: React.FC<PixelatedPreviewCanvasProps> = ({
  mappedPixelData,
  gridDimensions,
  isManualColoringMode,
  isFreehandEraseEnabled,
  canvasRef,
  onInteraction,
  beginStroke,
  highlightColorKey,
}) => {
  const [darkModeState, setDarkModeState] = useState<boolean | null>(null);
  const inputRef = useRef(new CanvasPointerInput());
  const strokeRef = useRef<{ update: (indexes: number[]) => void; indexes: Set<number>; last: { x: number; y: number } } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  // Effect to detect dark mode changes and update state
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkDarkMode = () => {
        const isDark = document.documentElement.classList.contains('dark');
        // Only update state if it actually changes
        if (isDark !== darkModeState) {
            setDarkModeState(isDark);
        }
    };

    // Initial check
    checkDarkMode();

    // Use MutationObserver to watch for class changes on <html>
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // Cleanup observer on component unmount
    return () => observer.disconnect();

  }, [darkModeState]); // Depend on darkModeState to re-run if needed externally

  // Update useEffect for drawing to depend on darkModeState as well
  useEffect(() => {
    // Ensure darkModeState is not null before drawing
    if (mappedPixelData && gridDimensions && canvasRef.current && darkModeState !== null) {
      console.log(`Redrawing canvas, dark mode: ${darkModeState}`); // Log redraw trigger
      drawPixelatedCanvas(mappedPixelData, canvasRef.current, gridDimensions, highlightColorKey, Boolean(highlightColorKey));
    }
  }, [mappedPixelData, gridDimensions, canvasRef, darkModeState, highlightColorKey]); // Add darkModeState dependency

  useEffect(() => {
    const reset = () => { inputRef.current.reset(); strokeRef.current = null; };
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => { reset(); window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', reset); };
  }, []);

  useEffect(() => {
    inputRef.current.reset(); strokeRef.current = null;
    setOffset({ x: 0, y: 0 });
    setZoom(1);
  }, [gridDimensions, isManualColoringMode]);

  const changeZoom = (delta: number) => {
    setZoom(current => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current + delta)));
  };

  const resetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const extendStroke = (event: PointerEvent<HTMLDivElement>) => {
    const stroke = strokeRef.current;
    const canvas = canvasRef.current;
    if (!stroke || !canvas || !gridDimensions) return;
    const next = { x: event.clientX, y: event.clientY };
    const rect = canvas.getBoundingClientRect();
    const size = stroke.indexes.size;
    for (const index of sampleCanvasSegment(stroke.last, next, rect, gridDimensions.N, gridDimensions.M)) stroke.indexes.add(index);
    stroke.last = next;
    if (stroke.indexes.size !== size) stroke.update([...stroke.indexes]);
  };
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const action = inputRef.current.down(event);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (action === 'ignore') return;
    if (action === 'pan') { onInteraction(0, 0, 0, 0, false, true); return; }
    const update = beginStroke?.();
    if (update) {
      strokeRef.current = { update, indexes: new Set(), last: { x: event.clientX, y: event.clientY } };
      extendStroke(event);
    } else {
      onInteraction(event.clientX, event.clientY, event.pageX, event.pageY, isManualColoringMode);
    }
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const action = inputRef.current.move(event);
    if (action?.type === 'pan') {
      const viewport = event.currentTarget.getBoundingClientRect();
      const canvas = canvasRef.current?.getBoundingClientRect();
      if (!canvas) return;
      const maxX = Math.max(0, (viewport.width + canvas.width) / 2 - 48);
      const maxY = Math.max(0, (viewport.height + canvas.height) / 2 - 48);
      setOffset(old => ({ x: Math.max(-maxX, Math.min(maxX, old.x + action.dx)),
        y: Math.max(-maxY, Math.min(maxY, old.y + action.dy)) }));
    }
    else if (action?.type === 'draw') extendStroke(event);
    else if (event.pointerType === 'mouse' && event.buttons === 0 && !isManualColoringMode)
      onInteraction(event.clientX, event.clientY, event.pageX, event.pageY, false);
  };
  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (event.type === 'pointerup' && inputRef.current.move(event)?.type === 'draw') extendStroke(event);
    if (inputRef.current.end(event.pointerId)) strokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="relative w-full overflow-hidden flex items-center justify-center min-h-[340px]"
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onLostPointerCapture={handlePointerEnd}
      onPointerLeave={() => onInteraction(0, 0, 0, 0, false, true)}>
      {isManualColoringMode && (
        <div
          className="absolute right-3 top-3 z-20 flex items-center overflow-hidden rounded-xl border border-gray-300 bg-white/95 shadow-md backdrop-blur dark:border-gray-600 dark:bg-gray-800/95"
          onPointerDown={event => event.stopPropagation()}
          onPointerMove={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label="缩小图纸"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => changeZoom(-ZOOM_STEP)}
            className="flex h-11 w-11 items-center justify-center text-xl font-semibold text-gray-800 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-35 dark:text-white dark:hover:bg-gray-700"
          >
            −
          </button>
          <button
            type="button"
            aria-label="重置图纸视图"
            title="重置为 100%"
            onClick={resetView}
            className="h-11 min-w-16 border-x border-gray-300 px-2 text-sm font-semibold text-gray-800 hover:bg-gray-100 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label="放大图纸"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => changeZoom(ZOOM_STEP)}
            className="flex h-11 w-11 items-center justify-center text-xl font-semibold text-gray-800 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-35 dark:text-white dark:hover:bg-gray-700"
          >
            +
          </button>
        </div>
      )}
      <canvas ref={canvasRef}
        className={`border border-gray-300 dark:border-gray-600 max-w-full h-auto rounded block ${
          isFreehandEraseEnabled ? 'cursor-crosshair' : isManualColoringMode ? 'cursor-crosshair' : 'cursor-grab'
        }`}
        style={{
          imageRendering: 'pixelated',
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      />
    </div>
  );
};

export default PixelatedPreviewCanvas;
