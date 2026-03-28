import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import path from "path";
import fs from "fs";
import cors from "cors";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  const upload = multer({ storage: multer.memoryStorage() });

  // API: Image Conversion & Compression
  app.post("/api/convert", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      
      const { format, quality } = req.body;
      const q = parseInt(quality) || 85;
      
      let processor = sharp(req.file.buffer);
      
      if (format === "jpeg" || format === "jpg") {
        processor = processor.jpeg({ quality: q, chromaSubsampling: '4:4:4' });
      } else if (format === "webp") {
        processor = processor.webp({ quality: q });
      } else if (format === "avif") {
        processor = processor.avif({ quality: q });
      } else if (format === "png") {
        // PNG uses compression level 0-9
        const compressionLevel = Math.floor((100 - q) / 10);
        processor = processor.png({ compressionLevel: Math.max(0, Math.min(9, compressionLevel)) });
      }

      const buffer = await processor.toBuffer();
      
      res.set("Content-Type", `image/${format === 'jpg' ? 'jpeg' : format}`);
      res.send(buffer);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Conversion failed" });
    }
  });

  // API: Image to PDF
  app.post("/api/to-pdf", upload.array("files"), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) return res.status(400).json({ error: "No files uploaded" });

      const quality = parseInt(req.body.quality as string) || 85;
      const pdfDoc = await PDFDocument.create();
      
      for (const file of files) {
        let image;
        // Always process with sharp to apply quality/compression
        const processedBuffer = await sharp(file.buffer)
          .jpeg({ quality })
          .toBuffer();
        
        image = await pdfDoc.embedJpg(processedBuffer);

        const page = pdfDoc.addPage([image.width, image.height]);
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: image.width,
          height: image.height,
        });
      }

      const pdfBytes = await pdfDoc.save();
      res.set("Content-Type", "application/pdf");
      res.send(Buffer.from(pdfBytes));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "PDF creation failed" });
    }
  });

  // API: Compress PDF
  app.post("/api/pdf/compress", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      
      const pdfDoc = await PDFDocument.load(req.file.buffer);
      
      // Basic compression by re-saving with object streams
      // For real compression we'd need to downscale images, which is complex
      const pdfBytes = await pdfDoc.save({
        useObjectStreams: true,
        addDefaultPage: false,
      });

      res.set("Content-Type", "application/pdf");
      res.send(Buffer.from(pdfBytes));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "PDF compression failed" });
    }
  });

  // API: Merge PDFs
  app.post("/api/pdf/merge", upload.array("files"), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length < 2) return res.status(400).json({ error: "At least 2 files required" });

      const mergedPdf = await PDFDocument.create();
      for (const file of files) {
        const pdf = await PDFDocument.load(file.buffer);
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }

      const pdfBytes = await mergedPdf.save();
      res.set("Content-Type", "application/pdf");
      res.send(Buffer.from(pdfBytes));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "PDF merging failed" });
    }
  });

  // API: Split PDF (returns a zip of individual pages)
  app.post("/api/pdf/split", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      
      const pdf = await PDFDocument.load(req.file.buffer);
      const pageCount = pdf.getPageCount();
      
      const archiver = (await import("archiver")).default;
      const archive = archiver("zip");
      
      res.set("Content-Type", "application/zip");
      res.set("Content-Disposition", `attachment; filename="split_pdf.zip"`);
      archive.pipe(res);

      for (let i = 0; i < pageCount; i++) {
        const newPdf = await PDFDocument.create();
        const [page] = await newPdf.copyPages(pdf, [i]);
        newPdf.addPage(page);
        const pdfBytes = await newPdf.save();
        archive.append(Buffer.from(pdfBytes), { name: `page_${i + 1}.pdf` });
      }

      await archive.finalize();
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "PDF splitting failed" });
    }
  });

  // API: Delete Pages
  app.post("/api/pdf/delete-pages", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const pagesToDelete = JSON.parse(req.body.pages); // Array of 0-indexed page numbers
      
      const pdf = await PDFDocument.load(req.file.buffer);
      const newPdf = await PDFDocument.create();
      
      const pageIndices = pdf.getPageIndices().filter(i => !pagesToDelete.includes(i));
      const copiedPages = await newPdf.copyPages(pdf, pageIndices);
      copiedPages.forEach(page => newPdf.addPage(page));

      const pdfBytes = await newPdf.save();
      res.set("Content-Type", "application/pdf");
      res.send(Buffer.from(pdfBytes));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Page deletion failed" });
    }
  });

  // API: Extract Pages
  app.post("/api/pdf/extract-pages", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const pagesToExtract = JSON.parse(req.body.pages); // Array of 0-indexed page numbers
      
      const pdf = await PDFDocument.load(req.file.buffer);
      const newPdf = await PDFDocument.create();
      
      const copiedPages = await newPdf.copyPages(pdf, pagesToExtract);
      copiedPages.forEach(page => newPdf.addPage(page));

      const pdfBytes = await newPdf.save();
      res.set("Content-Type", "application/pdf");
      res.send(Buffer.from(pdfBytes));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Page extraction failed" });
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
