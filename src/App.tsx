import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Briefcase,
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
  Pencil,
  Mic,
  RefreshCw,
  Image as ImageIcon,
  X,
  Info,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Facebook
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import heic2any from 'heic2any';
import { PhotoEditor } from './components/PhotoEditor';
import { changeDpi } from './lib/dpiUtils';
// Removed AIOCRTool as per user request to use Iframe instead

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
  | 'PHOTO_EDITOR_MOBILE'
  | 'EXTRACT_TEXT_AI'
  | 'PHOTOPEA'
  | 'AUDIO_TO_TEXT'
  | 'CHANGE_DPI'
  | 'PDF_TO_WORD'
  | 'SDVN_PHOTO_EDIT';

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
    title: 'Ảnh sang PDF', 
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
    accept: '.pdf',
    multiple: true
  },
  { 
    id: 'EXTRACT_PAGES', 
    title: 'Trích xuất trang PDF', 
    icon: <FileText className="w-10 h-10 text-slate-700" />, 
    description: 'Lấy các trang cụ thể từ tệp PDF của bạn',
    accept: '.pdf',
    multiple: true
  },
  { 
    id: 'COMPRESS_PDF', 
    title: 'Nén tệp PDF', 
    icon: <Package className="w-10 h-10 text-slate-700" />, 
    description: 'Giảm dung lượng tệp PDF mà vẫn giữ chất lượng',
    accept: '.pdf',
    multiple: true
  },
  { 
    id: 'CONVERT_IMAGE', 
    title: 'Đổi định dạng Ảnh (JPG/PNG)', 
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
    accept: '.pdf',
    multiple: true
  },
  { 
    id: 'PDF_TO_WORD', 
    title: 'Chuyển PDF sang Word', 
    icon: <FileText className="w-10 h-10 text-blue-600" />, 
    description: 'Chuyển đổi tệp PDF của bạn thành tài liệu Word (.doc) có thể chỉnh sửa',
    accept: '.pdf',
    multiple: true
  },
  { 
    id: 'DELETE_PAGES', 
    title: 'Xóa trang PDF', 
    icon: <Trash2 className="w-10 h-10 text-slate-700" />, 
    description: 'Loại bỏ các trang không mong muốn khỏi PDF',
    accept: '.pdf',
    multiple: true
  },
  { 
    id: 'PHOTO_EDITOR', 
    title: 'Chỉnh sửa ảnh (Photoshop)', 
    icon: <Scissors className="w-10 h-10 text-slate-700" />, 
    description: 'Cắt, vẽ, thêm chữ, bộ lọc và AI cho ảnh',
    accept: 'image/*,.heic,.heif,.jfif,.pdf',
    multiple: true
  },
  { 
    id: 'PHOTO_EDITOR_MOBILE', 
    title: 'Chỉnh sửa ảnh mobile', 
    icon: <Scissors className="w-10 h-10 text-slate-700" />, 
    description: 'Phiên bản tối ưu cho điện thoại',
    accept: 'image/*,.heic,.heif,.jfif,.pdf',
    multiple: true
  },
  { 
    id: 'EXTRACT_TEXT_AI', 
    title: 'Trích xuất văn bản AI (OCR)', 
    icon: <Sparkles className="w-10 h-10 text-slate-700" />, 
    description: 'Sử dụng ứng dụng AI để nhận diện văn bản từ hình ảnh và PDF',
    accept: '*',
    multiple: true
  },
  { 
    id: 'PHOTOPEA', 
    title: 'Photopea (Online Editor)', 
    icon: <Pencil className="w-10 h-10 text-slate-700" />, 
    description: 'Mở trình chỉnh sửa ảnh chuyên nghiệp Photopea trong tab mới',
    accept: '*',
    multiple: true
  },
  { 
    id: 'CHANGE_DPI', 
    title: 'Thay đổi DPI (PDF & Ảnh)', 
    icon: <RefreshCw className="w-10 h-10 text-slate-700" />, 
    description: 'Thay đổi mật độ điểm ảnh cho PDF hoặc Hình ảnh (72, 96, 150, 300, 600)',
    accept: '.pdf,image/*,.heic,.heif,.jfif',
    multiple: true
  },
  { 
    id: 'AUDIO_TO_TEXT', 
    title: 'Chuyển Audio thành Text', 
    icon: <Mic className="w-10 h-10 text-slate-700" />, 
    description: 'Sử dụng ứng dụng AI để chuyển đổi âm thanh thành văn bản',
    accept: 'audio/*',
    multiple: true
  },
  { 
    id: 'SDVN_PHOTO_EDIT', 
    title: 'Chỉnh sửa ảnh AI với SDVN', 
    icon: <Sparkles className="w-10 h-10 text-violet-600" />, 
    description: 'Sử dụng ứng dụng AI chuyên sâu chỉnh sửa ảnh thông minh của SDVN',
    accept: 'image/*',
    multiple: false
  }
];

const escapeHtml = (text: string) => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const mapFontFamily = (rawFont: string, fontName: string): string => {
  const combined = (rawFont + ' ' + fontName).toLowerCase();
  if (combined.includes('times') || combined.includes('serif')) {
    return 'Times New Roman';
  }
  if (combined.includes('courier') || combined.includes('mono')) {
    return 'Courier New';
  }
  if (combined.includes('calibri')) {
    return 'Calibri';
  }
  if (combined.includes('georgia')) {
    return 'Georgia';
  }
  if (combined.includes('garamond')) {
    return 'Garamond';
  }
  if (combined.includes('verdana')) {
    return 'Verdana';
  }
  if (combined.includes('arial') || combined.includes('helvetica') || combined.includes('sans')) {
    return 'Arial';
  }
  return 'Calibri';
};

const generateWordHtmlFromPdf = async (
  pdf: any,
  onPageProgress: (pageIndex: number, totalPages: number) => void
): Promise<string> => {
  let widthCm = 21.0;
  let heightCm = 29.7;
  try {
    const firstPage = await pdf.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1 });
    widthCm = (viewport.width / 72) * 2.54;
    heightCm = (viewport.height / 72) * 2.54;
  } catch (e) {
    console.error('Failed to parse viewport dimensions', e);
  }

  let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">`;
  html += `<head><meta charset="utf-8"/>`;
  html += `<!--[if gte mso 9]>`;
  html += `<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml>`;
  html += `<![endif]-->`;
  html += `<style>`;
  html += `@page WordSection1 { size: ${widthCm.toFixed(2)}cm ${heightCm.toFixed(2)}cm; margin: 2.0cm 2.0cm 2.0cm 2.0cm; }`;
  html += `div.WordSection1 { page: WordSection1; }`;
  html += `body { font-family: "Calibri", "Arial", sans-serif; font-size: 11pt; line-height: 1.15; }`;
  html += `p { margin: 0; padding: 0; line-height: normal; }`;
  html += `.page-break { page-break-before: always; mso-break-type: section-break; }`;
  html += `</style></head><body>`;
  html += `<div class="WordSection1">`;

  for (let i = 1; i <= pdf.numPages; i++) {
    onPageProgress(i, pdf.numPages);
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const items = (textContent.items as any[]).filter(it => it.str !== undefined);

    if (items.length === 0) {
      if (i > 1) {
        html += `<div class="page-break"></div>`;
      }
      continue;
    }

    const lines: { y: number; items: any[] }[] = [];
    const threshold = 5;

    for (const item of items) {
      const str = item.str;
      const x = item.transform[4];
      const y = item.transform[5];
      const height = Math.abs(item.transform[3]);

      let line = lines.find(l => Math.abs(l.y - y) < Math.max(threshold, height * 0.4));
      if (!line) {
        line = { y, items: [] };
        lines.push(line);
      }
      line.items.push({ x, str, height, fontName: item.fontName, width: item.width });
    }

    lines.sort((a, b) => b.y - a.y);
    const pageMinX = Math.min(...items.map(it => it.transform[4]));

    if (i > 1) {
      html += `<div class="page-break"></div>`;
    }

    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      line.items.sort((a, b) => a.x - b.x);

      let marginBottom = 6;
      if (j < lines.length - 1) {
        const verticalDistance = line.y - lines[j+1].y;
        const lineMaxHeight = Math.max(...line.items.map(it => it.height), 1);
        if (verticalDistance > 1.2 * lineMaxHeight) {
          marginBottom = Math.min(120, verticalDistance - (1.1 * lineMaxHeight));
        } else {
          marginBottom = 0;
        }
      }

      const firstItem = line.items[0];
      const indentPt = Math.max(0, firstItem.x - pageMinX);
      const pStyle = `margin: 0; margin-left: ${indentPt.toFixed(1)}pt; margin-bottom: ${marginBottom.toFixed(1)}pt; line-height: normal; text-align: left;`;

      html += `<p style="${pStyle}">`;

      let lastRightX = 0;
      for (let idx = 0; idx < line.items.length; idx++) {
        const it = line.items[idx];
        const styleParts: string[] = [];

        const fontObj = textContent.styles[it.fontName];
        const rawFamily = fontObj ? fontObj.fontFamily : 'Calibri';
        const fontFamily = mapFontFamily(rawFamily, it.fontName);
        styleParts.push(`font-family: '${fontFamily}'`);
        styleParts.push(`font-size: ${it.height.toFixed(1)}pt`);

        const combinedFont = (rawFamily + ' ' + it.fontName).toLowerCase();
        if (combinedFont.includes('bold') || combinedFont.includes('bd') || combinedFont.includes('black') || combinedFont.includes('heavy') || combinedFont.includes('semibold')) {
          styleParts.push('font-weight: bold');
        }
        if (combinedFont.includes('italic') || combinedFont.includes('oblique') || combinedFont.includes('it')) {
          styleParts.push('font-style: italic');
        }

        let marginStyle = '';
        if (idx > 0) {
          const gap = it.x - lastRightX;
          if (gap > 2) {
            marginStyle = `margin-left: ${gap.toFixed(1)}pt`;
            if (gap > 3 && !it.str.startsWith(' ')) {
              html += ' ';
            }
          }
        }

        const spanStyle = styleParts.join('; ') + (marginStyle ? `; ${marginStyle}` : '');
        html += `<span style="${spanStyle}">${escapeHtml(it.str)}</span>`;
        const widthVal = it.width || (it.str.length * it.height * 0.5);
        lastRightX = it.x + widthVal;
      }

      html += `</p>\n`;
    }
  }

  html += `</div></body></html>`;
  return html;
};

export default function App() {
  const [status, setStatus] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'loading' } | null>(null);
  const [isDragging, setIsDragging] = useState<ToolAction | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTool, setActiveTool] = useState<ToolAction | null>(null);
  const [showSupport, setShowSupport] = useState(false);
  const [photoEditorFile, setPhotoEditorFile] = useState<File | null>(null);
  const [isMobileEditor, setIsMobileEditor] = useState(false);
  const [toolInput, setToolInput] = useState<{
    action: ToolAction;
    files: FileList | File[];
    value?: string;
    quality: number;
    dpi: number;
    type: 'text' | 'select' | 'reorder' | 'settings';
    options?: { label: string; value: string }[];
  } | null>(null);

  const [globalQuality, setGlobalQuality] = useState(85);
  const [globalDpi, setGlobalDpi] = useState(300);

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
    setGlobalQuality(85);
    setGlobalDpi(300);
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
          async (blob) => {
            if (blob) {
              const dpiBlob = await changeDpi(blob, dpi);
              resolve(dpiBlob);
            } else {
              reject(new Error('Canvas toBlob failed'));
            }
          },
          format,
          quality / 100
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        reject(new Error('Could not load image'));
      };
    });
  };

  const handleProcess = async (files: FileList | File[], action: ToolAction, overrideValues?: { value?: string, quality?: number, dpi?: number }) => {
    const filesArray = Array.from(files);
    if (filesArray.length === 0) return;

    // Determine if we need to show a settings modal before processing
    const needsSettings = ['IMG_TO_PDF', 'PDF_TO_IMG', 'COMPRESS_PDF', 'CONVERT_IMAGE', 'CHANGE_DPI'].includes(action);
    const multiStepTools = ['MERGE_PDF', 'DELETE_PAGES', 'EXTRACT_PAGES'];
    
    if (!toolInput && !overrideValues) {
      if (needsSettings) {
        setToolInput({
          action,
          files: filesArray,
          quality: globalQuality,
          dpi: globalDpi,
          value: action === 'CONVERT_IMAGE' ? 'jpg' : (action === 'CHANGE_DPI' ? '300' : ''),
          type: 'settings',
          options: action === 'CONVERT_IMAGE' ? [
            { label: 'Sang JPG', value: 'jpg' },
            { label: 'Sang PNG', value: 'png' }
          ] : (action === 'CHANGE_DPI' ? [
            { label: '72 DPI', value: '72' },
            { label: '96 DPI', value: '96' },
            { label: '150 DPI', value: '150' },
            { label: '300 DPI', value: '300' },
            { label: '600 DPI', value: '600' }
          ] : undefined)
        });
        return;
      } else if (multiStepTools.includes(action)) {
        setToolInput({
          action,
          files: filesArray,
          quality: globalQuality,
          dpi: globalDpi,
          value: '',
          type: action === 'MERGE_PDF' ? 'reorder' : 'text'
        });
        return;
      }
    }

    // Capture settings from toolInput or override or global defaults
    const currentQuality = overrideValues?.quality ?? toolInput?.quality ?? globalQuality;
    const currentDpi = overrideValues?.dpi ?? toolInput?.dpi ?? globalDpi;
    const currentValue = overrideValues?.value ?? toolInput?.value ?? '';

    // If coming from modal, close it now so status is visible and process starts
    setToolInput(null);

    // Validate file types for PDF tools
    const pdfTools: ToolAction[] = ['PDF_TO_IMG', 'EXTRACT_PAGES', 'COMPRESS_PDF', 'MERGE_PDF', 'SPLIT_PDF', 'DELETE_PAGES', 'PDF_TO_WORD'];
    if (pdfTools.includes(action)) {
      const nonPdfFiles = filesArray.filter(f => !f.name.toLowerCase().endsWith('.pdf'));
      if (nonPdfFiles.length > 0) {
        setStatus({ message: `❌ Vui lòng chỉ chọn tệp PDF cho chức năng này.`, type: 'error' });
        return;
      }
    }

    setStatus({ message: 'Đang chuẩn bị...', type: 'loading' });

    try {
      const processedFiles = await Promise.all(filesArray.map(f => convertHeicToJpg(f)));
      
      setStatus({ message: 'Đang khởi tạo trình xử lý...', type: 'loading' });

      switch (action) {
        case 'PDF_TO_IMG': {
          const zip = new JSZip();
          for (let f = 0; f < processedFiles.length; f++) {
            const file = processedFiles[f];
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            const numPages = pdf.numPages;
            const padding = numPages.toString().length;
            const fileFolder = processedFiles.length > 1 ? zip.folder(file.name.replace(/\.pdf$/i, '')) : zip;
            
            for (let i = 1; i <= numPages; i++) {
              const page = await pdf.getPage(i);
              const viewport = page.getViewport({ scale: currentDpi / 72 }); 
              const canvas = document.createElement('canvas');
              const context = canvas.getContext('2d');
              if (!context) continue;
              canvas.height = viewport.height;
              canvas.width = viewport.width;
              await page.render({ canvasContext: context, viewport: viewport } as any).promise;
              
              const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', currentQuality / 100));
              if (blob) {
                const dpiBlob = await changeDpi(blob, currentDpi);
                const pageNum = i.toString().padStart(padding, '0');
                fileFolder?.file(`page_${pageNum}.jpg`, await dpiBlob.arrayBuffer());
              }
              setStatus({ message: `Đang xử lý PDF ${f + 1}/${processedFiles.length}: ${i}/${numPages} trang...`, type: 'loading' });
            }
          }
          const content = await zip.generateAsync({ type: 'blob' });
          downloadBlob(content, processedFiles.length > 1 ? 'converted_pdfs_images.zip' : `${processedFiles[0].name.replace(/\.pdf$/i, '')}_images.zip`);
          setStatus({ message: '✅ Đã tách trang thành công!', type: 'success' });
          break;
        }

        case 'IMG_TO_PDF': {
          const pdfDoc = await PDFDocument.create();
          for (let i = 0; i < processedFiles.length; i++) {
            const file = processedFiles[i];
            setStatus({ message: `Đang nén và gộp ảnh: ${i + 1}/${processedFiles.length}...`, type: 'loading' });
            try {
              const compressedBlob = await compressImage(file, currentQuality, currentDpi);
              const arrayBuffer = await compressedBlob.arrayBuffer();
              const image = await pdfDoc.embedJpg(arrayBuffer);
              const scale = 72 / currentDpi;
              const width = image.width * scale;
              const height = image.height * scale;
              const page = pdfDoc.addPage([width, height]);
              page.drawImage(image, { x: 0, y: 0, width, height });
            } catch (err) {
              const arrayBuffer = await file.arrayBuffer();
              let image = file.type === 'image/png' ? await pdfDoc.embedPng(arrayBuffer) : await pdfDoc.embedJpg(arrayBuffer);
              const scale = 72 / currentDpi;
              const width = image.width * scale;
              const height = image.height * scale;
              const page = pdfDoc.addPage([width, height]);
              page.drawImage(image, { x: 0, y: 0, width, height });
            }
          }
          const pdfBytes = await pdfDoc.save();
          downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), 'converted.pdf');
          setStatus({ message: '✅ Đã tạo PDF thành công!', type: 'success' });
          break;
        }

        case 'COMPRESS_PDF': {
          const zip = new JSZip();
          for (let f = 0; f < processedFiles.length; f++) {
            const file = processedFiles[f];
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            const pdfDoc = await PDFDocument.create();
            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              const viewport = page.getViewport({ scale: currentDpi / 72 }); 
              const canvas = document.createElement('canvas');
              const context = canvas.getContext('2d');
              if (!context) continue;
              canvas.height = viewport.height;
              canvas.width = viewport.width;
              await page.render({ canvasContext: context, viewport: viewport } as any).promise;
              const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', currentQuality / 100));
              if (blob) {
                const dpiBlob = await changeDpi(blob, currentDpi);
                const imgBuffer = await dpiBlob.arrayBuffer();
                const image = await pdfDoc.embedJpg(imgBuffer);
                const scale = 72 / currentDpi;
                const width = image.width * scale;
                const height = image.height * scale;
                const newPage = pdfDoc.addPage([width, height]);
                newPage.drawImage(image, { x: 0, y: 0, width, height });
              }
              setStatus({ message: `Đang nén ${f + 1}: ${i}/${pdf.numPages} trang...`, type: 'loading' });
            }
            const pdfBytes = await pdfDoc.save();
            zip.file(`${file.name.replace(/\.pdf$/i, '')}_compressed.pdf`, pdfBytes);
          }
          if (processedFiles.length > 1) {
            downloadBlob(await zip.generateAsync({ type: 'blob' }), 'compressed_pdfs.zip');
          } else {
            const key = Object.keys(zip.files)[0];
            downloadBlob(await zip.file(key)!.async('blob'), key);
          }
          setStatus({ message: '✅ Đã nén PDF thành công!', type: 'success' });
          break;
        }

        case 'CONVERT_IMAGE': {
          const format = currentValue || 'jpg';
          const targetFormat = format.toLowerCase() === 'jpg' ? 'jpeg' : 'png';
          if (processedFiles.length > 1) {
            const zip = new JSZip();
            for (let i = 0; i < processedFiles.length; i++) {
              const file = processedFiles[i];
              try {
                const convertedBlob = await compressImage(file, currentQuality, currentDpi, `image/${targetFormat}`);
                zip.file(file.name.replace(/\.[^/.]+$/, "") + (format === 'jpg' ? '.jpg' : '.png'), await convertedBlob.arrayBuffer());
              } catch (err) { zip.file(file.name, await file.arrayBuffer()); }
            }
            downloadBlob(await zip.generateAsync({ type: 'blob' }), 'converted_images.zip');
          } else {
            const convertedBlob = await compressImage(processedFiles[0], currentQuality, currentDpi, `image/${targetFormat}`);
            downloadBlob(convertedBlob, `converted.${format}`);
          }
          setStatus({ message: '✅ Đã chuyển đổi ảnh thành công!', type: 'success' });
          break;
        }

        case 'CHANGE_DPI': {
          const targetDpi = parseInt(currentValue || '300');
          const zip = new JSZip();
          for (let f = 0; f < processedFiles.length; f++) {
            const file = processedFiles[f];
            if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
              const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
              const pdfDoc = await PDFDocument.create();
              for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: targetDpi / 72 }); 
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                if (!context) continue;
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                await page.render({ canvasContext: context, viewport: viewport } as any).promise;
                const quality = targetDpi >= 300 ? 0.76 : 0.86;
                const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
                if (blob) {
                  const image = await pdfDoc.embedJpg(await (await changeDpi(blob, targetDpi)).arrayBuffer());
                  const orig = page.getViewport({ scale: 1 });
                  const newPage = pdfDoc.addPage([orig.width, orig.height]);
                  newPage.drawImage(image, { x: 0, y: 0, width: orig.width, height: orig.height });
                }
              }
              zip.file(`${file.name.replace(/\.pdf$/i, '')}_${targetDpi}dpi.pdf`, await pdfDoc.save());
            } else {
              // Direct image handling: Injection only, to preserve original quality/pixels
              const dpiBlob = await changeDpi(file, targetDpi);
              const ext = file.type === 'image/png' ? 'png' : 'jpg';
              zip.file(`${file.name.replace(/\.[^/.]+$/, "")}_${targetDpi}dpi.${ext}`, await dpiBlob.arrayBuffer());
            }
          }
          if (processedFiles.length > 1) {
            downloadBlob(await zip.generateAsync({ type: 'blob' }), `dpi_${targetDpi}.zip`);
          } else {
            const key = Object.keys(zip.files)[0];
            downloadBlob(await zip.file(key)!.async('blob'), key);
          }
          setStatus({ message: `✅ Cập nhật DPI ${targetDpi} thành công!`, type: 'success' });
          break;
        }

        case 'MERGE_PDF': {
          const mergedPdf = await PDFDocument.create();
          const targetFiles = filesArray.length > 0 ? filesArray : processedFiles;
          for (let i = 0; i < targetFiles.length; i++) {
            const file = targetFiles[i];
            setStatus({ message: `Đang gộp PDF: ${i + 1}/${targetFiles.length}...`, type: 'loading' });
            const pdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
          }
          downloadBlob(new Blob([await mergedPdf.save()], { type: 'application/pdf' }), 'merged.pdf');
          setStatus({ message: '✅ Đã gộp PDF thành công!', type: 'success' });
          break;
        }

        case 'SPLIT_PDF': {
          const zip = new JSZip();
          for (const file of processedFiles) {
            const pdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
            for (let i = 0; i < pdf.getPageCount(); i++) {
              const newPdf = await PDFDocument.create();
              const [page] = await newPdf.copyPages(pdf, [i]);
              newPdf.addPage(page);
              zip.file(`${file.name.replace(/\.pdf$/i, '')}_page_${i+1}.pdf`, await newPdf.save());
            }
          }
          downloadBlob(await zip.generateAsync({ type: 'blob' }), 'split.zip');
          setStatus({ message: '✅ Đã tách PDF thành công!', type: 'success' });
          break;
        }

        case 'PDF_TO_WORD': {
          if (processedFiles.length > 1) {
            const zip = new JSZip();
            for (let f = 0; f < processedFiles.length; f++) {
              const file = processedFiles[f];
              setStatus({ message: `Đang chuyển đổi tệp ${f + 1}/${processedFiles.length}: ${file.name}...`, type: 'loading' });
              const arrayBuffer = await file.arrayBuffer();
              const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
              const pdf = await loadingTask.promise;
              
              const fileWordHtml = await generateWordHtmlFromPdf(pdf, (pageIdx, totalPages) => {
                setStatus({ message: `Đang trích xuất văn bản tệp ${f + 1}: Trang ${pageIdx}/${totalPages}...`, type: 'loading' });
              });
              
              const docBlob = new Blob([fileWordHtml], { type: 'application/msword;charset=utf-8' });
              const docName = file.name.replace(/\.pdf$/i, '') + '.doc';
              zip.file(docName, docBlob);
            }
            downloadBlob(await zip.generateAsync({ type: 'blob' }), 'converted_word_files.zip');
          } else {
            const file = processedFiles[0];
            setStatus({ message: `Đang chuyển đổi tệp: ${file.name}...`, type: 'loading' });
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            
            const fileWordHtml = await generateWordHtmlFromPdf(pdf, (pageIdx, totalPages) => {
              setStatus({ message: `Đang trích xuất văn bản: Trang ${pageIdx}/${totalPages}...`, type: 'loading' });
            });
            
            const docBlob = new Blob([fileWordHtml], { type: 'application/msword;charset=utf-8' });
            const docName = file.name.replace(/\.pdf$/i, '') + '.doc';
            downloadBlob(docBlob, docName);
          }
          setStatus({ message: '✅ Đã chuyển đổi PDF sang Word thành công!', type: 'success' });
          break;
        }

        case 'DELETE_PAGES':
        case 'EXTRACT_PAGES': {
          const pagesInput = currentValue || '';
          const pageIndices = parsePageInput(pagesInput);
          const zip = new JSZip();
          const targetFiles = filesArray.length > 0 ? filesArray : processedFiles;
          for (const file of targetFiles) {
            setStatus({ message: `Đang xử lý PDF: ${file.name}...`, type: 'loading' });
            const pdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
            const newPdf = await PDFDocument.create();
            const indices = action === 'DELETE_PAGES' 
              ? pdf.getPageIndices().filter(i => !pageIndices.includes(i))
              : pageIndices.filter(i => i >= 0 && i < pdf.getPageCount());
            if (indices.length > 0) {
              const copiedPages = await newPdf.copyPages(pdf, indices);
              copiedPages.forEach(p => newPdf.addPage(p));
              zip.file(`${file.name.replace(/\.pdf$/i, '')}_modified.pdf`, await newPdf.save());
            }
          }
          if (Object.keys(zip.files).length > 1) {
            downloadBlob(await zip.generateAsync({ type: 'blob' }), 'processed_pdfs.zip');
          } else if (Object.keys(zip.files).length === 1) {
            const key = Object.keys(zip.files)[0];
            downloadBlob(await zip.file(key)!.async('blob'), key);
          } else {
            throw new Error('Không có trang nào được chọn hoặc kết quả trống.');
          }
          setStatus({ message: '✅ Đã xử lý thành công!', type: 'success' });
          break;
        }

        case 'PHOTO_EDITOR':
        case 'PHOTO_EDITOR_MOBILE': {
          setPhotoEditorFile(processedFiles[0]);
          setIsMobileEditor(action === 'PHOTO_EDITOR_MOBILE');
          break;
        }

        default:
          setStatus({ message: 'Tính năng đang được phát triển', type: 'info' });
      }
      // Success - toolInput already nullified at start of processing
    } catch (error: any) {
      console.error(error);
      setStatus({ message: `❌ ${error.message || 'Có lỗi xảy ra.'}`, type: 'error' });
      setToolInput(null); // Ensure modal closes even on error if it was open
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
          className="cursor-pointer hover:text-blue-600 transition-colors"
          onClick={() => setShowSupport(true)}
        >
          Thông tin
        </div>
      </div>

      {/* Header */}
      <header className="max-w-6xl mx-auto pt-12 pb-8 px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
              <Briefcase className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-5xl font-extrabold tracking-tight text-slate-800">
              Brilliant<span className="text-blue-600 italic">Office</span> Tool
            </h1>
          </div>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            Bộ công cụ thông minh cho văn phòng
          </p>
          <p className="text-sm text-slate-400 mt-2 font-medium tracking-widest uppercase">v.2.0.3 • Pro Edition</p>
        </motion.div>
      </header>

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
                if (tool.id === 'EXTRACT_TEXT_AI') {
                  window.open('https://ai.studio/apps/e8acfb7a-f587-425d-a822-0bbecfb2be30?fullscreenApplet=true', '_blank');
                } else if (tool.id === 'PHOTOPEA') {
                  window.open('https://www.photopea.com/', '_blank');
                } else if (tool.id === 'AUDIO_TO_TEXT') {
                  window.open('https://ai.studio/apps/d046bb29-3951-4c90-8ef4-df4d51fbb84f?fullscreenApplet=true', '_blank');
                } else if (tool.id === 'SDVN_PHOTO_EDIT') {
                  window.open('https://aistudio.google.com/app/apps/d798af97-ec18-4946-bce4-3b5b0e7d403e?showPreview=true&showAssistant=true&fullscreenApplet=true', '_blank');
                } else {
                  setActiveTool(tool.id);
                  fileInputRef.current?.click();
                }
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
              
              <div className="space-y-6">
                {(toolInput.type === 'settings' || ['IMG_TO_PDF', 'PDF_TO_IMG', 'COMPRESS_PDF', 'CONVERT_IMAGE', 'CHANGE_DPI'].includes(toolInput.action)) && (
                   <div className="space-y-6 bg-slate-50 p-6 rounded-2xl border border-slate-100">
                      {['IMG_TO_PDF', 'PDF_TO_IMG', 'COMPRESS_PDF', 'CONVERT_IMAGE'].includes(toolInput.action) && (
                        <div className="space-y-3">
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex justify-between">
                            Chất lượng nén: <span className="text-blue-600">{toolInput.quality}%</span>
                          </label>
                          <input 
                            type="range" 
                            min="10" 
                            max="100" 
                            value={toolInput.quality} 
                            onChange={(e) => setToolInput({ ...toolInput, quality: parseInt(e.target.value) })}
                            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                          />
                        </div>
                      )}

                      {['IMG_TO_PDF', 'PDF_TO_IMG', 'COMPRESS_PDF', 'CONVERT_IMAGE', 'CHANGE_DPI'].includes(toolInput.action) && (
                        <div className="space-y-3">
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            Độ phân giải (DPI)
                          </label>
                          <div className="grid grid-cols-5 gap-2">
                            {[72, 96, 150, 300, 600].map(d => (
                              <button
                                key={d}
                                onClick={() => setToolInput({ ...toolInput, dpi: d, value: toolInput.action === 'CHANGE_DPI' ? d.toString() : toolInput.value })}
                                className={`py-2 rounded-lg text-[10px] font-bold transition-all border ${
                                  toolInput.dpi === d 
                                    ? 'bg-blue-600 text-white border-blue-600 shadow-md' 
                                    : 'bg-white text-slate-600 border-slate-100 hover:border-blue-200'
                                }`}
                              >
                                {d}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {toolInput.action === 'CONVERT_IMAGE' && toolInput.options && (
                        <div className="space-y-3">
                           <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Định dạng đầu ra</label>
                           <div className="grid grid-cols-2 gap-2">
                             {toolInput.options.map(opt => (
                               <button
                                 key={opt.value}
                                 onClick={() => setToolInput({...toolInput, value: opt.value})}
                                 className={`py-2 rounded-lg text-xs font-bold transition-all border ${
                                   toolInput.value === opt.value
                                     ? 'bg-blue-600 text-white border-blue-600'
                                     : 'bg-white text-slate-600 border-slate-100'
                                 }`}
                               >
                                 {opt.label}
                               </button>
                             ))}
                           </div>
                        </div>
                      )}
                   </div>
                )}

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
                  <Reorder.Group 
                    axis="y" 
                    values={Array.from(toolInput.files) as File[]} 
                    onReorder={(newFiles) => setToolInput({ ...toolInput, files: newFiles })}
                    className="space-y-2 max-h-96 overflow-y-auto pr-2 custom-scrollbar p-1"
                  >
                    {(Array.from(toolInput.files) as File[]).map((file, idx) => (
                      <Reorder.Item 
                        key={`${file.name}-${idx}`} 
                        value={file}
                        className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl group cursor-grab active:cursor-grabbing hover:border-blue-200 transition-colors"
                      >
                        <GripVertical className="w-4 h-4 text-slate-300 group-hover:text-blue-400" />
                        <span className="flex-1 text-sm font-medium text-slate-700 truncate">{file.name}</span>
                        <div className="flex gap-1">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
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
                      </Reorder.Item>
                    ))}
                  </Reorder.Group>
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
                  {(toolInput.type === 'text' || toolInput.type === 'reorder' || toolInput.type === 'select' || toolInput.type === 'settings') && (
                    <button
                      onClick={() => handleProcess(toolInput.files, toolInput.action)}
                      className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
                    >
                      {toolInput.type === 'reorder' ? 'Tiến hành Gộp' : 'Xác nhận'}
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
                    Chào mừng bạn đến với <strong>Brilliant Office Tool</strong>. 
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
                    <div className="text-slate-700 font-bold">v2.0.3 - Pro Edition</div>
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
          isMobile={isMobileEditor}
          onClose={() => {
            setPhotoEditorFile(null);
            setIsMobileEditor(false);
          }}
          onSave={(blob) => {
            downloadBlob(blob, 'edited-image.png');
            setPhotoEditorFile(null);
            setIsMobileEditor(false);
          }}
        />
      )}
    </div>
  );
}
