'use client';

import type { RestoredProjectEnvelope } from '@pinbean/bead-core';
import { createWebProjectHistory, createWebProject, exportWebProject, importWebProject, loadWebProject, prepareWebProject, saveWebProject } from '../adapters/webProjectAdapter';
import React, { useState, useRef, ChangeEvent, DragEvent, useEffect, useMemo, useCallback } from 'react';

// 导入像素化工具和类型
import {
  PixelationMode,
  PaletteColor,
  MappedPixel,
  hexToRgb,
  findClosestPaletteColor
} from '../utils/pixelation';
import { createWebCorePalette, generateWebPattern, imageDataToNormalizedImage, mappedPixelsToWebPattern } from '../adapters/beadCoreAdapter';
import {
  createWebEditingSession,
  executeWebEdit,
  redoWebEdit,
  undoWebEdit,
  type WebEditingSession,
  type WebEditOperation,
} from '../adapters/webEditingAdapter';

// 导入新的类型和组件
import { GridDownloadOptions } from '../types/downloadTypes';
import DownloadSettingsModal, { gridLineColorOptions } from '../components/DownloadSettingsModal';
import { downloadImage, importCsvData } from '../utils/imageDownloader';

import { 
  colorSystemOptions, 
  convertPaletteToColorSystem, 
  getColorKeyByHex,
  getMardToHexMapping,
  sortColorsByHue,
  ColorSystem 
} from '../utils/colorSystemUtils';

// 添加自定义动画样式
const floatAnimation = `
  @keyframes float {
    0% { transform: translateY(0px); }
    50% { transform: translateY(-5px); }
    100% { transform: translateY(0px); }
  }
  .animate-float {
    animation: float 3s ease-in-out infinite;
  }
`;

// Helper function for sorting color keys - 保留原有实现，因为未在utils中导出
function sortColorKeys(a: string, b: string): number {
  const regex = /^([A-Z]+)(\d+)$/;
  const matchA = a.match(regex);
  const matchB = b.match(regex);

  if (matchA && matchB) {
    const prefixA = matchA[1];
    const numA = parseInt(matchA[2], 10);
    const prefixB = matchB[1];
    const numB = parseInt(matchB[2], 10);

    if (prefixA !== prefixB) {
      return prefixA.localeCompare(prefixB); // Sort by prefix first (A, B, C...)
    }
    return numA - numB; // Then sort by number (1, 2, 10...)
  }
  // Fallback for keys that don't match the standard pattern (e.g., T1, ZG1)
  return a.localeCompare(b);
}

// --- Define available palette key sets ---
// 从colorSystemMapping.json获取所有MARD色号
const mardToHexMapping = getMardToHexMapping();

// Pre-process the FULL palette data once - 使用colorSystemMapping而不是beadPaletteData
const fullBeadPalette: PaletteColor[] = Object.entries(mardToHexMapping)
  .map(([mardKey, hex]) => {
    const rgb = hexToRgb(hex);
    if (!rgb) {
      console.warn(`Invalid hex code "${hex}" for MARD key "${mardKey}". Skipping.`);
      return null;
    }
    // 使用hex值作为key，符合新的架构设计
    return { key: hex, hex, rgb };
  })
  .filter((color): color is PaletteColor => color !== null);

// ++ Add definition for background color keys ++

// 1. 导入新组件
import { createProjectId } from '../utils/projectId';
import PixelatedPreviewCanvas from '../components/PixelatedPreviewCanvas';
import GridTooltip from '../components/GridTooltip';
import CustomPaletteEditor from '../components/CustomPaletteEditor';
import FloatingColorPalette from '../components/FloatingColorPalette';
import FloatingToolbar from '../components/FloatingToolbar';
import MagnifierTool from '../components/MagnifierTool';
import MagnifierSelectionOverlay from '../components/MagnifierSelectionOverlay';
import { loadPaletteSelections, savePaletteSelections, presetToSelections, PaletteSelections } from '../utils/localStorageUtils';
import { TRANSPARENT_KEY } from '../utils/pixelEditingUtils';

// 1. 导入新的 FocusModePreDownloadModal 组件
import FocusModePreDownloadModal from '../components/FocusModePreDownloadModal';
import ImageCropperModal from '../components/ImageCropperModal';
import AIOptimizeModal from '../components/AIOptimizeModal';
import {
  PinBeanHeader,
  ProjectStart,
  ProjectSummary,
  StudioStep,
  WorkflowSteps,
} from '../components/studio/PinBeanChrome';

const DEFAULT_GRANULARITY = 50;
const DEFAULT_SIMILARITY_THRESHOLD = 48;
const MAX_UPLOAD_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_UPLOAD_IMAGE_PIXELS = 16_000_000;
const MAX_UPLOAD_IMAGE_ASPECT_RATIO = 8;

function imageFileLooksSupported(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const fileType = file.type.toLowerCase();
  return ['image/jpeg', 'image/jpg', 'image/png'].includes(fileType) || /\.(jpe?g|png)$/.test(fileName);
}

function inspectImageFile(file: File): Promise<{ height: number; width: number }> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
      reject(new Error(`图片文件不能超过 ${Math.round(MAX_UPLOAD_IMAGE_BYTES / 1024 / 1024)}MB。`));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      const pixels = width * height;
      const aspectRatio = Math.max(width / Math.max(1, height), height / Math.max(1, width));
      if (!width || !height) reject(new Error('无法读取图片尺寸。'));
      else if (pixels > MAX_UPLOAD_IMAGE_PIXELS) reject(new Error('图片分辨率过高，请先压缩后再上传。'));
      else if (aspectRatio > MAX_UPLOAD_IMAGE_ASPECT_RATIO) reject(new Error('图片宽高比过于极端，请先裁剪后再上传。'));
      else resolve({ height, width });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法解码图片，请确认文件是 JPG 或 PNG。'));
    };
    img.src = url;
  });
}

export default function Home() {
  const [originalImageSrc, setOriginalImageSrc] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<number>(DEFAULT_GRANULARITY);
  const [granularityInput, setGranularityInput] = useState<string>(DEFAULT_GRANULARITY.toString());
  const [similarityThreshold, setSimilarityThreshold] = useState<number>(DEFAULT_SIMILARITY_THRESHOLD);
  const [similarityThresholdInput, setSimilarityThresholdInput] = useState<string>(DEFAULT_SIMILARITY_THRESHOLD.toString());
  // 添加像素化模式状态
  const [pixelationMode, setPixelationMode] = useState<PixelationMode>(PixelationMode.Dominant); // 默认为卡通模式
  
  // 新增：色号系统选择状态
  const [selectedColorSystem, setSelectedColorSystem] = useState<ColorSystem>('MARD');
  // 新增：色号系统折叠状态
  const [isColorSystemCollapsed, setIsColorSystemCollapsed] = useState<boolean>(true);
  
  const [activeBeadPalette, setActiveBeadPalette] = useState<PaletteColor[]>(() => {
      return fullBeadPalette; // 默认使用全部颜色
  });
  // 状态变量：存储被排除的颜色（hex值）
  const [excludedColorKeys, setExcludedColorKeys] = useState<Set<string>>(new Set());
  const [colorExclusionActions, setColorExclusionActions] = useState<Array<{ hexKey: string; historyDepth: number }>>([]);
  const [showExcludedColors, setShowExcludedColors] = useState<boolean>(false);
  // 用于记录初始网格颜色（hex值），用于显示排除功能
  const [initialGridColorKeys, setInitialGridColorKeys] = useState<Set<string>>(new Set());
  const [mappedPixelData, setMappedPixelData] = useState<MappedPixel[][] | null>(null);
  const [gridDimensions, setGridDimensions] = useState<{ N: number; M: number } | null>(null);
  const [colorCounts, setColorCounts] = useState<{ [key: string]: { count: number; color: string } } | null>(null);
  const [totalBeadCount, setTotalBeadCount] = useState<number>(0);
  const [tooltipData, setTooltipData] = useState<{ x: number, y: number, key: string, color: string } | null>(null);
  const [remapTrigger, setRemapTrigger] = useState<number>(0);
  const [isManualColoringMode, setIsManualColoringMode] = useState<boolean>(false);
  const [selectedColor, setSelectedColor] = useState<MappedPixel | null>(null);
  // 新增：一键擦除模式状态
  const [isEraseMode, setIsEraseMode] = useState<boolean>(false);
  const [isFillMode, setIsFillMode] = useState<boolean>(false);
  const [isFillSuggested, setIsFillSuggested] = useState<boolean>(false);
  // 新增状态变量：控制教程弹窗
  const [isTutorialModalOpen, setIsTutorialModalOpen] = useState<boolean>(false);
  const [customPaletteSelections, setCustomPaletteSelections] = useState<PaletteSelections>({});
  const [isCustomPaletteEditorOpen, setIsCustomPaletteEditorOpen] = useState<boolean>(false);
  const [isCustomPalette, setIsCustomPalette] = useState<boolean>(false);
  
  // ++ 新增：下载设置相关状态 ++
  const [isDownloadSettingsOpen, setIsDownloadSettingsOpen] = useState<boolean>(false);
  const [downloadOptions, setDownloadOptions] = useState<GridDownloadOptions>({
    showGrid: true,
    gridInterval: 10,
    showCoordinates: true,
    showCellNumbers: true,
    gridLineColor: gridLineColorOptions[0].value,
    includeStats: true, // 默认包含统计信息
    exportCsv: false // 默认不导出CSV
  });

  // 新增：高亮相关状态
  const [highlightColorKey, setHighlightColorKey] = useState<string | null>(null);

  // 新增：完整色板切换状态
  const [showFullPalette, setShowFullPalette] = useState<boolean>(false);
  
  // 新增：颜色替换相关状态
  const [colorReplaceState, setColorReplaceState] = useState<{
    isActive: boolean;
    step: 'select-source' | 'select-target';
    sourceColor?: { key: string; color: string };
  }>({
    isActive: false,
    step: 'select-source'
  });

  // 新增：组件挂载状态
  const [isMounted, setIsMounted] = useState<boolean>(false);

  // 新增：悬浮调色盘状态
  const [isFloatingPaletteOpen, setIsFloatingPaletteOpen] = useState<boolean>(true);

  // 新增：放大镜状态
  const [isMagnifierActive, setIsMagnifierActive] = useState<boolean>(false);
  const [magnifierSelectionArea, setMagnifierSelectionArea] = useState<{
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  } | null>(null);

  // 新增：活跃工具层级管理
  const [activeFloatingTool, setActiveFloatingTool] = useState<'palette' | 'magnifier' | null>(null);

  // 新增：专心拼豆模式进入前下载提醒弹窗
  const [isFocusModePreDownloadModalOpen, setIsFocusModePreDownloadModalOpen] = useState<boolean>(false);

  // 新增：图片裁剪弹窗状态
  const [isCropperOpen, setIsCropperOpen] = useState<boolean>(false);
  const [cropperImageSrc, setCropperImageSrc] = useState<string>('');
  const [isAIOptimizeOpen, setIsAIOptimizeOpen] = useState<boolean>(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const [activeStudioStep, setActiveStudioStep] = useState<StudioStep>('import');
  const webEditingSessionRef = useRef<WebEditingSession | null>(null);
  const skipNextPixelateRef = useRef(false);
  const projectRef = useRef<RestoredProjectEnvelope | null>(null);
  const projectHistoryRef = useRef(createWebProjectHistory());
  const sourceImageAvailableRef = useRef(false);
  const generationEpochRef = useRef(0);
  const fileRequestRef = useRef(0);
  const [projectSaveError, setProjectSaveError] = useState('');
  const persistProject = (project: RestoredProjectEnvelope) => {
    projectRef.current = project;
    try { saveWebProject(localStorage, project); setProjectSaveError(''); }
    catch { setProjectSaveError('项目尚未保存：本地存储失败，请下载项目文件。'); }
  };
  const [, setEditingHistoryVersion] = useState(0);

  const publishWebEditResult = useCallback((result: ReturnType<typeof executeWebEdit>, isHistoryNavigation = false): number => {
    const previousHistoryDepth = webEditingSessionRef.current?.history.undoStack.length ?? 0;
    const nextHistoryDepth = result.session.history.undoStack.length;
    if (!isHistoryNavigation && nextHistoryDepth > previousHistoryDepth) {
      setColorExclusionActions(actions => actions.filter(action => action.historyDepth <= previousHistoryDepth));
    }
    const candidate = projectRef.current ? projectHistoryRef.current(projectRef.current, result.session.pattern) : null;
    webEditingSessionRef.current = result.session;
    if (candidate) persistProject(candidate);
    setMappedPixelData(result.mappedPixelData);
    setColorCounts(result.counts);
    setTotalBeadCount(result.totalCount);
    setEditingHistoryVersion(version => version + 1);
    return result.changed;
  }, []);

  const canUndoWebEdit = (webEditingSessionRef.current?.history.undoStack.length ?? 0) > 0;
  const canRedoWebEdit = (webEditingSessionRef.current?.history.redoStack.length ?? 0) > 0;

  const applyWebEdit = (operation: WebEditOperation): number => {
    const session = webEditingSessionRef.current;
    if (!session) throw new Error('共享编辑会话尚未建立，请重新生成图纸。');
    const result = executeWebEdit(session, operation, activeBeadPalette, selectedColorSystem);
    return publishWebEditResult(result);
  };

  const handleWebHistory = useCallback((direction: 'undo' | 'redo') => {
    const session = webEditingSessionRef.current;
    if (!session) return;
    const currentHistoryDepth = session.history.undoStack.length;
    const exclusionAction = colorExclusionActions.find(action => action.historyDepth === (
      direction === 'undo' ? currentHistoryDepth : currentHistoryDepth + 1
    ));
    const result = direction === 'undo'
      ? undoWebEdit(session, activeBeadPalette, selectedColorSystem)
      : redoWebEdit(session, activeBeadPalette, selectedColorSystem);
    publishWebEditResult(result, true);
    if (exclusionAction) {
      setExcludedColorKeys(current => {
        const next = new Set(current);
        if (direction === 'undo') next.delete(exclusionAction.hexKey);
        else next.add(exclusionAction.hexKey);
        return next;
      });
    }
  }, [activeBeadPalette, colorExclusionActions, publishWebEditResult, selectedColorSystem]);

  const currentHistoryDepth = webEditingSessionRef.current?.history.undoStack.length ?? 0;
  const currentColorExclusionAction = colorExclusionActions.find(action => action.historyDepth === currentHistoryDepth);
  const canUndoColorExclusion = Boolean(
    currentColorExclusionAction && excludedColorKeys.has(currentColorExclusionAction.hexKey)
  );

  const handleUndoColorExclusion = () => {
    if (!canUndoColorExclusion) return;
    handleWebHistory('undo');
    setIsManualColoringMode(false);
    setSelectedColor(null);
  };

  useEffect(() => {
    if (!isManualColoringMode) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      const isUndo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey;
      const isRedo = (event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey));
      if (!isUndo && !isRedo) return;
      event.preventDefault();
      handleWebHistory(isUndo ? 'undo' : 'redo');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleWebHistory, isManualColoringMode]);

  // 放大镜切换处理函数
  const handleToggleMagnifier = () => {
    const newActiveState = !isMagnifierActive;
    setIsMagnifierActive(newActiveState);
    
    // 如果关闭放大镜，清除选择区域，重新开始
    if (!newActiveState) {
      setMagnifierSelectionArea(null);
    }
  };

  // 激活工具处理函数
  const handleActivatePalette = () => {
    setActiveFloatingTool('palette');
  };

  const handleActivateMagnifier = () => {
    setActiveFloatingTool('magnifier');
  };

  // 放大镜像素编辑处理函数
  const handleMagnifierPixelEdit = (row: number, col: number, colorData: { key: string; color: string }) => {
    if (!gridDimensions) return;
    try {
      applyWebEdit({
        index: row * gridDimensions.N + col,
        target: colorData,
        type: 'paint',
      });
    } catch (error) {
      console.error('共享编辑失败:', error);
      alert(error instanceof Error ? error.message : '编辑失败，请重新生成图纸。');
    }
  };

  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const pixelatedCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // ++ 添加: Ref for import file input ++
  const importPaletteInputRef = useRef<HTMLInputElement>(null);
  //const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  // ++ Re-add touch refs needed for tooltip logic ++
  //const touchStartPosRef = useRef<{ x: number; y: number; pageX: number; pageY: number } | null>(null);
  //const touchMovedRef = useRef<boolean>(false);

  // ++ Add a ref for the main element ++
  const mainRef = useRef<HTMLElement>(null);

  // --- Derived State ---

  // Update active palette based on selection and exclusions
  useEffect(() => {
    const newActiveBeadPalette = fullBeadPalette.filter(color => {
      const normalizedHex = color.hex.toUpperCase();
      const isSelectedInCustomPalette = customPaletteSelections[normalizedHex];
      const isNotExcluded = !excludedColorKeys.has(normalizedHex);
      return isSelectedInCustomPalette && isNotExcluded;
    });
    // 根据选择的色号系统转换调色板
    const convertedPalette = convertPaletteToColorSystem(newActiveBeadPalette, selectedColorSystem);
    setActiveBeadPalette(convertedPalette);
  }, [customPaletteSelections, excludedColorKeys, remapTrigger, selectedColorSystem]);

  // ++ 添加：当状态变化时同步更新输入框的值 ++
  useEffect(() => {
    setGranularityInput(granularity.toString());
    setSimilarityThresholdInput(similarityThreshold.toString());
  }, [granularity, similarityThreshold]);

  // ++ Calculate unique colors currently on the grid for the palette ++
  const currentGridColors = useMemo(() => {
    if (!mappedPixelData) return [];
    // 使用hex值进行去重，避免多个MARD色号对应同一个目标色号系统值时产生重复key
    const uniqueColorsMap = new Map<string, MappedPixel>();
    mappedPixelData.flat().forEach(cell => {
      if (cell && cell.color && !cell.isExternal) {
        const hexKey = cell.color.toUpperCase();
        if (!uniqueColorsMap.has(hexKey)) {
          // 存储hex值作为key，保持颜色信息
          uniqueColorsMap.set(hexKey, { key: cell.key, color: cell.color });
        }
      }
    });
    
    // 转换为数组并为每个hex值生成对应的色号系统显示
    const originalColors = Array.from(uniqueColorsMap.values());
    
    const colorData = originalColors.map(color => {
      const displayKey = getColorKeyByHex(color.color.toUpperCase(), selectedColorSystem);
      return {
        key: displayKey,
        color: color.color
      };
    });

    // 使用色相排序而不是色号排序
    return sortColorsByHue(colorData);
  }, [mappedPixelData, selectedColorSystem]);

  // 初始化时从本地存储加载自定义色板选择
  useEffect(() => {
    // 尝试从localStorage加载
    const savedSelections = loadPaletteSelections();
    if (savedSelections && Object.keys(savedSelections).length > 0) {
      console.log('从localStorage加载的数据键数量:', Object.keys(savedSelections).length);
      // 验证加载的数据是否都是有效的hex值
      const allHexValues = fullBeadPalette.map(color => color.hex.toUpperCase());
      const validSelections: PaletteSelections = {};
      let hasValidData = false;
      let validCount = 0;
      let invalidCount = 0;
      
      Object.entries(savedSelections).forEach(([key, value]) => {
        // 严格验证：键必须是有效的hex格式，并且存在于调色板中
        if (/^#[0-9A-F]{6}$/i.test(key) && allHexValues.includes(key.toUpperCase())) {
          validSelections[key.toUpperCase()] = value;
          hasValidData = true;
          validCount++;
        } else {
          invalidCount++;
        }
      });
      
      console.log(`验证结果: 有效键 ${validCount} 个, 无效键 ${invalidCount} 个`);
      
      if (hasValidData) {
        setCustomPaletteSelections(validSelections);
    setIsCustomPalette(true);
    } else {
        console.log('所有数据都无效，清除localStorage并重新初始化');
        // 如果本地数据无效，清除localStorage并默认选择所有颜色
        localStorage.removeItem('customPerlerPaletteSelections');
        const allHexValues = fullBeadPalette.map(color => color.hex.toUpperCase());
        const initialSelections = presetToSelections(allHexValues, allHexValues);
      setCustomPaletteSelections(initialSelections);
      setIsCustomPalette(false);
    }
    } else {
      console.log('没有localStorage数据，默认选择所有颜色');
      // 如果没有保存的选择，默认选择所有颜色
      const allHexValues = fullBeadPalette.map(color => color.hex.toUpperCase());
      const initialSelections = presetToSelections(allHexValues, allHexValues);
      setCustomPaletteSelections(initialSelections);
      setIsCustomPalette(false);
    }
  }, []); // 只在组件首次加载时执行

  // 更新 activeBeadPalette 基于自定义选择和排除列表
  useEffect(() => {
    const newActiveBeadPalette = fullBeadPalette.filter(color => {
      const normalizedHex = color.hex.toUpperCase();
      const isSelectedInCustomPalette = customPaletteSelections[normalizedHex];
      // 使用hex值进行排除检查
      const isNotExcluded = !excludedColorKeys.has(normalizedHex);
      return isSelectedInCustomPalette && isNotExcluded;
    });
    // 不进行色号系统转换，保持原始的MARD色号和hex值
    setActiveBeadPalette(newActiveBeadPalette);
  }, [customPaletteSelections, excludedColorKeys, remapTrigger]);

  // --- Event Handlers ---

  // 专心拼豆模式相关处理函数
  const handleEnterFocusMode = () => {
    setIsFocusModePreDownloadModalOpen(true);
  };

  const handleProceedToFocusMode = () => {
    const session = webEditingSessionRef.current;
    if (!session || !mappedPixelData || !gridDimensions || !colorCounts) {
      alert('请先生成图纸后再进入制作模式。');
      return;
    }

    try {
      if (!projectRef.current) throw new Error('项目尚未建立');
      saveWebProject(localStorage, projectRef.current);
      window.location.href = '/focus';
    } catch (error) {
      console.error('无法保存制作模式数据:', error);
      alert('无法进入制作模式：浏览器本地存储空间不足，请先导出图纸或清理站点数据后重试。');
    }
  };

  // 添加一个安全的文件输入触发函数
  const triggerFileInput = useCallback(() => {
    // 检查组件是否已挂载
    if (!isMounted) {
      console.warn("组件尚未完全挂载，延迟触发文件选择");
      setTimeout(() => triggerFileInput(), 200);
      return;
    }
    
    // 检查 ref 是否存在
    if (fileInputRef.current) {
      try {
        fileInputRef.current.click();
      } catch (error) {
        console.error("触发文件选择失败:", error);
        // 如果直接点击失败，尝试延迟执行
        setTimeout(() => {
          try {
            fileInputRef.current?.click();
          } catch (retryError) {
            console.error("重试触发文件选择失败:", retryError);
          }
        }, 100);
      }
    } else {
      // 如果 ref 不存在，延迟重试
      console.warn("文件输入引用不存在，将在100ms后重试");
      setTimeout(() => {
        if (fileInputRef.current) {
          try {
            fileInputRef.current.click();
          } catch (error) {
            console.error("延迟触发文件选择失败:", error);
          }
        }
      }, 100);
    }
  }, [isMounted]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // 检查文件类型是否支持
      const fileName = file.name.toLowerCase();
      const fileType = file.type.toLowerCase();
      
      // 支持的图片类型
      const supportedImageTypes = ['image/jpeg', 'image/jpg', 'image/png'];
      // 支持的CSV MIME类型（不同浏览器可能返回不同的MIME类型）
      const supportedCsvTypes = ['text/csv', 'application/csv', 'text/plain'];
      
      const isImageFile = supportedImageTypes.includes(fileType) || imageFileLooksSupported(file);
      const isCsvFile = supportedCsvTypes.includes(fileType) || fileName.endsWith('.csv');
      
      if (isImageFile || isCsvFile || fileName.endsWith('.json')) {
        void processFile(file);
      } else {
        alert(`不支持的文件类型: ${file.type || '未知'}。请选择 JPG、PNG 格式的图片文件，或 CSV 数据文件。\n文件名: ${file.name}`);
        console.warn(`Unsupported file type: ${file.type}, file name: ${file.name}`);
      }
    }
    // 重置文件输入框的值，这样用户可以重新选择同一个文件
    if (event.target) {
      event.target.value = '';
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    
    try {
      if (event.dataTransfer.files && event.dataTransfer.files[0]) {
        const file = event.dataTransfer.files[0];
        
        // 使用与handleFileChange相同的文件类型检查逻辑
        const fileName = file.name.toLowerCase();
        const fileType = file.type.toLowerCase();
        
        // 支持的图片类型
        const supportedImageTypes = ['image/jpeg', 'image/jpg', 'image/png'];
        // 支持的CSV MIME类型（不同浏览器可能返回不同的MIME类型）
        const supportedCsvTypes = ['text/csv', 'application/csv', 'text/plain'];
        
        const isImageFile = supportedImageTypes.includes(fileType) || imageFileLooksSupported(file);
        const isCsvFile = supportedCsvTypes.includes(fileType) || fileName.endsWith('.csv');
        
        if (isImageFile || isCsvFile || fileName.endsWith('.json')) {
          void processFile(file);
        } else {
          alert(`不支持的文件类型: ${file.type || '未知'}。请拖放 JPG、PNG 格式的图片文件，或 CSV 数据文件。\n文件名: ${file.name}`);
          console.warn(`Unsupported file type: ${file.type}, file name: ${file.name}`);
        }
      }
    } catch (error) {
      console.error("处理拖拽文件时发生错误:", error);
      alert("处理文件时发生错误，请重试。");
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  // 根据mappedPixelData生成合成的originalImageSrc
  const generateSyntheticImageFromPixelData = (pixelData: MappedPixel[][], dimensions: { N: number; M: number }): string => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      console.error('无法创建canvas上下文');
      return '';
    }
    
    // 设置画布尺寸，每个像素用8x8像素来表示以确保清晰度
    const pixelSize = 8;
    canvas.width = dimensions.N * pixelSize;
    canvas.height = dimensions.M * pixelSize;
    
    // 绘制每个像素
    pixelData.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        if (cell) {
          // 使用颜色，外部单元格用白色
          const color = cell.isExternal ? '#FFFFFF' : cell.color;
          ctx.fillStyle = color;
          ctx.fillRect(
            colIndex * pixelSize, 
            rowIndex * pixelSize, 
            pixelSize, 
            pixelSize
          );
        }
      });
    });
    
    // 转换为dataURL
    return canvas.toDataURL('image/png');
  };

  const activateProject = (project: RestoredProjectEnvelope, persist = true) => {
    const prepared = prepareWebProject(project);
    const dimensions = { N: project.pattern.grid.width, M: project.pattern.grid.height };
    const preview = generateSyntheticImageFromPixelData(prepared.view.mappedPixelData, dimensions);
    if (!preview) throw new Error('无法准备项目预览');
    if (persist) saveWebProject(localStorage, project);
    generationEpochRef.current += 1;
    sourceImageAvailableRef.current = false;
    projectHistoryRef.current = createWebProjectHistory();
    projectRef.current = project;
    webEditingSessionRef.current = createWebEditingSession(project.pattern, 100, project.palette);
    setSelectedColorSystem(project.colorSystem as ColorSystem);
    setActiveBeadPalette(prepared.colors);
    setCustomPaletteSelections(Object.fromEntries(prepared.colors.map(color => [color.hex.toUpperCase(), true])));
    setExcludedColorKeys(new Set());
    setColorExclusionActions([]);
    setOriginalImageSrc(preview);
    setMappedPixelData(prepared.view.mappedPixelData);
    setGridDimensions(dimensions);
    setColorCounts(prepared.view.counts);
    setTotalBeadCount(prepared.view.totalCount);
    setInitialGridColorKeys(new Set(Object.keys(prepared.view.counts)));
    const config = project.project.generation?.config;
    setGranularity(config?.targetGrid.size ?? dimensions.N);
    setGranularityInput(String(config?.targetGrid.size ?? dimensions.N));
    setSimilarityThreshold(config?.similarityMerge.threshold ?? DEFAULT_SIMILARITY_THRESHOLD);
    setSimilarityThresholdInput(String(config?.similarityMerge.threshold ?? DEFAULT_SIMILARITY_THRESHOLD));
    setPixelationMode(config?.mode === 'realistic' ? PixelationMode.Average : PixelationMode.Dominant);
    setIsManualColoringMode(false);
    setSelectedColor(null);
    setIsEraseMode(false);
    setIsFillMode(false);
    setColorReplaceState({ isActive: false, step: 'select-source' });
    setEditingHistoryVersion(version => version + 1);
    setProjectSaveError('');
    setActiveStudioStep('refine');
  };

  useEffect(() => {
    try { const project = loadWebProject(localStorage); if (project) activateProject(project, false); }
    catch (error) { setProjectSaveError(`本地项目恢复失败，原数据已保留：${error instanceof Error ? error.message : '未知错误'}`); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveProject = () => {
    const project = projectRef.current;
    if (!project) return;
    try {
    const url = URL.createObjectURL(new Blob([exportWebProject(project)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.project.name.replace(/[\\/:*?"<>|]/g, '_')}.pinbean.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setProjectSaveError(`项目文件保存失败：${error instanceof Error ? error.message : '未知错误'}`); }
  };

  const processFile = async (file: File) => {
    const request = ++fileRequestRef.current;
    generationEpochRef.current += 1;
    if (file.name.toLowerCase().endsWith('.json')) {
      try {
        const text = await file.text();
        if (request !== fileRequestRef.current) return;
        activateProject(importWebProject(text));
      }
      catch (error) { alert(`项目导入失败：${error instanceof Error ? error.message : '未知错误'}`); }
      return;
    }
    // 检查文件类型
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    
    if (fileExtension === 'csv') {
      // 处理CSV文件
      console.log('正在导入CSV文件...');
      try {
        const { mappedPixelData } = await importCsvData(file);
        if (request !== fileRequestRef.current) return;
        const imported = mappedPixelsToWebPattern(mappedPixelData, fullBeadPalette, selectedColorSystem);
        activateProject(createWebProject(imported.pattern, createWebCorePalette(fullBeadPalette, selectedColorSystem).palette, selectedColorSystem, createProjectId(), file.name.replace(/\.csv$/i, ''), Date.now(), true));

        alert(`成功导入CSV文件！图纸尺寸：${imported.dimensions.N}x${imported.dimensions.M}，共使用${Object.keys(imported.counts).length}种颜色。`);
      } catch (error) {
        console.error('CSV导入失败:', error);
        alert(`CSV导入失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    } else {
      try {
        await inspectImageFile(file);
        if (request !== fileRequestRef.current) return;
      } catch (error) {
        alert(error instanceof Error ? error.message : '图片无法使用，请更换文件。');
        return;
      }
      // 处理图片文件 - 先打开裁剪弹窗
      const reader = new FileReader();
      reader.onload = (e) => {
        if (request !== fileRequestRef.current) return;
        const result = e.target?.result as string;
        setExcludedColorKeys(new Set());
        setColorExclusionActions([]);
        // 打开裁剪弹窗，而不是直接设置图片
        setCropperImageSrc(result);
        setPendingFile(file);
        setIsCropperOpen(true);
      };
      reader.onerror = () => {
          console.error("文件读取失败");
          alert("无法读取文件。");
          setInitialGridColorKeys(new Set()); // ++ 重置初始键 ++
      }
      reader.readAsDataURL(file);
    }
  };

  // 处理裁剪确认
  const handleCropConfirm = (croppedImageSrc: string) => {
    generationEpochRef.current += 1;
    sourceImageAvailableRef.current = true;
    projectRef.current = null;
    setOriginalImageSrc(croppedImageSrc);
    setMappedPixelData(null);
    setGridDimensions(null);
    setColorCounts(null);
    setTotalBeadCount(0);
    setInitialGridColorKeys(new Set()); // ++ 重置初始键 ++
    // ++ 重置横轴格子数量为默认值 ++
    setGranularity(DEFAULT_GRANULARITY);
    setGranularityInput(DEFAULT_GRANULARITY.toString());
    setSimilarityThreshold(DEFAULT_SIMILARITY_THRESHOLD);
    setSimilarityThresholdInput(DEFAULT_SIMILARITY_THRESHOLD.toString());
    setRemapTrigger(prev => prev + 1); // Trigger full remap for new image
    
    // 关闭裁剪弹窗
    setIsCropperOpen(false);
    setCropperImageSrc('');
    setPendingFile(null);
    
    // ++ Reset manual coloring mode when a new file is processed ++
    setIsManualColoringMode(false);
    setSelectedColor(null);
    setIsEraseMode(false);
  };

  // 处理裁剪取消
  const handleCropCancel = () => {
    setIsCropperOpen(false);
    setCropperImageSrc('');
    setPendingFile(null);
  };

  const handleAIOptimizedImage = (optimizedImageSrc: string) => {
    generationEpochRef.current += 1;
    sourceImageAvailableRef.current = true;
    projectRef.current = null;
    setOriginalImageSrc(optimizedImageSrc);
    setMappedPixelData(null);
    setGridDimensions(null);
    setColorCounts(null);
    setTotalBeadCount(0);
    setInitialGridColorKeys(new Set());
    webEditingSessionRef.current = null;
    setEditingHistoryVersion(version => version + 1);
    setIsManualColoringMode(false);
    setSelectedColor(null);
    setIsEraseMode(false);
    setIsFillMode(false);
    setColorReplaceState({ isActive: false, step: 'select-source' });
    setHighlightColorKey(null);
    setActiveStudioStep('generate');
  };

  // 处理一键擦除模式切换
  const handleEraseToggle = () => {
    // 确保在手动上色模式下才能使用擦除功能
    if (!isManualColoringMode) {
      return;
    }
    
    // 如果当前在颜色替换模式，先退出替换模式
    if (colorReplaceState.isActive) {
      setColorReplaceState({
        isActive: false,
        step: 'select-source'
      });
      setHighlightColorKey(null);
    }

    setIsFillMode(false);
    
    setIsEraseMode(!isEraseMode);
    // 如果开启擦除模式，取消选中的颜色
    if (!isEraseMode) {
      setSelectedColor(null);
    }
  };

  // ++ 新增：处理输入框变化的函数 ++
  const handleGranularityInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setGranularityInput(event.target.value);
  };

  // ++ 添加：处理相似度输入框变化的函数 ++
  const handleSimilarityThresholdInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSimilarityThresholdInput(event.target.value);
  };

  // ++ 修改：处理确认按钮点击的函数，同时处理两个参数 ++
  const handleConfirmParameters = () => {
    // 处理格子数
    const minGranularity = 10;
    const maxGranularity = 300;
    let newGranularity = parseInt(granularityInput, 10);

    if (isNaN(newGranularity) || newGranularity < minGranularity) {
      newGranularity = minGranularity;
    } else if (newGranularity > maxGranularity) {
      newGranularity = maxGranularity;
    }

    // 处理相似度阈值
    const minSimilarity = 0;
    const maxSimilarity = 100;
    let newSimilarity = parseInt(similarityThresholdInput, 10);
    
    if (isNaN(newSimilarity) || newSimilarity < minSimilarity) {
      newSimilarity = minSimilarity;
    } else if (newSimilarity > maxSimilarity) {
      newSimilarity = maxSimilarity;
    }

    // 检查值是否有变化
    const granularityChanged = newGranularity !== granularity;
    const similarityChanged = newSimilarity !== similarityThreshold;
    
    if (granularityChanged) {
      console.log(`Confirming new granularity: ${newGranularity}`);
      setGranularity(newGranularity);
    }
    
    if (similarityChanged) {
      console.log(`Confirming new similarity threshold: ${newSimilarity}`);
      setSimilarityThreshold(newSimilarity);
    }
    
    // 只有在有值变化时才触发重映射
    if (granularityChanged || similarityChanged) {
      setRemapTrigger(prev => prev + 1);
      // 退出手动上色模式
      setIsManualColoringMode(false);
      setSelectedColor(null);
    }

    // 始终同步输入框的值
    setGranularityInput(newGranularity.toString());
    setSimilarityThresholdInput(newSimilarity.toString());
  };

  // 添加像素化模式切换处理函数
  const handlePixelationModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const newMode = event.target.value as PixelationMode;
    if (Object.values(PixelationMode).includes(newMode)) {
        setPixelationMode(newMode);
        setRemapTrigger(prev => prev + 1); // 触发重新映射
        setIsManualColoringMode(false); // 退出手动模式
        setSelectedColor(null);
    } else {
        console.warn(`无效的像素化模式: ${newMode}`);
    }
  };

  // 修改pixelateImage函数接收模式参数
  const pixelateImage = (imageSrc: string, detailLevel: number, threshold: number, currentPalette: PaletteColor[], mode: PixelationMode) => {
    console.log(`Attempting to pixelate with detail: ${detailLevel}, threshold: ${threshold}, mode: ${mode}`);
    const originalCanvas = originalCanvasRef.current;
    const pixelatedCanvas = pixelatedCanvasRef.current;

    if (!originalCanvas || !pixelatedCanvas) { console.error("Canvas ref(s) not available."); return; }
    const originalCtx = originalCanvas.getContext('2d', { willReadFrequently: true });
    const pixelatedCtx = pixelatedCanvas.getContext('2d');
    if (!originalCtx || !pixelatedCtx) { console.error("Canvas context(s) not found."); return; }
    console.log("Canvas contexts obtained.");

    if (currentPalette.length === 0) {
        console.error("Cannot pixelate: The selected color palette is empty (likely due to exclusions).");
        alert("错误：当前可用颜色板为空（可能所有颜色都被排除了），无法处理图像。请尝试恢复部分颜色。");
        // Clear previous results visually
        pixelatedCtx.clearRect(0, 0, pixelatedCanvas.width, pixelatedCanvas.height);
        setMappedPixelData(null);
        setGridDimensions(null);
        // Keep colorCounts potentially showing the last valid counts? Or clear them too?
        // setColorCounts(null); // Decide if clearing counts is desired when palette is empty
        // setTotalBeadCount(0);
        return; // Stop processing
    }
    const img = new window.Image();
    const epoch = ++generationEpochRef.current;
    
    img.onerror = (error: Event | string) => {
      if (epoch !== generationEpochRef.current) return;
      console.error("Image loading failed:", error); 
      alert("无法加载图片。");
      setOriginalImageSrc(null); 
      setMappedPixelData(null); 
      setGridDimensions(null); 
      setColorCounts(null); 
      setInitialGridColorKeys(new Set());
    };
    
    img.onload = () => {
      if (epoch !== generationEpochRef.current || !sourceImageAvailableRef.current) return;
      console.log("Image loaded successfully.");
      const aspectRatio = img.height / img.width;
      const N = detailLevel;
      const M = Math.max(1, Math.round(N * aspectRatio));
      if (N <= 0 || M <= 0) { console.error("Invalid grid dimensions:", { N, M }); return; }
      console.log(`Grid size: ${N}x${M}`);

      // 动态调整画布尺寸：当格子数量大于100时，增加画布尺寸以保持每个格子的可见性
      const baseWidth = 500;
      const minCellSize = 4; // 每个格子的最小尺寸（像素）
      const recommendedCellSize = 6; // 推荐的格子尺寸（像素）
      
      let outputWidth = baseWidth;
      
      // 如果格子数量大于100，计算需要的画布宽度
      if (N > 100) {
        const requiredWidthForMinSize = N * minCellSize;
        const requiredWidthForRecommendedSize = N * recommendedCellSize;
        
        // 使用推荐尺寸，但不超过屏幕宽度的90%（最大1200px）
        const maxWidth = Math.min(1200, window.innerWidth * 0.9);
        outputWidth = Math.min(maxWidth, Math.max(baseWidth, requiredWidthForRecommendedSize));
        
        // 确保不小于最小要求
        outputWidth = Math.max(outputWidth, requiredWidthForMinSize);
        
        console.log(`Large grid detected (${N} columns). Adjusted canvas width from ${baseWidth} to ${outputWidth}px (cell size: ${Math.round(outputWidth / N)}px)`);
      }
      
      const outputHeight = Math.round(outputWidth * aspectRatio);
      
      // 在控制台提示用户画布尺寸变化
      if (N > 100) {
        console.log(`💡 由于格子数量较多 (${N}x${M})，画布已自动放大以保持清晰度。可以使用水平滚动查看完整图像。`);
      }
      originalCanvas.width = img.width; originalCanvas.height = img.height;
      pixelatedCanvas.width = outputWidth; pixelatedCanvas.height = outputHeight;
      console.log(`Canvas dimensions: Original ${img.width}x${img.height}, Output ${outputWidth}x${outputHeight}`);

      originalCtx.drawImage(img, 0, 0, img.width, img.height);
      console.log("Original image drawn.");

      try {
        const generated = generateWebPattern({
          image: imageDataToNormalizedImage(originalCtx.getImageData(0, 0, img.width, img.height)),
          detailLevel,
          similarityThreshold: threshold,
          currentPalette,
          mode,
          colorSystem: selectedColorSystem,
        });

        if (generated.dimensions.N !== N || generated.dimensions.M !== M) {
          throw new Error(
            `bead-core returned unexpected grid dimensions: ${generated.dimensions.N}x${generated.dimensions.M}, expected ${N}x${M}`,
          );
        }

        setMappedPixelData(generated.mappedPixelData);
        const actualPalette = createWebCorePalette(currentPalette, selectedColorSystem).palette;
        webEditingSessionRef.current = createWebEditingSession(generated.pattern, 100, actualPalette);
        setColorExclusionActions([]);
        persistProject(createWebProject(generated.pattern, actualPalette, selectedColorSystem, projectRef.current?.project.id ?? createProjectId(), projectRef.current?.project.name ?? pendingFile?.name.replace(/\.[^.]+$/, '') ?? '我的拼豆图纸'));
        setEditingHistoryVersion(version => version + 1);
        setGridDimensions(generated.dimensions);
        setColorCounts(generated.counts);
        setTotalBeadCount(generated.totalCount);
        setInitialGridColorKeys(new Set(Object.keys(generated.counts)));
        console.log("bead-core generation completed:", {
          dimensions: generated.dimensions,
          totalCount: generated.totalCount,
          counts: generated.counts,
        });
      } catch (error) {
        console.error("bead-core generation failed:", error);
        alert("图像处理失败，请检查图片或处理参数后重试。");
        pixelatedCtx.clearRect(0, 0, pixelatedCanvas.width, pixelatedCanvas.height);
        setMappedPixelData(null);
        webEditingSessionRef.current = null;
        setEditingHistoryVersion(version => version + 1);
        setGridDimensions(null);
        setColorCounts(null);
        setTotalBeadCount(0);
        setInitialGridColorKeys(new Set());
      }
    }; // 正确闭合 img.onload 函数
    
    console.log("Setting image source...");
    img.src = imageSrc;
    setIsManualColoringMode(false);
    setSelectedColor(null);
  }; // 正确闭合 pixelateImage 函数

  // 修改useEffect中的pixelateImage调用，加入模式参数
  useEffect(() => {
    if (!sourceImageAvailableRef.current) return undefined;
    if (skipNextPixelateRef.current) {
      skipNextPixelateRef.current = false;
      return undefined;
    }
    if (originalImageSrc && activeBeadPalette.length > 0) {
       const timeoutId = setTimeout(() => {
         if (originalImageSrc && originalCanvasRef.current && pixelatedCanvasRef.current && activeBeadPalette.length > 0) {
           console.log("useEffect triggered: Processing image due to src, granularity, threshold, palette selection, mode or remap trigger.");
           pixelateImage(originalImageSrc, granularity, similarityThreshold, activeBeadPalette, pixelationMode);
         } else {
            console.warn("useEffect check failed inside timeout: Refs or active palette not ready/empty.");
         }
       }, 50);
       return () => clearTimeout(timeoutId);
    } else if (originalImageSrc && activeBeadPalette.length === 0) {
        console.warn("Image selected, but the active palette is empty after exclusions. Cannot process. Clearing preview.");
        const pixelatedCanvas = pixelatedCanvasRef.current;
        const pixelatedCtx = pixelatedCanvas?.getContext('2d');
        if (pixelatedCtx && pixelatedCanvas) {
            pixelatedCtx.clearRect(0, 0, pixelatedCanvas.width, pixelatedCanvas.height);
            // Draw a message on the canvas?
            pixelatedCtx.fillStyle = '#6b7280'; // gray-500
            pixelatedCtx.font = '16px sans-serif';
            pixelatedCtx.textAlign = 'center';
            pixelatedCtx.fillText('无可用颜色，请恢复部分排除的颜色', pixelatedCanvas.width / 2, pixelatedCanvas.height / 2);
        }
        setMappedPixelData(null);
        setGridDimensions(null);
        // Keep colorCounts to allow user to un-exclude colors
        // setColorCounts(null);
        // setTotalBeadCount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalImageSrc, granularity, similarityThreshold, customPaletteSelections, pixelationMode, remapTrigger]);

  // 确保文件输入框引用在组件挂载后正确设置
  useEffect(() => {
    // 延迟执行，确保DOM完全渲染
    const timer = setTimeout(() => {
      if (!fileInputRef.current) {
        console.warn("文件输入框引用在组件挂载后仍为null，这可能会导致上传功能异常");
      }
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // 设置组件挂载状态
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // 添加URL重定向检查
  useEffect(() => {
    // 检查是否在浏览器环境中
    if (typeof window !== 'undefined') {
      const currentUrl = window.location.href;
      const currentHostname = window.location.hostname;
      const targetDomain = process.env.NEXT_PUBLIC_OFFICIAL_DOMAIN;
      if (!targetDomain) return;
      
      // 排除 localhost 和内网地址等本地开发环境
      const isLocalhost = currentHostname === 'localhost' ||
                         currentHostname === '127.0.0.1' ||
                         currentHostname.startsWith('192.168.') ||
                         currentHostname.startsWith('10.') ||
                         currentHostname.endsWith('.local');
      
      // 检查当前URL是否不是目标域名，且不是本地开发环境
      if (!currentUrl.startsWith(targetDomain) && !isLocalhost) {
        console.log(`当前URL: ${currentUrl}`);
        console.log(`目标URL: ${targetDomain}`);
        console.log('正在重定向到官方域名...');
        
        // 保留当前路径和查询参数
        const currentPath = window.location.pathname;
        const currentSearch = window.location.search;
        const currentHash = window.location.hash;
        
        // 构建完整的目标URL
        let redirectUrl = targetDomain;
        
        // 如果不是根路径，添加路径
        if (currentPath && currentPath !== '/') {
          redirectUrl = redirectUrl.replace(/\/$/, '') + currentPath;
        }
        
        // 添加查询参数和哈希
        redirectUrl += currentSearch + currentHash;
        
        // 执行重定向
        window.location.replace(redirectUrl);
      } else if (isLocalhost) {
        console.log(`检测到本地开发环境 (${currentHostname})，跳过重定向`);
      }
    }
  }, []); // 只在组件首次挂载时执行

    // --- Download function (ensure filename includes palette) ---
    const handleDownloadRequest = (options?: GridDownloadOptions) => {
        // 调用移动到utils/imageDownloader.ts中的downloadImage函数
        downloadImage({
          mappedPixelData,
          gridDimensions,
          colorCounts,
          totalBeadCount,
          options: options || downloadOptions,
          activeBeadPalette,
          selectedColorSystem
        });
    };

    // --- Handler to toggle color exclusion ---
    const handleToggleExcludeColor = (hexKey: string) => {
        const currentExcluded = excludedColorKeys;
        const isExcluding = !currentExcluded.has(hexKey);

        if (isExcluding) {
            if (!webEditingSessionRef.current) {
                alert('请先生成图纸后再排除颜色。');
                return;
            }
            if (initialGridColorKeys.size === 0) {
                alert('无法排除颜色，初始颜色数据尚未准备好，请稍候。');
                return;
            }
            const nextExcludedKeys = new Set(currentExcluded);
            nextExcludedKeys.add(hexKey);
            const potentialRemapHexKeys = new Set(initialGridColorKeys);
            potentialRemapHexKeys.delete(hexKey);
            currentExcluded.forEach(excludedHexKey => potentialRemapHexKeys.delete(excludedHexKey));
            const remapTargetPalette = fullBeadPalette.filter(color => potentialRemapHexKeys.has(color.hex.toUpperCase()));
            const excludedColorData = fullBeadPalette.find(color => color.hex.toUpperCase() === hexKey);
            if (!excludedColorData || remapTargetPalette.length === 0) {
                alert(`无法排除颜色 ${hexKey}，因为图中最初存在的其他可用颜色也已被排除。请先恢复部分其他颜色。`);
                return;
            }
            const replacementColor = findClosestPaletteColor(excludedColorData.rgb, remapTargetPalette);
            try {
                const changed = applyWebEdit({
                    source: { key: getColorKeyByHex(hexKey, selectedColorSystem), color: hexKey },
                    target: { key: replacementColor.key, color: replacementColor.hex },
                    type: 'replace',
                });
                if (changed > 0) {
                    const historyDepth = webEditingSessionRef.current?.history.undoStack.length ?? 0;
                    setExcludedColorKeys(nextExcludedKeys);
                    setColorExclusionActions(actions => [
                      ...actions.filter(action => action.historyDepth < historyDepth),
                      { hexKey, historyDepth },
                    ]);
                }
            } catch (error) {
                console.error('共享颜色排除失败:', error);
                alert(error instanceof Error ? error.message : '颜色排除失败，请重新生成图纸。');
                return;
            }
        } else {
            const nextExcludedKeys = new Set(currentExcluded);
            nextExcludedKeys.delete(hexKey);
            setExcludedColorKeys(nextExcludedKeys);
            setColorExclusionActions(actions => actions.filter(action => action.hexKey !== hexKey));
            setRemapTrigger(prev => prev + 1);
        }
        setIsManualColoringMode(false);
        setSelectedColor(null);
    };

  // 一键去背景：识别边缘主色并洪水填充去除
  const handleAutoRemoveBackground = () => {
    if (!mappedPixelData || !gridDimensions || !webEditingSessionRef.current) {
      alert('请先生成图纸后再使用一键去背景。');
      return;
    }
    try {
      const changed = applyWebEdit({ type: 'background-remove' });
      if (changed === 0) alert('未找到可去除的背景区域。');
    } catch (error) {
      console.error('共享去背景失败:', error);
      alert(error instanceof Error ? error.message : '去背景失败，请重新生成图纸。');
    }
  };

  // --- Tooltip Logic ---

  // --- Canvas Interaction ---

  // 洪水填充擦除函数
  const floodFillErase = (startRow: number, startCol: number, targetKey: string) => {
    if (!mappedPixelData || !gridDimensions || !targetKey) return false;
    try {
      return applyWebEdit({
        index: startRow * gridDimensions.N + startCol,
        target: { key: TRANSPARENT_KEY, color: '#FFFFFF' },
        type: 'fill',
      }) > 0;
    } catch (error) {
      console.error('共享区域擦除失败:', error);
      alert(error instanceof Error ? error.message : '区域擦除失败，请重新生成图纸。');
      return false;
    }
  };

  // 将点击位置所在的连续同色区域替换为当前选中颜色
  const floodFillRegion = (startRow: number, startCol: number, fillColor: MappedPixel) => {
    if (!mappedPixelData || !gridDimensions || fillColor.key === TRANSPARENT_KEY) return;
    try {
      applyWebEdit({
        index: startRow * gridDimensions.N + startCol,
        target: fillColor,
        type: 'fill',
      });
    } catch (error) {
      console.error('共享区域填充失败:', error);
      alert(error instanceof Error ? error.message : '区域填充失败，请重新生成图纸。');
    }
  };

  // ++ Re-introduce the combined interaction handler ++
  const handleCanvasInteraction = (
    clientX: number, 
    clientY: number, 
    pageX: number, 
    pageY: number, 
    isClick: boolean = false,
    isTouchEnd: boolean = false
  ) => {
    // 如果是触摸结束或鼠标离开事件，隐藏提示
    if (isTouchEnd) {
      setTooltipData(null);
      return;
    }

    const canvas = pixelatedCanvasRef.current;
    if (!canvas || !mappedPixelData || !gridDimensions) {
      setTooltipData(null);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;

    const { N, M } = gridDimensions;
    const cellWidthOutput = canvas.width / N;
    const cellHeightOutput = canvas.height / M;

    const i = Math.floor(canvasX / cellWidthOutput);
    const j = Math.floor(canvasY / cellHeightOutput);

    if (i >= 0 && i < N && j >= 0 && j < M) {
      const cellData = mappedPixelData[j][i];

      // 颜色替换模式逻辑 - 选择源颜色
      if (isClick && colorReplaceState.isActive && colorReplaceState.step === 'select-source') {
        if (cellData && !cellData.isExternal && cellData.key && cellData.key !== TRANSPARENT_KEY) {
          // 执行选择源颜色
          handleCanvasColorSelect({
            key: cellData.key,
            color: cellData.color
          });
          setTooltipData(null);
        }
        return;
      }

      // 一键擦除模式逻辑
      if (isClick && isEraseMode) {
        if (cellData && !cellData.isExternal && cellData.key && cellData.key !== TRANSPARENT_KEY) {
          // 执行洪水填充擦除
          const erased = floodFillErase(j, i, cellData.key);
          setIsEraseMode(false); // 擦除完成后退出擦除模式
          setIsFillSuggested(erased);
          setTooltipData(null);
        }
        return;
      }

      if (isClick && isFillMode) {
        if (selectedColor && selectedColor.key !== TRANSPARENT_KEY) {
          floodFillRegion(j, i, selectedColor);
          setIsFillMode(false);
          setIsFillSuggested(false);
          setTooltipData(null);
        }
        return;
      }

      // Manual Coloring Logic - 保持原有的上色逻辑
      if (isClick && isManualColoringMode && selectedColor) {
        try {
          applyWebEdit({ index: j * N + i, target: selectedColor, type: 'paint' });
          setIsFillSuggested(false);
        } catch (error) {
          console.error('共享单格编辑失败:', error);
          alert(error instanceof Error ? error.message : '编辑失败，请重新生成图纸。');
        }
        // 上色操作后隐藏提示
        setTooltipData(null);
      }
      // Tooltip Logic (非手动上色模式点击或悬停)
      else if (!isManualColoringMode) {
        // 只有单元格实际有内容（非背景/外部区域）才会显示提示
        if (cellData && !cellData.isExternal && cellData.key) {
          // 检查是否已经显示了提示框，并且是否点击的是同一个位置
          // 对于移动设备，位置可能有细微偏差，所以我们检查单元格索引而不是具体坐标
          if (tooltipData) {
            // 如果已经有提示框，计算当前提示框对应的格子的索引
            const tooltipRect = canvas.getBoundingClientRect();
            
            // 还原提示框位置为相对于canvas的坐标
            const prevX = tooltipData.x; // 页面X坐标
            const prevY = tooltipData.y; // 页面Y坐标
            
            // 转换为相对于canvas的坐标
            const prevCanvasX = (prevX - tooltipRect.left) * scaleX;
            const prevCanvasY = (prevY - tooltipRect.top) * scaleY;
            
            // 计算之前显示提示框位置对应的网格索引
            const prevCellI = Math.floor(prevCanvasX / cellWidthOutput);
            const prevCellJ = Math.floor(prevCanvasY / cellHeightOutput);
            
            // 如果点击的是同一个格子，则切换tooltip的显示/隐藏状态
            if (i === prevCellI && j === prevCellJ) {
              setTooltipData(null); // 隐藏提示
              return;
            }
          }
          
          // 计算相对于main元素的位置
          const mainElement = mainRef.current;
          if (mainElement) {
            const mainRect = mainElement.getBoundingClientRect();
            // 计算相对于main元素的坐标
            const relativeX = pageX - mainRect.left - window.scrollX;
            const relativeY = pageY - mainRect.top - window.scrollY;
            
            // 如果是移动/悬停到一个新的有效格子，或者点击了不同的格子，则显示提示
            setTooltipData({
              x: relativeX,
              y: relativeY,
              key: cellData.key,
              color: cellData.color,
            });
          } else {
            // 如果没有找到main元素，使用原始坐标
            setTooltipData({
              x: pageX,
              y: pageY,
              key: cellData.key,
              color: cellData.color,
            });
          }
        } else {
          // 如果点击/悬停在外部区域或背景上，隐藏提示
          setTooltipData(null);
        }
      }
    } else {
      // 如果点击/悬停在画布外部，隐藏提示
      setTooltipData(null);
    }
  };

  // 处理自定义色板中单个颜色的选择变化
  const handleSelectionChange = (hexValue: string, isSelected: boolean) => {
    const normalizedHex = hexValue.toUpperCase();
    setCustomPaletteSelections(prev => ({
      ...prev,
      [normalizedHex]: isSelected
    }));
    setIsCustomPalette(true);
  };

  // 保存自定义色板并应用
  const handleSaveCustomPalette = () => {
    savePaletteSelections(customPaletteSelections);
    setIsCustomPalette(true);
    setIsCustomPaletteEditorOpen(false);
    // 触发图像重新处理
    setRemapTrigger(prev => prev + 1);
    // 退出手动上色模式
    setIsManualColoringMode(false);
    setSelectedColor(null);
    setIsEraseMode(false);
  };

  // ++ 新增：导出自定义色板配置 ++
  const handleExportCustomPalette = () => {
    const selectedHexValues = Object.entries(customPaletteSelections)
      .filter(([, isSelected]) => isSelected)
      .map(([hexValue]) => hexValue);

    if (selectedHexValues.length === 0) {
      alert("当前没有选中的颜色，无法导出。");
      return;
    }

    // 导出格式：仅基于hex值
    const exportData = {
      version: "3.0", // 新版本号
      selectedHexValues: selectedHexValues,
      exportDate: new Date().toISOString(),
      totalColors: selectedHexValues.length
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'custom-perler-palette.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ++ 新增：处理导入的色板文件 ++
  const handleImportPaletteFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        // 检查文件格式
        if (!Array.isArray(data.selectedHexValues)) {
          throw new Error("无效的文件格式：文件必须包含 'selectedHexValues' 数组。");
        }

        console.log("检测到基于hex值的色板文件");

        const importedHexValues = data.selectedHexValues as string[];
        const validHexValues: string[] = [];
        const invalidHexValues: string[] = [];

        // 验证hex值
        importedHexValues.forEach(hex => {
          const normalizedHex = hex.toUpperCase();
          const colorData = fullBeadPalette.find(color => color.hex.toUpperCase() === normalizedHex);
          if (colorData) {
            validHexValues.push(normalizedHex);
          } else {
            invalidHexValues.push(hex);
          }
        });

        if (invalidHexValues.length > 0) {
          console.warn("导入时发现无效的hex值:", invalidHexValues);
          alert(`导入完成，但以下颜色无效已被忽略：\n${invalidHexValues.join(', ')}`);
        }

        if (validHexValues.length === 0) {
          alert("导入的文件中不包含任何有效的颜色。");
          return;
        }

        console.log(`成功验证 ${validHexValues.length} 个有效的hex值`);

        // 基于有效的hex值创建新的selections对象
        const allHexValues = fullBeadPalette.map(color => color.hex.toUpperCase());
        const newSelections = presetToSelections(allHexValues, validHexValues);
        setCustomPaletteSelections(newSelections);
        setIsCustomPalette(true); // 标记为自定义
        alert(`成功导入 ${validHexValues.length} 个颜色！`);

      } catch (error) {
        console.error("导入色板配置失败:", error);
        alert(`导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        // 重置文件输入，以便可以再次导入相同的文件
        if (event.target) {
          event.target.value = '';
        }
      }
    };
    reader.onerror = () => {
      alert("读取文件失败。");
       // 重置文件输入
      if (event.target) {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  // ++ 新增：触发导入文件选择 ++
  const triggerImportPalette = () => {
    importPaletteInputRef.current?.click();
  };

  // 新增：处理颜色高亮
  const handleHighlightColor = (colorHex: string | null) => {
    if (colorHex) {
      setHighlightColorKey(colorHex);
      return;
    }

    if (colorReplaceState.isActive && colorReplaceState.step === 'select-target' && colorReplaceState.sourceColor) {
      setHighlightColorKey(colorReplaceState.sourceColor.color);
      return;
    }

    setHighlightColorKey(null);
  };

  // 新增：切换完整色板显示
  const handleToggleFullPalette = () => {
    setShowFullPalette(!showFullPalette);
  };

  // 新增：处理颜色选择，同时管理模式切换
  const handleColorSelect = (colorData: { key: string; color: string; isExternal?: boolean }) => {
    // 如果选择的是橡皮擦（透明色）且当前在颜色替换模式，退出替换模式
    if (colorData.key === TRANSPARENT_KEY && colorReplaceState.isActive) {
      setColorReplaceState({
        isActive: false,
        step: 'select-source'
      });
      setHighlightColorKey(null);
    }
    
    // 选择任何颜色（包括橡皮擦）时，都应该退出一键擦除模式
    if (isEraseMode) {
      setIsEraseMode(false);
    }

    if (colorData.key === TRANSPARENT_KEY) {
      setIsFillMode(false);
    }
    
    // 设置选中的颜色
    setSelectedColor(colorData);
  };

  const handleFillToggle = () => {
    if (!isManualColoringMode || !selectedColor || selectedColor.key === TRANSPARENT_KEY) return;
    setIsFillMode(prev => !prev);
    setIsEraseMode(false);
    setColorReplaceState({ isActive: false, step: 'select-source' });
    setHighlightColorKey(null);
  };

  // 新增：颜色替换相关处理函数
  const handleColorReplaceToggle = () => {
    setColorReplaceState(prev => {
      if (prev.isActive) {
        // 退出替换模式
        return {
          isActive: false,
          step: 'select-source'
        };
      } else {
        // 进入替换模式
        // 只退出冲突的模式，但保持在手动上色模式下
        setIsEraseMode(false);
        setIsFillMode(false);
        setIsFillSuggested(false);
        setSelectedColor(null);
        return {
          isActive: true,
          step: 'select-source'
        };
      }
    });
  };

  // 新增：处理从画布选择源颜色
  const handleCanvasColorSelect = (colorData: { key: string; color: string }) => {
    if (colorReplaceState.isActive && colorReplaceState.step === 'select-source') {
      // 高亮显示选中的颜色
      setHighlightColorKey(colorData.color);
      // 进入第二步：选择目标颜色
      setColorReplaceState({
        isActive: true,
        step: 'select-target',
        sourceColor: colorData
      });
    }
  };

  // 新增：执行颜色替换
  const handleColorReplace = (sourceColor: { key: string; color: string }, targetColor: { key: string; color: string }) => {
    if (!mappedPixelData || !gridDimensions) return;
    try {
      const replaceCount = applyWebEdit({ source: sourceColor, target: targetColor, type: 'replace' });
      if (replaceCount > 0) {
        console.log(`颜色替换完成：将 ${replaceCount} 个 ${sourceColor.key} 替换为 ${targetColor.key}`);
      }
    } catch (error) {
      console.error('共享整色替换失败:', error);
      alert(error instanceof Error ? error.message : '颜色替换失败，请重新生成图纸。');
    }

    // 退出替换模式
    setColorReplaceState({
      isActive: false,
      step: 'select-source'
    });
    
    // 清除高亮
    setHighlightColorKey(null);
  };

  // 生成完整色板数据（用户自定义色板中选中的所有颜色）
  const fullPaletteColors = useMemo(() => {
    const selectedColors: { key: string; color: string }[] = [];
    
    Object.entries(customPaletteSelections).forEach(([hexValue, isSelected]) => {
      if (isSelected) {
        // 根据选择的色号系统获取显示的色号
        const displayKey = getColorKeyByHex(hexValue, selectedColorSystem);
        selectedColors.push({
          key: displayKey,
          color: hexValue
        });
      }
    });
    
    // 使用色相排序而不是色号排序
    return sortColorsByHue(selectedColors);
  }, [customPaletteSelections, selectedColorSystem]);

  const studioColorCount = colorCounts ? Object.keys(colorCounts).length : 0;
  const enabledStudioSteps: StudioStep[] = originalImageSrc
    ? mappedPixelData
      ? ['import', 'generate', 'refine', 'make']
      : ['import', 'generate']
    : ['import'];

  useEffect(() => {
    if (originalImageSrc && activeStudioStep === 'import') {
      setActiveStudioStep('generate');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [originalImageSrc, activeStudioStep]);

  const applyGranularityPreset = (value: number) => {
    setGranularity(value);
    setGranularityInput(value.toString());
    setRemapTrigger(prev => prev + 1);
    setIsManualColoringMode(false);
  };

  const applySimilarityPreset = (value: number) => {
    setSimilarityThreshold(value);
    setSimilarityThresholdInput(value.toString());
    setRemapTrigger(prev => prev + 1);
    setIsManualColoringMode(false);
  };

  const applyPixelationMode = (mode: PixelationMode) => {
    setPixelationMode(mode);
    setRemapTrigger(prev => prev + 1);
    setIsManualColoringMode(false);
    setSelectedColor(null);
  };

  const enterManualEditing = () => {
    if (!mappedPixelData) return;
    setActiveStudioStep('refine');
    setIsManualColoringMode(true);
    setIsEraseMode(false);
    setIsFillMode(false);
    setIsFillSuggested(false);
    setColorReplaceState({ isActive: false, step: 'select-source' });
    setSelectedColor(null);
    setTooltipData(null);
  };

  const handleStudioStepChange = (step: StudioStep) => {
    if (!enabledStudioSteps.includes(step)) return;
    if (step === 'import') {
      triggerFileInput();
      return;
    }
    if (step === 'refine') {
      enterManualEditing();
      return;
    }
    if (step === 'make') {
      setActiveStudioStep('make');
      handleEnterFocusMode();
      return;
    }
    setActiveStudioStep(step);
    setIsManualColoringMode(false);
  };

  return (
    <>
    {/* 添加自定义动画样式 */}
    <style dangerouslySetInnerHTML={{ __html: floatAnimation }} />

    <div className="pinbean-app">
      <PinBeanHeader
        hasProject={Boolean(originalImageSrc)}
        onNewProject={triggerFileInput}
        onHelp={() => setIsTutorialModalOpen(true)}
      />
      {projectSaveError && <p role="alert" className="mx-auto max-w-6xl px-4 py-2 text-sm text-red-700">{projectSaveError}</p>}
      {mappedPixelData && <div className="mx-auto flex max-w-6xl justify-end px-4 py-2"><button type="button" onClick={handleSaveProject} className="rounded-md border border-gray-300 px-3 py-2 text-sm">保存项目文件</button></div>}
      {/* Apply dark mode styles to the header */}
      <header className="hidden">
        {/* Adjust decorative background colors for dark mode */}
        <div className="absolute top-0 left-0 w-48 h-48 bg-blue-100 dark:bg-blue-900 rounded-full opacity-30 dark:opacity-20 blur-3xl"></div>
        <div className="absolute bottom-0 right-0 w-48 h-48 bg-pink-100 dark:bg-pink-900 rounded-full opacity-30 dark:opacity-20 blur-3xl"></div>

        {/* Adjust decorative dots color */}
        <div className="absolute top-0 right-0 grid grid-cols-5 gap-1 opacity-20 dark:opacity-10">
          {[...Array(25)].map((_, i) => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-600"></div>
          ))}
        </div>
        <div className="absolute bottom-0 left-0 grid grid-cols-5 gap-1 opacity-20 dark:opacity-10">
          {[...Array(25)].map((_, i) => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-600"></div>
          ))}
        </div>

        {/* Header content - Ultra fancy integrated logo and titles */}
        <div className="relative z-10 py-8">
          {/* Integrated super fancy logo and title container */}
          <div className="relative flex flex-col items-center">
            {/* Ultra cute hyper-detailed 16-bead icon */}
            

            {/* Ultra fancy brand name and tool name with hyper cute decorations */}
            <div className="relative flex flex-col items-center space-y-3">
              {/* Tool name - 拼豆底稿生成器 with hyper cute style */}
              <div className="relative">
                <h2 className="relative text-xl sm:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-500 via-teal-500 via-green-500 to-emerald-400 tracking-widest transform hover:scale-102 transition-all duration-300">
                  拼豆AI生成
                </h2>
                
                {/* Super cute geometric shapes */}
                <div className="absolute -top-3 -left-6 w-3.5 h-3.5 bg-gradient-to-br from-blue-400 to-teal-500 rounded-full animate-bounce delay-75"></div>
                <div className="absolute -top-1 -left-3 w-2 h-2 bg-gradient-to-br from-teal-400 to-green-500 rounded-full animate-ping delay-150"></div>
                <div className="absolute -top-0.5 -left-1 w-1 h-1 bg-gradient-to-br from-green-400 to-emerald-500 rotate-45 animate-pulse delay-225"></div>
                <div className="absolute -top-3 -right-6 w-3 h-3 bg-gradient-to-br from-green-400 to-emerald-500 rotate-45 animate-spin delay-300"></div>
                <div className="absolute -top-1 -right-3 w-1.5 h-1.5 bg-gradient-to-br from-emerald-400 to-cyan-500 rounded-full animate-bounce delay-375"></div>
                <div className="absolute -bottom-2 -right-3 w-2.5 h-2.5 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full animate-pulse delay-450"></div>
                <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-gradient-to-br from-teal-400 to-blue-500 rotate-45 animate-spin delay-525"></div>
                
                {/* Mini sparkles around tool name */}
                <div className="absolute -top-2 left-2 w-0.5 h-0.5 bg-blue-300 rounded-full animate-ping delay-600"></div>
                <div className="absolute -top-1 right-2 w-1 h-1 bg-teal-300 rounded-full animate-pulse delay-675"></div>
                <div className="absolute bottom-0 left-4 w-0.5 h-0.5 bg-green-300 rounded-full animate-bounce delay-750"></div>
                <div className="absolute bottom-1 right-4 w-0.5 h-0.5 bg-emerald-300 rounded-full animate-pulse delay-825"></div>
                <div className="absolute top-2 -left-2 w-0.5 h-0.5 bg-cyan-300 rounded-full animate-ping delay-900"></div>
                <div className="absolute top-2 -right-2 w-1 h-1 bg-teal-300 rounded-full animate-bounce delay-975"></div>
              </div>
            </div>
            
            {/* Ultra cute floating elements constellation around the entire group */}
            <div className="absolute -top-10 -left-10 w-3 h-3 bg-gradient-to-br from-pink-400 to-purple-500 rounded-full animate-float"></div>
            <div className="absolute -top-8 -left-6 w-1.5 h-1.5 bg-gradient-to-br from-purple-400 to-pink-500 rotate-45 animate-spin delay-100"></div>
            <div className="absolute -top-6 -left-12 w-2 h-2 bg-gradient-to-br from-pink-400 to-red-500 rounded-full animate-bounce delay-200"></div>
            
            <div className="absolute -top-10 -right-10 w-2.5 h-2.5 bg-gradient-to-br from-blue-400 to-cyan-500 rounded-full animate-ping delay-300"></div>
            <div className="absolute -top-6 -right-14 w-1 h-1 bg-gradient-to-br from-cyan-400 to-blue-500 rotate-45 animate-pulse delay-400"></div>
            <div className="absolute -top-4 -right-8 w-3 h-3 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full animate-bounce delay-500"></div>
            
            <div className="absolute -bottom-10 -left-10 w-2 h-2 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full animate-pulse delay-600"></div>
            <div className="absolute -bottom-8 -left-14 w-1.5 h-1.5 bg-gradient-to-br from-orange-400 to-red-500 rotate-45 animate-spin delay-700"></div>
            <div className="absolute -bottom-6 -left-6 w-2.5 h-2.5 bg-gradient-to-br from-yellow-400 to-pink-500 rounded-full animate-float delay-800"></div>
            
            <div className="absolute -bottom-10 -right-10 w-3 h-3 bg-gradient-to-br from-green-400 to-teal-500 rotate-45 animate-bounce delay-900"></div>
            <div className="absolute -bottom-8 -right-6 w-1 h-1 bg-gradient-to-br from-teal-400 to-cyan-500 rounded-full animate-ping delay-1000"></div>
            <div className="absolute -bottom-6 -right-14 w-2 h-2 bg-gradient-to-br from-emerald-400 to-green-500 rounded-full animate-pulse delay-1100"></div>
            
            {/* Extra tiny magical sparkles */}
            <div className="absolute -top-12 left-0 w-0.5 h-0.5 bg-yellow-300 rounded-full animate-ping delay-1200"></div>
            <div className="absolute -top-2 -left-16 w-1 h-1 bg-pink-300 rounded-full animate-bounce delay-1300"></div>
            <div className="absolute top-2 -right-18 w-0.5 h-0.5 bg-blue-300 rounded-full animate-pulse delay-1400"></div>
            <div className="absolute -bottom-12 right-0 w-1 h-1 bg-purple-300 rounded-full animate-float delay-1500"></div>
            <div className="absolute -bottom-2 -right-16 w-0.5 h-0.5 bg-green-300 rounded-full animate-ping delay-1600"></div>
            <div className="absolute bottom-2 -left-18 w-1 h-1 bg-teal-300 rounded-full animate-bounce delay-1700"></div>
          </div>
          {/* Separator gradient remains the same */}
          <div className="h-1 w-24 mx-auto my-3 bg-gradient-to-r from-blue-500 to-pink-500 rounded-full"></div>
                    {/* Slogan with clean typography */}
          <p className="mt-4 text-base sm:text-lg font-light text-gray-600 dark:text-gray-300 max-w-lg mx-auto text-center tracking-[0.1em] leading-relaxed">
            AI帮帮忙，像素创意更简单
          </p>
 
          
          {/* 添加小红书交流群链接 */}
          
        </div>
      </header>

      {/* Apply dark mode styles to the main section */}
      <main ref={mainRef} className="pinbean-shell">
        {!originalImageSrc ? (
          <ProjectStart
            ready={isMounted}
            onUpload={triggerFileInput}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          />
        ) : (
          <WorkflowSteps
            activeStep={activeStudioStep}
            enabledSteps={enabledStudioSteps}
            onStepChange={handleStudioStepChange}
          />
        )}

        {/* Apply dark mode styles to the Drop Zone */}
        <div
          onDrop={handleDrop} onDragOver={handleDragOver} onDragEnter={handleDragOver}
          onClick={isMounted ? triggerFileInput : undefined}
          className="hidden"
          style={{ minHeight: '130px' }}
        >
          {/* Icon color */}
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 sm:h-12 sm:w-12 text-gray-400 dark:text-gray-500 mb-2 sm:mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
             <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          {/* Text color */}
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">拖放图片到此处，或<span className="font-medium text-blue-600 dark:text-blue-400">点击选择文件</span></p>
          {/* Text color */}
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">支持 JPG, PNG 图片格式，或 CSV 数据文件</p>
        </div>

        {/* Apply dark mode styles to the Tip Box */}
        {false && !originalImageSrc && (
          <div className="w-full md:max-w-md bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-700 p-3 rounded-lg border border-blue-100 dark:border-gray-600 shadow-sm">
            {/* Icon color */}
            <p className="text-xs text-indigo-700 dark:text-indigo-300 flex items-start">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5 flex-shrink-0 text-blue-500 dark:text-blue-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {/* Text color */}
              <span className="text-indigo-700 dark:text-indigo-300">小贴士：使用像素图进行转换前，请确保图片的边缘吻合像素格子的边界线，这样可以获得更精确的切割效果和更好的成品。</span>
            </p>
          </div>
        )}

                      <input type="file" accept="image/jpeg, image/png, .pinbean.json, application/json, .csv, text/csv, application/csv, text/plain" onChange={handleFileChange} ref={fileInputRef} className="hidden" />

        {/* Controls and Output Area */}
        {originalImageSrc && (
          <div className={`pinbean-studio ${isManualColoringMode ? 'is-refining' : ''}`}>
            {!isManualColoringMode && (
              <aside className="pinbean-panel pinbean-panel-sticky pinbean-settings">
                <div className="pinbean-panel-heading">
                  <div>
                    <h2>生成设置</h2>
                    <p>先选接近成品的方案，再按需要微调。</p>
                  </div>
                  <span className="pinbean-mode-badge">实时预览</span>
                </div>

                <span className="pinbean-section-label">作品尺寸</span>
                <div className="pinbean-choice-grid is-four">
                  {[29, 50, 75, 100].map(value => (
                    <button
                      type="button"
                      key={value}
                      className={`pinbean-choice ${granularity === value ? 'is-selected' : ''}`}
                      onClick={() => applyGranularityPreset(value)}
                    >
                      {value === 29 ? '小' : value === 50 ? '中' : value === 75 ? '大' : '细'}
                    </button>
                  ))}
                </div>

                <span className="pinbean-section-label">画面风格</span>
                <div className="pinbean-choice-grid">
                  <button
                    type="button"
                    className={`pinbean-choice ${pixelationMode === PixelationMode.Dominant ? 'is-selected' : ''}`}
                    onClick={() => applyPixelationMode(PixelationMode.Dominant)}
                  >
                    轮廓清楚
                  </button>
                  <button
                    type="button"
                    className={`pinbean-choice ${pixelationMode === PixelationMode.Average ? 'is-selected' : ''}`}
                    onClick={() => applyPixelationMode(PixelationMode.Average)}
                  >
                    色彩细腻
                  </button>
                </div>

                <span className="pinbean-section-label">颜色复杂度</span>
                <div className="pinbean-choice-grid">
                  {[
                    { label: '更省豆', value: 48 },
                    { label: '更还原', value: 22 },
                  ].map(option => (
                    <button
                      type="button"
                      key={option.value}
                      className={`pinbean-choice ${similarityThreshold === option.value ? 'is-selected' : ''}`}
                      onClick={() => applySimilarityPreset(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <span className="pinbean-section-label">色号品牌</span>
                <select
                  className="pinbean-select"
                  value={selectedColorSystem}
                  onChange={event => setSelectedColorSystem(event.target.value as ColorSystem)}
                >
                  {colorSystemOptions.map(option => (
                    <option key={option.key} value={option.key}>{option.name}</option>
                  ))}
                </select>

                <details className="pinbean-advanced">
                  <summary>高级参数</summary>
                  <span className="pinbean-section-label">横向格数（10–300）</span>
                  <div className="pinbean-control-row">
                    <input
                      className="pinbean-input"
                      type="number"
                      min="10"
                      max="300"
                      value={granularityInput}
                      onChange={handleGranularityInputChange}
                    />
                    <button type="button" className="pinbean-button pinbean-button-quiet" onClick={handleConfirmParameters}>应用</button>
                  </div>
                  <span className="pinbean-section-label">颜色合并阈值（0–100）</span>
                  <input
                    className="pinbean-input"
                    type="number"
                    min="0"
                    max="100"
                    value={similarityThresholdInput}
                    onChange={handleSimilarityThresholdInputChange}
                    onBlur={handleConfirmParameters}
                  />
                </details>

                <div className="pinbean-action-stack">
                  <button type="button" className="pinbean-button pinbean-button-quiet pinbean-button-block" onClick={() => setIsAIOptimizeOpen(true)} disabled={!originalImageSrc}>AI 优化图片</button>
                  <button type="button" className="pinbean-button pinbean-button-quiet pinbean-button-block" onClick={handleAutoRemoveBackground} disabled={!mappedPixelData}>去掉背景</button>
                  <button type="button" className="pinbean-button pinbean-button-quiet pinbean-button-block" onClick={() => setIsCustomPaletteEditorOpen(true)}>
                    {isCustomPalette ? '管理我的色板' : '限制可用颜色'}
                  </button>
                </div>
              </aside>
            )}
            {/* ++ HIDE Control Row in manual mode ++ */}
            {!isManualColoringMode && (
              /* 修改控制面板网格布局 */
              <div className="hidden">
                {/* Granularity Input */}
                <div className="flex-1">
                  {/* Label color */}
                  <label htmlFor="granularityInput" className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 sm:mb-2">
                    横轴切割数量 (10-300):
                  </label>
                  <div className="flex items-center gap-2">
                    {/* Input field styles */}
                    <input
                      type="number"
                      id="granularityInput"
                      value={granularityInput}
                      onChange={handleGranularityInputChange}
                      className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 h-9 shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
                      min="10"
                      max="300"
                    />
                  </div>
                </div>

                {/* Similarity Threshold Input */}
                <div className="flex-1">
                    {/* Label color */}
                    <label htmlFor="similarityThresholdInput" className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 sm:mb-2">
                        颜色合并阈值 (0-100):
                    </label>
                    <div className="flex items-center gap-2">
                      {/* Input field styles */}
                      <input
                        type="number"
                        id="similarityThresholdInput"
                        value={similarityThresholdInput}
                        onChange={handleSimilarityThresholdInputChange}
                        className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 h-9 shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
                        min="0"
                        max="100"
                      />
                    </div>
                </div>

                {/* 快捷按钮 */}
                <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleConfirmParameters}
                    className="h-9 bg-blue-500 hover:bg-blue-600 text-white text-sm px-3 rounded-md whitespace-nowrap transition-colors duration-200 shadow-sm"
                  >
                    应用数字
                  </button>
                  <button
                    onClick={handleAutoRemoveBackground}
                    disabled={!mappedPixelData || !gridDimensions}
                    className="inline-flex items-center justify-center h-9 px-3 text-sm rounded-md border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-800/40 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    一键去背景
                  </button>
                </div>

                {/* Pixelation Mode Selector */}
                <div className="sm:col-span-2">
                  {/* Label color */}
                  <label htmlFor="pixelationModeSelect" className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 sm:mb-2">处理模式:</label>
                  <div className="flex items-center gap-2">
                    {/* Select field styles */}
                    <select
                      id="pixelationModeSelect"
                      value={pixelationMode}
                      onChange={handlePixelationModeChange}
                      className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 h-9 shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                    >
                      <option value={PixelationMode.Dominant} className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200">卡通 (主色)</option>
                      <option value={PixelationMode.Average} className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200">真实 (平均)</option>
                    </select>
                  </div>
                </div>

                {/* 色号系统选择器 */}
                <div className="sm:col-span-2">
                  <button
                    onClick={() => setIsColorSystemCollapsed(!isColorSystemCollapsed)}
                    className="flex items-center justify-between w-full text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 sm:mb-2"
                  >
                    <span>色号系统:</span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className={`h-4 w-4 transition-transform duration-200 ${isColorSystemCollapsed ? 'rotate-0' : 'rotate-180'}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {!isColorSystemCollapsed && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {colorSystemOptions.map(option => (
                          <button
                            key={option.key}
                            onClick={() => setSelectedColorSystem(option.key as ColorSystem)}
                            className={`px-3 py-2 text-sm rounded-lg border transition-all duration-200 flex-shrink-0 ${
                              selectedColorSystem === option.key
                                ? 'bg-blue-500 text-white border-blue-500 shadow-md transform scale-105'
                                : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-gray-600'
                            }`}
                          >
                            {option.name}
                          </button>
                        ))}
                      </div>

                      {/* 自定义色板按钮 */}
                      <div className="mt-3">
                        <button
                          onClick={() => setIsCustomPaletteEditorOpen(true)}
                          className="w-full py-2.5 px-3 flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-medium rounded-lg shadow-sm transition-all duration-200 hover:shadow-md hover:from-blue-600 hover:to-purple-600"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z" clipRule="evenodd" />
                          </svg>
                          管理色板 ({Object.values(customPaletteSelections).filter(Boolean).length} 色)
                        </button>
                        {isCustomPalette && (
                          <p className="text-xs text-center text-blue-500 dark:text-blue-400 mt-1.5">当前使用自定义色板</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 自定义色板编辑器弹窗 - 这是新增的部分 */}
            {isCustomPaletteEditorOpen && (
              <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm z-50 flex justify-center items-center p-4">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                   {/* 添加隐藏的文件输入框 */}
                   <input
                    type="file"
                    accept=".json"
                    ref={importPaletteInputRef}
                    onChange={handleImportPaletteFile}
                    className="hidden"
                  />
                  <div className="p-4 sm:p-6 flex-1 overflow-y-auto"> {/* 让内容区域可滚动 */}
                    <CustomPaletteEditor
                      allColors={fullBeadPalette}
                      currentSelections={customPaletteSelections}
                      onSelectionChange={handleSelectionChange}
                      onSaveCustomPalette={handleSaveCustomPalette}
                      onClose={() => setIsCustomPaletteEditorOpen(false)}
                      onExportCustomPalette={handleExportCustomPalette}
                      onImportCustomPalette={triggerImportPalette}
                      selectedColorSystem={selectedColorSystem}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Output Section */}
            <section className="pinbean-canvas-card">
              <canvas ref={originalCanvasRef} className="hidden"></canvas>

              <div className="pinbean-canvas-head">
                <div>
                  <h1>{isManualColoringMode ? '校对拼豆图纸' : '图纸预览'}</h1>
                  <p>{isManualColoringMode ? '点选颜色后直接修改格子，右上角可切换工具。' : '参数变化后会自动重新计算，无需重复上传。'}</p>
                </div>
                <span className="pinbean-mode-badge">{pixelationMode === PixelationMode.Dominant ? '轮廓模式' : '细腻模式'}</span>
              </div>

              {/* ++ 手动编辑模式提示信息 ++ */}
              {isManualColoringMode && mappedPixelData && gridDimensions && (
                <div className="w-full mb-4 p-3 bg-blue-50 dark:bg-gray-800 rounded-lg shadow-sm border border-blue-100 dark:border-gray-700">
                  <div className="flex justify-center">
                    <div className="bg-blue-50 dark:bg-gray-700 border border-blue-100 dark:border-gray-600 rounded-lg p-2 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 text-xs text-gray-600 dark:text-gray-300 w-full sm:w-auto">
                      <div className="flex items-center gap-1 w-full sm:w-auto">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        <span>使用右上角菜单操作</span>
                      </div>
                      <span className="hidden sm:inline text-gray-300 dark:text-gray-500">|</span>
                      <div className="flex items-center gap-1 w-full sm:w-auto">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <span>Pencil 或鼠标涂色，手指拖动画布；橡皮在工具菜单切换</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Canvas Preview Container */}
              {/* Apply dark mode styles */}
              <div>
                {/* 大画布提示信息 */}
                {gridDimensions && gridDimensions.N > 100 && (
                  <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-blue-700 dark:text-blue-300 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>高精度网格 ({gridDimensions.N}×{gridDimensions.M}) - 画布已自动放大，可左右滚动、放大查看精细图像</span>
                    </div>
                  </div>
                )}
                 {/* Inner container background - 允许水平滚动以适应大画布 */}
                <div className="pinbean-canvas-stage">
                  {/* PixelatedPreviewCanvas component needs internal changes for dark mode drawing */}
                  <PixelatedPreviewCanvas
                    canvasRef={pixelatedCanvasRef}
                    mappedPixelData={mappedPixelData}
                    gridDimensions={gridDimensions}
                    isManualColoringMode={isManualColoringMode}
                    isFreehandEraseEnabled={Boolean(
                      isManualColoringMode
                      && selectedColor?.key === TRANSPARENT_KEY
                      && !isEraseMode
                      && !isFillMode
                      && !colorReplaceState.isActive
                    )}
                    beginStroke={() => {
                      const base = webEditingSessionRef.current;
                      if (!base || !isManualColoringMode || !selectedColor || isEraseMode || isFillMode || colorReplaceState.isActive) return null;
                      const target = { ...selectedColor };
                      let expected = base;
                      return indexes => {
                        if (webEditingSessionRef.current !== expected) return;
                        const result = executeWebEdit(base, { type: 'stroke', indexes, target }, activeBeadPalette, selectedColorSystem);
                        expected = result.session;
                        publishWebEditResult(result);
                        setTooltipData(null);
                        setIsFillSuggested(false);
                      };
                    }}
                    onInteraction={handleCanvasInteraction}
                    highlightColorKey={highlightColorKey}
                  />
                </div>
              </div>
            </section>

            <aside className="pinbean-panel pinbean-panel-sticky pinbean-inspector">
              <div className="pinbean-panel-heading">
                <div>
                  <h2>开拼清单</h2>
                  <p>确认尺寸、用量和色号，再导出施工图。</p>
                </div>
              </div>

              <ProjectSummary
                dimensions={gridDimensions}
                beadCount={totalBeadCount}
                colorCount={studioColorCount}
              />

              {isManualColoringMode && (
                <p className="pinbean-note">正在校对模式。先从悬浮色板选颜色，再点击图纸中的格子；完成后返回生成设置即可。</p>
              )}

              {colorCounts && (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="pinbean-section-label">色号与用量 · 点击可排除杂色</span>
                    <button
                      type="button"
                      className="mt-2 min-h-10 shrink-0 rounded-xl border border-[#f4c6b8] bg-[#fff1eb] px-3 text-xs font-bold text-[#c64c38] disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={handleUndoColorExclusion}
                      disabled={!canUndoColorExclusion}
                      title={canUndoColorExclusion ? '恢复最近一次被排除的颜色' : '排除一个颜色后可撤销'}
                    >
                      撤销排除
                    </button>
                  </div>
                  <ul className="pinbean-color-list">
                    {Object.keys(colorCounts).sort(sortColorKeys).map(hexKey => {
                      const item = colorCounts[hexKey];
                      const excluded = excludedColorKeys.has(hexKey);
                      return (
                        <li
                          key={hexKey}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleToggleExcludeColor(hexKey)}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') handleToggleExcludeColor(hexKey);
                          }}
                          style={{ opacity: excluded ? .42 : 1, textDecoration: excluded ? 'line-through' : 'none' }}
                        >
                          <span className="pinbean-color-name">
                            <span className="pinbean-swatch" style={{ backgroundColor: item.color }} />
                            {getColorKeyByHex(hexKey, selectedColorSystem)}
                          </span>
                          <span>{item.count} 颗</span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              <div className="pinbean-action-stack">
                {!isManualColoringMode ? (
                  <button type="button" className="pinbean-button pinbean-button-soft pinbean-button-block" onClick={enterManualEditing} disabled={!mappedPixelData}>校对细节</button>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className="pinbean-button pinbean-button-soft pinbean-button-block"
                        onClick={() => handleWebHistory('undo')}
                        disabled={!canUndoWebEdit}
                      >撤销</button>
                      <button
                        type="button"
                        className="pinbean-button pinbean-button-soft pinbean-button-block"
                        onClick={() => handleWebHistory('redo')}
                        disabled={!canRedoWebEdit}
                      >重做</button>
                    </div>
                    <button
                      type="button"
                      className="pinbean-button pinbean-button-quiet pinbean-button-block"
                      onClick={() => {
                        setIsManualColoringMode(false);
                        setActiveStudioStep('generate');
                      }}
                    >
                      完成校对
                    </button>
                  </>
                )}
                <button type="button" className="pinbean-button pinbean-button-secondary pinbean-button-block" onClick={handleEnterFocusMode} disabled={!mappedPixelData}>进入制作模式</button>
                <button
                  type="button"
                  className="pinbean-button pinbean-button-primary pinbean-button-block"
                  onClick={() => setIsDownloadSettingsOpen(true)}
                  disabled={!mappedPixelData || !gridDimensions || activeBeadPalette.length === 0}
                >
                  导出图纸
                </button>
              </div>
            </aside>
          </div> // This closes the main div started after originalImageSrc check
        )}

        {/* ++ HIDE Color Counts in manual mode ++ */}
        {!isManualColoringMode && originalImageSrc && colorCounts && Object.keys(colorCounts).length > 0 && (
          // Apply dark mode styles to color counts container
          <div className="hidden color-stats-panel">
            {/* Title color */}
            <h3 className="text-lg font-semibold mb-1 text-gray-700 dark:text-gray-200 text-center">
              去除杂色 
            </h3>
            {/* Subtitle color */}
            <p className="text-xs text-center text-gray-500 dark:text-gray-400 mb-3">点击下方列表中的颜色可将其从可用列表中排除。总计: {totalBeadCount} 颗</p>
            <ul className="space-y-1 max-h-60 overflow-y-auto pr-2 text-sm">
              {Object.keys(colorCounts)
                .sort(sortColorKeys)
                .map((hexKey) => {
                  // 现在key是hex值，需要通过hex获取对应色号系统的色号
                  const displayColorKey = getColorKeyByHex(hexKey, selectedColorSystem);
                  const isExcluded = excludedColorKeys.has(hexKey);
                  const count = colorCounts[hexKey].count;
                  const colorHex = colorCounts[hexKey].color;

                  return (
                    <li
                      key={hexKey}
                      onClick={() => handleToggleExcludeColor(hexKey)}
                       // Apply dark mode styles for list items (normal and excluded)
                      className={`flex items-center justify-between p-1.5 rounded cursor-pointer transition-colors ${ 
                        isExcluded
                          ? 'bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-800/60 opacity-60 dark:opacity-70' // Darker red background for excluded
                          : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      title={isExcluded ? `点击恢复 ${displayColorKey}` : `点击排除 ${displayColorKey}`}
                    >
                      <div className={`flex items-center space-x-2 ${isExcluded ? 'line-through' : ''}`}>
                        {/* Adjust color swatch border */}
                        <span
                          className="inline-block w-4 h-4 rounded border border-gray-400 dark:border-gray-500 flex-shrink-0"
                          style={{ backgroundColor: isExcluded ? '#666' : colorHex }} // Darker gray for excluded swatch
                        ></span>
                        {/* Adjust text color for key (normal and excluded) */}
                        <span className={`font-mono font-medium ${isExcluded ? 'text-red-700 dark:text-red-400' : 'text-gray-800 dark:text-gray-200'}`}>{displayColorKey}</span>
                      </div>
                      {/* Adjust text color for count (normal and excluded) */}
                      <span className={`text-xs ${isExcluded ? 'text-red-600 dark:text-red-400 line-through' : 'text-gray-600 dark:text-gray-300'}`}>{count} 颗</span>
                    </li>
                  );
                })}
            </ul>
            {excludedColorKeys.size > 0 && (
                <div className="mt-3">
                  <button
                    onClick={() => setShowExcludedColors(prev => !prev)}
                    className="w-full text-xs py-1.5 px-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors flex items-center justify-between"
                  >
                    <span>已排除的颜色 ({excludedColorKeys.size})</span>
                    <svg 
                      xmlns="http://www.w3.org/2000/svg" 
                      className={`h-4 w-4 text-gray-500 dark:text-gray-400 transform transition-transform ${showExcludedColors ? 'rotate-180' : ''}`}
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {showExcludedColors && (
                    <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-md p-2 bg-gray-100 dark:bg-gray-800">
                      <div className="max-h-40 overflow-y-auto">
                        {Array.from(excludedColorKeys).length > 0 ? (
                          <ul className="space-y-1">
                            {Array.from(excludedColorKeys).sort(sortColorKeys).map(hexKey => {
                              const colorData = fullBeadPalette.find(color => color.hex.toUpperCase() === hexKey.toUpperCase());
                              return (
                                <li key={hexKey} className="flex justify-between items-center p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
                                  <div className="flex items-center space-x-2">
                                    <span
                                      className="inline-block w-4 h-4 rounded border border-gray-400 dark:border-gray-500 flex-shrink-0"
                                      style={{ backgroundColor: colorData?.hex || hexKey }}
                                    ></span>
                                    <span className="font-mono text-xs text-gray-800 dark:text-gray-200">{getColorKeyByHex(hexKey, selectedColorSystem)}</span>
                                  </div>
                                  <button
                                    onClick={() => {
                                      // 实现恢复单个颜色的逻辑
                                      const newExcludedKeys = new Set(excludedColorKeys);
                                      newExcludedKeys.delete(hexKey);
                                      setExcludedColorKeys(newExcludedKeys);
                                      setColorExclusionActions(actions => actions.filter(action => action.hexKey !== hexKey));
                                      setRemapTrigger(prev => prev + 1);
                                      setIsManualColoringMode(false);
                                      setSelectedColor(null);
                                      console.log(`Restored color: ${hexKey}`);
                                    }}
                                    className="text-xs py-0.5 px-2 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-800/40"
                                  >
                                    恢复
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="text-xs text-center text-gray-500 dark:text-gray-400 py-2">
                            没有排除的颜色
                          </p>
                        )}
                      </div>
                      
                      <button
                        onClick={() => {
                          // 恢复所有颜色的逻辑
                          setExcludedColorKeys(new Set());
                          setColorExclusionActions([]);
                          setRemapTrigger(prev => prev + 1);
                          setIsManualColoringMode(false);
                          setSelectedColor(null);
                          console.log("Restored all excluded colors");
                        }}
                        className="mt-2 w-full text-xs py-1 px-2 bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
                      >
                        一键恢复所有颜色
                      </button>
                    </div>
                  )}
                </div>
            )}
          </div>
        )} {/* ++ End of HIDE Color Counts ++ */}

        {/* Message if palette becomes empty (Also hide in manual mode) */}
         {!isManualColoringMode && originalImageSrc && activeBeadPalette.length === 0 && excludedColorKeys.size > 0 && (
             // Apply dark mode styles to the warning box
             <div className="hidden">
                 当前可用颜色过少或为空。请在上方统计列表中查看已排除的颜色并恢复部分，或更换色板。
                 {excludedColorKeys.size > 0 && (
                      // Apply dark mode styles to the inline "restore all" button
                      <button
                          onClick={() => {
                            setShowExcludedColors(true); // 展开排除颜色列表
                            // 滚动到颜色列表处
                            setTimeout(() => {
                              const listElement = document.querySelector('.color-stats-panel');
                              if (listElement) {
                                listElement.scrollIntoView({ behavior: 'smooth' });
                              }
                            }, 100);
                          }}
                          className="mt-2 ml-2 text-xs py-1 px-2 bg-yellow-200 dark:bg-yellow-700/60 text-yellow-900 dark:text-yellow-200 rounded hover:bg-yellow-300 dark:hover:bg-yellow-600/70 transition-colors"
                      >
                          查看已排除颜色 ({excludedColorKeys.size})
                      </button>
                  )}
             </div>
         )}

        {/* ++ RENDER Enter Manual Mode Button ONLY when NOT in manual mode (before downloads) ++ */}
        {!isManualColoringMode && originalImageSrc && mappedPixelData && gridDimensions && (
            <div className="hidden"> {/* Wrapper div */}
             {/* Manual Edit Mode Button */}
             <button
                onClick={() => {
                  setIsManualColoringMode(true); // Enter mode
                  setSelectedColor(null);
                  setTooltipData(null);
                }}
                className={`w-full py-2.5 px-4 text-sm sm:text-base rounded-lg transition-all duration-300 flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-md hover:shadow-lg hover:translate-y-[-1px]`}
              >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"> <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /> </svg>
                 进入手动编辑模式
             </button>

             {/* Focus Mode Button */}
             <button
                onClick={handleEnterFocusMode}
                className={`w-full py-2.5 px-4 text-sm sm:text-base rounded-lg transition-all duration-300 flex items-center justify-center gap-2 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white shadow-md hover:shadow-lg hover:translate-y-[-1px]`}
              >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                 </svg>
                 进入专心拼豆模式（AplhaTest）
             </button>
            </div>
        )} {/* ++ End of RENDER Enter Manual Mode Button ++ */}

        {/* ++ HIDE Download Buttons in manual mode ++ */}
        {!isManualColoringMode && originalImageSrc && mappedPixelData && (
            <div className="hidden">
              {/* 使用一个大按钮，现在所有的下载设置都通过弹窗控制 */}
              <button
                onClick={() => setIsDownloadSettingsOpen(true)}
                disabled={!mappedPixelData || !gridDimensions || gridDimensions.N === 0 || gridDimensions.M === 0 || activeBeadPalette.length === 0}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-green-500 to-green-600 text-white text-sm sm:text-base rounded-lg hover:from-green-600 hover:to-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg hover:translate-y-[-1px] disabled:hover:translate-y-0 disabled:hover:shadow-md"
               >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                下载拼豆图纸
              </button>
            </div>
        )} {/* ++ End of HIDE Download Buttons ++ */}

         {/* Tooltip Display (Needs update in GridTooltip.tsx) */}
         {tooltipData && (
            <GridTooltip tooltipData={tooltipData} selectedColorSystem={selectedColorSystem} />
          )}

      </main>

      {/* 悬浮工具栏 */}
      <FloatingToolbar
        isManualColoringMode={isManualColoringMode}
        isPaletteOpen={isFloatingPaletteOpen}
        onTogglePalette={() => setIsFloatingPaletteOpen(!isFloatingPaletteOpen)}
        onExitManualMode={() => {
          setIsManualColoringMode(false);
          setSelectedColor(null);
          setTooltipData(null);
          setIsEraseMode(false);
          setIsFillMode(false);
          setIsFillSuggested(false);
          setColorReplaceState({
            isActive: false,
            step: 'select-source'
          });
          setHighlightColorKey(null);
          setIsMagnifierActive(false);
          setMagnifierSelectionArea(null);
        }}
        onToggleMagnifier={handleToggleMagnifier}
        isMagnifierActive={isMagnifierActive}
      />

      {/* 悬浮调色盘 */}
      {isManualColoringMode && (
        <FloatingColorPalette
          colors={currentGridColors}
          selectedColor={selectedColor}
          onColorSelect={handleColorSelect}
          selectedColorSystem={selectedColorSystem}
          isEraseMode={isEraseMode}
          onEraseToggle={handleEraseToggle}
          isFillMode={isFillMode}
          onFillToggle={handleFillToggle}
          isFillSuggested={isFillSuggested}
          fullPaletteColors={fullPaletteColors}
          showFullPalette={showFullPalette}
          onToggleFullPalette={handleToggleFullPalette}
          colorReplaceState={colorReplaceState}
          onColorReplaceToggle={handleColorReplaceToggle}
          onColorReplace={handleColorReplace}
          onHighlightColor={handleHighlightColor}
          isOpen={isFloatingPaletteOpen}
          onToggleOpen={() => setIsFloatingPaletteOpen(!isFloatingPaletteOpen)}
          isActive={activeFloatingTool === 'palette'}
          onActivate={handleActivatePalette}
        />
      )}

      {/* 放大镜工具 */}
      {isManualColoringMode && (
        <>
          <MagnifierTool
            isActive={isMagnifierActive}
            onToggle={handleToggleMagnifier}
            mappedPixelData={mappedPixelData}
            gridDimensions={gridDimensions}
            selectedColor={selectedColor}
            selectedColorSystem={selectedColorSystem}
            onPixelEdit={handleMagnifierPixelEdit}
            cellSize={gridDimensions ? Math.min(6, Math.max(4, 500 / Math.max(gridDimensions.N, gridDimensions.M))) : 6}
            selectionArea={magnifierSelectionArea}
            onClearSelection={() => setMagnifierSelectionArea(null)}
            isFloatingActive={activeFloatingTool === 'magnifier'}
            onActivateFloating={handleActivateMagnifier}
            highlightColorKey={highlightColorKey}
          />
          
          {/* 放大镜选择覆盖层 */}
          <MagnifierSelectionOverlay
            isActive={isMagnifierActive && !magnifierSelectionArea}
            canvasRef={pixelatedCanvasRef}
            gridDimensions={gridDimensions}
            cellSize={gridDimensions ? Math.min(6, Math.max(4, 500 / Math.max(gridDimensions.N, gridDimensions.M))) : 6}
            onSelectionComplete={setMagnifierSelectionArea}
          />
        </>
      )}

      <footer className="pinbean-footer">
        <span>PinBean · 为实际制作而设计的拼豆工具</span>
        <span>本地生成图纸，AI 优化走服务器代理</span>
      </footer>

      {/* Apply dark mode styles to the Footer */}
      <footer className="hidden">

        {/* 帮助教程按钮 */}
        <div className="flex gap-3 justify-center mb-5">
          <button
            onClick={() => setIsTutorialModalOpen(true)}
            className="px-6 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-full shadow-lg transition-all duration-300 hover:shadow-xl hover:translate-y-[-2px] flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <span>帮助教程</span>
          </button>
        </div>

        {/* Copyright text color */}
        <p className="font-medium text-gray-600 dark:text-gray-300">
          拼豆底稿生成器 &copy; {new Date().getFullYear()}
        </p>
      </footer>

      {/* 帮助教程弹窗 */}
      {isTutorialModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                使用教程
              </h2>
              <button
                onClick={() => setIsTutorialModalOpen(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 内容区域 */}
            <div className="flex-1 overflow-auto p-6">
              <div className="space-y-6">
                {/* 步骤 1 */}
                <div className="space-y-2">
                  <h3 className="text-md font-medium text-gray-900 dark:text-white flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 text-sm font-medium">1</span>
                    一般使用流程
                  </h3>
                  <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <p className="text-gray-700 dark:text-gray-300">
                      上传图片 → 去掉背景 → 下载图纸 → 专心拼豆
                    </p>
                  </div>
                </div>

                {/* 步骤 2 */}
                <div className="space-y-2">
                  <h3 className="text-md font-medium text-gray-900 dark:text-white flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 text-sm font-medium">2</span>
                    处理模式
                  </h3>
                  <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <p className="text-gray-700 dark:text-gray-300">
                      可选卡通模式和真实模式，真实模式会使用更细的颜色更逼真更复杂。
                    </p>
                  </div>
                </div>

                {/* 步骤 3 */}
                <div className="space-y-2">
                  <h3 className="text-md font-medium text-gray-900 dark:text-white flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 text-sm font-medium">3</span>
                    档案管理
                  </h3>
                  <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <p className="text-gray-700 dark:text-gray-300">
                      下载档案可以下次直接导入使用。
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="flex items-center justify-end px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setIsTutorialModalOpen(false)}
                className="px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 使用导入的下载设置弹窗组件 */}
      <DownloadSettingsModal 
        isOpen={isDownloadSettingsOpen}
        onClose={() => setIsDownloadSettingsOpen(false)}
        options={downloadOptions}
        onOptionsChange={setDownloadOptions}
        onDownload={handleDownloadRequest}
      />

      {/* 专心拼豆模式进入前下载提醒弹窗 */}
      <FocusModePreDownloadModal
        isOpen={isFocusModePreDownloadModalOpen}
        onClose={() => setIsFocusModePreDownloadModalOpen(false)}
        onProceedWithoutDownload={handleProceedToFocusMode}
        mappedPixelData={mappedPixelData}
        gridDimensions={gridDimensions}
        selectedColorSystem={selectedColorSystem}
      />

      <AIOptimizeModal
        imageSrc={originalImageSrc ?? ''}
        isOpen={isAIOptimizeOpen && Boolean(originalImageSrc)}
        onClose={() => setIsAIOptimizeOpen(false)}
        onOptimized={handleAIOptimizedImage}
      />

      {/* 图片裁剪弹窗 */}
      <ImageCropperModal
        imageSrc={cropperImageSrc}
        isOpen={isCropperOpen}
        onClose={handleCropCancel}
        onConfirm={handleCropConfirm}
      />

    </div>
   </>
  );
}
