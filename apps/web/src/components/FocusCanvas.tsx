import React, { useRef, useEffect, useCallback, useState } from 'react';
import { MappedPixel } from '../utils/pixelation';

interface FocusCanvasProps {
  mappedPixelData: MappedPixel[][];
  gridDimensions: { N: number; M: number };
  currentColor: string;
  completedCells: Set<string>;
  recommendedCell: { row: number; col: number } | null;
  recommendedRegion: { row: number; col: number }[] | null;
  canvasScale: number;
  canvasOffset: { x: number; y: number };
  gridSectionInterval: number;
  showSectionLines: boolean;
  sectionLineColor: string;
  onCellClick: (row: number, col: number) => void;
  onScaleChange: (scale: number) => void;
  onOffsetChange: (offset: { x: number; y: number }) => void;
}

const DRAG_CLICK_THRESHOLD_PX = 5;

const FocusCanvas: React.FC<FocusCanvasProps> = ({
  mappedPixelData,
  gridDimensions,
  currentColor,
  completedCells,
  recommendedCell,
  recommendedRegion,
  canvasScale,
  canvasOffset,
  gridSectionInterval,
  showSectionLines,
  sectionLineColor,
  onCellClick,
  onScaleChange,
  onOffsetChange
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState<{ x: number; y: number } | null>(null);
  const [lastPinchDistance, setLastPinchDistance] = useState<number | null>(null);
  const pointerGestureRef = useRef({ moved: false, startX: 0, startY: 0 });
  const suppressNextClickRef = useRef(false);

  const cellSize = Math.max(15, Math.min(40, 300 / Math.max(gridDimensions.N, gridDimensions.M)));

  const markMovedIfNeeded = useCallback((x: number, y: number) => {
    const dx = x - pointerGestureRef.current.startX;
    const dy = y - pointerGestureRef.current.startY;
    if (Math.hypot(dx, dy) > DRAG_CLICK_THRESHOLD_PX) {
      pointerGestureRef.current.moved = true;
    }
  }, []);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mappedPixelData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const canvasWidth = gridDimensions.N * cellSize;
    const canvasHeight = gridDimensions.M * cellSize;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    for (let row = 0; row < gridDimensions.M; row++) {
      for (let col = 0; col < gridDimensions.N; col++) {
        const pixel = mappedPixelData[row][col];
        const x = col * cellSize;
        const y = row * cellSize;
        const cellKey = `${row},${col}`;
        let fillColor = pixel.color;

        if (pixel.color !== currentColor) {
          const hex = pixel.color.replace('#', '');
          const r = parseInt(hex.substr(0, 2), 16);
          const g = parseInt(hex.substr(2, 2), 16);
          const b = parseInt(hex.substr(4, 2), 16);
          const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          fillColor = `rgb(${gray}, ${gray}, ${gray})`;
        }

        ctx.fillStyle = fillColor;
        ctx.fillRect(x, y, cellSize, cellSize);

        if (completedCells.has(cellKey) && pixel.color === currentColor) {
          ctx.fillStyle = 'rgba(0, 255, 0, 0.6)';
          ctx.fillRect(x, y, cellSize, cellSize);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + cellSize * 0.2, y + cellSize * 0.5);
          ctx.lineTo(x + cellSize * 0.4, y + cellSize * 0.7);
          ctx.lineTo(x + cellSize * 0.8, y + cellSize * 0.3);
          ctx.stroke();
        }

        const isInRecommendedRegion = recommendedRegion?.some(cell =>
          cell.row === row && cell.col === col
        );
        if (isInRecommendedRegion) {
          ctx.strokeStyle = '#ff4444';
          ctx.lineWidth = 3;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
          ctx.setLineDash([]);
        }

        if (recommendedCell && recommendedCell.row === row && recommendedCell.col === col && isInRecommendedRegion) {
          ctx.fillStyle = '#ff4444';
          ctx.beginPath();
          ctx.arc(x + cellSize / 2, y + cellSize / 2, 4, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
    }

    if (showSectionLines) {
      ctx.strokeStyle = sectionLineColor;
      ctx.lineWidth = 2;
      for (let col = gridSectionInterval; col < gridDimensions.N; col += gridSectionInterval) {
        const x = col * cellSize;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasHeight);
        ctx.stroke();
      }
      for (let row = gridSectionInterval; row < gridDimensions.M; row += gridSectionInterval) {
        const y = row * cellSize;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvasWidth, y);
        ctx.stroke();
      }
    }
  }, [mappedPixelData, gridDimensions, cellSize, currentColor, completedCells, recommendedCell, recommendedRegion, gridSectionInterval, showSectionLines, sectionLineColor]);

  const getEventPosition = useCallback((event: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    let clientX: number;
    let clientY: number;

    if ('touches' in event) {
      const touch = event.touches[0] ?? event.changedTouches[0];
      if (!touch) return null;
      clientX = touch.clientX;
      clientY = touch.clientY;
    } else {
      clientX = event.clientX;
      clientY = event.clientY;
    }

    return {
      x: (clientX - rect.left) / canvasScale,
      y: (clientY - rect.top) / canvasScale
    };
  }, [canvasScale]);

  const getGridPosition = useCallback((x: number, y: number) => {
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    if (row >= 0 && row < gridDimensions.M && col >= 0 && col < gridDimensions.N) {
      return { row, col };
    }
    return null;
  }, [cellSize, gridDimensions]);

  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const touch1 = touches[0];
    const touch2 = touches[1];
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleClick = useCallback((event: React.MouseEvent | React.TouchEvent) => {
    event.preventDefault();
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    const pos = getEventPosition(event);
    if (!pos) return;
    const gridPos = getGridPosition(pos.x, pos.y);
    if (gridPos) onCellClick(gridPos.row, gridPos.col);
  }, [onCellClick, getEventPosition, getGridPosition]);

  const handleWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.3, Math.min(3, canvasScale * delta));
    onScaleChange(newScale);
  }, [canvasScale, onScaleChange]);

  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      pointerGestureRef.current = { moved: false, startX: touch.clientX, startY: touch.clientY };
      setIsDragging(true);
      setLastPanPoint({ x: touch.clientX, y: touch.clientY });
      setLastPinchDistance(null);
    } else if (event.touches.length === 2) {
      event.preventDefault();
      const touch = event.touches[0];
      pointerGestureRef.current = { moved: true, startX: touch.clientX, startY: touch.clientY };
      setIsDragging(false);
      setLastPanPoint(null);
      setLastPinchDistance(getTouchDistance(event.touches));
    }
  }, []);

  const handleTouchMove = useCallback((event: React.TouchEvent) => {
    event.preventDefault();

    if (event.touches.length === 1 && isDragging && lastPanPoint) {
      const touch = event.touches[0];
      markMovedIfNeeded(touch.clientX, touch.clientY);
      const deltaX = touch.clientX - lastPanPoint.x;
      const deltaY = touch.clientY - lastPanPoint.y;
      onOffsetChange({ x: canvasOffset.x + deltaX, y: canvasOffset.y + deltaY });
      setLastPanPoint({ x: touch.clientX, y: touch.clientY });
    } else if (event.touches.length === 2 && lastPinchDistance !== null) {
      pointerGestureRef.current.moved = true;
      const currentDistance = getTouchDistance(event.touches);
      const scaleRatio = currentDistance / lastPinchDistance;
      const newScale = Math.max(0.3, Math.min(3, canvasScale * scaleRatio));
      onScaleChange(newScale);
      setLastPinchDistance(currentDistance);
    }
  }, [isDragging, lastPanPoint, canvasOffset, onOffsetChange, lastPinchDistance, canvasScale, onScaleChange, markMovedIfNeeded]);

  const handleTouchEnd = useCallback((event: React.TouchEvent) => {
    event.preventDefault();
    if (event.touches.length === 0) {
      const wasTap = !pointerGestureRef.current.moved && lastPinchDistance === null;
      setIsDragging(false);
      setLastPanPoint(null);
      setLastPinchDistance(null);
      if (wasTap) {
        suppressNextClickRef.current = true;
        const pos = getEventPosition(event);
        const gridPos = pos ? getGridPosition(pos.x, pos.y) : null;
        if (gridPos) onCellClick(gridPos.row, gridPos.col);
      } else {
        suppressNextClickRef.current = true;
      }
    } else if (event.touches.length === 1) {
      const touch = event.touches[0];
      pointerGestureRef.current = { moved: true, startX: touch.clientX, startY: touch.clientY };
      setLastPinchDistance(null);
      setIsDragging(true);
      setLastPanPoint({ x: touch.clientX, y: touch.clientY });
    }
  }, [getEventPosition, getGridPosition, lastPinchDistance, onCellClick]);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    pointerGestureRef.current = { moved: false, startX: event.clientX, startY: event.clientY };
    setIsDragging(true);
    setLastPanPoint({ x: event.clientX, y: event.clientY });
  }, []);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (isDragging && lastPanPoint) {
      markMovedIfNeeded(event.clientX, event.clientY);
      const deltaX = event.clientX - lastPanPoint.x;
      const deltaY = event.clientY - lastPanPoint.y;
      onOffsetChange({ x: canvasOffset.x + deltaX, y: canvasOffset.y + deltaY });
      setLastPanPoint({ x: event.clientX, y: event.clientY });
    }
  }, [isDragging, lastPanPoint, canvasOffset, onOffsetChange, markMovedIfNeeded]);

  const handleMouseUp = useCallback(() => {
    if (pointerGestureRef.current.moved) suppressNextClickRef.current = true;
    setIsDragging(false);
    setLastPanPoint(null);
  }, []);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center overflow-hidden bg-gray-100"
      style={{ touchAction: 'none' }}
    >
      <div
        style={{
          transform: `scale(${canvasScale}) translate(${canvasOffset.x}px, ${canvasOffset.y}px)`,
          transformOrigin: 'center center'
        }}
      >
        <canvas
          ref={canvasRef}
          className="cursor-crosshair border border-gray-300"
          onClick={handleClick}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>
    </div>
  );
};

export default FocusCanvas;
