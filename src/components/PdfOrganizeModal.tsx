import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Layers,
  RotateCw,
  RotateCcw,
  Trash2,
  Undo2,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Upload,
  X,
  FileText,
  Loader2,
  GripVertical,
  Check,
  RefreshCw
} from 'lucide-react';
import { motion } from 'motion/react';
import * as pdfjsLib from 'pdfjs-dist';

export interface OrganizedPdfPage {
  id: string;
  originalIndex: number; // 0-based page index in source PDF
  originalPageNum: number; // 1-based display number
  rotation: number; // Cumulative degrees for smooth CSS preview; normalized mod 360 on export
  deleted: boolean;
  selected: boolean;
}

interface PdfOrganizeModalProps {
  initialFile?: File | null;
  onClose: () => void;
  onExecuteOrganize: (
    file: File,
    pages: { originalIndex: number; rotation: number }[]
  ) => Promise<void>;
}

const MAX_THUMBNAILS = 60;

export const PdfOrganizeModal: React.FC<PdfOrganizeModalProps> = ({
  initialFile = null,
  onClose,
  onExecuteOrganize,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(initialFile);
  const [pages, setPages] = useState<OrganizedPdfPage[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [isDragOverFile, setIsDragOverFile] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Drag & drop reorder state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Quick custom page order / range input
  const [customOrderInput, setCustomOrderInput] = useState('');
  const [showDeleted, setShowDeleted] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const normalizeAngle = (angle: number) => ((angle % 360) + 360) % 360;

  // Load PDF & render progressive thumbnails
  useEffect(() => {
    if (!selectedFile) {
      setPages([]);
      setThumbnails({});
      setCustomOrderInput('');
      return;
    }

    let cancelled = false;
    setLoadingDoc(true);
    setPages([]);
    setThumbnails({});
    setErrorMsg(null);
    setCustomOrderInput('');

    const loadPdf = async () => {
      try {
        const buffer = await selectedFile.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        if (cancelled) return;

        const count = pdf.numPages;
        const initPages: OrganizedPdfPage[] = Array.from({ length: count }, (_, idx) => ({
          id: `page-${idx + 1}`,
          originalIndex: idx,
          originalPageNum: idx + 1,
          rotation: 0,
          deleted: false,
          selected: false,
        }));
        setPages(initPages);
        setLoadingDoc(false);

        const renderLimit = Math.min(count, MAX_THUMBNAILS);
        for (let i = 1; i <= renderLimit; i++) {
          if (cancelled) break;
          try {
            const page = await pdf.getPage(i);
            const initVp = page.getViewport({ scale: 1 });
            const scale = 150 / initVp.width;
            const vp = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = vp.width;
            canvas.height = vp.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              await page.render({ canvasContext: ctx, viewport: vp } as any).promise;
              if (cancelled) break;
              setThumbnails((prev) => ({ ...prev, [i]: canvas.toDataURL('image/jpeg', 0.8) }));
            }
          } catch (err) {
            console.error(`Thumbnail error on page ${i}`, err);
          }
        }
      } catch (err) {
        console.error('Failed loading PDF for organize', err);
        if (!cancelled) {
          setLoadingDoc(false);
          setErrorMsg(`Không thể đọc tệp PDF: ${selectedFile.name}`);
        }
      }
    };

    loadPdf();
    return () => {
      cancelled = true;
    };
  }, [selectedFile]);

  const handleFileDropOrPick = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const pdf = Array.from(files).find((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (!pdf) {
      setErrorMsg('Vui lòng chỉ chọn tệp định dạng .pdf.');
      return;
    }
    setSelectedFile(pdf);
  };

  const activePages = useMemo(() => pages.filter((p) => !p.deleted), [pages]);
  const deletedCount = pages.length - activePages.length;
  const selectedActiveCount = useMemo(
    () => pages.filter((p) => !p.deleted && p.selected).length,
    [pages]
  );

  // Batch rotation: applies to selected active pages if any are selected, else all active pages
  const rotateTargetPages = (delta: number) => {
    setErrorMsg(null);
    const hasSelection = pages.some((p) => !p.deleted && p.selected);
    setPages((prev) =>
      prev.map((p) => {
        if (p.deleted) return p;
        if (hasSelection && !p.selected) return p;
        return { ...p, rotation: p.rotation + delta };
      })
    );
  };

  const rotateSinglePage = (id: string, delta: number) => {
    setErrorMsg(null);
    setPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, rotation: p.rotation + delta } : p))
    );
  };

  const toggleDeletePage = (id: string) => {
    setErrorMsg(null);
    setPages((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, deleted: !p.deleted, selected: !p.deleted ? false : p.selected }
          : p
      )
    );
  };

  const deleteSelectedPages = () => {
    if (selectedActiveCount === 0) return;
    setErrorMsg(null);
    setPages((prev) =>
      prev.map((p) => (p.selected && !p.deleted ? { ...p, deleted: true, selected: false } : p))
    );
  };

  const restoreAllDeleted = () => {
    setErrorMsg(null);
    setPages((prev) => prev.map((p) => ({ ...p, deleted: false })));
  };

  const toggleSelectPage = (id: string) => {
    setPages((prev) =>
      prev.map((p) => (p.id === id && !p.deleted ? { ...p, selected: !p.selected } : p))
    );
  };

  const selectScope = (scope: 'all' | 'odd' | 'even' | 'none') => {
    setPages((prev) => {
      let activeOrderIdx = 0;
      return prev.map((p) => {
        if (p.deleted) return { ...p, selected: false };
        activeOrderIdx++;
        if (scope === 'none') return { ...p, selected: false };
        if (scope === 'all') return { ...p, selected: true };
        if (scope === 'odd') return { ...p, selected: activeOrderIdx % 2 === 1 };
        return { ...p, selected: activeOrderIdx % 2 === 0 };
      });
    });
  };

  const movePage = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= pages.length || fromIndex === toIndex) return;
    setPages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const reversePageOrder = () => {
    setErrorMsg(null);
    setPages((prev) => [...prev].reverse());
  };

  const resetAllChanges = () => {
    setErrorMsg(null);
    setCustomOrderInput('');
    setPages((prev) =>
      [...prev]
        .sort((a, b) => a.originalIndex - b.originalIndex)
        .map((p) => ({ ...p, rotation: 0, deleted: false, selected: false }))
    );
  };

  // Apply custom page order like "3, 1, 2, 5-4"
  const applyCustomOrder = () => {
    const raw = customOrderInput.trim();
    if (!raw || pages.length === 0) return;
    setErrorMsg(null);

    const total = pages.length;
    const pickedNums: number[] = [];
    const parts = raw.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (trimmed.includes('-')) {
        const [s, e] = trimmed.split('-').map((n) => parseInt(n.trim(), 10));
        if (!isNaN(s) && !isNaN(e)) {
          const step = s <= e ? 1 : -1;
          for (let n = s; step > 0 ? n <= e : n >= e; n += step) {
            if (n >= 1 && n <= total) pickedNums.push(n);
          }
        }
      } else {
        const n = parseInt(trimmed, 10);
        if (!isNaN(n) && n >= 1 && n <= total) pickedNums.push(n);
      }
    }

    const uniqueOrdered = Array.from(new Set(pickedNums));
    if (uniqueOrdered.length === 0) {
      setErrorMsg(`Vui lòng nhập thứ tự trang hợp lệ từ 1 đến ${total} (ví dụ: 3, 1, 2, 4-${total}).`);
      return;
    }

    const byOrigNum = new Map<number, OrganizedPdfPage>();
    pages.forEach((p) => byOrigNum.set(p.originalPageNum, p));

    const keptSet = new Set(uniqueOrdered);
    const reorderedActive: OrganizedPdfPage[] = uniqueOrdered
      .map((num) => byOrigNum.get(num)!)
      .filter(Boolean)
      .map((p) => ({ ...p, deleted: false }));

    const omittedAsDeleted: OrganizedPdfPage[] = pages
      .filter((p) => !keptSet.has(p.originalPageNum))
      .sort((a, b) => a.originalIndex - b.originalIndex)
      .map((p) => ({ ...p, deleted: true, selected: false }));

    setPages([...reorderedActive, ...omittedAsDeleted]);
  };

  // Native HTML5 grid drag & drop handlers
  const handleCardDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleCardDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedId && draggedId !== targetId) {
      setDragOverId(targetId);
    }
  };

  const handleCardDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = draggedId || e.dataTransfer.getData('text/plain');
    setDraggedId(null);
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;

    setPages((prev) => {
      const fromIdx = prev.findIndex((p) => p.id === sourceId);
      const toIdx = prev.findIndex((p) => p.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const handleCardDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const visiblePages = showDeleted ? pages : activePages;

  // Map active page sequential number (1, 2, 3...) for display
  const activeSequenceMap = useMemo(() => {
    const map = new Map<string, number>();
    let seq = 1;
    pages.forEach((p) => {
      if (!p.deleted) {
        map.set(p.id, seq++);
      }
    });
    return map;
  }, [pages]);

  const hasAnyChanges = useMemo(() => {
    if (deletedCount > 0) return true;
    return pages.some(
      (p, idx) => p.originalIndex !== idx || normalizeAngle(p.rotation) !== 0
    );
  }, [pages, deletedCount]);

  const handleSubmit = async () => {
    if (!selectedFile || activePages.length === 0 || isProcessing) return;
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      await onExecuteOrganize(
        selectedFile,
        activePages.map((p) => ({
          originalIndex: p.originalIndex,
          rotation: normalizeAngle(p.rotation),
        }))
      );
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Có lỗi xảy ra khi lưu tệp PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => !isProcessing && onClose()}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="relative bg-white rounded-3xl shadow-2xl p-6 sm:p-7 w-full max-w-5xl max-h-[92vh] flex flex-col z-10"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            handleFileDropOrPick(e.target.files);
            e.target.value = '';
          }}
        />

        {/* Header */}
        <div className="flex items-start justify-between pb-3.5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-sm">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">
                Sắp xếp, Xoay & Xóa trang PDF
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Kéo thả để sắp xếp lại thứ tự trang, xoay góc 90°/180°/270° hoặc xóa các trang không mong muốn trong một lần xử lý
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isProcessing}
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto py-4 pr-1 space-y-4 custom-scrollbar">
          {!selectedFile ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragOverFile(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragOverFile(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragOverFile(false);
                handleFileDropOrPick(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 ${
                isDragOverFile
                  ? 'border-blue-500 bg-blue-50/70 scale-[1.01]'
                  : 'border-slate-200 bg-slate-50/70 hover:bg-slate-50 hover:border-blue-400'
              }`}
            >
              <div className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center">
                <Upload className="w-7 h-7" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-800">
                  Bấm để tải tệp PDF lên hoặc kéo thả vào đây
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Tất cả trang PDF sẽ hiển thị trực quan để bạn sắp xếp, xoay hoặc xóa tùy ý
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-semibold shadow-sm hover:bg-blue-700 transition-colors mt-1">
                Chọn tệp PDF
              </span>
            </div>
          ) : (
            <>
              {/* File Info Bar */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate max-w-[240px] sm:max-w-md" title={selectedFile.name}>
                      {selectedFile.name}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {formatBytes(selectedFile.size)} • Gốc: <strong>{pages.length}</strong> trang • Còn lại:{' '}
                      <strong className="text-blue-700">{activePages.length}</strong> trang
                      {deletedCount > 0 && (
                        <span className="text-rose-600 ml-1">({deletedCount} trang đã xóa)</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={resetAllChanges}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span>Khôi phục ban đầu</span>
                  </button>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Đổi tệp PDF</span>
                  </button>
                </div>
              </div>

              {/* Combined Controls Toolbar */}
              {!loadingDoc && pages.length > 0 && (
                <div className="bg-slate-50/90 border border-slate-200/80 rounded-2xl p-3.5 space-y-3">
                  {/* Row 1: Selection + Rotate + Delete */}
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">
                        Chọn nhanh:
                      </span>
                      <button
                        type="button"
                        onClick={() => selectScope('all')}
                        className="px-2.5 py-1 bg-white border border-slate-200 hover:border-blue-400 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        Tất cả
                      </button>
                      <button
                        type="button"
                        onClick={() => selectScope('odd')}
                        className="px-2.5 py-1 bg-white border border-slate-200 hover:border-blue-400 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        Trang lẻ
                      </button>
                      <button
                        type="button"
                        onClick={() => selectScope('even')}
                        className="px-2.5 py-1 bg-white border border-slate-200 hover:border-blue-400 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        Trang chẵn
                      </button>
                      {selectedActiveCount > 0 && (
                        <button
                          type="button"
                          onClick={() => selectScope('none')}
                          className="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold cursor-pointer"
                        >
                          Bỏ chọn ({selectedActiveCount})
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">
                        {selectedActiveCount > 0 ? `Xoay ${selectedActiveCount} trang:` : 'Xoay tất cả:'}
                      </span>
                      <button
                        type="button"
                        onClick={() => rotateTargetPages(-90)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-700 rounded-lg text-xs font-bold cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Trái 90°</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => rotateTargetPages(90)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-700 rounded-lg text-xs font-bold cursor-pointer"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>Phải 90°</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => rotateTargetPages(180)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-700 rounded-lg text-xs font-bold cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>180°</span>
                      </button>

                      {selectedActiveCount > 0 && (
                        <button
                          type="button"
                          onClick={deleteSelectedPages}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer ml-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Xóa ({selectedActiveCount})</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Reorder controls & custom order */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2.5 border-t border-slate-200/70">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={reversePageOrder}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-700 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                      >
                        <ArrowUpDown className="w-3.5 h-3.5" />
                        <span>Đảo ngược thứ tự</span>
                      </button>

                      {deletedCount > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={restoreAllDeleted}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-bold cursor-pointer"
                          >
                            <Undo2 className="w-3.5 h-3.5" />
                            <span>Khôi phục {deletedCount} trang đã xóa</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowDeleted((v) => !v)}
                            className="px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                          >
                            {showDeleted ? 'Ẩn trang đã xóa' : 'Hiện trang đã xóa'}
                          </button>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-1 sm:max-w-sm">
                      <input
                        type="text"
                        value={customOrderInput}
                        onChange={(e) => setCustomOrderInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && applyCustomOrder()}
                        placeholder={`Thứ tự tùy chỉnh (vd: ${pages.length > 2 ? `3, 1, 2, 4-${pages.length}` : '2, 1'})`}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={applyCustomOrder}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer"
                      >
                        Áp dụng
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Loading State */}
              {loadingDoc ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-500">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                  <p className="text-sm font-semibold">Đang tải các trang PDF...</p>
                </div>
              ) : (
                /* Interactive 2D Draggable Page Grid */
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                  {visiblePages.map((page) => {
                    const actualIdx = pages.findIndex((p) => p.id === page.id);
                    const normRot = normalizeAngle(page.rotation);
                    const activeSeq = activeSequenceMap.get(page.id);
                    const thumb = thumbnails[page.originalPageNum];
                    const isDropTarget = dragOverId === page.id;
                    const isBeingDragged = draggedId === page.id;

                    return (
                      <div
                        key={page.id}
                        draggable={!isProcessing}
                        onDragStart={(e) => handleCardDragStart(e, page.id)}
                        onDragOver={(e) => handleCardDragOver(e, page.id)}
                        onDrop={(e) => handleCardDrop(e, page.id)}
                        onDragEnd={handleCardDragEnd}
                        className={`relative rounded-2xl border p-2.5 flex flex-col gap-2 transition-all select-none ${
                          page.deleted
                            ? 'bg-rose-50/40 border-rose-200 opacity-70'
                            : page.selected
                              ? 'bg-blue-50/60 border-blue-500 ring-2 ring-blue-200 shadow-sm'
                              : isDropTarget
                                ? 'bg-blue-50/40 border-blue-500 border-dashed scale-[1.02]'
                                : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-sm'
                        } ${isBeingDragged ? 'opacity-40 scale-95' : ''}`}
                      >
                        {/* Top Card Row: Drag Handle + Order/Selection + Delete */}
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1 min-w-0">
                            <span
                              title="Kéo thả để thay đổi vị trí trang"
                              className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-blue-500 p-0.5"
                            >
                              <GripVertical className="w-4 h-4" />
                            </span>

                            {!page.deleted ? (
                              <button
                                type="button"
                                onClick={() => toggleSelectPage(page.id)}
                                title="Chọn trang này để thao tác hàng loạt"
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                                  page.selected
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-100 text-slate-700 hover:bg-blue-100 hover:text-blue-700'
                                }`}
                              >
                                {page.selected && <Check className="w-3 h-3" />}
                                <span>#{activeSeq}</span>
                              </button>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded-md text-[11px] font-bold bg-rose-100 text-rose-700">
                                Đã xóa
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleDeletePage(page.id)}
                            title={page.deleted ? 'Khôi phục trang này' : 'Xóa trang này'}
                            className={`p-1 rounded-lg transition-colors cursor-pointer ${
                              page.deleted
                                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                            }`}
                          >
                            {page.deleted ? (
                              <Undo2 className="w-3.5 h-3.5" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        {/* Square Thumbnail Preview Container */}
                        <div
                          onClick={() => !page.deleted && toggleSelectPage(page.id)}
                          className={`relative w-full aspect-square bg-slate-100/80 rounded-xl overflow-hidden flex items-center justify-center p-2 border border-slate-100 ${
                            !page.deleted ? 'cursor-pointer' : ''
                          }`}
                        >
                          {thumb ? (
                            <img
                              src={thumb}
                              alt={`Trang ${page.originalPageNum}`}
                              style={{ transform: `rotate(${page.rotation}deg)` }}
                              className="w-full h-full object-contain transition-transform duration-300 ease-out pointer-events-none"
                            />
                          ) : (
                            <div
                              style={{ transform: `rotate(${page.rotation}deg)` }}
                              className="flex flex-col items-center justify-center text-slate-400 transition-transform duration-300"
                            >
                              <FileText className="w-8 h-8" />
                              <span className="text-[11px] font-bold mt-1">
                                Trang {page.originalPageNum}
                              </span>
                            </div>
                          )}

                          {/* Original Page Badge */}
                          <span className="absolute bottom-1.5 left-1.5 bg-slate-800/75 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">
                            Gốc: {page.originalPageNum}
                          </span>

                          {/* Rotation Badge */}
                          {normRot !== 0 && !page.deleted && (
                            <span className="absolute top-1.5 right-1.5 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs">
                              {normRot}°
                            </span>
                          )}

                          {/* Deleted Overlay */}
                          {page.deleted && (
                            <div className="absolute inset-0 bg-rose-900/20 flex items-center justify-center">
                              <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow">
                                Sẽ bị xóa
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Bottom Per-Page Controls: Move Left/Right & Rotate Left/Right */}
                        <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-100">
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              disabled={actualIdx <= 0}
                              onClick={() => movePage(actualIdx, actualIdx - 1)}
                              title="Di chuyển lên trước"
                              className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed"
                            >
                              <ArrowLeft className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={actualIdx >= pages.length - 1}
                              onClick={() => movePage(actualIdx, actualIdx + 1)}
                              title="Di chuyển ra sau"
                              className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed"
                            >
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              disabled={page.deleted}
                              onClick={() => rotateSinglePage(page.id, -90)}
                              title="Xoay trái 90°"
                              className="p-1 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={page.deleted}
                              onClick={() => rotateSinglePage(page.id, 90)}
                              title="Xoay phải 90°"
                              className="p-1 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Sticky Footer */}
        <div className="flex gap-3 pt-3.5 border-t border-slate-100 flex-shrink-0 bg-white mt-1">
          <button
            type="button"
            disabled={isProcessing}
            onClick={onClose}
            className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={!selectedFile || activePages.length === 0 || loadingDoc || isProcessing}
            onClick={handleSubmit}
            className={`flex-1 px-6 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
              !selectedFile || activePages.length === 0 || loadingDoc || isProcessing
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200 cursor-pointer'
            }`}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Đang xuất tệp PDF...</span>
              </>
            ) : !selectedFile ? (
              <span>Chưa chọn tệp PDF</span>
            ) : activePages.length === 0 ? (
              <span>Cần giữ lại ít nhất 1 trang</span>
            ) : (
              <span>
                {hasAnyChanges
                  ? `Lưu PDF mới (${activePages.length} trang)`
                  : `Xuất PDF (${activePages.length} trang)`}
              </span>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
