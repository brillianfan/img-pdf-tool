import React, { useState, useCallback, useRef, useEffect } from 'react';
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
  Info,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Facebook
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import heic2any from 'heic2any';
import { PhotoEditor } from './components/PhotoEditor';
import AIOCRTool from './components/AIOCRTool';

// Set up PDF.js worker using unpkg for better reliability with .mjs files
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

type ToolAction = 
  | 'IMG_TO_PDF' 
  | 'PDF_TO_IMG' 
  | 'EXTRACT_PAGES' 
  | 'COMPRESS_PDF' 
  | 'CONVERT_IMAGE' 
  | 'MERGE_PDF' 
  | 'SPLIT_PDF' 
  | 'DELETE_PAGES'
  | 'PHOTO_EDITOR'
  | 'EXTRACT_TEXT_AI';

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
    accept: 'image/*,.heic,.heif,.jfif',
    multiple: true
  },
  { 
    id: 'PDF_TO_IMG', 
    title: 'PDF sang Ảnh (JPG)', 
    icon: <ImageIcon className="w-10 h-10 text-slate-700" />, 
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
    icon: <Package className="w-10 h-10 text-slate-700" />, 
    description: 'Giảm dung lượng tệp PDF mà vẫn giữ chất lượng',
    accept: '.pdf'
  },
  { 
    id: 'CONVERT_IMAGE', 
    title: 'Chuyển sang Ảnh (JPG/PNG)', 
    icon: <ImageIcon className="w-10 h-10 text-slate-700" />, 
    description: 'Chuyển đổi qua lại giữa JPG và PNG',
    accept: 'image/*,.heic,.heif,.jfif',
    multiple: true
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
  { 
    id: 'PHOTO_EDITOR', 
    title: 'Chỉnh sửa ảnh (Photoshop)', 
    icon: <Scissors className="w-10 h-10 text-slate-700" />, 
    description: 'Cắt, vẽ, thêm chữ, bộ lọc và AI cho ảnh',
    accept: 'image/*,.heic,.heif,.jfif,.pdf'
  },
  { 
    id: 'EXTRACT_TEXT_AI', 
    title: 'Trích xuất văn bản AI (OCR)', 
    icon: <Sparkles className="w-10 h-10 text-slate-700" />, 
    description: 'Chuyển đổi hình ảnh và PDF thành văn bản bằng AI (Gemini)',
    accept: 'image/*,.pdf,.heic,.heif',
    multiple: true
  }
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
  const [photoEditorFile, setPhotoEditorFile] = useState<File | null>(null);
  const [aiOcrFiles, setAiOcrFiles] = useState<File[] | null>(null);
  const [toolInput, setToolInput] = useState<{
    action: ToolAction;
    files: FileList | File[];
    value: string;
    type: 'text' | 'select' | 'reorder';
    options?: { label: string; value: string }[];
  } | null>(null);

  const convertHeicToJpg = async (file: File): Promise<File> => {
    if (file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
      setStatus({ message: `Đang chuyển đổi HEIC: ${file.name}...`, type: 'loading' });
      const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.8 });
      const resultBlob = Array.isArray(blob) ? blob[0] : blob;
      return new File([resultBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
    }
    return file;
  };

  const checkResponse = async (response: Response, defaultError: string) => {
    if (!response.ok) {
      let errorMessage = defaultError;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || defaultError;
      } catch (e) {
        // Not JSON, might be a server error or proxy error (like Vercel payload limit)
        if (response.status === 413) {
          errorMessage = "Tệp quá lớn. Vui lòng giảm số lượng ảnh hoặc chất lượng.";
        } else {
          errorMessage = `${defaultError} (Mã lỗi: ${response.status} ${response.statusText})`;
        }
      }
      throw new Error(errorMessage);
    }
    return response;
  };

  const resetSettings = () => {
    setQuality(85);
    setDpi(300);
    setStatus({ message: 'Đã khôi phục cài đặt gốc!', type: 'success' });
    setTimeout(() => setStatus(null), 2000);
  };

  const compressImage = async (file: File, quality: number, dpi: number, format: string = 'image/jpeg'): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas toBlob failed'));
          },
          format,
          quality / 100
        );
      };
      img.onerror = () => reject(new Error('Could not load image'));
    });
  };

  const handleProcess = async (files: FileList | File[], action: ToolAction, overrideValue?: string) => {
    if (files.length === 0) return;

    // Validate file types for PDF tools
    const pdfTools: ToolAction[] = ['PDF_TO_IMG', 'EXTRACT_PAGES', 'COMPRESS_PDF', 'MERGE_PDF', 'SPLIT_PDF', 'DELETE_PAGES'];
    if (pdfTools.includes(action)) {
      const nonPdfFiles = Array.from(files).filter(f => !f.name.toLowerCase().endsWith('.pdf'));
      if (nonPdfFiles.length > 0) {
        setStatus({ message: `❌ Vui lòng chỉ chọn tệp PDF cho chức năng này.`, type: 'error' });
        return;
      }
    }

    setStatus({ message: 'Đang chuẩn bị...', type: 'loading' });

    try {
      const formData = new FormData();
      
      // Pre-process HEIC files
      const processedFiles = await Promise.all(Array.from(files).map(f => convertHeicToJpg(f)));
      
      setStatus({ message: 'Đang xử lý...', type: 'loading' });

      switch (action) {
        case 'PDF_TO_IMG': {
          const file = processedFiles[0];
          const arrayBuffer = await file.arrayBuffer();
          const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
          const pdf = await loadingTask.promise;
          const numPages = pdf.numPages;
          const zip = new JSZip();
          const padding = numPages.toString().length;
          
          for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: dpi / 72 }); 
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) continue;
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport: viewport } as any).promise;
            const imgData = canvas.toDataURL('image/jpeg', quality / 100);
            const pageNum = i.toString().padStart(padding, '0');
            zip.file(`page_${pageNum}.jpg`, imgData.split(',')[1], { base64: true });
            setStatus({ message: `Đang xử lý: ${i}/${numPages} trang...`, type: 'loading' });
          }
          const content = await zip.generateAsync({ type: 'blob' });
          downloadBlob(content, `${file.name.replace('.pdf', '')}_images.zip`);
          setStatus({ message: '✅ Đã tách trang thành công!', type: 'success' });
          break;
        }

        case 'IMG_TO_PDF': {
          setStatus({ message: '🔄 Đang chuẩn bị ảnh...', type: 'loading' });
          const pdfDoc = await PDFDocument.create();
          
          for (let i = 0; i < processedFiles.length; i++) {
            const file = processedFiles[i];
            setStatus({ message: `Đang nén và gộp ảnh: ${i + 1}/${processedFiles.length}...`, type: 'loading' });
            try {
              const compressedBlob = await compressImage(file, quality, dpi);
              const arrayBuffer = await compressedBlob.arrayBuffer();
              const image = await pdfDoc.embedJpg(arrayBuffer);
              
              const scale = 72 / dpi;
              const width = image.width * scale;
              const height = image.height * scale;
              
              const page = pdfDoc.addPage([width, height]);
              page.drawImage(image, {
                x: 0,
                y: 0,
                width: width,
                height: height,
              });
            } catch (err) {
              console.error('Error embedding image:', err);
              // Try original if compression fails
              try {
                const arrayBuffer = await file.arrayBuffer();
                let image;
                if (file.type === 'image/png') {
                  image = await pdfDoc.embedPng(arrayBuffer);
                } else {
                  image = await pdfDoc.embedJpg(arrayBuffer);
                }
                const scale = 72 / dpi;
                const width = image.width * scale;
                const height = image.height * scale;
                const page = pdfDoc.addPage([width, height]);
                page.drawImage(image, { x: 0, y: 0, width, height });
              } catch (innerErr) {
                console.error('Failed to embed original image:', innerErr);
              }
            }
          }
          
          const pdfBytes = await pdfDoc.save();
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          downloadBlob(blob, 'converted.pdf');
          setStatus({ message: '✅ Đã tạo PDF thành công!', type: 'success' });
          break;
        }
        case 'MERGE_PDF': {
          if (processedFiles.length < 2) {
            throw new Error('Vui lòng chọn ít nhất 2 tệp PDF để gộp.');
          }
          
          if (!toolInput) {
            setToolInput({
              action,
              files: processedFiles,
              value: '',
              type: 'reorder'
            });
            setStatus(null);
            return;
          }
          
          setStatus({ message: '🔄 Đang gộp các tệp PDF...', type: 'loading' });
          const mergedPdf = await PDFDocument.create();
          const filesToMerge = Array.from(toolInput.files) as File[];
          
          for (const file of filesToMerge) {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
          }
          
          const pdfBytes = await mergedPdf.save();
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          downloadBlob(blob, 'merged.pdf');
          setStatus({ message: '✅ Đã gộp PDF thành công!', type: 'success' });
          setToolInput(null);
          break;
        }

        case 'SPLIT_PDF': {
          const file = processedFiles[0];
          setStatus({ message: '🔄 Đang tách các trang PDF...', type: 'loading' });
          
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
          const pageCount = pdf.getPageCount();
          const zip = new JSZip();
          const padding = pageCount.toString().length;
          
          for (let i = 0; i < pageCount; i++) {
            setStatus({ message: `Đang tách trang: ${i + 1}/${pageCount}...`, type: 'loading' });
            const newPdf = await PDFDocument.create();
            const [page] = await newPdf.copyPages(pdf, [i]);
            newPdf.addPage(page);
            const pdfBytes = await newPdf.save();
            const pageNum = (i + 1).toString().padStart(padding, '0');
            zip.file(`page_${pageNum}.pdf`, pdfBytes);
          }
          
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          downloadBlob(zipBlob, `${file.name.replace(/\.pdf$/i, '')}_split.zip`);
          setStatus({ message: '✅ Đã tách PDF thành công!', type: 'success' });
          break;
        }

        case 'DELETE_PAGES': {
          if (!toolInput && !overrideValue) {
            setToolInput({
              action,
              files: processedFiles,
              value: '',
              type: 'text'
            });
            setStatus(null);
            return;
          }
          const pagesInput = overrideValue || toolInput?.value || '';
          const pageIndices = parsePageInput(pagesInput);
          if (pageIndices.length === 0) throw new Error('Vui lòng nhập số trang hợp lệ (ví dụ: 1, 2-4)');
          
          setStatus({ message: '🔄 Đang xóa các trang PDF...', type: 'loading' });
          const file = processedFiles[0];
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
          
          const newPdf = await PDFDocument.create();
          const totalPages = pdf.getPageCount();
          const indicesToKeep = pdf.getPageIndices().filter(i => !pageIndices.includes(i));
          
          if (indicesToKeep.length === 0) {
            throw new Error('Không thể xóa tất cả các trang');
          }

          const copiedPages = await newPdf.copyPages(pdf, indicesToKeep);
          copiedPages.forEach(page => newPdf.addPage(page));

          const pdfBytes = await newPdf.save();
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          downloadBlob(blob, 'modified.pdf');
          setStatus({ message: '✅ Đã xóa trang thành công!', type: 'success' });
          setToolInput(null);
          break;
        }

        case 'EXTRACT_PAGES': {
          if (!toolInput && !overrideValue) {
            setToolInput({
              action,
              files: processedFiles,
              value: '',
              type: 'text'
            });
            setStatus(null);
            return;
          }
          const pagesInput = overrideValue || toolInput?.value || '';
          const pageIndices = parsePageInput(pagesInput);
          if (pageIndices.length === 0) throw new Error('Vui lòng nhập số trang hợp lệ (ví dụ: 1, 2-4)');

          setStatus({ message: '🔄 Đang trích xuất các trang PDF...', type: 'loading' });
          const file = processedFiles[0];
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
          
          const newPdf = await PDFDocument.create();
          const totalPages = pdf.getPageCount();
          const validIndices = pageIndices.filter(i => i >= 0 && i < totalPages);
          
          if (validIndices.length === 0) {
            throw new Error('Số trang trích xuất không hợp lệ');
          }

          const copiedPages = await newPdf.copyPages(pdf, validIndices);
          copiedPages.forEach(page => newPdf.addPage(page));

          const pdfBytes = await newPdf.save();
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          downloadBlob(blob, 'extracted.pdf');
          setStatus({ message: '✅ Đã trích xuất trang thành công!', type: 'success' });
          setToolInput(null);
          break;
        }

        case 'CONVERT_IMAGE': {
          if (!toolInput && !overrideValue) {
            setToolInput({
              action,
              files: processedFiles,
              value: 'jpg',
              type: 'select',
              options: [
                { label: 'Sang JPG', value: 'jpg' },
                { label: 'Sang PNG', value: 'png' }
              ]
            });
            setStatus(null);
            return;
          }
          const format = overrideValue || toolInput?.value || 'jpg';
          const targetFormat = format.toLowerCase() === 'jpg' ? 'jpeg' : 'png';
          
          console.log(`Processing CONVERT_IMAGE: format=${format}, files=${processedFiles.length}`);
          
          if (processedFiles.length > 1) {
            setStatus({ message: '🔄 Đang chuyển đổi ảnh...', type: 'loading' });
            const zip = new JSZip();
            
            for (let i = 0; i < processedFiles.length; i++) {
              const file = processedFiles[i];
              setStatus({ message: `Đang xử lý ảnh: ${i + 1}/${processedFiles.length}...`, type: 'loading' });
              try {
                const convertedBlob = await compressImage(file, quality, dpi, `image/${targetFormat}`);
                const arrayBuffer = await convertedBlob.arrayBuffer();
                const fileName = file.name.replace(/\.[^/.]+$/, "") + (format.toLowerCase() === 'jpg' ? '.jpg' : '.png');
                zip.file(fileName, arrayBuffer);
              } catch (err) {
                console.error('Conversion error:', err);
                const arrayBuffer = await file.arrayBuffer();
                zip.file(file.name, arrayBuffer);
              }
            }
            
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            downloadBlob(zipBlob, 'converted_images.zip');
          } else {
            setStatus({ message: '🔄 Đang chuyển đổi ảnh...', type: 'loading' });
            const file = processedFiles[0];
            try {
              const convertedBlob = await compressImage(file, quality, dpi, `image/${targetFormat}`);
              const fileName = `converted.${format.toLowerCase()}`;
              downloadBlob(convertedBlob, fileName);
            } catch (err) {
              console.error('Conversion error:', err);
              downloadBlob(file, file.name);
            }
          }
          
          setStatus({ message: '✅ Đã chuyển đổi ảnh thành công!', type: 'success' });
          setToolInput(null);
          break;
        }

        case 'COMPRESS_PDF': {
          const file = processedFiles[0];
          setStatus({ message: '🔄 Đang nén PDF (Phương pháp Rasterize Pro)...', type: 'loading' });
          
          const arrayBuffer = await file.arrayBuffer();
          const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
          const pdf = await loadingTask.promise;
          const numPages = pdf.numPages;
          
          const pdfDoc = await PDFDocument.create();
          
          for (let i = 1; i <= numPages; i++) {
            setStatus({ message: `Đang nén: ${i}/${numPages} trang...`, type: 'loading' });
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: dpi / 72 }); 
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) continue;
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport: viewport } as any).promise;
            
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality / 100));
            if (blob) {
              const imgBuffer = await blob.arrayBuffer();
              const image = await pdfDoc.embedJpg(imgBuffer);
              
              const scale = 72 / dpi;
              const width = image.width * scale;
              const height = image.height * scale;
              
              const newPage = pdfDoc.addPage([width, height]);
              newPage.drawImage(image, {
                x: 0,
                y: 0,
                width: width,
                height: height,
              });
            }
          }
          
          const pdfBytes = await pdfDoc.save();
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          downloadBlob(blob, `${file.name.replace('.pdf', '')}_compressed.pdf`);
          setStatus({ message: '✅ Đã nén PDF thành công!', type: 'success' });
          break;
        }

        case 'PHOTO_EDITOR': {
          const file = processedFiles[0];
          setPhotoEditorFile(file);
          setStatus(null);
          break;
        }

        case 'EXTRACT_TEXT_AI': {
          setAiOcrFiles(processedFiles);
          setStatus(null);
          break;
        }

        default:
          setStatus({ message: 'Tính năng đang được phát triển', type: 'info' });
      }
    } catch (error: any) {
      console.error(error);
      setStatus({ message: `❌ ${error.message || 'Có lỗi xảy ra.'}`, type: 'error' });
    }
  };

  const parsePageInput = (input: string) => {
    const pages: number[] = [];
    const parts = input.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.includes('-')) {
        const [start, end] = trimmed.split('-').map(p => parseInt(p.trim()));
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
            pages.push(i - 1);
          }
        }
      } else {
        const p = parseInt(trimmed);
        if (!isNaN(p)) pages.push(p - 1);
      }
    }
    return [...new Set(pages)].sort((a, b) => a - b);
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    if (!blob || blob.size === 0) {
      console.error('Download failed: Blob is empty or null');
      return;
    }
    console.log(`Triggering download for ${filename} (${blob.size} bytes)`);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    
    // Trigger click
    a.click();
    
    // Cleanup with delay to ensure browser handles the download request
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
    }, 1000);
  };

  const onDrop = (e: React.DragEvent, action: ToolAction) => {
    e.preventDefault();
    setIsDragging(null);
    handleProcess(e.dataTransfer.files, action);
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && activeTool) {
      handleProcess(e.target.files, activeTool);
      e.target.value = ''; // Reset to allow selecting the same file again
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
            Tool Văn Phòng - v.2.0.2
          </h1>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            Chọn chất lượng nén, DPI và kéo thả tệp để xử lý
          </p>
          <p className="text-sm text-slate-400 mt-2">by Brillian Pham</p>
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
          onClick={resetSettings}
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

      {/* Tool Input Modal */}
      <AnimatePresence>
        {toolInput && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setToolInput(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`relative bg-white rounded-3xl shadow-2xl p-8 w-full ${toolInput.type === 'reorder' ? 'max-w-2xl' : 'max-w-md'}`}
            >
              <h2 className="text-xl font-bold text-slate-800 mb-4">
                {TOOLS.find(t => t.id === toolInput.action)?.title}
              </h2>
              
              <div className="space-y-4">
                {toolInput.type === 'text' ? (
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">
                      Nhập số trang (ví dụ: 1, 2-4, 6)
                    </label>
                    <input
                      type="text"
                      autoFocus
                      value={toolInput.value}
                      onChange={(e) => setToolInput({ ...toolInput, value: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && handleProcess(toolInput.files, toolInput.action)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      placeholder="1, 2, 3..."
                    />
                  </div>
                ) : toolInput.type === 'reorder' ? (
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                    {(Array.from(toolInput.files) as File[]).map((file, idx) => (
                      <div 
                        key={`${file.name}-${idx}`}
                        className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl group"
                      >
                        <GripVertical className="w-4 h-4 text-slate-300" />
                        <span className="flex-1 text-sm font-medium text-slate-700 truncate">{file.name}</span>
                        <div className="flex gap-1">
                          <button 
                            disabled={idx === 0}
                            onClick={() => {
                              const newFiles = [...(Array.from(toolInput.files) as File[])];
                              [newFiles[idx], newFiles[idx-1]] = [newFiles[idx-1], newFiles[idx]];
                              setToolInput({ ...toolInput, files: newFiles });
                            }}
                            className="p-1.5 hover:bg-white rounded-lg text-slate-400 hover:text-blue-600 disabled:opacity-30 transition-all"
                          >
                            <ArrowUp className="w-4 h-4" />
                          </button>
                          <button 
                            disabled={idx === toolInput.files.length - 1}
                            onClick={() => {
                              const newFiles = [...(Array.from(toolInput.files) as File[])];
                              [newFiles[idx], newFiles[idx+1]] = [newFiles[idx+1], newFiles[idx]];
                              setToolInput({ ...toolInput, files: newFiles });
                            }}
                            className="p-1.5 hover:bg-white rounded-lg text-slate-400 hover:text-blue-600 disabled:opacity-30 transition-all"
                          >
                            <ArrowDown className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => {
                              const newFiles = (Array.from(toolInput.files) as File[]).filter((_, i) => i !== idx);
                              if (newFiles.length < 2) {
                                setToolInput(null);
                                setStatus({ message: 'Cần ít nhất 2 file để gộp!', type: 'error' });
                              } else {
                                setToolInput({ ...toolInput, files: newFiles });
                              }
                            }}
                            className="p-1.5 hover:bg-white rounded-lg text-slate-400 hover:text-rose-600 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : toolInput.type === 'select' ? (
                  <div className="grid grid-cols-2 gap-3">
                    {toolInput.options?.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setToolInput({ ...toolInput, value: opt.value });
                          handleProcess(toolInput.files, toolInput.action, opt.value);
                        }}
                        className={`py-4 rounded-xl font-bold transition-all border ${
                          toolInput.value === opt.value 
                            ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-200' 
                            : 'bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setToolInput(null)}
                    className="flex-1 px-6 py-3 border border-slate-100 rounded-xl font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    Hủy
                  </button>
                  {(toolInput.type === 'text' || toolInput.type === 'reorder' || toolInput.type === 'select') && (
                    <button
                      onClick={() => handleProcess(toolInput.files, toolInput.action)}
                      className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
                    >
                      {toolInput.type === 'reorder' ? 'Tiến hành Gộp' : 'Tiếp tục'}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                    <div className="text-slate-700 font-bold">v2.0.2 - Pro Edition</div>
                  </div>
                  <a 
                    href="https://fb.com/minhtri.pham.1997" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 bg-blue-50 p-4 rounded-xl text-left hover:bg-blue-100 transition-colors group"
                  >
                    <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                      <Facebook className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-0.5">Facebook</div>
                      <div className="text-blue-700 font-bold">minhtri.pham.1997</div>
                    </div>
                  </a>
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

      {photoEditorFile && (
        <PhotoEditor 
          file={photoEditorFile} 
          onClose={() => setPhotoEditorFile(null)}
          onSave={(blob) => {
            downloadBlob(blob, 'edited-image.png');
            setPhotoEditorFile(null);
          }}
        />
      )}

      {aiOcrFiles && (
        <AIOCRTool 
          files={aiOcrFiles} 
          onClose={() => setAiOcrFiles(null)}
        />
      )}
    </div>
  );
}
