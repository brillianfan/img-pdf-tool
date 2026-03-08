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
  Settings2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type ToolAction = 'TO_PDF' | 'PDF_TO_IMG' | 'WEBP' | 'AVIF' | 'JPEG' | 'PNG';

interface Tool {
  id: ToolAction;
  title: string;
  icon: React.ReactNode;
  description: string;
  accept: string;
}

const TOOLS: Tool[] = [
  { 
    id: 'TO_PDF', 
    title: 'Ảnh sang PDF', 
    icon: <FileText className="w-8 h-8 text-blue-500" />, 
    description: 'Ghép nhiều ảnh thành 1 file PDF duy nhất',
    accept: 'image/*'
  },
  { 
    id: 'PDF_TO_IMG', 
    title: 'PDF sang Ảnh (JPG)', 
    icon: <FileImage className="w-8 h-8 text-orange-500" />, 
    description: 'Tách các trang PDF thành file ảnh chất lượng cao',
    accept: '.pdf'
  },
  { 
    id: 'WEBP', 
    title: 'Chuyển sang WEBP', 
    icon: <Globe className="w-8 h-8 text-emerald-500" />, 
    description: 'Định dạng web hiện đại, dung lượng cực nhẹ',
    accept: 'image/*'
  },
  { 
    id: 'AVIF', 
    title: 'Chuyển sang AVIF', 
    icon: <Sparkles className="w-8 h-8 text-purple-500" />, 
    description: 'Công nghệ nén ảnh tiên tiến nhất hiện nay',
    accept: 'image/*'
  },
  { 
    id: 'JPEG', 
    title: 'Nén và chuyển sang JPEG', 
    icon: <TrendingDown className="w-8 h-8 text-rose-500" />, 
    description: 'Chuẩn ảnh phổ biến với khả năng nén tốt',
    accept: 'image/*'
  },
  { 
    id: 'PNG', 
    title: 'Nén và chuyển sang PNG', 
    icon: <Package className="w-8 h-8 text-indigo-500" />, 
    description: 'Giữ nguyên độ trong suốt và chi tiết sắc nét',
    accept: 'image/*'
  },
];

export default function App() {
  const [quality, setQuality] = useState(85);
  const [status, setStatus] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'loading' } | null>(null);
  const [isDragging, setIsDragging] = useState<ToolAction | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTool, setActiveTool] = useState<ToolAction | null>(null);

  const handleProcess = async (files: FileList | File[], action: ToolAction) => {
    if (files.length === 0) return;

    setStatus({ message: 'Đang xử lý...', type: 'loading' });

    try {
      if (action === 'PDF_TO_IMG') {
        // PDF to Image is handled client-side for better performance/privacy
        // We'll use pdfjs-dist for this. Since it's a bit heavy, we'll alert for now
        // or implement a basic version.
        setStatus({ message: 'Tính năng PDF sang Ảnh đang được hoàn thiện...', type: 'info' });
        return;
      }

      const formData = new FormData();
      
      if (action === 'TO_PDF') {
        Array.from(files).forEach(file => formData.append('files', file));
        const response = await fetch('/api/to-pdf', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) throw new Error('Lỗi server');
        
        const blob = await response.blob();
        downloadBlob(blob, 'converted_document.pdf');
        setStatus({ message: '✅ Đã tạo file PDF thành công!', type: 'success' });
      } else {
        // Image conversions
        const file = files[0];
        formData.append('file', file);
        formData.append('format', action.toLowerCase());
        formData.append('quality', quality.toString());

        const response = await fetch('/api/convert', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) throw new Error('Lỗi chuyển đổi');

        const blob = await response.blob();
        const ext = action.toLowerCase() === 'jpeg' ? 'jpg' : action.toLowerCase();
        downloadBlob(blob, `converted_image.${ext}`);
        setStatus({ message: `✅ Đã chuyển đổi sang ${action} thành công!`, type: 'success' });
      }
    } catch (error) {
      console.error(error);
      setStatus({ message: '❌ Có lỗi xảy ra trong quá trình xử lý.', type: 'error' });
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
    <div className="min-h-screen bg-[#FDFDFD] text-slate-900 font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="max-w-6xl mx-auto pt-16 pb-12 px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="text-5xl font-bold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600">
            Tool Văn Phòng
          </h1>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            Bộ công cụ chuyên nghiệp để nén, chuyển đổi và xử lý tài liệu văn phòng nhanh chóng ngay trên trình duyệt.
          </p>
        </motion.div>
      </header>

      {/* Controls */}
      <div className="max-w-6xl mx-auto px-6 mb-12">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="p-3 bg-slate-50 rounded-2xl">
              <Settings2 className="w-5 h-5 text-slate-400" />
            </div>
            <div className="flex-1 md:w-64">
              <div className="flex justify-between mb-2">
                <span className="text-sm font-semibold text-slate-700">Chất lượng nén</span>
                <span className="text-sm font-mono text-blue-600 font-bold">{quality}%</span>
              </div>
              <input 
                type="range" 
                min="10" 
                max="100" 
                value={quality} 
                onChange={(e) => setQuality(parseInt(e.target.value))}
                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <AnimatePresence mode="wait">
              {status && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${
                    status.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                    status.type === 'error' ? 'bg-rose-50 text-rose-700 border border-rose-100' :
                    status.type === 'loading' ? 'bg-blue-50 text-blue-700 border border-blue-100' :
                    'bg-slate-50 text-slate-700 border border-slate-100'
                  }`}
                >
                  {status.type === 'loading' && <Loader2 className="w-4 h-4 animate-spin" />}
                  {status.type === 'success' && <CheckCircle2 className="w-4 h-4" />}
                  {status.type === 'error' && <AlertCircle className="w-4 h-4" />}
                  {status.message}
                </motion.div>
              )}
            </AnimatePresence>
            {!status && (
              <div className="text-sm text-slate-400 italic">Sẵn sàng! Chỉ cần kéo thả tệp</div>
            )}
          </div>
        </div>
      </div>

      {/* Grid UI */}
      <main className="max-w-6xl mx-auto px-6 pb-24">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
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
              className={`group relative bg-white border-2 border-dashed rounded-[2rem] p-8 transition-all duration-300 cursor-pointer flex flex-col items-center text-center gap-6 hover:shadow-xl hover:shadow-slate-200/50 ${
                isDragging === tool.id 
                  ? 'border-blue-500 bg-blue-50/50 scale-[1.02]' 
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="p-5 bg-white rounded-3xl shadow-sm border border-slate-100 group-hover:scale-110 transition-transform duration-300">
                {tool.icon}
              </div>
              
              <div>
                <h3 className="text-lg font-bold text-slate-800 mb-2">{tool.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed px-4">
                  {tool.description}
                </p>
              </div>

              <div className="mt-auto flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 group-hover:text-blue-600 transition-colors">
                <Upload className="w-3 h-3" />
                Kéo thả hoặc Click
              </div>

              {/* Hover Effect Ring */}
              <div className="absolute inset-0 rounded-[2rem] ring-1 ring-inset ring-slate-900/5 group-hover:ring-slate-900/10 transition-all" />
            </motion.div>
          ))}
        </div>
      </main>

      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef}
        className="hidden"
        multiple={activeTool === 'TO_PDF'}
        accept={activeTool ? TOOLS.find(t => t.id === activeTool)?.accept : '*'}
        onChange={onFileSelect}
      />

      {/* Footer */}
      <footer className="border-t border-slate-100 py-12 text-center">
        <div className="text-slate-400 text-sm font-medium">
          Tool by Brillian Pham • Phiên bản 2.0
        </div>
      </footer>
    </div>
  );
}
