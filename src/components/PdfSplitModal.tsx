import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Scissors, 
  Layers, 
  Upload, 
  X, 
  Trash2, 
  Check, 
  Loader2, 
  FileText, 
  Sparkles,
  Info,
  RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as pdfjsLib from 'pdfjs-dist';

interface PdfSplitModalProps {
  initialFile?: File | null;
  onClose: () => void;
  onExecuteSplit: (file: File, mode: 'all_pages' | 'custom_cuts', cutPoints: number[]) => Promise<void>;
}

interface SplitPart {
  partIndex: number;
  startPage: number;
  endPage: number;
  pageCount: number;
  colorClass: {
    bg: string;
    border: string;
    badge: string;
    text: string;
    accent: string;
  };
}

const PART_COLORS = [
  { bg: 'bg-blue-50/60', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700', text: 'text-blue-700', accent: '#2563eb' },
  { bg: 'bg-purple-50/60', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700', text: 'text-purple-700', accent: '#9333ea' },
  { bg: 'bg-emerald-50/60', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700', text: 'text-emerald-700', accent: '#059669' },
  { bg: 'bg-amber-50/60', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700', text: 'text-amber-700', accent: '#d97706' },
  { bg: 'bg-rose-50/60', border: 'border-rose-200', badge: 'bg-rose-100 text-rose-700', text: 'text-rose-700', accent: '#e11d48' },
  { bg: 'bg-cyan-50/60', border: 'border-cyan-200', badge: 'bg-cyan-100 text-cyan-700', text: 'text-cyan-700', accent: '#0891b2' },
];

export const PdfSplitModal: React.FC<PdfSplitModalProps> = ({
  initialFile,
  onClose,
  onExecuteSplit
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(initialFile || null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [splitMode, setSplitMode] = useState<'all_pages' | 'custom_cuts'>('custom_cuts');
  const [cutPoints, setCutPoints] = useState<number[]>([]); // Page numbers after which cut occurs (e.g. [2, 5])
  const [totalPages, setTotalPages] = useState<number>(0);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hoveredDivider, setHoveredDivider] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Load PDF document and render thumbnails progressively
  useEffect(() => {
    if (!selectedFile) {
      setTotalPages(0);
      setThumbnails({});
      setCutPoints([]);
      return;
    }

    let isCancelled = false;
    setLoadingDoc(true);
    setThumbnails({});
    setCutPoints([]);

    const loadPdf = async () => {
      try {
        const arrayBuffer = await selectedFile.arrayBuffer();
        if (isCancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (isCancelled) return;

        const count = pdf.numPages;
        setTotalPages(count);
        setLoadingDoc(false);

        // Progressive thumbnail generation
        for (let i = 1; i <= count; i++) {
          if (isCancelled) break;
          try {
            const page = await pdf.getPage(i);
            const initialViewport = page.getViewport({ scale: 1 });
            const targetWidth = 130;
            const scale = targetWidth / initialViewport.width;
            const viewport = page.getViewport({ scale });

            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              await page.render({ canvasContext: ctx, viewport } as any).promise;
              if (isCancelled) break;
              const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
              setThumbnails(prev => ({ ...prev, [i]: dataUrl }));
            }
          } catch (err) {
            console.error(`Error rendering thumb for page ${i}`, err);
          }
        }
      } catch (err) {
        console.error('Failed to load PDF document for splitting', err);
        setLoadingDoc(false);
      }
    };

    loadPdf();

    return () => {
      isCancelled = true;
    };
  }, [selectedFile]);

  // Compute calculated parts based on cutPoints
  const parts: SplitPart[] = useMemo(() => {
    if (totalPages === 0) return [];
    if (splitMode === 'all_pages') {
      return Array.from({ length: totalPages }, (_, i) => ({
        partIndex: i + 1,
        startPage: i + 1,
        endPage: i + 1,
        pageCount: 1,
        colorClass: PART_COLORS[i % PART_COLORS.length]
      }));
    }

    const sortedCuts = [...cutPoints].sort((a, b) => a - b);
    const result: SplitPart[] = [];
    let currentStart = 1;

    sortedCuts.forEach((cut, idx) => {
      if (cut >= currentStart && cut <= totalPages) {
        result.push({
          partIndex: result.length + 1,
          startPage: currentStart,
          endPage: cut,
          pageCount: cut - currentStart + 1,
          colorClass: PART_COLORS[result.length % PART_COLORS.length]
        });
        currentStart = cut + 1;
      }
    });

    if (currentStart <= totalPages) {
      result.push({
        partIndex: result.length + 1,
        startPage: currentStart,
        endPage: totalPages,
        pageCount: totalPages - currentStart + 1,
        colorClass: PART_COLORS[result.length % PART_COLORS.length]
      });
    }

    return result;
  }, [totalPages, splitMode, cutPoints]);

  // Helper to find which part a page belongs to
  const getPagePart = (pageNum: number): SplitPart | undefined => {
    return parts.find(p => pageNum >= p.startPage && pageNum <= p.endPage);
  };

  // Toggle cut after pageNum
  const toggleCut = (afterPage: number) => {
    if (splitMode !== 'custom_cuts') return;
    setCutPoints(prev => {
      if (prev.includes(afterPage)) {
        return prev.filter(p => p !== afterPage);
      } else {
        return [...prev, afterPage].sort((a, b) => a - b);
      }
    });
  };

  // Cut after all pages
  const handleCutAll = () => {
    if (totalPages <= 1) return;
    const all = Array.from({ length: totalPages - 1 }, (_, i) => i + 1);
    setCutPoints(all);
  };

  // Clear all cuts
  const handleClearCuts = () => {
    setCutPoints([]);
  };

  // Perform split
  const handleSplit = async () => {
    if (!selectedFile || totalPages === 0 || isProcessing) return;
    setIsProcessing(true);
    try {
      await onExecuteSplit(selectedFile, splitMode, cutPoints);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />

      {/* Modal Dialog */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="relative bg-white rounded-3xl shadow-2xl p-6 sm:p-7 w-full max-w-4xl max-h-[90vh] flex flex-col z-10"
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-3.5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-sm">
              <Scissors className="w-5 h-5 -rotate-45" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">
                Tách file PDF (Split PDF)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Tách mỗi trang thành file riêng hoặc nhấp chuột vào đường ranh giữa các trang để cắt tùy ý
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 min-h-0 overflow-y-auto py-4 space-y-5 custom-scrollbar pr-1">
          {/* File Picker or Info Banner */}
          {!selectedFile ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  const file = (Array.from(e.dataTransfer.files) as File[]).find(f => f.name.toLowerCase().endsWith('.pdf'));
                  if (file) setSelectedFile(file);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 ${
                isDragOver ? 'border-blue-500 bg-blue-50/70 scale-[1.01]' : 'border-slate-200 bg-slate-50/60 hover:bg-slate-50 hover:border-blue-400'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setSelectedFile(e.target.files[0]);
                  }
                }}
              />
              <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center shadow-inner">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-800">
                  Kéo thả tệp PDF vào đây hoặc bấm để chọn tệp
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Hỗ trợ xem trước trang trực quan và tùy chọn vị trí cắt bằng kéo
                </p>
              </div>
              <button
                type="button"
                className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-sm transition-all"
              >
                Chọn tệp PDF
              </button>
            </div>
          ) : (
            <>
              {/* File Info Card */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0 font-bold text-xs">
                    PDF
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate max-w-sm sm:max-w-md" title={selectedFile.name}>
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatBytes(selectedFile.size)} • {loadingDoc ? 'Đang đọc số trang...' : `${totalPages} trang`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setSelectedFile(e.target.files[0]);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-blue-600 bg-white border border-slate-200 rounded-lg hover:border-blue-300 transition-colors shadow-2xs"
                  >
                    Đổi tệp khác
                  </button>
                </div>
              </div>

              {/* Mode Selection Tabs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSplitMode('all_pages')}
                  className={`p-3.5 rounded-2xl border text-left transition-all flex items-start gap-3 ${
                    splitMode === 'all_pages'
                      ? 'bg-blue-50/70 border-blue-500 ring-2 ring-blue-500/20 shadow-sm'
                      : 'bg-white border-slate-200 hover:border-blue-300'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    splitMode === 'all_pages' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}>
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-800">Tách mỗi trang thành 1 file</span>
                      {splitMode === 'all_pages' && (
                        <span className="w-2 h-2 rounded-full bg-blue-600" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                      Mỗi trang tài liệu sẽ được tách độc lập thành một file PDF riêng biệt.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSplitMode('custom_cuts')}
                  className={`p-3.5 rounded-2xl border text-left transition-all flex items-start gap-3 ${
                    splitMode === 'custom_cuts'
                      ? 'bg-blue-50/70 border-blue-500 ring-2 ring-blue-500/20 shadow-sm'
                      : 'bg-white border-slate-200 hover:border-blue-300'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    splitMode === 'custom_cuts' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}>
                    <Scissors className="w-4 h-4 -rotate-45" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-800">Tùy chỉnh vị trí cắt bằng kéo</span>
                      {splitMode === 'custom_cuts' && (
                        <span className="w-2 h-2 rounded-full bg-blue-600" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                      Di chuột vào đường ranh giữa các trang và nhấp kéo để phân đoạn tùy ý.
                    </p>
                  </div>
                </button>
              </div>

              {/* Mode Specific Info & Controls */}
              {splitMode === 'custom_cuts' ? (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Phần xuất ra: {parts.length} tệp PDF
                      </span>
                      {cutPoints.length > 0 && (
                        <span className="text-[11px] bg-rose-100 text-rose-700 font-bold px-2 py-0.5 rounded-full">
                          {cutPoints.length} đường cắt
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCutAll}
                        disabled={totalPages <= 1}
                        className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-blue-600 bg-white border border-slate-200 rounded-lg hover:border-blue-300 transition-colors shadow-2xs disabled:opacity-30"
                      >
                        Cắt tất cả
                      </button>
                      <button
                        type="button"
                        onClick={handleClearCuts}
                        disabled={cutPoints.length === 0}
                        className="px-2.5 py-1 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-white border border-rose-200 rounded-lg hover:border-rose-300 transition-colors shadow-2xs disabled:opacity-30 flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Xóa đường cắt</span>
                      </button>
                    </div>
                  </div>

                  {/* Parts Summary Badges */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {parts.map((part) => (
                      <div
                        key={part.partIndex}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-xl border flex items-center gap-1.5 ${part.colorClass.bg} ${part.colorClass.border} ${part.colorClass.text}`}
                      >
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${part.colorClass.badge}`}>
                          {part.partIndex}
                        </span>
                        <span>
                          {part.startPage === part.endPage
                            ? `Trang ${part.startPage}`
                            : `Trang ${part.startPage} - ${part.endPage}`}
                        </span>
                        <span className="opacity-60 text-[10px]">
                          ({part.pageCount} trang)
                        </span>
                      </div>
                    ))}
                  </div>

                  <p className="text-[11px] text-slate-500 flex items-center gap-1.5 italic">
                    <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                    <span>Di chuột vào ranh giới giữa 2 trang bất kỳ và nhấp vào biểu tượng kéo để Cắt / Hủy cắt.</span>
                  </p>
                </div>
              ) : (
                <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div className="text-xs text-blue-800 leading-relaxed">
                    Tất cả <span className="font-bold">{totalPages} trang</span> sẽ được trích xuất thành <span className="font-bold">{totalPages} tệp PDF riêng biệt</span> và đóng gói trong 1 tệp ZIP tự động tải về.
                  </div>
                </div>
              )}

              {/* Visual Page Flow with Scissors Dividers */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider px-1">
                  <span>Xem trước các trang ({totalPages} trang)</span>
                  {splitMode === 'custom_cuts' && (
                    <span className="text-slate-400 font-normal lowercase">nhấp vào kéo để chia file</span>
                  )}
                </div>

                <div className="bg-slate-100/70 border border-slate-200 rounded-2xl p-4 sm:p-5 overflow-x-auto min-h-[220px]">
                  {loadingDoc ? (
                    <div className="py-16 flex flex-col items-center justify-center text-slate-400 gap-2">
                      <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                      <span className="text-xs font-medium">Đang tải và dựng hình các trang tài liệu...</span>
                    </div>
                  ) : totalPages === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-400">
                      Không thể tải trang PDF. Vui lòng kiểm tra lại tệp.
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-y-6">
                      {Array.from({ length: totalPages }, (_, idx) => {
                        const pageNum = idx + 1;
                        const part = getPagePart(pageNum);
                        const isCutAfter = cutPoints.includes(pageNum);
                        const isHovered = hoveredDivider === pageNum;
                        const isAllPagesMode = splitMode === 'all_pages';

                        return (
                          <React.Fragment key={`page-${pageNum}`}>
                            {/* Page Card */}
                            <div className="flex flex-col items-center">
                              {/* Part Tag Header */}
                              {part && (
                                <div className="mb-1.5 flex items-center gap-1">
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${part.colorClass.bg} ${part.colorClass.border} ${part.colorClass.text}`}>
                                    {isAllPagesMode ? `Tệp ${pageNum}` : `Phần ${part.partIndex}`}
                                  </span>
                                </div>
                              )}

                              {/* Page Preview Thumbnail */}
                              <div className={`relative w-[124px] sm:w-[136px] h-[165px] sm:h-[180px] bg-white rounded-xl shadow-sm border-2 transition-all flex flex-col overflow-hidden group select-none ${
                                part ? part.colorClass.border : 'border-slate-200'
                              } hover:shadow-md hover:scale-[1.02]`}>
                                {/* Top page number badge */}
                                <div className="absolute top-2 left-2 z-10 bg-slate-900/80 backdrop-blur-xs text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-sm">
                                  Trang {pageNum}
                                </div>

                                {/* Thumbnail content */}
                                {thumbnails[pageNum] ? (
                                  <img
                                    src={thumbnails[pageNum]}
                                    alt={`Trang ${pageNum}`}
                                    className="w-full h-full object-contain p-1"
                                  />
                                ) : (
                                  <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 text-slate-400 gap-1.5 animate-pulse">
                                    <FileText className="w-6 h-6 opacity-40" />
                                    <span className="text-[10px]">Đang dựng...</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Cut Divider (Between this page and next page) */}
                            {pageNum < totalPages && (
                              <div
                                className="relative flex flex-col items-center justify-center px-2 py-4 h-[190px] group cursor-pointer"
                                onMouseEnter={() => setHoveredDivider(pageNum)}
                                onMouseLeave={() => setHoveredDivider(null)}
                                onClick={() => toggleCut(pageNum)}
                                title={
                                  isAllPagesMode
                                    ? `Mỗi trang là 1 file độc lập`
                                    : isCutAfter
                                    ? `Nhấp để hủy vết cắt sau trang ${pageNum}`
                                    : `Nhấp để cắt sau trang ${pageNum}`
                                }
                              >
                                {/* Vertical Divider Line */}
                                <div
                                  className={`w-0.5 h-full transition-all ${
                                    isAllPagesMode
                                      ? 'border-r-2 border-dashed border-blue-400 opacity-60'
                                      : isCutAfter
                                      ? 'border-r-2 border-dashed border-rose-500 scale-y-105'
                                      : isHovered
                                      ? 'border-r-2 border-dashed border-blue-500'
                                      : 'border-r-2 border-dashed border-slate-300 opacity-40 group-hover:opacity-100 group-hover:border-blue-400'
                                  }`}
                                />

                                {/* Floating Scissors Button / Badge */}
                                <div className="absolute z-20 flex flex-col items-center gap-1 transition-transform">
                                  <div
                                    className={`w-8 h-8 rounded-full flex items-center justify-center shadow-md transition-all ${
                                      isAllPagesMode
                                        ? 'bg-blue-100 text-blue-600 border border-blue-300'
                                        : isCutAfter
                                        ? 'bg-rose-600 text-white ring-4 ring-rose-100 scale-110 shadow-rose-200'
                                        : isHovered
                                        ? 'bg-blue-600 text-white ring-4 ring-blue-100 scale-110 shadow-blue-200'
                                        : 'bg-white text-slate-400 border border-slate-200 group-hover:bg-blue-50 group-hover:text-blue-600 group-hover:border-blue-300'
                                    }`}
                                  >
                                    <Scissors className={`w-4 h-4 transition-transform ${
                                      isCutAfter || isHovered ? '-rotate-90 scale-110' : '-rotate-45'
                                    }`} />
                                  </div>

                                  {/* Status indicator pill */}
                                  <span
                                    className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded transition-all whitespace-nowrap ${
                                      isAllPagesMode
                                        ? 'bg-blue-50 text-blue-700 opacity-80'
                                        : isCutAfter
                                        ? 'bg-rose-500 text-white shadow-xs'
                                        : isHovered
                                        ? 'bg-blue-600 text-white'
                                        : 'opacity-0 group-hover:opacity-100 bg-slate-800 text-white'
                                    }`}
                                  >
                                    {isAllPagesMode ? 'TÁCH' : isCutAfter ? 'ĐÃ CẮT' : 'CẮT'}
                                  </span>
                                </div>
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Pinned Sticky Footer */}
        <div className="flex items-center justify-between gap-3 pt-3.5 border-t border-slate-100 flex-shrink-0 bg-white">
          <div className="text-xs text-slate-500">
            {selectedFile && totalPages > 0 && (
              <span>
                {splitMode === 'all_pages' 
                  ? `Sẽ tạo ra ${totalPages} file PDF (đóng gói ZIP)`
                  : cutPoints.length === 0
                  ? 'Chưa đặt vết cắt nào (nhấp vào các biểu tượng kéo để cắt)'
                  : `Đã cắt thành ${parts.length} file PDF`}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="px-5 py-2.5 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-colors text-sm"
            >
              Hủy
            </button>

            {selectedFile && totalPages > 0 && (
              <button
                type="button"
                onClick={handleSplit}
                disabled={isProcessing || (splitMode === 'custom_cuts' && cutPoints.length === 0 && totalPages > 1)}
                className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
                  isProcessing
                    ? 'bg-blue-400 text-white cursor-wait'
                    : splitMode === 'custom_cuts' && cutPoints.length === 0 && totalPages > 1
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200'
                }`}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang tách file PDF...</span>
                  </>
                ) : (
                  <>
                    <Scissors className="w-4 h-4 -rotate-45" />
                    <span>
                      {splitMode === 'all_pages'
                        ? `Tiến hành Tách (${totalPages} file)`
                        : cutPoints.length === 0 && totalPages > 1
                        ? 'Chưa chọn điểm cắt'
                        : `Tiến hành Tách (${parts.length} file PDF)`}
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};
