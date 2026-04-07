import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import path from "path";
import fs from "fs";
import cors from "cors";

import archiver from "archiver";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // API: Image Conversion & Compression
  app.post("/api/convert", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      
      const { format, quality, dpi } = req.body;
      const q = parseInt(quality) || 85;
      const d = parseInt(dpi) || 300;
      
      console.log(`Converting single image: ${req.file.originalname} -> ${format} (quality: ${q}, DPI: ${d})`);
      
      let processor = sharp(req.file.buffer).withMetadata({ density: d });
      
      if (format === "jpeg" || format === "jpg") {
        processor = processor.jpeg({ quality: q, chromaSubsampling: '4:4:4' });
      } else if (format === "webp") {
        processor = processor.webp({ quality: q });
      } else if (format === "avif") {
        processor = processor.avif({ quality: q });
      } else if (format === "png") {
        const compressionLevel = Math.floor((100 - q) / 10);
        processor = processor.png({ compressionLevel: Math.max(0, Math.min(9, compressionLevel)) });
      }

      const buffer = await processor.toBuffer();
      
      res.set("Content-Type", `image/${format === 'jpg' ? 'jpeg' : format}`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Conversion error:", error);
      res.status(500).json({ error: error.message || "Conversion failed" });
    }
  });

  // API: Multiple Image Conversion
  app.post("/api/convert-multiple", upload.array("files"), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) return res.status(400).json({ error: "No files uploaded" });
      
      const { format, quality, dpi } = req.body;
      const q = parseInt(quality) || 85;
      const d = parseInt(dpi) || 300;
      const targetExt = format === 'jpeg' || format === 'jpg' ? 'jpg' : format;
      
      console.log(`Converting ${files.length} images to ${format} (quality: ${q}, DPI: ${d})`);
      
      const archive = archiver("zip");
      res.set("Content-Type", "application/zip");
      res.set("Content-Disposition", `attachment; filename="converted_images.zip"`);
      archive.pipe(res);

      for (const file of files) {
        let processor = sharp(file.buffer).withMetadata({ density: d });
        
        if (format === "jpeg" || format === "jpg") {
          processor = processor.jpeg({ quality: q, chromaSubsampling: '4:4:4' });
        } else if (format === "webp") {
          processor = processor.webp({ quality: q });
        } else if (format === "png") {
          const compressionLevel = Math.floor((100 - q) / 10);
          processor = processor.png({ compressionLevel: Math.max(0, Math.min(9, compressionLevel)) });
        }

        const buffer = await processor.toBuffer();
        const fileName = path.parse(file.originalname).name;
        archive.append(buffer, { name: `${fileName}.${targetExt}` });
      }

      await archive.finalize();
    } catch (error: any) {
      console.error("Multiple conversion error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Conversion failed" });
      }
    }
  });

  // API: Image to PDF
  app.post("/api/to-pdf", upload.array("files"), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) return res.status(400).json({ error: "No files uploaded" });

      const quality = parseInt(req.body.quality as string) || 85;
      const dpi = parseInt(req.body.dpi as string) || 300;
      console.log(`Creating PDF from ${files.length} images with quality ${quality} and DPI ${dpi}`);
      
      const pdfDoc = await PDFDocument.create();
      
      for (const file of files) {
        // Always process with sharp to ensure compatibility and apply quality
        const processedBuffer = await sharp(file.buffer)
          .jpeg({ quality })
          .toBuffer();
        
        const image = await pdfDoc.embedJpg(processedBuffer);
        
        // Scale dimensions based on DPI (Standard PDF is 72 DPI)
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
      }

      const pdfBytes = await pdfDoc.save();
      res.set("Content-Type", "application/pdf");
      res.send(Buffer.from(pdfBytes));
    } catch (error: any) {
      console.error("PDF creation error:", error);
      res.status(500).json({ error: error.message || "PDF creation failed" });
    }
  });

  // API: Merge PDFs
  app.post("/api/pdf/merge", upload.array("files"), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length < 2) return res.status(400).json({ error: "At least 2 files required" });

      console.log(`Merging ${files.length} PDFs`);
      const mergedPdf = await PDFDocument.create();
      
      for (const file of files) {
        try {
          const pdf = await PDFDocument.load(file.buffer, { ignoreEncryption: true });
          const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
          copiedPages.forEach((page) => mergedPdf.addPage(page));
        } catch (loadErr) {
          console.error(`Error loading PDF ${file.originalname}:`, loadErr);
          return res.status(400).json({ error: `Không thể đọc tệp PDF: ${file.originalname}. Tệp có thể bị hỏng hoặc có mật khẩu bảo vệ.` });
        }
      }

      const pdfBytes = await mergedPdf.save({ useObjectStreams: true });
      res.set("Content-Type", "application/pdf");
      res.send(Buffer.from(pdfBytes));
    } catch (error: any) {
      console.error("PDF merge error:", error);
      res.status(500).json({ error: error.message || "PDF merging failed" });
    }
  });

  // API: Split PDF
  app.post("/api/pdf/split", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      
      console.log("Splitting PDF:", req.file.originalname);
      
      // Load PDF with ignoreEncryption to handle more files
      let pdf;
      try {
        pdf = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true });
      } catch (e) {
        return res.status(400).json({ error: "Không thể đọc tệp PDF. Tệp có thể bị hỏng hoặc có mật khẩu bảo vệ." });
      }

      const pageCount = pdf.getPageCount();
      if (pageCount === 0) {
        return res.status(400).json({ error: "Tệp PDF không có trang nào." });
      }
      
      const padding = pageCount.toString().length;
      const archive = archiver("zip", { zlib: { level: 5 } });
      
      // Handle archive errors
      archive.on('error', (err) => {
        console.error("Archive error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Lỗi khi nén tệp ZIP" });
        }
      });

      res.set("Content-Type", "application/zip");
      res.set("Content-Disposition", `attachment; filename="split_pdf.zip"`);
      archive.pipe(res);

      for (let i = 0; i < pageCount; i++) {
        try {
          const newPdf = await PDFDocument.create();
          const [page] = await newPdf.copyPages(pdf, [i]);
          newPdf.addPage(page);
          const pdfBytes = await newPdf.save();
          const pageNum = (i + 1).toString().padStart(padding, '0');
          archive.append(Buffer.from(pdfBytes), { name: `page_${pageNum}.pdf` });
        } catch (pageErr) {
          console.error(`Error splitting page ${i + 1}:`, pageErr);
        }
      }

      await archive.finalize();
    } catch (error: any) {
      console.error("PDF split error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "PDF splitting failed" });
      }
    }
  });

  // API: Delete Pages
  app.post("/api/pdf/delete-pages", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const pagesToDelete = JSON.parse(req.body.pages);
      
      console.log(`Deleting pages from ${req.file.originalname}: ${pagesToDelete.join(", ")}`);
      
      let pdf;
      try {
        pdf = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true });
      } catch (e) {
        return res.status(400).json({ error: "Không thể đọc tệp PDF. Tệp có thể bị hỏng hoặc có mật khẩu bảo vệ." });
      }

      const newPdf = await PDFDocument.create();
      const totalPages = pdf.getPageCount();
      const pageIndices = pdf.getPageIndices().filter(i => !pagesToDelete.includes(i));
      
      if (pageIndices.length === 0) {
        return res.status(400).json({ error: "Không thể xóa tất cả các trang" });
      }

      const copiedPages = await newPdf.copyPages(pdf, pageIndices);
      copiedPages.forEach(page => newPdf.addPage(page));

      const pdfBytes = await newPdf.save({ useObjectStreams: true });
      res.set("Content-Type", "application/pdf");
      res.send(Buffer.from(pdfBytes));
    } catch (error: any) {
      console.error("PDF delete pages error:", error);
      res.status(500).json({ error: error.message || "Page deletion failed" });
    }
  });

  // API: Extract Pages
  app.post("/api/pdf/extract-pages", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const pagesToExtract = JSON.parse(req.body.pages);
      
      console.log(`Extracting pages from ${req.file.originalname}: ${pagesToExtract.join(", ")}`);
      
      let pdf;
      try {
        pdf = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true });
      } catch (e) {
        return res.status(400).json({ error: "Không thể đọc tệp PDF. Tệp có thể bị hỏng hoặc có mật khẩu bảo vệ." });
      }

      const newPdf = await PDFDocument.create();
      const totalPages = pdf.getPageCount();
      const validPages = pagesToExtract.filter((p: number) => p >= 0 && p < totalPages);
      
      if (validPages.length === 0) {
        return res.status(400).json({ error: "Số trang trích xuất không hợp lệ" });
      }

      const copiedPages = await newPdf.copyPages(pdf, validPages);
      copiedPages.forEach(page => newPdf.addPage(page));

      const pdfBytes = await newPdf.save({ useObjectStreams: true });
      res.set("Content-Type", "application/pdf");
      res.send(Buffer.from(pdfBytes));
    } catch (error: any) {
      console.error("PDF extract pages error:", error);
      res.status(500).json({ error: error.message || "Page extraction failed" });
    }
  });

  // API: Compress PDF (Rasterized or Optimized)
  app.post("/api/pdf/compress", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      
      const quality = parseInt(req.body.quality as string) || 85;
      const isRasterized = req.body.rasterize === 'true';
      
      console.log(`Compressing PDF (Rasterize: ${isRasterized}) with quality hint: ${quality}`);
      
      const pdfDoc = await PDFDocument.load(req.file.buffer);
      
      // If rasterized, we expect the frontend to have sent images instead, 
      // but if the user calls this directly, we just do object stream optimization.
      // The "Pro" rasterization is handled by the frontend sending images to /api/to-pdf.
      
      const pdfBytes = await pdfDoc.save({
        useObjectStreams: true,
        addDefaultPage: false,
      });

      res.set("Content-Type", "application/pdf");
      res.send(Buffer.from(pdfBytes));
    } catch (error: any) {
      console.error("PDF compression error:", error);
      res.status(500).json({ error: error.message || "PDF compression failed" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
