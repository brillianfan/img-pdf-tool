import React, { useState, useCallback } from 'react';
import { 
  X, 
  FileText, 
  Loader2, 
  Download, 
  Copy, 
  File as FileIcon, 
  AlertCircle,
  Check,
  ChevronRight,
  GripVertical
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { saveAs } from "file-saver";
import * as pdfjsLib from 'pdfjs-dist';

// pdfjs worker setup
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface AIOCRToolProps {
  files: File[];
  onClose: () => void;
}

interface ExtractionResult {
  fileName: string;
  text: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  error?: string;
}

export default function AIOCRTool({ files: initialFiles, onClose }: AIOCRToolProps) {
  const [results, setResults] = useState<ExtractionResult[]>(
    initialFiles.map(f => ({ fileName: f.name, text: '', status: 'pending' }))
  );
  const [isProcessingAll, setIsProcessingAll] = useState(false);

  const processFile = async (file: File, index: number) => {
    setResults(prev => {
      const newResults = [...prev];
      newResults[index] = { ...newResults[index], status: 'processing' };
      return newResults;
    });

    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      let imagesToProcess: string[] = [];

      if (extension === 'pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (context) {
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport } as any).promise;
            imagesToProcess.push(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
          }
        }
      } else {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
        imagesToProcess.push(base64);
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      let fullText = "";

      for (const base64 of imagesToProcess) {
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: base64,
                  },
                },
                {
                  text: "Extract all text from this image as accurately as possible. Maintain the structure and paragraphs. Output only the extracted text.",
                },
              ],
            },
          ],
        });
        fullText += (response.text || "") + "\n\n";
      }

      setResults(prev => {
        const newResults = [...prev];
        newResults[index] = { ...newResults[index], status: 'success', text: fullText.trim() };
        return newResults;
      });
    } catch (error: any) {
      console.error(error);
      setResults(prev => {
        const newResults = [...prev];
        newResults[index] = { ...newResults[index], status: 'error', error: error.message || 'Lỗi xử lý' };
        return newResults;
      });
    }
  };

  const handleProcessAll = async () => {
    setIsProcessingAll(true);
    for (let i = 0; i < initialFiles.length; i++) {
      if (results[i].status === 'pending' || results[i].status === 'error') {
        await processFile(initialFiles[i], i);
      }
    }
    setIsProcessingAll(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const downloadDocx = async () => {
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: results
            .filter(r => r.status === 'success')
            .flatMap(r => [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Tệp: ${r.fileName}`,
                    bold: true,
                    size: 28,
                  }),
                ],
              }),
              ...r.text.split('\n').map(line => 
                new Paragraph({
                  children: [new TextRun(line)],
                })
              ),
              new Paragraph({ children: [new TextRun("")] }), // Spacer
            ]),
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, "trich_xuat_van_ban.docx");
  };

  return (
    <div className="fixed inset-0 z-[200] bg-slate-50 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-100">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800 leading-tight">Trích xuất văn bản AI (OCR)</h1>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Sử dụng Gemini AI Pro</p>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-all"
        >
          <X className="w-6 h-6" />
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: File List */}
        <div className="w-80 border-r border-slate-200 bg-slate-50/50 flex flex-col">
          <div className="p-4 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Danh sách tệp ({initialFiles.length})</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {results.map((res, idx) => (
              <div 
                key={idx}
                className={`p-3 rounded-xl border transition-all ${
                  res.status === 'processing' ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-200' :
                  res.status === 'success' ? 'bg-white border-slate-200' :
                  res.status === 'error' ? 'bg-rose-50 border-rose-200' :
                  'bg-white border-slate-200 opacity-60'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${
                    res.status === 'success' ? 'bg-emerald-50 text-emerald-600' :
                    res.status === 'error' ? 'bg-rose-50 text-rose-600' :
                    'bg-slate-50 text-slate-400'
                  }`}>
                    <FileIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-700 truncate">{res.fileName}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {res.status === 'pending' ? 'Đang chờ...' :
                       res.status === 'processing' ? 'Đang xử lý...' :
                       res.status === 'success' ? 'Hoàn tất' : 'Lỗi'}
                    </p>
                  </div>
                  {res.status === 'processing' && <Loader2 className="w-4 h-4 animate-spin text-blue-600" />}
                  {res.status === 'success' && <Check className="w-4 h-4 text-emerald-600" />}
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 bg-white border-t border-slate-200">
            <button
              onClick={handleProcessAll}
              disabled={isProcessingAll || results.every(r => r.status === 'success')}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-100"
            >
              {isProcessingAll ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Đang xử lý...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Bắt đầu trích xuất
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right: Results Preview */}
        <div className="flex-1 bg-white overflow-y-auto p-8 custom-scrollbar">
          {results.some(r => r.status === 'success') ? (
            <div className="max-w-3xl mx-auto space-y-12 pb-12">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <h2 className="text-xl font-bold text-slate-800">Kết quả trích xuất</h2>
                <button
                  onClick={downloadDocx}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg font-bold hover:bg-blue-100 transition-all"
                >
                  <Download className="w-4 h-4" />
                  Xuất File Word
                </button>
              </div>
              
              {results.filter(r => r.status === 'success').map((res, idx) => (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={idx} 
                  className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden"
                >
                  <div className="px-6 py-4 bg-white border-b border-slate-100 flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-600">{res.fileName}</span>
                    <button
                      onClick={() => copyToClipboard(res.text)}
                      className="p-2 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-blue-600 transition-all group"
                      title="Sao chép"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="p-6">
                    <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed">
                      {res.text}
                    </pre>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-6">
                <FileText className="w-10 h-10 text-slate-300" />
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">Chưa có kết quả</h3>
              <p className="text-slate-500 max-w-sm">
                Hãy nhấn nút "Bắt đầu trích xuất" ở cột bên trái để bắt đầu quá trình nhận diện văn bản bằng AI.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Sparkles(props: any) {
  return (
    <svg 
      {...props} 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" 
      height="24" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
      <path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
    </svg>
  );
}
