import React, { useState, useCallback, useRef } from 'react';
import { 
  FileImage, 
  FileText, 
  Globe, 
  Sparkles, 
  TrendingDown, 
  Package, 
  Upload, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Download,
  Settings2,
  FileArchive,
  Plus,
  Scissors,
  Trash2,
  RefreshCw,
  Image as ImageIcon,
  X,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';

// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Set up PDF.js worker using Vite's URL import
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

type ToolAction = 
  | 'IMG_TO_PDF' 
  | 'PDF_TO_IMG' 
  | 'EXTRACT_PAGES' 
  | 'COMPRESS_PDF' 
  | 'CONVERT_IMAGE' 
  | 'MERGE_PDF' 
  | 'SPLIT_PDF' 
  | 'DELETE_PAGES';

interface Tool {
  id: ToolAction;
  title: string;
  icon: React.ReactNode;
  description: string;
  accept: string;
  multiple?: boolean;
}

const TOOLS: Tool[] = [
  { 
    id: 'IMG_TO_PDF', 
    title: 'Nén và chuyển sang PDF', 
    icon: <FileText className="w-10 h-10 text-slate-700" />, 
    description: 'Chuyển đổi và nén ảnh sang định dạng PDF',
    accept: 'image/*',
    multiple: true
  },
  { 
    id: 'PDF_TO_IMG', 
    title: 'PDF sang Ảnh (JPG)', 
    icon: <FileImage className="w-10 h-10 text-slate-700" />, 
    description: 'Tách các trang PDF thành các file ảnh (tải về file ZIP)',
    accept: '.pdf'
  },
  { 
    id: 'EXTRACT_PAGES', 
    title: 'Trích xuất trang PDF', 
    icon: <FileText className="w-10 h-10 text-slate-700" />, 
    description: 'Lấy các trang cụ thể từ tệp PDF của bạn',
    accept: '.pdf'
  },
  { 
    id: 'COMPRESS_PDF', 
    title: 'Nén tệp PDF', 
    icon: <FileArchive className="w-10 h-10 text-slate-700" />, 
    description: 'Giảm dung lượng tệp PDF mà vẫn giữ chất lượng',
    accept: '.pdf'
  },
  { 
    id: 'CONVERT_IMAGE', 
    title: 'Chuyển sang Ảnh (JPG/PNG)', 
    icon: <ImageIcon className="w-10 h-10 text-slate-700" />, 
    description: 'Chuyển đổi qua lại giữa JPG và PNG',
    accept: 'image/*'
  },
  { 
    id: 'MERGE_PDF', 
    title: 'Gộp nhiều PDF', 
    icon: <Plus className="w-10 h-10 text-slate-700" />, 
    description: 'Ghép nhiều tệp PDF thành một tệp duy nhất',
    accept: '.pdf',
    multiple: true
  },
  { 
    id: 'SPLIT_PDF', 
    title: 'Tách 1 PDF thành nhiều trang', 
    icon: <Scissors className="w-10 h-10 text-slate-700" />, 
    description: 'Chia nhỏ tệp PDF thành từng trang riêng lẻ',
    accept: '.pdf'
  },
  { 
    id: 'DELETE_PAGES', 
    title: 'Xóa trang PDF', 
    icon: <Trash2 className="w-10 h-10 text-slate-700" />, 
    description: 'Loại bỏ các trang không mong muốn khỏi PDF',
    accept: '.pdf'
  },
];

export default function App() {
  const [quality, setQuality] = useState(85);
  const [dpi, setDpi] = useState(300);
  const [status, setStatus] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'loading' } | null>(null);
  const [isDragging, setIsDragging] = useState<ToolAction | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTool, setActiveTool] = useState<ToolAction | null>(null);
  const [showSupport, setShowSupport] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showDpiMenu, setShowDpiMenu] = useState(false);

  const handleProcess = async (files: FileList | File[], action: ToolAction) => {
    if (files.length === 0) return;

    setStatus({ message: 'Đang xử lý...', type: 'loading' });

    try {
      const formData = new FormData();
      
      switch (action) {
        case 'PDF_TO_IMG': {
          const file = files[0];
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          const numPages = pdf.numPages;
          const zip = new JSZip();
          
          for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: dpi / 72 }); // Scale based on DPI (72 is standard)
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) continue;
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport: viewport } as any).promise;
            const imgData = canvas.toDataURL('image/jpeg', quality / 100);
            zip.file(`page_${i}.jpg`, imgData.split(',')[1], { base64: true });
            setStatus({ message: `Đang xử lý: ${i}/${numPages} trang...`, type: 'loading' });
          }
          const content = await zip.generateAsync({ type: 'blob' });
          downloadBlob(content, `${file.name.replace('.pdf', '')}_images.zip`);
          setStatus({ message: '✅ Đã tách trang thành công!', type: 'success' });
          break;
        }

        case 'IMG_TO_PDF': {
          Array.from(files).forEach(file => formData.append('files', file));
          formData.append('quality', quality.toString());
          const response = await fetch('/api/to-pdf', { method: 'POST', body: formData });
          if (!response.ok) throw new Error('Lỗi server');
          downloadBlob(await response.blob(), 'converted.pdf');
          setStatus({ message: '✅ Đã tạo PDF thành công!', type: 'success' });
          break;
        }

        case 'MERGE_PDF': {
          Array.from(files).forEach(file => formData.append('files', file));
          const response = await fetch('/api/pdf/merge', { method: 'POST', body: formData });
          if (!response.ok) throw new Error('Lỗi gộp PDF');
          downloadBlob(await response.blob(), 'merged.pdf');
          setStatus({ message: '✅ Đã gộp PDF thành công!', type: 'success' });
          break;
        }

        case 'SPLIT_PDF': {
          formData.append('file', files[0]);
          const response = await fetch('/api/pdf/split', { method: 'POST', body: formData });
          if (!response.ok) throw new Error('Lỗi tách PDF');
          downloadBlob(await response.blob(), 'split_pages.zip');
          setStatus({ message: '✅ Đã tách PDF thành công!', type: 'success' });
          break;
        }

        case 'DELETE_PAGES': {
          const pages = prompt('Nhập số trang cần xóa (ví dụ: 1,3,5):');
          if (!pages) { setStatus(null); return; }
          const pageIndices = pages.split(',').map(p => parseInt(p.trim()) - 1).filter(p => !isNaN(p));
          formData.append('file', files[0]);
          formData.append('pages', JSON.stringify(pageIndices));
          const response = await fetch('/api/pdf/delete-pages', { method: 'POST', body: formData });
          if (!response.ok) throw new Error('Lỗi xóa trang');
          downloadBlob(await response.blob(), 'modified.pdf');
          setStatus({ message: '✅ Đã xóa trang thành công!', type: 'success' });
          break;
        }

        case 'EXTRACT_PAGES': {
          const pages = prompt('Nhập số trang cần lấy (ví dụ: 1,2,4):');
          if (!pages) { setStatus(null); return; }
          const pageIndices = pages.split(',').map(p => parseInt(p.trim()) - 1).filter(p => !isNaN(p));
          formData.append('file', files[0]);
          formData.append('pages', JSON.stringify(pageIndices));
          const response = await fetch('/api/pdf/extract-pages', { method: 'POST', body: formData });
          if (!response.ok) throw new Error('Lỗi trích xuất trang');
          downloadBlob(await response.blob(), 'extracted.pdf');
          setStatus({ message: '✅ Đã trích xuất trang thành công!', type: 'success' });
          break;
        }

        case 'CONVERT_IMAGE': {
          const format = prompt('Chuyển sang định dạng nào? (jpg hoặc png):', 'jpg');
          if (!format || !['jpg', 'png'].includes(format.toLowerCase())) { setStatus(null); return; }
          formData.append('file', files[0]);
          formData.append('format', format.toLowerCase());
          formData.append('quality', quality.toString());
          const response = await fetch('/api/convert', { method: 'POST', body: formData });
          if (!response.ok) throw new Error('Lỗi chuyển đổi ảnh');
          downloadBlob(await response.blob(), `converted.${format}`);
          setStatus({ message: '✅ Đã chuyển đổi ảnh thành công!', type: 'success' });
          break;
        }

        case 'COMPRESS_PDF': {
          formData.append('file', files[0]);
          const response = await fetch('/api/pdf/compress', { method: 'POST', body: formData });
          if (!response.ok) throw new Error('Lỗi nén PDF');
          downloadBlob(await response.blob(), 'compressed.pdf');
          setStatus({ message: '✅ Đã nén PDF thành công!', type: 'success' });
          break;
        }

        default:
          setStatus({ message: 'Tính năng đang được phát triển', type: 'info' });
      }
    } catch (error) {
      console.error(error);
      setStatus({ message: '❌ Có lỗi xảy ra.', type: 'error' });
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const onDrop = (e: React.DragEvent, action: ToolAction) => {
    e.preventDefault();
    setIsDragging(null);
    handleProcess(e.dataTransfer.files, action);
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && activeTool) {
      handleProcess(e.target.files, activeTool);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-blue-100">
      {/* Menu Bar */}
      <div className="border-b border-slate-100 px-4 py-2 flex gap-6 text-sm text-slate-600 relative">
        <div 
          className="cursor-pointer hover:text-blue-600 transition-colors relative"
          onMouseEnter={() => setShowQualityMenu(true)}
          onMouseLeave={() => setShowQualityMenu(false)}
        >
          Chất lượng nén
          <AnimatePresence>
            {showQualityMenu && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute top-full left-0 mt-2 bg-white border border-slate-100 rounded-lg shadow-xl p-4 z-50 w-48"
              >
                <div className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Chọn chất lượng</div>
                <input 
                  type="range" 
                  min="10" 
                  max="100" 
                  value={quality} 
                  onChange={(e) => setQuality(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <div className="text-center mt-2 font-bold text-blue-600">{quality}%</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div 
          className="cursor-pointer hover:text-blue-600 transition-colors relative"
          onMouseEnter={() => setShowDpiMenu(true)}
          onMouseLeave={() => setShowDpiMenu(false)}
        >
          Độ phân giải (DPI)
          <AnimatePresence>
            {showDpiMenu && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute top-full left-0 mt-2 bg-white border border-slate-100 rounded-lg shadow-xl p-4 z-50 w-48"
              >
                <div className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Chọn DPI</div>
                <div className="grid grid-cols-2 gap-2">
                  {[72, 150, 300, 600].map(d => (
                    <button
                      key={d}
                      onClick={() => setDpi(d)}
                      className={`px-2 py-1 rounded text-xs font-bold transition-colors ${dpi === d ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                    >
                      {d} DPI
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div 
          className="cursor-pointer hover:text-blue-600 transition-colors"
          onClick={() => setShowSupport(true)}
        >
          Hỗ trợ
        </div>
      </div>

      {/* Header */}
      <header className="max-w-6xl mx-auto pt-12 pb-8 px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="text-5xl font-bold tracking-tight mb-4 text-slate-800">
            Tool Văn Phòng
          </h1>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            Chọn chất lượng nén, DPI và kéo thả tệp để xử lý
          </p>
        </motion.div>
      </header>

      {/* Controls */}
      <div className="max-w-6xl mx-auto px-6 mb-8 flex flex-col items-center gap-6">
        <div className="flex flex-col sm:flex-row items-center gap-8 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex flex-col gap-2 w-48">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Chất lượng nén: {quality}%</span>
            </div>
            <input 
              type="range" 
              min="10" 
              max="100" 
              value={quality} 
              onChange={(e) => setQuality(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>

          <div className="h-8 w-px bg-slate-100 hidden sm:block" />

          <div className="flex flex-col gap-2 w-48">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">DPI: {dpi}</span>
            </div>
            <div className="flex gap-2">
              {[72, 150, 300].map(d => (
                <button
                  key={d}
                  onClick={() => setDpi(d)}
                  className={`flex-1 py-1 rounded-md text-[10px] font-bold transition-all ${
                    dpi === d 
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-200' 
                      : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button 
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 text-slate-400 hover:text-blue-600 transition-colors text-xs font-medium uppercase tracking-widest"
        >
          <RefreshCw className="w-3 h-3" />
          Làm mới (Refresh)
        </button>
      </div>

      {/* Grid UI */}
      <main className="max-w-6xl mx-auto px-6 pb-24">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {TOOLS.map((tool, index) => (
            <motion.div
              key={tool.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(tool.id); }}
              onDragLeave={() => setIsDragging(null)}
              onDrop={(e) => onDrop(e, tool.id)}
              onClick={() => {
                setActiveTool(tool.id);
                fileInputRef.current?.click();
              }}
              className={`group relative bg-[#F9F9F9] border border-slate-100 rounded-lg p-10 transition-all duration-300 cursor-pointer flex flex-col items-center text-center gap-6 hover:bg-white hover:shadow-lg hover:shadow-slate-200/50 ${
                isDragging === tool.id 
                  ? 'border-blue-500 bg-blue-50/50 scale-[1.02]' 
                  : ''
              }`}
            >
              <div className="transition-transform duration-300 group-hover:scale-110">
                {tool.icon}
              </div>
              
              <div>
                <h3 className="text-base font-bold text-slate-800 leading-tight">{tool.title}</h3>
              </div>

              {/* Hover Effect Ring */}
              <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-slate-900/5 group-hover:ring-slate-900/10 transition-all" />
            </motion.div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <AnimatePresence mode="wait">
            {status && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold ${
                  status.type === 'success' ? 'text-emerald-600' :
                  status.type === 'error' ? 'text-rose-600' :
                  status.type === 'loading' ? 'text-blue-600' :
                  'text-slate-600'
                }`}
              >
                {status.type === 'loading' && <Loader2 className="w-4 h-4 animate-spin" />}
                {status.message}
              </motion.div>
            )}
            {!status && (
              <div className="text-emerald-500 font-bold">Sẵn sàng!</div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Support Modal */}
      <AnimatePresence>
        {showSupport && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSupport(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full overflow-hidden"
            >
              <button 
                onClick={() => setShowSupport(false)}
                className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="flex flex-col items-center text-center gap-6">
                <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center">
                  <Info className="w-8 h-8 text-blue-600" />
                </div>
                
                <div>
                  <h2 className="text-2xl font-bold text-slate-800 mb-2">Hỗ trợ khách hàng</h2>
                  <p className="text-slate-500 leading-relaxed">
                    Chào mừng bạn đến với <strong>Tool Văn Phòng</strong>. 
                    Đây là bộ công cụ xử lý PDF và hình ảnh chuyên nghiệp, nhanh chóng và bảo mật.
                  </p>
                </div>

                <div className="w-full space-y-3">
                  <div className="bg-slate-50 p-4 rounded-xl text-left">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Tác giả</div>
                    <div className="text-slate-700 font-bold">Brillian Pham</div>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-xl text-left">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Phiên bản</div>
                    <div className="text-slate-700 font-bold">v2.0.1 - Pro Edition</div>
                  </div>
                </div>

                <button 
                  onClick={() => setShowSupport(false)}
                  className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold hover:bg-slate-800 transition-colors"
                >
                  Đã hiểu
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef}
        className="hidden"
        multiple={activeTool ? TOOLS.find(t => t.id === activeTool)?.multiple : false}
        accept={activeTool ? TOOLS.find(t => t.id === activeTool)?.accept : '*'}
        onChange={onFileSelect}
      />
    </div>
  );
}
