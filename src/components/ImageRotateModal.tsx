import React, { useState, useEffect, useRef } from 'react';
import {
  RotateCw,
  RotateCcw,
  Upload,
  X,
  Trash2,
  Plus,
  Image as ImageIcon,
  ShieldCheck,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { motion } from 'motion/react';

export interface RotateImageItem {
  id: string;
  file: File;
  previewUrl: string;
  angle: number; // Cumulative degrees for smooth CSS transition; normalized mod 360 when executing
  width?: number;
  height?: number;
  previewError?: boolean;
}

interface ImageRotateModalProps {
  initialFiles?: File[];
  onClose: () => void;
  onExecuteRotate: (items: { file: File; angle: number }[]) => Promise<void>;
}

const IMAGE_EXT_REGEX = /\.(jpe?g|png|webp|gif|bmp|tiff?|jfif|heic|heif|avif)$/i;

const isSupportedImageFile = (file: File) => {
  return file.type.startsWith('image/') || IMAGE_EXT_REGEX.test(file.name);
};

export const ImageRotateModal: React.FC<ImageRotateModalProps> = ({
  initialFiles = [],
  onClose,
  onExecuteRotate,
}) => {
  const [items, setItems] = useState<RotateImageItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<RotateImageItem[]>([]);

  itemsRef.current = items;

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const normalizeAngle = (angle: number) => ((angle % 360) + 360) % 360;

  const addFiles = (newFiles: File[]) => {
    setErrorMsg(null);
    const valid = newFiles.filter(isSupportedImageFile);
    if (valid.length === 0) {
      setErrorMsg('Vui lòng chỉ chọn các tệp hình ảnh hợp lệ (JPG, PNG, WebP, TIFF, GIF, BMP, HEIC...).');
      return;
    }
    if (valid.length < newFiles.length) {
      setErrorMsg('Một số tệp không phải hình ảnh đã được bỏ qua.');
    }

    const mapped: RotateImageItem[] = valid.map((file, idx) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      angle: 0,
    }));

    setItems((prev) => [...prev, ...mapped]);
  };

  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      addFiles(initialFiles);
    }
    return () => {
      itemsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeItem = (id: string) => {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((i) => i.id !== id);
    });
  };

  const clearAll = () => {
    items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setItems([]);
    setErrorMsg(null);
  };

  const rotateAllBy = (delta: number) => {
    setErrorMsg(null);
    setItems((prev) => prev.map((item) => ({ ...item, angle: item.angle + delta })));
  };

  const resetAllAngles = () => {
    setErrorMsg(null);
    setItems((prev) => prev.map((item) => ({ ...item, angle: 0 })));
  };

  const rotateItemBy = (id: string, delta: number) => {
    setErrorMsg(null);
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, angle: item.angle + delta } : item))
    );
  };

  const handleImageLoad = (id: string, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, width: img.naturalWidth, height: img.naturalHeight, previewError: false }
            : item
        )
      );
    }
  };

  const handleImageError = (id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, previewError: true } : item))
    );
  };

  const rotatedCount = items.filter((item) => normalizeAngle(item.angle) !== 0).length;

  const handleSubmit = async () => {
    if (items.length === 0 || isProcessing) return;
    if (rotatedCount === 0) {
      setErrorMsg('Vui lòng chọn góc xoay cho ít nhất 1 ảnh trước khi lưu.');
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);
    try {
      await onExecuteRotate(
        items.map((item) => ({
          file: item.file,
          angle: normalizeAngle(item.angle),
        }))
      );
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Có lỗi xảy ra khi xoay ảnh.');
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
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.heic,.heif,.jfif,.tif,.tiff,.bmp,.webp,.avif,.gif"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              addFiles(Array.from(e.target.files));
              e.target.value = '';
            }
          }}
        />

        {/* Header */}
        <div className="flex items-start justify-between pb-3.5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-sm">
              <RotateCw className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">
                Xoay ảnh (Giữ nguyên kích thước & chất lượng gốc)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>Không nén giảm chất lượng, không thu nhỏ kích thước pixel và giữ nguyên mật độ DPI gốc.</span>
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
          {/* Upload / Drop zone */}
          {items.length === 0 ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragOver(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  addFiles(Array.from(e.dataTransfer.files));
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 ${
                isDragOver
                  ? 'border-indigo-500 bg-indigo-50/70 scale-[1.01]'
                  : 'border-slate-200 bg-slate-50/70 hover:bg-slate-50 hover:border-indigo-400'
              }`}
            >
              <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
                <Upload className="w-7 h-7" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-800">
                  Bấm để chọn ảnh từ máy tính hoặc kéo thả ảnh vào đây
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Hỗ trợ nhiều ảnh cùng lúc (JPG, PNG, WebP, TIFF, GIF, BMP, HEIC...)
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold shadow-sm hover:bg-indigo-700 transition-colors mt-1">
                <Plus className="w-4 h-4" />
                <span>Chọn tệp ảnh</span>
              </div>
            </div>
          ) : (
            <>
              {/* Compact top bar: Add more + Global Rotate Controls */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragOver(false);
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    addFiles(Array.from(e.dataTransfer.files));
                  }
                }}
                className={`rounded-2xl border p-3.5 transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                  isDragOver
                    ? 'border-indigo-500 bg-indigo-50/60'
                    : 'border-slate-200 bg-slate-50/80'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mr-1">
                    Xoay tất cả:
                  </span>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => rotateAllBy(-90)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-indigo-400 hover:text-indigo-700 text-slate-700 rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Trái 90°</span>
                  </button>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => rotateAllBy(90)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-indigo-400 hover:text-indigo-700 text-slate-700 rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Phải 90°</span>
                  </button>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => rotateAllBy(180)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-indigo-400 hover:text-indigo-700 text-slate-700 rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Xoay 180°</span>
                  </button>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={resetAllAngles}
                    className="inline-flex items-center gap-1 px-2.5 py-2 text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                  >
                    <span>Đặt lại 0°</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 self-end md:self-auto">
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-semibold shadow-sm hover:bg-indigo-700 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm ảnh</span>
                  </button>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={clearAll}
                    className="inline-flex items-center gap-1 px-3 py-2 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xóa hết</span>
                  </button>
                </div>
              </div>

              {/* Status / Summary info */}
              <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                <span>
                  Đã chọn <strong className="text-slate-700">{items.length}</strong> ảnh • Tổng dung lượng:{' '}
                  <strong className="text-slate-700">
                    {formatBytes(items.reduce((acc, i) => acc + i.file.size, 0))}
                  </strong>
                </span>
                <span className="text-slate-400 hidden sm:inline">
                  Có thể xoay từng ảnh riêng lẻ bên dưới
                </span>
              </div>

              {/* Image Preview Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((item) => {
                  const norm = normalizeAngle(item.angle);
                  const isSwapped = norm === 90 || norm === 270;
                  const outW = item.width && item.height ? (isSwapped ? item.height : item.width) : undefined;
                  const outH = item.width && item.height ? (isSwapped ? item.width : item.height) : undefined;

                  return (
                    <div
                      key={item.id}
                      className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-col gap-3 hover:border-indigo-300 transition-colors shadow-2xs"
                    >
                      {/* Square preview box so rotated image never overflows */}
                      <div className="relative w-full aspect-square bg-slate-100/80 rounded-xl overflow-hidden flex items-center justify-center p-3 border border-slate-100">
                        {item.previewError ? (
                          <div className="flex flex-col items-center gap-1.5 text-slate-400">
                            <ImageIcon className="w-10 h-10" />
                            <span className="text-[11px] font-medium">Không xem trước được định dạng này</span>
                          </div>
                        ) : (
                          <img
                            src={item.previewUrl}
                            alt={item.file.name}
                            onLoad={(e) => handleImageLoad(item.id, e)}
                            onError={() => handleImageError(item.id)}
                            style={{ transform: `rotate(${item.angle}deg)` }}
                            className="w-full h-full object-contain transition-transform duration-300 ease-out select-none"
                          />
                        )}

                        {/* Angle badge */}
                        <div
                          className={`absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[11px] font-bold shadow-xs ${
                            norm === 0
                              ? 'bg-slate-800/70 text-white'
                              : 'bg-indigo-600 text-white'
                          }`}
                        >
                          {norm === 0 ? 'Gốc (0°)' : `${norm}°`}
                        </div>

                        {/* Remove button */}
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => removeItem(item.id)}
                          title="Xóa ảnh này"
                          className="absolute top-2 right-2 p-1.5 bg-white/90 hover:bg-rose-50 text-slate-500 hover:text-rose-600 rounded-lg shadow-xs transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* File metadata */}
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs font-bold text-slate-800 truncate" title={item.file.name}>
                          {item.file.name}
                        </p>
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span>{formatBytes(item.file.size)}</span>
                          {outW && outH && (
                            <span className="font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                              {outW} × {outH} px
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Per-image rotate buttons */}
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => rotateItemBy(item.id, -90)}
                          className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-slate-50 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 text-xs font-semibold transition-colors cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Trái 90°</span>
                        </button>
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => rotateItemBy(item.id, 90)}
                          className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-slate-50 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 text-xs font-semibold transition-colors cursor-pointer"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                          <span>Phải 90°</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
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
            disabled={items.length === 0 || rotatedCount === 0 || isProcessing}
            onClick={handleSubmit}
            className={`flex-1 px-6 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
              items.length === 0 || rotatedCount === 0 || isProcessing
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200 cursor-pointer'
            }`}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Đang xử lý ảnh gốc...</span>
              </>
            ) : items.length === 0 ? (
              <span>Chưa chọn ảnh</span>
            ) : rotatedCount === 0 ? (
              <span>Chọn góc xoay để lưu</span>
            ) : (
              <span>Xoay & Tải về ({items.length} ảnh)</span>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
