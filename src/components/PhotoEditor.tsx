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
  ChevronLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Cropper, ReactCropperElement } from 'react-cropper';
import 'cropperjs/dist/cropper.css';
import Tesseract from 'tesseract.js';
import { GoogleGenAI } from "@google/genai";

interface PhotoEditorProps {
  file: File;
  onClose: () => void;
  onSave: (blob: Blob) => void;
}

type EditorMode = 'select' | 'brush' | 'text' | 'rect' | 'circle' | 'triangle' | 'eraser' | 'crop';

export const PhotoEditor: React.FC<PhotoEditorProps> = ({ file, onClose, onSave }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvas = useRef<fabric.Canvas | null>(null);
  const cropperRef = useRef<ReactCropperElement>(null);
  
  const [mode, setMode] = useState<EditorMode>('select');
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

  // Initialize Canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: 800,
      height: 600,
      backgroundColor: '#ffffff',
    });

    fabricCanvas.current = canvas;

    // Load initial image
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      fabric.Image.fromURL(url).then((img) => {
        // Scale image to fit canvas
        const canvasWidth = canvas.getWidth();
        const canvasHeight = canvas.getHeight();
        const scale = Math.min(canvasWidth / img.width!, canvasHeight / img.height!, 1);
        
        img.set({
          scaleX: scale,
          scaleY: scale,
          left: (canvasWidth - img.width! * scale) / 2,
          top: (canvasHeight - img.height! * scale) / 2,
          selectable: true,
        });
        
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.renderAll();
        saveHistory();
      });
    };
    reader.readAsDataURL(file);

    // Event Listeners
    canvas.on('selection:created', (e) => setActiveObject(e.selected?.[0] || null));
    canvas.on('selection:updated', (e) => setActiveObject(e.selected?.[0] || null));
    canvas.on('selection:cleared', () => setActiveObject(null));
    canvas.on('object:modified', () => saveHistory());
    canvas.on('object:added', () => saveHistory());

    return () => {
      canvas.dispose();
    };
  }, []);

  // Mode Management
  useEffect(() => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    canvas.isDrawingMode = mode === 'brush' || mode === 'eraser';
    
    if (canvas.isDrawingMode) {
      if (mode === 'brush') {
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
        canvas.freeDrawingBrush.color = color;
        canvas.freeDrawingBrush.width = brushSize;
      } else if (mode === 'eraser') {
        // Fabric 6 doesn't have a built-in eraser brush in the same way, 
        // but we can use a pencil brush with destination-out or just white for now
        // For a true eraser in Fabric 6, it's more complex, let's use white for simplicity in "simple" version
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
        canvas.freeDrawingBrush.color = '#ffffff';
        canvas.freeDrawingBrush.width = brushSize;
      }
    }
  }, [mode, color, brushSize]);

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
      });
    }
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
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    setMode('select');
  };

  const addShape = (type: 'rect' | 'circle' | 'triangle') => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    let shape;
    const common = { left: 100, top: 100, fill: color, opacity };
    
    if (type === 'rect') shape = new fabric.Rect({ ...common, width: 100, height: 100 });
    else if (type === 'circle') shape = new fabric.Circle({ ...common, radius: 50 });
    else shape = new fabric.Triangle({ ...common, width: 100, height: 100 });
    
    canvas.add(shape);
    canvas.setActiveObject(shape);
    setMode('select');
  };

  const deleteObject = () => {
    const canvas = fabricCanvas.current;
    if (!canvas || !activeObject) return;
    canvas.remove(activeObject);
    canvas.discardActiveObject();
    canvas.renderAll();
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
      canvas.add(img);
      canvas.renderAll();
      setIsCropMode(false);
      setCropImage(null);
      saveHistory();
    });
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

  const downloadImage = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL({ format: 'png' });
    const link = document.createElement('a');
    link.download = 'edited-image.png';
    link.href = dataUrl;
    link.click();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col overflow-hidden font-sans">
      {/* Top Bar */}
      <div className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors">
            <X className="w-6 h-6" />
          </button>
          <div className="h-6 w-px bg-slate-800" />
          <h2 className="text-slate-200 font-medium">Trình chỉnh sửa ảnh</h2>
        </div>

        <div className="flex items-center gap-2">
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
          <button 
            onClick={handleOcr}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-full text-sm font-medium transition-all"
          >
            <FileText className="w-4 h-4" />
            Trích xuất chữ
          </button>
          <button 
            onClick={downloadImage}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full text-sm font-medium transition-all shadow-lg shadow-emerald-500/20"
          >
            <Download className="w-4 h-4" />
            Tải về
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Toolbar */}
        <div className="w-16 border-r border-slate-800 bg-slate-900 flex flex-col items-center py-6 gap-4">
          <ToolButton active={mode === 'select'} onClick={() => setMode('select')} icon={<MousePointer2 />} label="Chọn" />
          <ToolButton active={mode === 'brush'} onClick={() => setMode('brush')} icon={<Pencil />} label="Vẽ" />
          <ToolButton active={mode === 'eraser'} onClick={() => setMode('eraser')} icon={<Eraser />} label="Xóa" />
          <div className="w-8 h-px bg-slate-800 my-2" />
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

        {/* Main Canvas Area */}
        <div className="flex-1 bg-slate-950 flex items-center justify-center p-8 relative overflow-hidden">
          <div className="bg-white shadow-2xl rounded-sm overflow-hidden border border-slate-800">
            <canvas ref={canvasRef} />
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

        {/* Right Properties Panel */}
        <div className="w-72 border-l border-slate-800 bg-slate-900 p-6 flex flex-col gap-8 overflow-y-auto">
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
              <input 
                type="range" min="1" max="100" value={brushSize} 
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-slate-400 text-xs font-bold uppercase tracking-wider">Độ trong suốt</label>
                <span className="text-slate-200 text-xs">{Math.round(opacity * 100)}%</span>
              </div>
              <input 
                type="range" min="0" max="1" step="0.1" value={opacity} 
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
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
        </div>
      </div>
    </div>
  );
};

const ToolButton = ({ active, onClick, icon, label, className = "" }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string, className?: string }) => (
  <button 
    onClick={onClick}
    title={label}
    className={`p-3 rounded-xl transition-all relative group ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'} ${className}`}
  >
    {React.cloneElement(icon as React.ReactElement, { className: 'w-5 h-5' })}
    <span className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
      {label}
    </span>
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
