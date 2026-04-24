import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import { 
  Type, 
  Square, 
  Circle, 
  Triangle, 
  MousePointer2, 
  Pencil, 
  Eraser, 
  Trash2, 
  Layers, 
  Download, 
  Image as ImageIcon, 
  Crop, 
  Sparkles, 
  FileText,
  Sun,
  Contrast,
  Wind,
  Undo2,
  Redo2,
  X,
  Check,
  ChevronRight,
  ChevronLeft,
  ImagePlus,
  RotateCcw,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Settings,
  Maximize2,
  Palette,
  GripVertical,
  ZoomIn,
  ZoomOut,
  Maximize,
  SquareDashed,
  Wand2
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { Cropper, ReactCropperElement } from 'react-cropper';
import 'cropperjs/dist/cropper.css';
import Tesseract from 'tesseract.js';
import { GoogleGenAI } from "@google/genai";
import * as Tabs from '@radix-ui/react-tabs';
import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import * as Slider from '@radix-ui/react-slider';
import * as Switch from '@radix-ui/react-switch';
import heic2any from 'heic2any';
import UTIF from 'utif';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface PhotoEditorProps {
  file: File;
  onClose: () => void;
  onSave: (blob: Blob) => void;
  isMobile?: boolean;
}

type EditorMode = 'select' | 'brush' | 'text' | 'rect' | 'circle' | 'triangle' | 'eraser' | 'crop' | 'marquee' | 'healing';

interface SelectionArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ExportSettings {
  format: 'png' | 'jpeg' | 'pdf';
  quality: number;
  dpi: number;
  width: number;
  height: number;
}

export const PhotoEditor: React.FC<PhotoEditorProps> = ({ file, onClose, onSave, isMobile = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvas = useRef<fabric.Canvas | null>(null);
  const cropperRef = useRef<ReactCropperElement>(null);
  const insertImageInputRef = useRef<HTMLInputElement>(null);
  
  const [mode, setMode] = useState<EditorMode>('select');
  const modeRef = useRef<EditorMode>('select');
  
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);
  const [opacity, setOpacity] = useState(1);
  const [activeObject, setActiveObject] = useState<fabric.Object | null>(null);
  const [isCropMode, setIsCropMode] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [layers, setLayers] = useState<fabric.Object[]>([]);
  const [activeSelection, setActiveSelection] = useState<SelectionArea | null>(null);
  const selectionRectRef = useRef<fabric.Rect | null>(null);
  const healingPathRef = useRef<fabric.Path | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [originalSize, setOriginalSize] = useState({ width: 0, height: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [vpt, setVpt] = useState<number[]>([1, 0, 0, 1, 0, 0]);
  const [zoom, setZoom] = useState(1);
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    format: 'pdf',
    quality: 0.9,
    dpi: 300,
    width: 2480,
    height: 3508
  });
  const [showMobilePanel, setShowMobilePanel] = useState(false);

  const processImageFile = async (imageFile: File): Promise<string> => {
    const extension = imageFile.name.split('.').pop()?.toLowerCase();
    
    if (extension === 'heic' || extension === 'heif') {
      const blob = await heic2any({ blob: imageFile, toType: 'image/jpeg' });
      const resultBlob = Array.isArray(blob) ? blob[0] : blob;
      return URL.createObjectURL(resultBlob);
    }
    
    if (extension === 'tif' || extension === 'tiff') {
      const arrayBuffer = await imageFile.arrayBuffer();
      const ifds = UTIF.decode(arrayBuffer);
      UTIF.decodeImage(arrayBuffer, ifds[0]);
      const rgba = UTIF.toRGBA8(ifds[0]);
      const canvas = document.createElement('canvas');
      canvas.width = ifds[0].width;
      canvas.height = ifds[0].height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imgData = ctx.createImageData(canvas.width, canvas.height);
        imgData.data.set(rgba);
        ctx.putImageData(imgData, 0, 0);
        return canvas.toDataURL('image/png');
      }
    }

    if (extension === 'pdf') {
      const arrayBuffer = await imageFile.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 3 }); // High scale for quality
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (context) {
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport } as any).promise;
        return canvas.toDataURL('image/png');
      }
    }

    // For AVIF, JFIF, and others, try native loading first
    return URL.createObjectURL(imageFile);
  };

  // Initialize Canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: 800,
      height: 600,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      enableRetinaScaling: false
    });

    fabricCanvas.current = canvas;

    // Load initial image
    const initImage = async () => {
      try {
        const url = await processImageFile(file);
        fabric.Image.fromURL(url).then((img) => {
          const imgWidth = img.width!;
          const imgHeight = img.height!;
          setOriginalSize({ width: imgWidth, height: imgHeight });
          
          // A4 Default Canvas Size logic
          const A4_RATIO = 210 / 297;
          const isLandscape = imgWidth > imgHeight;
          const targetRatio = isLandscape ? 1 / A4_RATIO : A4_RATIO;

          const maxWidth = 800;
          const maxHeight = 800;
          
          let canvasWidth = maxWidth;
          let canvasHeight = maxWidth / targetRatio;

          if (canvasHeight > maxHeight) {
            canvasHeight = maxHeight;
            canvasWidth = maxHeight * targetRatio;
          }

          canvas.setDimensions({ width: canvasWidth, height: canvasHeight });
          setCanvasSize({ width: canvasWidth, height: canvasHeight });
          canvas.backgroundColor = '#ffffff';

          setExportSettings(prev => ({ 
            ...prev, 
            width: isLandscape ? 3508 : 2480, 
            height: isLandscape ? 2480 : 3508 
          }));
          
          const scaleX = canvasWidth / imgWidth;
          const scaleY = canvasHeight / imgHeight;
          const scale = Math.min(scaleX, scaleY);
          
          img.set({
            scaleX: scale,
            scaleY: scale,
            left: (canvasWidth - imgWidth * scale) / 2,
            top: (canvasHeight - imgHeight * scale) / 2,
            selectable: false, // Background should usually be fixed
            name: 'Background',
            hoverCursor: 'default'
          });
          
          canvas.add(img);
          canvas.sendObjectToBack(img);
          canvas.renderAll();
          updateLayers();
          saveHistory();
        });
      } catch (err) {
        console.error('Error processing initial image:', err);
      }
    };

    initImage();

    // Event Listeners
    canvas.on('selection:created', (e) => setActiveObject(e.selected?.[0] || null));
    canvas.on('selection:updated', (e) => setActiveObject(e.selected?.[0] || null));
    canvas.on('selection:cleared', () => setActiveObject(null));
    canvas.on('object:modified', () => {
      saveHistory();
      updateLayers();
    });
    canvas.on('object:added', () => {
      saveHistory();
      updateLayers();
    });
    canvas.on('object:removed', () => {
      saveHistory();
      updateLayers();
    });

    canvas.on('path:created', (e: any) => {
      if (modeRef.current === 'healing') {
        const path = e.path;
        path.set({
          selectable: false,
          stroke: 'rgba(251, 191, 36, 0.5)',
          fill: 'rgba(251, 191, 36, 0.3)',
          name: 'HealingSelectionPath'
        });
        
        // Remove old healing path if it exists
        if (healingPathRef.current) {
          canvas.remove(healingPathRef.current);
        }
        
        healingPathRef.current = path;
        
        // Use path bounding box for selection
        const bounds = path.getBoundingRect();
        setActiveSelection({
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height
        });
        
        canvas.renderAll();
      }
    });

    // Zoom on wheel
    canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY;
      let zoomLevel = canvas.getZoom();
      zoomLevel *= 0.999 ** delta;
      if (zoomLevel > 20) zoomLevel = 20;
      if (zoomLevel < 0.01) zoomLevel = 0.01;
      canvas.zoomToPoint(new fabric.Point(opt.e.offsetX, opt.e.offsetY), zoomLevel);
      setZoom(zoomLevel);
      setVpt([...canvas.viewportTransform!]);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    // Handle Panning and Marquee
    canvas.on('mouse:down', (opt) => {
      const evt = opt.e as any;
      if (evt.altKey === true) {
        (canvas as any).isDragging = true;
        (canvas as any).selection = false;
        (canvas as any).lastPosX = evt.clientX;
        (canvas as any).lastPosY = evt.clientY;
        return;
      }

      if (modeRef.current === 'marquee') {
        const pointer = canvas.getPointer(opt.e);
        const startX = pointer.x;
        const startY = pointer.y;

        // Remove old selection rect
        if (selectionRectRef.current) {
          canvas.remove(selectionRectRef.current);
        }

        const rect = new fabric.Rect({
          left: startX,
          top: startY,
          width: 0,
          height: 0,
          fill: 'rgba(99, 102, 241, 0.2)',
          stroke: '#6366f1',
          strokeWidth: 1,
          strokeDashArray: [5, 5],
          selectable: false,
          hoverCursor: 'crosshair',
          name: 'SelectionRect'
        });

        selectionRectRef.current = rect;
        canvas.add(rect);
        (canvas as any).isSelecting = true;
        (canvas as any).selectionStartX = startX;
        (canvas as any).selectionStartY = startY;
      }
    });

    canvas.on('mouse:move', (opt) => {
      if ((canvas as any).isDragging) {
        const e = opt.e as any;
        const vpt = canvas.viewportTransform!;
        vpt[4] += e.clientX - (canvas as any).lastPosX;
        vpt[5] += e.clientY - (canvas as any).lastPosY;
        canvas.requestRenderAll();
        (canvas as any).lastPosX = e.clientX;
        (canvas as any).lastPosY = e.clientY;
        setVpt([...vpt]);
      } else if ((canvas as any).isSelecting && modeRef.current === 'marquee' && selectionRectRef.current) {
        const pointer = canvas.getPointer(opt.e);
        const rect = selectionRectRef.current;
        const startX = (canvas as any).selectionStartX;
        const startY = (canvas as any).selectionStartY;

        const left = Math.min(startX, pointer.x);
        const top = Math.min(startY, pointer.y);
        const width = Math.abs(startX - pointer.x);
        const height = Math.abs(startY - pointer.y);

        rect.set({ left, top, width, height });
        canvas.renderAll();
      }
    });

    canvas.on('mouse:up', () => {
      if ((canvas as any).isDragging) {
        canvas.setViewportTransform(canvas.viewportTransform!);
        (canvas as any).isDragging = false;
        canvas.selection = true;
      } else if ((canvas as any).isSelecting && modeRef.current === 'marquee' && selectionRectRef.current) {
        (canvas as any).isSelecting = false;
        const rect = selectionRectRef.current;
        if (rect.width! > 5 && rect.height! > 5) {
          setActiveSelection({
            left: rect.left!,
            top: rect.top!,
            width: rect.width!,
            height: rect.height!
          });
        } else {
          canvas.remove(rect);
          selectionRectRef.current = null;
          setActiveSelection(null);
        }
      }
    });

    return () => {
      canvas.dispose();
    };
  }, []);

  const updateLayers = useCallback(() => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    // Reverse to show top layers at the top of the list
    setLayers([...canvas.getObjects()].reverse());
  }, []);

  // Mode Management
  useEffect(() => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    if (mode !== 'marquee' && mode !== 'healing') {
      if (selectionRectRef.current) {
        canvas.remove(selectionRectRef.current);
        selectionRectRef.current = null;
      }
      if (healingPathRef.current) {
        canvas.remove(healingPathRef.current);
        healingPathRef.current = null;
      }
      setActiveSelection(null);
    }

    canvas.isDrawingMode = mode === 'brush' || mode === 'eraser' || mode === 'healing';
    canvas.selection = mode === 'select';
    canvas.hoverCursor = mode === 'marquee' ? 'crosshair' : mode === 'healing' ? 'cell' : 'default';
    
    if (canvas.isDrawingMode) {
      if (mode === 'brush') {
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
        canvas.freeDrawingBrush.color = color;
        canvas.freeDrawingBrush.width = brushSize;
      } else if (mode === 'eraser') {
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
        canvas.freeDrawingBrush.color = '#ffffff';
        canvas.freeDrawingBrush.width = brushSize;
      } else if (mode === 'healing') {
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
        canvas.freeDrawingBrush.color = 'rgba(251, 191, 36, 0.6)';
        canvas.freeDrawingBrush.width = brushSize * 3; // Wider by default for healing
      }
    }
  }, [mode, color, brushSize]);

  useEffect(() => {
    const canvas = fabricCanvas.current;
    if (!canvas || !activeObject) return;
    
    if (activeObject.get('opacity') !== opacity) {
      activeObject.set('opacity', opacity);
      canvas.renderAll();
    }
  }, [opacity, activeObject]);

  const saveHistory = useCallback(() => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    const json = JSON.stringify(canvas.toJSON());
    setHistory(prev => [...prev.slice(0, historyIndex + 1), json]);
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  const undo = () => {
    if (historyIndex > 0) {
      const canvas = fabricCanvas.current;
      if (!canvas) return;
      const prevIndex = historyIndex - 1;
      canvas.loadFromJSON(history[prevIndex]).then(() => {
        canvas.renderAll();
        setHistoryIndex(prevIndex);
        updateLayers();
      });
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const canvas = fabricCanvas.current;
      if (!canvas) return;
      const nextIndex = historyIndex + 1;
      canvas.loadFromJSON(history[nextIndex]).then(() => {
        canvas.renderAll();
        setHistoryIndex(nextIndex);
        updateLayers();
      });
    }
  };

  const resetCanvas = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    
    canvas.clear();
    canvas.backgroundColor = '#ffffff';
    
    const resetImage = async () => {
      try {
        const url = await processImageFile(file);
        fabric.Image.fromURL(url).then((img) => {
          const imgWidth = img.width!;
          const imgHeight = img.height!;
          
          // A4 Default Canvas Size logic
          const A4_RATIO = 210 / 297;
          const isLandscape = imgWidth > imgHeight;
          const targetRatio = isLandscape ? 1 / A4_RATIO : A4_RATIO;

          const maxWidth = 800;
          const maxHeight = 800;
          
          let canvasWidth = maxWidth;
          let canvasHeight = maxWidth / targetRatio;

          if (canvasHeight > maxHeight) {
            canvasHeight = maxHeight;
            canvasWidth = maxHeight * targetRatio;
          }

          canvas.setDimensions({ width: canvasWidth, height: canvasHeight });
          setCanvasSize({ width: canvasWidth, height: canvasHeight });
          canvas.backgroundColor = '#ffffff';

          const scaleX = canvasWidth / imgWidth;
          const scaleY = canvasHeight / imgHeight;
          const scale = Math.min(scaleX, scaleY);
          
          img.set({
            scaleX: scale,
            scaleY: scale,
            left: (canvasWidth - imgWidth * scale) / 2,
            top: (canvasHeight - imgHeight * scale) / 2,
            selectable: false,
            name: 'Background',
            hoverCursor: 'default'
          });
          
          canvas.add(img);
          canvas.sendObjectToBack(img);
          canvas.renderAll();
          setHistory([]);
          setHistoryIndex(-1);
          saveHistory();
          updateLayers();
        });
      } catch (err) {
        console.error('Error resetting canvas:', err);
      }
    };

    resetImage();
  };

  const handleInsertImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const url = await processImageFile(file);
      fabric.Image.fromURL(url).then((img) => {
        const canvas = fabricCanvas.current;
        if (!canvas) return;

        const maxDim = 300;
        if (img.width! > maxDim || img.height! > maxDim) {
          const scale = maxDim / Math.max(img.width!, img.height!);
          img.scale(scale);
        }

        img.set({
          left: 100,
          top: 100,
          selectable: true,
          name: `Image ${layers.length}`
        });

        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.renderAll();
        saveHistory();
        updateLayers();
      });
    } catch (err) {
      console.error('Error inserting image:', err);
    }
    e.target.value = '';
  };

  const addText = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    const text = new fabric.IText('Nhập văn bản...', {
      left: 100,
      top: 100,
      fontFamily: 'Inter',
      fill: color,
      fontSize: 24,
      name: `Text ${layers.length}`
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    setMode('select');
    updateLayers();
  };

  const addShape = (type: 'rect' | 'circle' | 'triangle') => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    let shape;
    const common = { 
      left: 100, 
      top: 100, 
      fill: color, 
      opacity,
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${layers.length}`
    };
    
    if (type === 'rect') shape = new fabric.Rect({ ...common, width: 100, height: 100 });
    else if (type === 'circle') shape = new fabric.Circle({ ...common, radius: 50 });
    else shape = new fabric.Triangle({ ...common, width: 100, height: 100 });
    
    canvas.add(shape);
    canvas.setActiveObject(shape);
    setMode('select');
    updateLayers();
  };

  const deleteObject = () => {
    const canvas = fabricCanvas.current;
    if (!canvas || !activeObject) return;
    canvas.remove(activeObject);
    canvas.discardActiveObject();
    canvas.renderAll();
    updateLayers();
  };

  const applyFilter = (filterType: string) => {
    const canvas = fabricCanvas.current;
    const obj = canvas?.getActiveObject();
    if (!obj || !(obj instanceof fabric.Image)) return;

    let filter;
    switch (filterType) {
      case 'grayscale': filter = new fabric.filters.Grayscale(); break;
      case 'invert': filter = new fabric.filters.Invert(); break;
      case 'sepia': filter = new fabric.filters.Sepia(); break;
      case 'brightness': filter = new fabric.filters.Brightness({ brightness: 0.1 }); break;
      case 'contrast': filter = new fabric.filters.Contrast({ contrast: 0.1 }); break;
      case 'blur': filter = new fabric.filters.Blur({ blur: 0.1 }); break;
    }

    if (filter) {
      obj.filters.push(filter);
      obj.applyFilters();
      canvas?.renderAll();
      saveHistory();
    }
  };

  const startCrop = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL({ format: 'png' });
    setCropImage(dataUrl);
    setIsCropMode(true);
  };

  const finishCrop = () => {
    const cropper = cropperRef.current?.cropper;
    if (!cropper) return;
    
    const croppedCanvas = cropper.getCroppedCanvas();
    const dataUrl = croppedCanvas.toDataURL();
    
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    canvas.clear();
    fabric.Image.fromURL(dataUrl).then((img) => {
      const imgWidth = img.width!;
      const imgHeight = img.height!;
      setOriginalSize({ width: imgWidth, height: imgHeight });
      
      // A4 Default Canvas Size logic
      const A4_RATIO = 210 / 297;
      const isLandscape = imgWidth > imgHeight;
      const targetRatio = isLandscape ? 1 / A4_RATIO : A4_RATIO;

      const maxWidth = 800;
      const maxHeight = 800;
      
      let canvasWidth = maxWidth;
      let canvasHeight = maxWidth / targetRatio;

      if (canvasHeight > maxHeight) {
        canvasHeight = maxHeight;
        canvasWidth = maxHeight * targetRatio;
      }

      canvas.setDimensions({ width: canvasWidth, height: canvasHeight });
      setCanvasSize({ width: canvasWidth, height: canvasHeight });
      canvas.backgroundColor = '#ffffff';

      setExportSettings(prev => ({ 
        ...prev, 
        width: isLandscape ? 3508 : 2480, 
        height: isLandscape ? 2480 : 3508 
      }));
      
      const scaleX = canvasWidth / imgWidth;
      const scaleY = canvasHeight / imgHeight;
      const scale = Math.min(scaleX, scaleY);
      
      img.set({
        scaleX: scale,
        scaleY: scale,
        left: (canvasWidth - imgWidth * scale) / 2,
        top: (canvasHeight - imgHeight * scale) / 2,
        selectable: false,
        name: 'Background'
      });

      canvas.add(img);
      canvas.renderAll();
      setIsCropMode(false);
      setCropImage(null);
      saveHistory();
      updateLayers();
    });
  };

  const handleContentAwareFill = async () => {
    if (!activeSelection || !fabricCanvas.current) return;
    
    setIsProcessing(true);
    const canvas = fabricCanvas.current;
    
    try {
      // Prioritize active layer if it is an image, otherwise find the main background
      let targetImage = activeObject as fabric.Image;
      if (!targetImage || targetImage.type !== 'image') {
        const objects = canvas.getObjects('image');
        targetImage = objects[0] as fabric.Image;
      }
      
      if (!targetImage) {
        setIsProcessing(false);
        return;
      }

      // Create an offline buffer to process pixels
      const tempCanvas = document.createElement('canvas');
      const ctx = tempCanvas.getContext('2d');
      if (!ctx) throw new Error('Could not get context');

      // Set dimensions to selection size
      const { left, top, width, height } = activeSelection;
      tempCanvas.width = width;
      tempCanvas.height = height;

      // Draw original area
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = canvas.width!;
      sampleCanvas.height = canvas.height!;
      const sctx = sampleCanvas.getContext('2d')!;
      
      // Hide selection rect/path before capturing
      if (selectionRectRef.current) selectionRectRef.current.visible = false;
      if (healingPathRef.current) healingPathRef.current.visible = false;
      canvas.renderAll();
      
      sctx.drawImage(canvas.getElement(), 0, 0);
      
      // Sample top, bottom, left, right edges around the bounding box
      const topData = sctx.getImageData(left, Math.max(0, top - 2), width, 1).data;
      const bottomData = sctx.getImageData(left, Math.min(canvas.height! - 1, top + height + 1), width, 1).data;
      const leftData = sctx.getImageData(Math.max(0, left - 2), top, 1, height).data;
      const rightData = sctx.getImageData(Math.min(canvas.width! - 1, left + width + 1), top, 1, height).data;

      // Draw into result canvas
      const imageData = ctx.createImageData(width, height);
      const data = imageData.data;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const wx1 = (width - x) / width;
          const wx2 = x / width;
          const wy1 = (height - y) / height;
          const wy2 = y / height;
          const ri = x * 4;
          const li = y * 4;
          
          data[i] = (topData[ri] * wy1 + bottomData[ri] * wy2 + leftData[li] * wx1 + rightData[li] * wx2) / 2;
          data[i+1] = (topData[ri+1] * wy1 + bottomData[ri+1] * wy2 + leftData[li+1] * wx1 + rightData[li+1] * wx2) / 2;
          data[i+2] = (topData[ri+2] * wy1 + bottomData[ri+2] * wy2 + leftData[li+2] * wx1 + rightData[li+2] * wx2) / 2;
          data[i+3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // MASKING: If using healing tool, we only want to fill the painted area
      if (healingPathRef.current) {
        ctx.globalCompositeOperation = 'destination-in';
        // Render path relative to its own bounding box
        const pathData = healingPathRef.current.toDataURL();
        const pathImg = new Image();
        pathImg.src = pathData;
        await new Promise(resolve => pathImg.onload = resolve);
        
        ctx.drawImage(pathImg, 0, 0, width, height);
      }
      
      // Add a slight blur to the fill patch
      ctx.filter = 'blur(2px)';
      ctx.drawImage(tempCanvas, 0, 0);
      ctx.filter = 'none';

      // Create a fabric image from the patch
      const dataUrl = tempCanvas.toDataURL();
      const patch = await fabric.Image.fromURL(dataUrl);
      patch.set({
        left,
        top,
        name: 'AI Fill Patch',
      });
      
      canvas.add(patch);
      
      // Clean up selection
      if (selectionRectRef.current) {
        canvas.remove(selectionRectRef.current);
        selectionRectRef.current = null;
      }
      if (healingPathRef.current) {
        canvas.remove(healingPathRef.current);
        healingPathRef.current = null;
      }
      setActiveSelection(null);
      setMode('select');
      
      saveHistory();
      updateLayers();
    } catch (err) {
      console.error('Fill error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAiDescribe = async () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    
    setIsProcessing(true);
    setAiResult(null);
    
    try {
      const dataUrl = canvas.toDataURL({ format: 'jpeg', quality: 0.8 });
      const base64Data = dataUrl.split(',')[1];
      
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { inlineData: { data: base64Data, mimeType: "image/jpeg" } },
              { text: "Hãy mô tả chi tiết bức ảnh này và gợi ý các bước chỉnh sửa để ảnh đẹp hơn." }
            ]
          }
        ]
      });
      
      setAiResult(response.text);
    } catch (err) {
      console.error('AI Error:', err);
      setAiResult('Lỗi khi gọi AI. Vui lòng thử lại.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOcr = async () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    
    setIsProcessing(true);
    setAiResult(null);
    
    try {
      const dataUrl = canvas.toDataURL({ format: 'png' });
      const { data: { text } } = await Tesseract.recognize(dataUrl, 'vie+eng');
      setAiResult(`Văn bản trích xuất được:\n\n${text}`);
    } catch (err) {
      console.error('OCR Error:', err);
      setAiResult('Lỗi khi nhận diện chữ viết.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExport = async () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    // Save current zoom and viewport transform
    const currentZoom = canvas.getZoom();
    const currentVpt = canvas.viewportTransform ? [...canvas.viewportTransform] : null;

    // Reset zoom for export to ensure correct dimensions
    canvas.setZoom(1);
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    // Ensure we capture everything including outside the current viewport
    const multiplier = exportSettings.width / canvas.getWidth();
    
    // We want to capture the ENTIRE canvas area
    const dataUrl = canvas.toDataURL({
      format: exportSettings.format === 'jpeg' ? 'jpeg' : 'png',
      quality: exportSettings.quality,
      multiplier: multiplier,
      left: 0,
      top: 0,
      width: canvas.getWidth(),
      height: canvas.getHeight(),
      enableRetinaScaling: false // Avoid confusion with device pixel ratio
    });

    // Restore zoom and viewport transform
    canvas.setZoom(currentZoom);
    if (currentVpt) canvas.setViewportTransform(currentVpt as any);
    canvas.renderAll();

    let finalBlob: Blob;

    if (exportSettings.format === 'pdf') {
      const pdfDoc = await PDFDocument.create();
      // In PDF-lib, dimensions are in points (1/72 inch). 
      // We want to map current pixel dimensions to points based on the DPI setting if possible,
      // but usually we just want the output PDF to contain the image at full size.
      // 72 DPI is standard for points. So we scale the points.
      const pageWidth = (exportSettings.width * 72) / exportSettings.dpi;
      const pageHeight = (exportSettings.height * 72) / exportSettings.dpi;
      
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      
      const parts = dataUrl.split(',');
      const imageBytes = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));
      const embeddedImage = await pdfDoc.embedPng(imageBytes);
      
      page.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });
      
      const pdfBytes = await pdfDoc.save();
      finalBlob = new Blob([pdfBytes], { type: 'application/pdf' });
    } else {
      // Manually inject DPI metadata as browsers default to 96 DPI
      const parts = dataUrl.split(',');
      const body = atob(parts[1]);
      const bytes = new Uint8Array(body.length);
      for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i);

      if (exportSettings.format === 'jpeg') {
        // Inject JFIF DPI (Density units and X/Y density)
        for (let i = 0; i < bytes.length - 1; i++) {
          if (bytes[i] === 0xff && bytes[i + 1] === 0xe0) {
            bytes[i + 11] = 1; // dots per inch
            bytes[i + 12] = (exportSettings.dpi >> 8) & 0xff;
            bytes[i + 13] = exportSettings.dpi & 0xff;
            bytes[i + 14] = (exportSettings.dpi >> 8) & 0xff;
            bytes[i + 15] = exportSettings.dpi & 0xff;
            break;
          }
        }
        finalBlob = new Blob([bytes], { type: 'image/jpeg' });
      } else {
        // Inject PNG pHYs chunk (pixels per meter)
        const ppm = Math.round(exportSettings.dpi / 0.0254);
        const pHYs = new Uint8Array(21);
        pHYs[0] = 0; pHYs[1] = 0; pHYs[2] = 0; pHYs[3] = 9; // Length: 9 bytes
        pHYs[4] = 112; pHYs[5] = 72; pHYs[6] = 89; pHYs[7] = 115; // 'pHYs'
        pHYs[8] = (ppm >> 24) & 0xff; pHYs[9] = (ppm >> 16) & 0xff; pHYs[10] = (ppm >> 8) & 0xff; pHYs[11] = ppm & 0xff; // X
        pHYs[12] = (ppm >> 24) & 0xff; pHYs[13] = (ppm >> 16) & 0xff; pHYs[14] = (ppm >> 8) & 0xff; pHYs[15] = ppm & 0xff; // Y
        pHYs[16] = 1; // Unit: meter
        
        // CRC32 for pHYs chunk (type + data)
        const crcData = pHYs.subarray(4, 17);
        let crc = 0xffffffff;
        for (let i = 0; i < crcData.length; i++) {
          let c = (crc ^ crcData[i]) & 0xff;
          for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
          crc = (crc >>> 8) ^ c;
        }
        crc = (crc ^ 0xffffffff) >>> 0;
        pHYs[17] = (crc >> 24) & 0xff; pHYs[18] = (crc >> 16) & 0xff; pHYs[19] = (crc >> 8) & 0xff; pHYs[20] = crc & 0xff;

        // Insert pHYs chunk right after IHDR chunk (offset 33)
        const newBytes = new Uint8Array(bytes.length + 21);
        newBytes.set(bytes.subarray(0, 33));
        newBytes.set(pHYs, 33);
        newBytes.set(bytes.subarray(33), 54);
        finalBlob = new Blob([newBytes], { type: 'image/png' });
      }
    }

    const finalUrl = URL.createObjectURL(finalBlob);
    const link = document.createElement('a');
    const ext = exportSettings.format;
    link.download = `edited-image.${ext}`;
    link.href = finalUrl;
    link.click();
    
    setTimeout(() => URL.revokeObjectURL(finalUrl), 1000);
    setShowExportDialog(false);
  };

  const reorderLayers = (newLayers: fabric.Object[]) => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    // Fabric layers are 0-indexed from bottom to top
    // newLayers is top to bottom
    const reversed = [...newLayers].reverse();
    reversed.forEach((obj, index) => {
      canvas.moveObjectTo(obj, index);
    });
    canvas.renderAll();
    setLayers(newLayers);
    saveHistory();
  };

  const toggleLayerVisibility = (obj: fabric.Object) => {
    obj.set('visible', !obj.visible);
    fabricCanvas.current?.renderAll();
    updateLayers();
  };

  const toggleLayerLock = (obj: fabric.Object) => {
    const isLocked = obj.lockMovementX;
    obj.set({
      lockMovementX: !isLocked,
      lockMovementY: !isLocked,
      lockScalingX: !isLocked,
      lockScalingY: !isLocked,
      lockRotation: !isLocked,
      selectable: isLocked,
    });
    fabricCanvas.current?.renderAll();
    updateLayers();
  };

  const updateLayerStyle = (property: string, value: any) => {
    const canvas = fabricCanvas.current;
    if (!canvas || !activeObject) return;

    if (property === 'blendMode') {
      activeObject.set('globalCompositeOperation', value);
    } else if (property === 'stroke') {
      activeObject.set('stroke', value);
      activeObject.set('strokeWidth', 2);
    } else if (property === 'shadow') {
      activeObject.set('shadow', value ? new fabric.Shadow({
        color: 'rgba(0,0,0,0.5)',
        blur: 10,
        offsetX: 5,
        offsetY: 5
      }) : null);
    } else {
      activeObject.set(property as any, value);
    }
    
    canvas.renderAll();
    saveHistory();
    updateLayers();
  };

  const handleZoom = (type: 'in' | 'out' | 'reset') => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    let newZoom = canvas.getZoom();
    if (type === 'in') newZoom *= 1.2;
    else if (type === 'out') newZoom /= 1.2;
    else newZoom = 1;

    if (newZoom > 20) newZoom = 20;
    if (newZoom < 0.01) newZoom = 0.01;

    if (type === 'reset') {
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      canvas.setZoom(1);
    } else {
      canvas.zoomToPoint(new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2), newZoom);
    }
    setZoom(newZoom);
    setVpt([...canvas.viewportTransform!]);
  };

  const Ruler = ({ orientation, size, zoom, offset }: { 
    orientation: 'horizontal' | 'vertical', 
    size: number, 
    zoom: number, 
    offset: number
  }) => {
    const isHorizontal = orientation === 'horizontal';
    
    // Total physical size in CM for the canvas dimension
    const isLandscape = canvasSize.width > canvasSize.height;
    const totalCm = isHorizontal 
      ? (isLandscape ? 29.7 : 21) 
      : (isLandscape ? 21 : 29.7);
    
    const pixelsPerCm = (size / totalCm) * zoom;
    
    // Calculate visible range
    const startCm = Math.floor(-offset / pixelsPerCm);
    const endCm = Math.ceil((size - offset) / pixelsPerCm);
    
    return (
      <div className={`relative bg-slate-900 overflow-hidden ${isHorizontal ? 'w-full h-full border-b' : 'h-full w-full border-r'} border-slate-700`}>
        <svg width="100%" height="100%" className="absolute inset-0 text-slate-300">
          <defs>
            <pattern id={`ruler-${orientation}`} x={offset} y="0" width={pixelsPerCm} height="24" patternUnits="userSpaceOnUse">
              <line 
                x1="0" y1="0" x2={isHorizontal ? "0" : "24"} 
                y2={isHorizontal ? "24" : "0"} 
                stroke="currentColor" strokeWidth="1" 
              />
              {Array.from({ length: 9 }).map((_, j) => {
                const pos = (j + 1) * (pixelsPerCm / 10);
                const isMid = j === 4;
                return (
                  <line 
                    key={j} 
                    x1={isHorizontal ? pos : (isMid ? 10 : 16)} 
                    y1={isHorizontal ? (isMid ? 10 : 16) : pos} 
                    x2={isHorizontal ? pos : 24} 
                    y2={isHorizontal ? 24 : pos} 
                    stroke="currentColor" strokeWidth="1" 
                    opacity="0.6"
                  />
                );
              })}
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#ruler-${orientation})`} />
          
          {/* Labels */}
          {Array.from({ length: endCm - startCm + 1 }).map((_, i) => {
            const cm = startCm + i;
            const pos = cm * pixelsPerCm + offset;
            if (pos < -20 || pos > size + 20) return null;
            return (
              <text
                key={cm}
                x={isHorizontal ? pos + 2 : 2}
                y={isHorizontal ? 10 : pos + 10}
                fill="currentColor"
                fontSize="8"
                fontFamily="monospace"
                className="select-none pointer-events-none font-bold"
              >
                {cm}
              </text>
            );
          })}
        </svg>
      </div>
    );
  };

  return (
    <div className={`fixed inset-0 z-50 bg-slate-950 flex flex-col overflow-hidden font-sans text-slate-200 ${isMobile ? 'safe-bottom' : ''}`}>
      {/* Top Bar */}
      {isMobile ? (
        <div className="h-14 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900/80 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="p-2 text-slate-400 active:bg-slate-800 rounded-lg">
              <X className="w-5 h-5" />
            </button>
            <div className="h-4 w-px bg-slate-800" />
            <h2 className="text-slate-200 text-xs font-bold uppercase tracking-wider">Mobile Pro</h2>
          </div>

          <div className="flex items-center gap-1">
            <button 
              onClick={undo} 
              disabled={historyIndex <= 0}
              className="p-2 text-slate-400 disabled:opacity-20"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button 
              onClick={redo} 
              disabled={historyIndex >= history.length - 1}
              className="p-2 text-slate-400 disabled:opacity-20"
            >
              <Redo2 className="w-4 h-4" />
            </button>
            <div className="h-4 w-px bg-slate-800 mx-1" />
            <button 
              onClick={handleAiDescribe}
              className="p-2 text-indigo-400 active:bg-indigo-500/20 rounded-lg"
            >
              <Sparkles className="w-5 h-5" />
            </button>
            {activeSelection && (
              <button 
                onClick={handleContentAwareFill}
                className="p-2 text-amber-400 active:bg-amber-500/20 rounded-lg animate-pulse"
              >
                <Wand2 className="w-5 h-5" />
              </button>
            )}
            <button 
              onClick={() => setShowExportDialog(true)}
              className="p-2 text-emerald-400 active:bg-emerald-500/20 rounded-lg"
            >
              <Download className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors">
              <X className="w-6 h-6" />
            </button>
            <div className="h-6 w-px bg-slate-800" />
            <h2 className="text-slate-200 font-medium">Trình chỉnh sửa ảnh Pro</h2>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={resetCanvas}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-all"
              title="Khôi phục ảnh gốc"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            <div className="h-6 w-px bg-slate-800 mx-2" />
            <button 
              onClick={undo} 
              disabled={historyIndex <= 0}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 disabled:opacity-30 transition-all"
            >
              <Undo2 className="w-5 h-5" />
            </button>
            <button 
              onClick={redo} 
              disabled={historyIndex >= history.length - 1}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 disabled:opacity-30 transition-all"
            >
              <Redo2 className="w-5 h-5" />
            </button>
            <div className="h-6 w-px bg-slate-800 mx-2" />
            <button 
              onClick={handleAiDescribe}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-sm font-medium transition-all shadow-lg shadow-indigo-500/20"
            >
              <Sparkles className="w-4 h-4" />
              AI Gợi ý
            </button>
            {activeSelection && (
              <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-4 duration-300">
                <button 
                  onClick={handleContentAwareFill}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-full text-sm font-bold transition-all shadow-lg shadow-amber-500/20"
                >
                  <Wand2 className="w-4 h-4" />
                  Content Aware Fill
                </button>
                <button 
                  onClick={() => {
                    const canvas = fabricCanvas.current;
                    if (canvas) {
                      if (selectionRectRef.current) canvas.remove(selectionRectRef.current);
                      if (healingPathRef.current) canvas.remove(healingPathRef.current);
                      canvas.renderAll();
                    }
                    setActiveSelection(null);
                  }}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-full transition-all"
                  title="Bỏ vùng chọn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <button 
              onClick={() => setShowExportDialog(true)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full text-sm font-medium transition-all shadow-lg shadow-emerald-500/20"
            >
              <Download className="w-4 h-4" />
              Xuất ảnh
            </button>
          </div>
        </div>
      )}

      <div className={`flex-1 flex overflow-hidden ${isMobile ? 'flex-col' : ''}`}>
        {/* Left Toolbar */}
        {!isMobile && (
          <div className="w-16 border-r border-slate-800 bg-slate-900 flex flex-col items-center py-6 gap-4">
            <ToolButton active={mode === 'select'} onClick={() => setMode('select')} icon={<MousePointer2 />} label="Chọn" />
            <ToolButton active={mode === 'healing'} onClick={() => setMode('healing')} icon={<Wand2 className="w-4 h-4" />} label="Xóa AI" />
            <ToolButton active={mode === 'brush'} onClick={() => setMode('brush')} icon={<Pencil />} label="Vẽ" />
            <ToolButton active={mode === 'eraser'} onClick={() => setMode('eraser')} icon={<Eraser />} label="Xóa" />
            <div className="w-8 h-px bg-slate-800 my-2" />
            <ToolButton active={false} onClick={() => insertImageInputRef.current?.click()} icon={<ImagePlus />} label="Chèn ảnh" />
            <ToolButton active={false} onClick={addText} icon={<Type />} label="Chữ" />
            <ToolButton active={mode === 'rect'} onClick={() => addShape('rect')} icon={<Square />} label="Vuông" />
            <ToolButton active={mode === 'circle'} onClick={() => addShape('circle')} icon={<Circle />} label="Tròn" />
            <ToolButton active={mode === 'triangle'} onClick={() => addShape('triangle')} icon={<Triangle />} label="Tam giác" />
            <div className="w-8 h-px bg-slate-800 my-2" />
            <ToolButton active={isCropMode} onClick={startCrop} icon={<Crop />} label="Cắt" />
            <div className="mt-auto">
              <ToolButton active={false} onClick={deleteObject} icon={<Trash2 />} className="text-rose-500 hover:bg-rose-500/10" label="Xóa đối tượng" />
            </div>
          </div>
        )}

        {/* Main Canvas Area */}
        <div className={`flex-1 bg-slate-950 flex items-center justify-center relative overflow-hidden ${isMobile ? 'p-1' : 'p-8'}`}>
          <div className={`relative flex flex-col bg-slate-900 rounded-sm border border-slate-700 shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden ${isMobile ? 'p-0 mt-0 h-full w-full justify-center' : 'p-1 pt-6 pl-6'}`}>
            {/* Ruler Corner */}
            {!isMobile && (
              <div className="absolute top-0 left-0 w-6 h-6 bg-slate-900 border-r border-b border-slate-800 flex items-center justify-center z-10">
                <span className="text-[7px] text-slate-500 font-bold uppercase select-none">cm</span>
              </div>
            )}
            
            {/* Horizontal Ruler */}
            {!isMobile && (
              <div className="absolute top-0 left-6 right-0 h-6 z-10">
                <Ruler 
                  orientation="horizontal" 
                  size={canvasSize.width} 
                  zoom={vpt[0]} 
                  offset={vpt[4]}
                />
              </div>
            )}

            {/* Vertical Ruler */}
            {!isMobile && (
              <div className="absolute top-6 left-0 bottom-0 w-6 z-10">
                <Ruler 
                  orientation="vertical" 
                  size={canvasSize.height} 
                  zoom={vpt[3]} 
                  offset={vpt[5]}
                />
              </div>
            )}

            <div className={`bg-white overflow-hidden flex items-center justify-center ${isMobile ? 'w-full h-full' : ''}`}>
              <canvas ref={canvasRef} />
            </div>
          </div>

          {/* Zoom Controls */}
          <div className={`absolute left-1/2 -translate-x-1/2 flex items-center gap-2 bg-slate-900/80 backdrop-blur-md border border-slate-800 p-1.5 rounded-full shadow-2xl z-20 transition-all ${isMobile ? 'bottom-20 scale-90' : 'bottom-8'}`}>
            <button 
              onClick={() => handleZoom('out')}
              className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <div className="h-4 w-px bg-slate-800 mx-1" />
            <button 
              onClick={() => handleZoom('reset')}
              className="px-3 py-1 hover:bg-slate-800 rounded-full text-slate-200 text-xs font-bold transition-colors"
              title="Reset Zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <div className="h-4 w-px bg-slate-800 mx-1" />
            <button 
              onClick={() => handleZoom('in')}
              className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <div className="h-4 w-px bg-slate-800 mx-1" />
            <button 
              onClick={() => handleZoom('reset')}
              className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors"
              title="Fit to Screen"
            >
              <Maximize className="w-4 h-4" />
            </button>
          </div>

          {/* Crop Overlay */}
          <AnimatePresence>
            {isCropMode && cropImage && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-950 z-10 flex flex-col"
              >
                <div className="flex-1 p-8">
                  <Cropper
                    src={cropImage}
                    style={{ height: '100%', width: '100%' }}
                    initialAspectRatio={1}
                    guides={true}
                    ref={cropperRef}
                    viewMode={1}
                    background={false}
                    responsive={true}
                    autoCropArea={1}
                    checkOrientation={false}
                  />
                </div>
                <div className="h-20 bg-slate-900 border-t border-slate-800 flex items-center justify-center gap-4">
                  <button 
                    onClick={() => setIsCropMode(false)}
                    className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-full font-medium transition-all"
                  >
                    Hủy
                  </button>
                  <button 
                    onClick={finishCrop}
                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full font-medium transition-all"
                  >
                    Xác nhận cắt
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* AI/OCR Result Sidebar */}
          <AnimatePresence>
            {aiResult && (
              <motion.div 
                initial={{ x: 400 }}
                animate={{ x: 0 }}
                exit={{ x: 400 }}
                className="absolute right-0 top-0 bottom-0 w-80 bg-slate-900 border-l border-slate-800 p-6 z-20 shadow-2xl overflow-y-auto"
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-slate-200 font-semibold flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    Kết quả AI
                  </h3>
                  <button onClick={() => setAiResult(null)} className="text-slate-500 hover:text-slate-300">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="text-slate-400 text-sm leading-relaxed whitespace-pre-wrap">
                  {aiResult}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Processing Loader */}
          <AnimatePresence>
            {isProcessing && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm z-30 flex items-center justify-center"
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-slate-200 font-medium">Đang xử lý...</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Panel (Tabs) */}
        {!isMobile && (
          <div className="w-80 border-l border-slate-800 bg-slate-900 flex flex-col overflow-hidden">
          <Tabs.Root defaultValue="layers" className="flex flex-col h-full">
            <Tabs.List className="flex border-b border-slate-800">
              <Tabs.Trigger value="layers" className="flex-1 px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-indigo-500 transition-all">
                Layers
              </Tabs.Trigger>
              <Tabs.Trigger value="properties" className="flex-1 px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-indigo-500 transition-all">
                Properties
              </Tabs.Trigger>
              <Tabs.Trigger value="styles" className="flex-1 px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-indigo-500 transition-all">
                Styles
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="layers" className="flex-1 overflow-y-auto p-4">
              <Reorder.Group axis="y" values={layers} onReorder={reorderLayers} className="space-y-2">
                {layers.map((obj) => (
                  <Reorder.Item 
                    key={obj.name || Math.random().toString()} 
                    value={obj}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-grab active:cursor-grabbing ${activeObject === obj ? 'bg-indigo-600/20 border-indigo-500' : 'bg-slate-800 border-slate-700 hover:border-slate-600'}`}
                    onClick={() => {
                      fabricCanvas.current?.setActiveObject(obj);
                      fabricCanvas.current?.renderAll();
                    }}
                  >
                    <GripVertical className="w-4 h-4 text-slate-500" />
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-200 text-xs font-medium truncate">{obj.name || 'Unnamed Layer'}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(obj); }}
                        className={`p-1.5 rounded hover:bg-slate-700 transition-colors ${obj.visible ? 'text-slate-400' : 'text-rose-500'}`}
                      >
                        {obj.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); toggleLayerLock(obj); }}
                        className={`p-1.5 rounded hover:bg-slate-700 transition-colors ${obj.lockMovementX ? 'text-amber-500' : 'text-slate-400'}`}
                      >
                        {obj.lockMovementX ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            </Tabs.Content>

            <Tabs.Content value="properties" className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Colors */}
              <section>
                <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-4">Màu sắc</h3>
                <div className="grid grid-cols-6 gap-2">
                  {['#000000', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#64748b', '#475569'].map(c => (
                    <button 
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <input 
                    type="color" 
                    value={color} 
                    onChange={(e) => setColor(e.target.value)}
                    className="w-8 h-8 rounded-full overflow-hidden border-none p-0 cursor-pointer"
                  />
                </div>
              </section>

              {/* Settings */}
              <section className="flex flex-col gap-6">
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-slate-400 text-xs font-bold uppercase tracking-wider">Kích thước cọ</label>
                    <span className="text-slate-200 text-xs">{brushSize}px</span>
                  </div>
                  <Slider.Root 
                    className="relative flex items-center select-none touch-none w-full h-5"
                    value={[brushSize]}
                    onValueChange={([v]) => setBrushSize(v)}
                    max={100}
                    step={1}
                  >
                    <Slider.Track className="bg-slate-800 relative grow rounded-full h-[3px]">
                      <Slider.Range className="absolute bg-indigo-500 rounded-full h-full" />
                    </Slider.Track>
                    <Slider.Thumb className="block w-4 h-4 bg-white shadow-lg rounded-full hover:scale-110 focus:outline-none transition-transform" />
                  </Slider.Root>
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-slate-400 text-xs font-bold uppercase tracking-wider">Độ trong suốt</label>
                    <span className="text-slate-200 text-xs">{Math.round(opacity * 100)}%</span>
                  </div>
                  <Slider.Root 
                    className="relative flex items-center select-none touch-none w-full h-5"
                    value={[opacity]}
                    onValueChange={([v]) => setOpacity(v)}
                    max={1}
                    step={0.01}
                  >
                    <Slider.Track className="bg-slate-800 relative grow rounded-full h-[3px]">
                      <Slider.Range className="absolute bg-indigo-500 rounded-full h-full" />
                    </Slider.Track>
                    <Slider.Thumb className="block w-4 h-4 bg-white shadow-lg rounded-full hover:scale-110 focus:outline-none transition-transform" />
                  </Slider.Root>
                </div>
              </section>

              {/* Filters */}
              <section>
                <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-4">Bộ lọc (Chọn ảnh)</h3>
                <div className="grid grid-cols-2 gap-2">
                  <FilterButton onClick={() => applyFilter('grayscale')} icon={<Layers className="w-4 h-4" />} label="Xám" />
                  <FilterButton onClick={() => applyFilter('sepia')} icon={<ImageIcon className="w-4 h-4" />} label="Sepia" />
                  <FilterButton onClick={() => applyFilter('invert')} icon={<RefreshCw className="w-4 h-4" />} label="Đảo ngược" />
                  <FilterButton onClick={() => applyFilter('brightness')} icon={<Sun className="w-4 h-4" />} label="Sáng" />
                  <FilterButton onClick={() => applyFilter('contrast')} icon={<Contrast className="w-4 h-4" />} label="Tương phản" />
                  <FilterButton onClick={() => applyFilter('blur')} icon={<Wind className="w-4 h-4" />} label="Mờ" />
                </div>
              </section>
            </Tabs.Content>

            <Tabs.Content value="styles" className="flex-1 overflow-y-auto p-6 space-y-8">
              {activeObject ? (
                <>
                  <section>
                    <label className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-4 block">Chế độ hòa trộn</label>
                    <Select.Root 
                      value={activeObject.get('globalCompositeOperation') || 'source-over'}
                      onValueChange={(v) => updateLayerStyle('blendMode', v)}
                    >
                      <Select.Trigger className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-all">
                        <Select.Value />
                        <ChevronDown className="w-4 h-4 text-slate-500" />
                      </Select.Trigger>
                      <Select.Portal>
                        <Select.Content className="bg-slate-800 border border-slate-700 rounded-lg shadow-2xl overflow-hidden z-[100]">
                          <Select.Viewport className="p-1">
                            {[
                              { label: 'Normal', value: 'source-over' },
                              { label: 'Multiply', value: 'multiply' },
                              { label: 'Screen', value: 'screen' },
                              { label: 'Overlay', value: 'overlay' },
                              { label: 'Darken', value: 'darken' },
                              { label: 'Lighten', value: 'lighten' },
                              { label: 'Color Dodge', value: 'color-dodge' },
                              { label: 'Color Burn', value: 'color-burn' },
                              { label: 'Hard Light', value: 'hard-light' },
                              { label: 'Soft Light', value: 'soft-light' },
                              { label: 'Difference', value: 'difference' },
                              { label: 'Exclusion', value: 'exclusion' },
                            ].map((opt) => (
                              <Select.Item key={opt.value} value={opt.value} className="px-8 py-2 text-sm text-slate-300 hover:bg-indigo-600 hover:text-white rounded cursor-pointer focus:outline-none">
                                <Select.ItemText>{opt.label}</Select.ItemText>
                              </Select.Item>
                            ))}
                          </Select.Viewport>
                        </Select.Content>
                      </Select.Portal>
                    </Select.Root>
                  </section>

                  <section className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-slate-400 text-xs font-bold uppercase tracking-wider">Viền (Stroke)</label>
                      <Switch.Root 
                        checked={!!activeObject.stroke}
                        onCheckedChange={(checked) => updateLayerStyle('stroke', checked ? color : null)}
                        className="w-10 h-5 bg-slate-800 rounded-full relative data-[state=checked]:bg-indigo-600 transition-colors"
                      >
                        <Switch.Thumb className="block w-4 h-4 bg-white rounded-full transition-transform translate-x-0.5 data-[state=checked]:translate-x-[22px]" />
                      </Switch.Root>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-slate-400 text-xs font-bold uppercase tracking-wider">Đổ bóng (Shadow)</label>
                      <Switch.Root 
                        checked={!!activeObject.shadow}
                        onCheckedChange={(checked) => updateLayerStyle('shadow', checked)}
                        className="w-10 h-5 bg-slate-800 rounded-full relative data-[state=checked]:bg-indigo-600 transition-colors"
                      >
                        <Switch.Thumb className="block w-4 h-4 bg-white rounded-full transition-transform translate-x-0.5 data-[state=checked]:translate-x-[22px]" />
                      </Switch.Root>
                    </div>
                  </section>
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                  <Palette className="w-12 h-12 text-slate-700 mb-4" />
                  <p className="text-slate-500 text-sm">Chọn một layer để tùy chỉnh Layer Style</p>
                </div>
              )}
            </Tabs.Content>
          </Tabs.Root>
          </div>
        )}
      </div>

      {/* Mobile Bottom Toolbar */}
      {isMobile && (
        <div className="h-16 bg-slate-900 border-t border-slate-800 flex items-center px-1 overflow-x-auto no-scrollbar gap-1 shrink-0">
          <ToolButton isMobile active={mode === 'select'} onClick={() => setMode('select')} icon={<MousePointer2 />} label="Chọn" />
          <ToolButton isMobile active={mode === 'healing'} onClick={() => setMode('healing')} icon={<Wand2 className="w-4 h-4" />} label="Xóa AI" />
          <ToolButton isMobile active={mode === 'brush'} onClick={() => setMode('brush')} icon={<Pencil />} label="Vẽ" />
          <ToolButton isMobile active={mode === 'eraser'} onClick={() => setMode('eraser')} icon={<Eraser />} label="Xóa" />
          <ToolButton isMobile active={false} onClick={() => insertImageInputRef.current?.click()} icon={<ImagePlus />} label="Ảnh" />
          <ToolButton isMobile active={false} onClick={addText} icon={<Type />} label="Chữ" />
          <ToolButton isMobile active={false} onClick={() => addShape('rect')} icon={<Square />} label="Hình" />
          <ToolButton 
            isMobile 
            active={showMobilePanel} 
            onClick={() => setShowMobilePanel(!showMobilePanel)} 
            icon={<Settings />} 
            label="Cài đặt" 
          />
          <ToolButton isMobile active={false} onClick={() => { setMode('select'); deleteObject(); }} icon={<Trash2 />} label="Xóa lớp" className="text-rose-400" />
        </div>
      )}

      {/* Mobile Side Panel (Drawer Replacement) */}
      {isMobile && showMobilePanel && (
        <div className="absolute inset-x-0 bottom-16 top-20 bg-slate-900 border-t border-indigo-500 rounded-t-3xl z-[60] flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-300">
          <div className="p-4 flex items-center justify-between border-b border-slate-800">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-widest">Tùy chọn & Lớp</h3>
            <button 
              onClick={() => setShowMobilePanel(false)}
              className="p-2 text-slate-400 active:bg-slate-800 rounded-full"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar">
            <Tabs.Root defaultValue="layers" className="flex flex-col h-full">
              <Tabs.List className="flex border-b border-slate-800 bg-slate-900/50">
                <Tabs.Trigger value="layers" className="flex-1 px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-indigo-500 transition-all">
                  Lớp
                </Tabs.Trigger>
                <Tabs.Trigger value="properties" className="flex-1 px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-indigo-500 transition-all">
                  Cài đặt
                </Tabs.Trigger>
                <Tabs.Trigger value="styles" className="flex-1 px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-indigo-500 transition-all">
                  Style
                </Tabs.Trigger>
              </Tabs.List>

              <div className="flex-1 overflow-y-scroll no-scrollbar pb-10">
                <Tabs.Content value="layers" className="p-4">
                  <div className="space-y-2">
                    {layers.map((obj) => (
                      <div 
                        key={obj.name || Math.random().toString()} 
                        className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${activeObject === obj ? 'bg-indigo-600/20 border-indigo-500' : 'bg-slate-800 border-slate-700'}`}
                        onClick={() => {
                          fabricCanvas.current?.setActiveObject(obj);
                          fabricCanvas.current?.renderAll();
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-slate-200 text-sm font-medium truncate">{obj.name || 'Layer'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(obj); }} className="p-2 text-slate-400">
                            {obj.visible ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5 text-rose-500" />}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); toggleLayerLock(obj); }} className="p-2 text-slate-400">
                            {obj.lockMovementX ? <Lock className="w-5 h-5 text-amber-500" /> : <Unlock className="w-5 h-5" />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Tabs.Content>

                <Tabs.Content value="properties" className="p-6 space-y-8">
                  {/* Colors */}
                  <section>
                    <h3 className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-4">Màu sắc</h3>
                    <div className="grid grid-cols-5 gap-3">
                      {['#000000', '#ffffff', '#ef4444', '#22c55e', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#facc15', '#f97316'].map(c => (
                        <button 
                          key={c}
                          onClick={() => setColor(c)}
                          className={`w-10 h-10 rounded-full border-2 transition-all ${color === c ? 'border-white scale-110 shadow-lg' : 'border-transparent shadow-md'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </section>

                  {/* Brush & Opacity */}
                  <section className="space-y-8">
                    <div>
                      <div className="flex justify-between mb-3">
                        <label className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Kích thước cọ</label>
                        <span className="text-slate-200 text-xs font-bold">{brushSize}px</span>
                      </div>
                      <Slider.Root className="relative flex items-center select-none touch-none w-full h-8" value={[brushSize]} onValueChange={([v]) => setBrushSize(v)} max={100} step={1}>
                        <Slider.Track className="bg-slate-800 relative grow rounded-full h-[6px]">
                          <Slider.Range className="absolute bg-indigo-500 rounded-full h-full" />
                        </Slider.Track>
                        <Slider.Thumb className="block w-6 h-6 bg-white shadow-xl rounded-full focus:outline-none" />
                      </Slider.Root>
                    </div>
                    <div>
                      <div className="flex justify-between mb-3">
                        <label className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Độ mờ</label>
                        <span className="text-slate-200 text-xs font-bold">{Math.round(opacity * 100)}%</span>
                      </div>
                      <Slider.Root className="relative flex items-center select-none touch-none w-full h-8" value={[opacity]} onValueChange={([v]) => setOpacity(v)} max={1} step={0.01}>
                        <Slider.Track className="bg-slate-800 relative grow rounded-full h-[6px]">
                          <Slider.Range className="absolute bg-indigo-500 rounded-full h-full" />
                        </Slider.Track>
                        <Slider.Thumb className="block w-6 h-6 bg-white shadow-xl rounded-full focus:outline-none" />
                      </Slider.Root>
                    </div>
                  </section>
                </Tabs.Content>

                <Tabs.Content value="styles" className="p-6 space-y-8">
                  {activeObject ? (
                    <div className="space-y-8">
                      <section>
                         <label className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-4 block">Hòa trộn</label>
                         <div className="grid grid-cols-2 gap-2">
                           {['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten'].map(m => (
                             <button key={m} onClick={() => updateLayerStyle('blendMode', m)} className={`px-4 py-3 rounded-xl border text-xs font-bold transition-all ${activeObject.get('globalCompositeOperation') === m ? 'bg-indigo-600 border-indigo-500' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                               {m.replace('-', ' ').toUpperCase()}
                             </button>
                           ))}
                         </div>
                      </section>
                      <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-2xl border border-slate-800">
                        <span className="text-xs font-bold text-slate-200 uppercase tracking-widest">Đổ bóng</span>
                        <Switch.Root checked={!!activeObject.shadow} onCheckedChange={(checked) => updateLayerStyle('shadow', checked)} className="w-12 h-6 bg-slate-800 rounded-full relative data-[state=checked]:bg-indigo-600 outline-none">
                          <Switch.Thumb className="block w-5 h-5 bg-white rounded-full transition-transform translate-x-0.5 data-[state=checked]:translate-x-[26px]" />
                        </Switch.Root>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 px-6">
                      <Palette className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                      <p className="text-slate-500 text-sm">Vui lòng chọn một lớp để tùy chỉnh style</p>
                    </div>
                  )}
                </Tabs.Content>
              </div>
            </Tabs.Root>
          </div>
        </div>
      )}

      {/* Export Dialog */}
      <Dialog.Root open={showExportDialog} onOpenChange={setShowExportDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100]" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl z-[101] focus:outline-none">
            <Dialog.Title className="text-xl font-bold text-slate-200 mb-6 flex items-center gap-3">
              <Download className="w-5 h-5 text-emerald-500" />
              Tùy chọn xuất ảnh
            </Dialog.Title>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2 block">Định dạng</label>
                  <Select.Root 
                    value={exportSettings.format}
                    onValueChange={(v: any) => setExportSettings(prev => ({ ...prev, format: v }))}
                  >
                    <Select.Trigger className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-200">
                      <Select.Value />
                      <ChevronDown className="w-4 h-4" />
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Content className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-[110]">
                        <Select.Viewport className="p-1">
                          <Select.Item value="png" className="px-8 py-2 text-sm text-slate-300 hover:bg-indigo-600 hover:text-white rounded cursor-pointer">
                            <Select.ItemText>PNG</Select.ItemText>
                          </Select.Item>
                          <Select.Item value="jpeg" className="px-8 py-2 text-sm text-slate-300 hover:bg-indigo-600 hover:text-white rounded cursor-pointer">
                            <Select.ItemText>JPG</Select.ItemText>
                          </Select.Item>
                          <Select.Item value="pdf" className="px-8 py-2 text-sm text-slate-300 hover:bg-indigo-600 hover:text-white rounded cursor-pointer">
                            <Select.ItemText>PDF</Select.ItemText>
                          </Select.Item>
                        </Select.Viewport>
                      </Select.Content>
                    </Select.Portal>
                  </Select.Root>
                </div>
                <div>
                  <label className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2 block">DPI</label>
                  <Select.Root 
                    value={exportSettings.dpi.toString()}
                    onValueChange={(v) => {
                      const newDpi = parseInt(v);
                      const isLat = canvasSize.width > canvasSize.height;
                      // Recalculate A4 dimensions for new DPI
                      const a4W = isLat ? 11.69 : 8.27; // inches
                      const a4H = isLat ? 8.27 : 11.69; 
                      setExportSettings(prev => ({ 
                        ...prev, 
                        dpi: newDpi,
                        width: Math.round(a4W * newDpi),
                        height: Math.round(a4H * newDpi)
                      }));
                    }}
                  >
                    <Select.Trigger className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-200">
                      <Select.Value />
                      <ChevronDown className="w-4 h-4" />
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Content className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-[110]">
                        <Select.Viewport className="p-1">
                          {[72, 150, 300, 600].map(d => (
                            <Select.Item key={d} value={d.toString()} className="px-8 py-2 text-sm text-slate-300 hover:bg-indigo-600 hover:text-white rounded cursor-pointer">
                              <Select.ItemText>{d} DPI</Select.ItemText>
                            </Select.Item>
                          ))}
                        </Select.Viewport>
                      </Select.Content>
                    </Select.Portal>
                  </Select.Root>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-slate-400 text-xs font-bold uppercase tracking-wider block">Kích thước (px)</label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-slate-500 uppercase font-bold">Rộng</span>
                    <input 
                      type="number" 
                      value={exportSettings.width}
                      onChange={(e) => {
                        const w = parseInt(e.target.value) || 0;
                        const h = Math.round(w * (canvasSize.height / canvasSize.width));
                        setExportSettings(prev => ({ ...prev, width: w, height: h }));
                      }}
                      className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-200 focus:border-indigo-500 outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-slate-500 uppercase font-bold">Cao</span>
                    <input 
                      type="number" 
                      value={exportSettings.height}
                      onChange={(e) => {
                        const h = parseInt(e.target.value) || 0;
                        const w = Math.round(h * (canvasSize.width / canvasSize.height));
                        setExportSettings(prev => ({ ...prev, width: w, height: h }));
                      }}
                      className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-200 focus:border-indigo-500 outline-none"
                    />
                  </div>
                </div>
                <button 
                  onClick={() => {
                    const isLat = canvasSize.width > canvasSize.height;
                    const a4W = isLat ? 11.69 : 8.27; // inches
                    const a4H = isLat ? 8.27 : 11.69;
                    const dpi = exportSettings.dpi;
                    setExportSettings(prev => ({ 
                      ...prev, 
                      width: Math.round(a4W * dpi), 
                      height: Math.round(a4H * dpi) 
                    }));
                  }}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-widest flex items-center gap-1.5"
                >
                  <Maximize2 className="w-3 h-3" />
                  Khôi phục chuẩn A4
                </button>
              </div>

              <div className="pt-4 flex gap-3">
                <Dialog.Close asChild>
                  <button className="flex-1 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-2xl font-bold transition-all">
                    Hủy
                  </button>
                </Dialog.Close>
                <button 
                  onClick={handleExport}
                  className="flex-1 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-bold shadow-lg shadow-emerald-500/20 transition-all"
                >
                  Tải về ngay
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <input 
        type="file" 
        ref={insertImageInputRef}
        className="hidden"
        accept="image/*,.heic,.heif,.jfif,.pdf"
        onChange={handleInsertImage}
      />
    </div>
  );
};

const ToolButton = ({ active, onClick, icon, label, className = "", isMobile = false }: { 
  active: boolean, 
  onClick: () => void, 
  icon: React.ReactNode, 
  label: string, 
  className?: string,
  isMobile?: boolean 
}) => (
  <button 
    onClick={onClick}
    title={label}
    className={`rounded-xl transition-all relative group flex flex-col items-center justify-center shrink-0 ${
      isMobile ? 'p-1.5 min-w-[56px] gap-1' : 'p-3'
    } ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'} ${className}`}
  >
    {React.cloneElement(icon as React.ReactElement, { className: isMobile ? 'w-4 h-4' : 'w-5 h-5' })}
    {isMobile ? (
      <span className="text-[9px] font-medium truncate w-full text-center leading-none tracking-tight">{label}</span>
    ) : (
      <span className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
        {label}
      </span>
    )}
  </button>
);

const FilterButton = ({ onClick, icon, label }: { onClick: () => void, icon: React.ReactNode, label: string }) => (
  <button 
    onClick={onClick}
    className="flex flex-col items-center justify-center gap-2 p-3 bg-slate-800 hover:bg-slate-700 rounded-xl transition-all border border-slate-700/50"
  >
    <div className="text-slate-300">{icon}</div>
    <span className="text-slate-400 text-[10px] font-medium">{label}</span>
  </button>
);

const RefreshCw = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
);

const ChevronDown = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m6 9 6 6 6-6"/></svg>
);
