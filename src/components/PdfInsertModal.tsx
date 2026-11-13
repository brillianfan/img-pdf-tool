import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  FilePlus2,
  Upload,
  X,
  FileText,
  Loader2,
  ArrowLeftRight,
  ArrowDownToLine,
  Check,
  Sparkles
} from 'lucide-react';
import { motion } from 'motion/react';
import * as pdfjsLib from 'pdfjs-dist';

interface PdfInsertModalProps {
  initialBaseFile?: File | null;
  initialInsertFile?: File | null;
  onClose: () => void;
  onExecuteInsert: (params: {
    baseFile: File;
    insertFile: File;
    insertAfterPage: number; // 0 = before page 1, N = after page N
    insertPageRange: string; // empty = all pages
  }) => Promise<void>;
}

const MAX_THUMBNAILS = 40;

export const PdfInsertModal: React.FC<PdfInsertModalProps> = ({
  initialBaseFile = null,
  initialInsertFile = null,
  onClose,
  onExecuteInsert,
}) => {
  const [baseFile, setBaseFile] = useState<File | null>(initialBaseFile);
  const [insertFile, setInsertFile] = useState<File | null>(initialInsertFile);
  const [basePageCount, setBasePageCount] = useState<number>(0);
  const [insertPageCount, setInsertPageCount] = useState<number>(0);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [loadingBase, setLoadingBase] = useState<boolean>(false);
  const [loadingInsert, setLoadingInsert] = useState<boolean>(false);

  // 0 = before page 1; 1..basePageCount = after page K
  const [insertAfterPage, setInsertAfterPage] = useState<number>(0);
  const [insertPageMode, setInsertPageMode] = useState<'all' | 'custom'>('all');
  const [customInsertPages, setCustomInsertPages] = useState<string>('');

  const [dragOverSlot, setDragOverSlot] = useState<'base' | 'insert' | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const baseInputRef = useRef<HTMLInputElement>(null);
  const insertInputRef = useRef<HTMLInputElement>(null);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Load base PDF page count & progressive thumbnails
  useEffect(() => {
    if (!baseFile) {
      setBasePageCount(0);
      setThumbnails({});
      setInsertAfterPage(0);
      return;
    }

    let cancelled = false;
    setLoadingBase(true);
    setThumbnails({});
    setErrorMsg(null);

    const loadBase = async () => {
      try {
        const buffer = await baseFile.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        if (cancelled) return;

        const count = pdf.numPages;
        setBasePageCount(count);
        setInsertAfterPage(count); // Default: append at end, easy to click anywhere else
        setLoadingBase(false);

        const renderLimit = Math.min(count, MAX_THUMBNAILS);
        for (let i = 1; i <= renderLimit; i++) {
          if (cancelled) break;
          try {
            const page = await pdf.getPage(i);
            const initVp = page.getViewport({ scale: 1 });
            const scale = 116 / initVp.width;
            const vp = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = vp.width;
            canvas.height = vp.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              await page.render({ canvasContext: ctx, viewport: vp } as any).promise;
              if (cancelled) break;
              setThumbnails((prev) => ({ ...prev, [i]: canvas.toDataURL('image/jpeg', 0.78) }));
            }
          } catch (err) {
            console.error(`Failed thumbnail for page ${i}`, err);
          }
        }
      } catch (err) {
        console.error('Failed loading base PDF', err);
        if (!cancelled) {
          setLoadingBase(false);
          setErrorMsg(`Không thể đọc tệp PDF gốc: ${baseFile.name}`);
        }
      }
    };

    loadBase();
    return () => {
      cancelled = true;
    };
  }, [baseFile]);

  // Load insert PDF page count
  useEffect(() => {
    if (!insertFile) {
      setInsertPageCount(0);
      return;
    }

    let cancelled = false;
    setLoadingInsert(true);
    setErrorMsg(null);

    const loadInsert = async () => {
      try {
        const buffer = await insertFile.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        if (cancelled) return;
        setInsertPageCount(pdf.numPages);
        setLoadingInsert(false);
      } catch (err) {
        console.error('Failed loading insert PDF', err);
        if (!cancelled) {
          setLoadingInsert(false);
          setErrorMsg(`Không thể đọc tệp PDF cần chèn: ${insertFile.name}`);
        }
      }
    };

    loadInsert();
    return () => {
      cancelled = true;
    };
  }, [insertFile]);

  const parsedCustomIndices = useMemo(() => {
    if (insertPageMode === 'all' || insertPageCount === 0) return null;
    const pages: number[] = [];
    const parts = customInsertPages.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (trimmed.includes('-')) {
        const [s, e] = trimmed.split('-').map((n) => parseInt(n.trim(), 10));
        if (!isNaN(s) && !isNaN(e)) {
          for (let p = Math.min(s, e); p <= Math.max(s, e); p++) {
            if (p >= 1 && p <= insertPageCount) pages.push(p - 1);
          }
        }
      } else {
        const p = parseInt(trimmed, 10);
        if (!isNaN(p) && p >= 1 && p <= insertPageCount) pages.push(p - 1);
      }
    }
    return [...new Set(pages)].sort((a, b) => a - b);
  }, [insertPageMode, customInsertPages, insertPageCount]);

  const effectiveInsertCount =
    insertPageMode === 'all'
      ? insertPageCount
      : parsedCustomIndices
        ? parsedCustomIndices.length
        : 0;

  const handlePickPdf = (slot: 'base' | 'insert', files: FileList | null) => {
    if (!files || files.length === 0) return;
    const pdf = Array.from(files).find((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (!pdf) {
      setErrorMsg('Vui lòng chỉ chọn tệp định dạng .pdf');
      return;
    }
    setErrorMsg(null);
    if (slot === 'base') {
      setBaseFile(pdf);
    } else {
      setInsertFile(pdf);
    }
  };

  const handleSwapFiles = () => {
    if (!baseFile || !insertFile || isProcessing) return;
    const oldBase = baseFile;
    const oldInsert = insertFile;
    setBaseFile(oldInsert);
    setInsertFile(oldBase);
  };

  const positionLabel =
    basePageCount === 0
      ? ''
      : insertAfterPage === 0
        ? 'Đầu tệp (Trước trang 1)'
        : insertAfterPage >= basePageCount
          ? `Cuối tệp (Sau trang ${basePageCount})`
          : `Sau trang ${insertAfterPage} (Trước trang ${insertAfterPage + 1})`;

  const canSubmit =
    Boolean(baseFile) &&
    Boolean(insertFile) &&
    basePageCount > 0 &&
    insertPageCount > 0 &&
    effectiveInsertCount > 0 &&
    !loadingBase &&
    !loadingInsert &&
    !isProcessing;

  const handleSubmit = async () => {
    if (!canSubmit || !baseFile || !insertFile) return;
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      await onExecuteInsert({
        baseFile,
        insertFile,
        insertAfterPage: Math.max(0, Math.min(insertAfterPage, basePageCount)),
        insertPageRange: insertPageMode === 'custom' ? customInsertPages : '',
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Có lỗi xảy ra khi chèn PDF.');
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
        className="relative bg-white rounded-3xl shadow-2xl p-6 sm:p-7 w-full max-w-4xl max-h-[90vh] flex flex-col z-10"
      >
        <input
          ref={baseInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            handlePickPdf('base', e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={insertInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            handlePickPdf('insert', e.target.files);
            e.target.value = '';
          }}
        />

        {/* Header */}
        <div className="flex items-start justify-between pb-3.5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center shadow-sm">
              <FilePlus2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Chèn PDF vào PDF khác</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Chọn tệp PDF gốc, tệp PDF cần chèn và nhấp vào vị trí bạn muốn chèn giữa các trang
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
        <div className="flex-1 min-h-0 overflow-y-auto py-4 pr-1 space-y-5 custom-scrollbar">
          {/* Two File Pickers Row */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
            {/* Slot 1: Base PDF */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverSlot('base');
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverSlot(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverSlot(null);
                handlePickPdf('base', e.dataTransfer.files);
              }}
              onClick={() => !isProcessing && baseInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-4 cursor-pointer transition-all flex flex-col justify-between gap-2 ${
                dragOverSlot === 'base'
                  ? 'border-teal-500 bg-teal-50/70'
                  : baseFile
                    ? 'border-slate-200 bg-slate-50/80 hover:border-teal-400'
                    : 'border-slate-200 bg-slate-50/50 hover:border-teal-400 hover:bg-teal-50/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  1. Tệp PDF gốc
                </span>
                {baseFile && (
                  <span className="text-[11px] font-semibold text-teal-700 bg-teal-100 px-2 py-0.5 rounded-md">
                    {loadingBase ? 'Đang đọc...' : `${basePageCount} trang`}
                  </span>
                )}
              </div>

              {baseFile ? (
                <div className="flex items-center gap-3 py-1">
                  <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 truncate" title={baseFile.name}>
                      {baseFile.name}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {formatBytes(baseFile.size)} • Bấm để thay đổi
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 py-2 text-slate-500">
                  <div className="w-9 h-9 rounded-xl bg-slate-200/70 text-slate-500 flex items-center justify-center flex-shrink-0">
                    <Upload className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-700">Chọn hoặc kéo thả PDF gốc</p>
                    <p className="text-[11px] text-slate-400">Tệp nền sẽ giữ các trang hiện có</p>
                  </div>
                </div>
              )}
            </div>

            {/* Swap Button */}
            <div className="flex items-center justify-center">
              <button
                type="button"
                disabled={!baseFile || !insertFile || isProcessing}
                onClick={handleSwapFiles}
                title="Đổi chỗ 2 tệp PDF"
                className="p-2.5 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-teal-600 hover:border-teal-300 disabled:opacity-30 transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                <ArrowLeftRight className="w-4 h-4" />
              </button>
            </div>

            {/* Slot 2: Insert PDF */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverSlot('insert');
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverSlot(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverSlot(null);
                handlePickPdf('insert', e.dataTransfer.files);
              }}
              onClick={() => !isProcessing && insertInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-4 cursor-pointer transition-all flex flex-col justify-between gap-2 ${
                dragOverSlot === 'insert'
                  ? 'border-teal-500 bg-teal-50/70'
                  : insertFile
                    ? 'border-teal-200 bg-teal-50/40 hover:border-teal-400'
                    : 'border-slate-200 bg-slate-50/50 hover:border-teal-400 hover:bg-teal-50/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
                  2. Tệp PDF cần chèn
                </span>
                {insertFile && (
                  <span className="text-[11px] font-semibold text-teal-700 bg-teal-100 px-2 py-0.5 rounded-md">
                    {loadingInsert ? 'Đang đọc...' : `${insertPageCount} trang`}
                  </span>
                )}
              </div>

              {insertFile ? (
                <div className="flex items-center gap-3 py-1">
                  <div className="w-9 h-9 rounded-xl bg-teal-100 text-teal-600 flex items-center justify-center flex-shrink-0">
                    <FilePlus2 className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 truncate" title={insertFile.name}>
                      {insertFile.name}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {formatBytes(insertFile.size)} • Bấm để thay đổi
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 py-2 text-slate-500">
                  <div className="w-9 h-9 rounded-xl bg-teal-100/70 text-teal-600 flex items-center justify-center flex-shrink-0">
                    <Upload className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-700">Chọn hoặc kéo thả PDF cần chèn</p>
                    <p className="text-[11px] text-slate-400">Các trang sẽ được đưa vào tệp gốc</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Optional page selection for the inserted PDF */}
          {insertFile && insertPageCount > 1 && (
            <div className="bg-slate-50 rounded-2xl border border-slate-200/80 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600">Trang lấy từ PDF cần chèn:</span>
                <div className="inline-flex rounded-xl bg-white border border-slate-200 p-0.5">
                  <button
                    type="button"
                    onClick={() => setInsertPageMode('all')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      insertPageMode === 'all'
                        ? 'bg-teal-600 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tất cả ({insertPageCount} trang)
                  </button>
                  <button
                    type="button"
                    onClick={() => setInsertPageMode('custom')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      insertPageMode === 'custom'
                        ? 'bg-teal-600 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tùy chọn trang
                  </button>
                </div>
              </div>

              {insertPageMode === 'custom' && (
                <div className="flex items-center gap-2 flex-1 sm:max-w-xs">
                  <input
                    type="text"
                    value={customInsertPages}
                    onChange={(e) => setCustomInsertPages(e.target.value)}
                    placeholder={`Ví dụ: 1, 2-${Math.min(3, insertPageCount)}`}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-teal-500 outline-none"
                  />
                  <span className="text-[11px] font-semibold text-teal-700 whitespace-nowrap">
                    ({effectiveInsertCount} trang)
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Position Selection Section */}
          {baseFile && basePageCount > 0 && (
            <div className="space-y-3">
              {/* Quick Position Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5">
                <div>
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    3. Chọn vị trí chèn trong PDF gốc
                  </p>
                  <p className="text-xs text-teal-700 font-semibold mt-0.5">
                    Vị trí đang chọn: {positionLabel}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setInsertAfterPage(0)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      insertAfterPage === 0
                        ? 'bg-teal-600 text-white border-teal-600 shadow-xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-teal-400'
                    }`}
                  >
                    Đầu tệp
                  </button>

                  <div className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1">
                    <span className="text-xs font-semibold text-slate-600">Sau trang:</span>
                    <input
                      type="number"
                      min={0}
                      max={basePageCount}
                      value={insertAfterPage}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v)) {
                          setInsertAfterPage(Math.max(0, Math.min(v, basePageCount)));
                        } else if (e.target.value === '') {
                          setInsertAfterPage(0);
                        }
                      }}
                      className="w-14 text-center text-xs font-bold text-teal-700 bg-teal-50/70 rounded-lg py-1 outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    <span className="text-[11px] text-slate-400">/ {basePageCount}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setInsertAfterPage(basePageCount)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      insertAfterPage === basePageCount
                        ? 'bg-teal-600 text-white border-teal-600 shadow-xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-teal-400'
                    }`}
                  >
                    Cuối tệp
                  </button>
                </div>
              </div>

              {/* Interactive Visual Page Grid with Clickable Insertion Slots */}
              <div className="bg-slate-50/60 border border-slate-200/70 rounded-2xl p-4">
                <p className="text-[11px] text-slate-500 mb-3 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-teal-600" />
                  <span>
                    Nhấp vào nút <strong className="text-teal-700">+</strong> trước, giữa hoặc sau các trang bên dưới để chọn vị trí chèn trực quan:
                  </span>
                </p>

                <div className="flex flex-wrap items-center gap-y-4">
                  {/* Slot 0: Before Page 1 */}
                  <InsertionSlotButton
                    active={insertAfterPage === 0}
                    insertCount={effectiveInsertCount}
                    label="Trước trang 1"
                    onClick={() => setInsertAfterPage(0)}
                  />

                  {Array.from({ length: basePageCount }, (_, idx) => {
                    const pageNum = idx + 1;
                    const thumb = thumbnails[pageNum];
                    return (
                      <React.Fragment key={pageNum}>
                        <div className="flex flex-col items-center gap-1.5 mx-0.5">
                          <div className="w-24 h-32 bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden flex items-center justify-center relative">
                            {thumb ? (
                              <img
                                src={thumb}
                                alt={`Trang ${pageNum}`}
                                className="w-full h-full object-contain select-none"
                              />
                            ) : pageNum <= MAX_THUMBNAILS ? (
                              <Loader2 className="w-4 h-4 text-slate-300 animate-spin" />
                            ) : (
                              <div className="flex flex-col items-center text-slate-400">
                                <FileText className="w-5 h-5" />
                                <span className="text-[10px] font-semibold mt-1">Trang {pageNum}</span>
                              </div>
                            )}
                            <span className="absolute bottom-1 right-1 bg-slate-800/75 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                              {pageNum}
                            </span>
                          </div>
                        </div>

                        {/* Slot after pageNum */}
                        <InsertionSlotButton
                          active={insertAfterPage === pageNum}
                          insertCount={effectiveInsertCount}
                          label={pageNum === basePageCount ? `Sau trang ${pageNum} (Cuối)` : `Sau trang ${pageNum}`}
                          onClick={() => setInsertAfterPage(pageNum)}
                        />
                      </React.Fragment>
                    );
                  })}
                </div>

                {basePageCount > MAX_THUMBNAILS && (
                  <p className="text-[11px] text-slate-400 mt-3 italic">
                    * Hiển thị ảnh thu nhỏ cho {MAX_THUMBNAILS} trang đầu; các trang còn lại vẫn có thể chọn vị trí chèn bằng ô nhập số trang hoặc nhấp trực tiếp.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Summary */}
          {baseFile && insertFile && basePageCount > 0 && insertPageCount > 0 && (
            <div className="bg-teal-50 border border-teal-200 rounded-2xl p-3.5 flex items-center gap-3 text-xs text-teal-900">
              <div className="w-8 h-8 rounded-xl bg-teal-600 text-white flex items-center justify-center flex-shrink-0">
                <Check className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold">Dự kiến kết quả: </span>
                Chèn <strong>{effectiveInsertCount} trang</strong> từ{' '}
                <strong className="underline">{insertFile.name}</strong> vào{' '}
                <strong>{positionLabel}</strong> của tệp{' '}
                <strong className="underline">{baseFile.name}</strong> (Tổng sau khi chèn:{' '}
                <strong>{basePageCount + effectiveInsertCount} trang</strong>).
              </div>
            </div>
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
            disabled={!canSubmit}
            onClick={handleSubmit}
            className={`flex-1 px-6 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
              !canSubmit
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                : 'bg-teal-600 text-white hover:bg-teal-700 shadow-lg shadow-teal-200 cursor-pointer'
            }`}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Đang chèn PDF...</span>
              </>
            ) : !baseFile ? (
              <span>Chọn tệp PDF gốc</span>
            ) : !insertFile ? (
              <span>Chọn tệp PDF cần chèn</span>
            ) : effectiveInsertCount === 0 ? (
              <span>Số trang cần chèn không hợp lệ</span>
            ) : (
              <span>Tiến hành Chèn ({basePageCount + effectiveInsertCount} trang)</span>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

interface InsertionSlotButtonProps {
  active: boolean;
  insertCount: number;
  label: string;
  onClick: () => void;
}

const InsertionSlotButton: React.FC<InsertionSlotButtonProps> = ({
  active,
  insertCount,
  label,
  onClick,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Chèn vào vị trí: ${label}`}
      className={`group relative flex flex-col items-center justify-center transition-all cursor-pointer mx-1 ${
        active ? 'w-14 h-32' : 'w-6 h-32 hover:w-10'
      }`}
    >
      <div
        className={`w-0.5 h-full rounded-full transition-all ${
          active
            ? 'bg-teal-600 w-1 shadow-sm shadow-teal-300'
            : 'bg-slate-200 group-hover:bg-teal-400'
        }`}
      />
      <div
        className={`absolute flex flex-col items-center justify-center rounded-xl transition-all shadow-xs ${
          active
            ? 'bg-teal-600 text-white px-2 py-2 shadow-md shadow-teal-200 scale-105'
            : 'bg-white border border-slate-200 text-slate-400 group-hover:border-teal-500 group-hover:text-teal-600 group-hover:scale-110 w-6 h-6'
        }`}
      >
        {active ? (
          <>
            <ArrowDownToLine className="w-4 h-4" />
            <span className="text-[9px] font-bold leading-tight mt-0.5 whitespace-nowrap">
              {insertCount > 0 ? `+${insertCount} tr` : 'Chèn'}
            </span>
          </>
        ) : (
          <span className="text-xs font-bold leading-none">+</span>
        )}
      </div>
    </button>
  );
};
