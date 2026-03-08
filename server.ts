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

      const pdfDoc = await PDFDocument.create();
      
      for (const file of files) {
        let image;
        if (file.mimetype === "image/jpeg" || file.mimetype === "image/jpg") {
          image = await pdfDoc.embedJpg(file.buffer);
        } else if (file.mimetype === "image/png") {
          image = await pdfDoc.embedPng(file.buffer);
        } else {
          // Convert other formats to PNG first using sharp
          const pngBuffer = await sharp(file.buffer).png().toBuffer();
          image = await pdfDoc.embedPng(pngBuffer);
        }

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
