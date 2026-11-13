import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import multer from "multer";
import WordExtractor from "word-extractor";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { spawn } from "child_process";
import sharp from "sharp";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  const upload = multer({ storage: multer.memoryStorage() });

  // Spawn Python FastAPI conversion service
  console.log("[Server Startup] Spawning high-fidelity Python PDF conversion service on port 8000...");
  const pythonService = spawn("python3", [
    "-m", 
    "uvicorn", 
    "pdf_service:app", 
    "--host", 
    "127.0.0.1", 
    "--port", 
    "8000"
  ]);
  
  pythonService.stdout.on("data", (data) => {
    console.log(`[Python Service]: ${data.toString().trim()}`);
  });

  pythonService.stderr.on("data", (data) => {
    console.error(`[Python Service Error]: ${data.toString().trim()}`);
  });

  pythonService.on("close", (code) => {
    console.log(`[Python Service] Process exited with code ${code}`);
  });

  process.on("SIGINT", () => {
    pythonService.kill();
    process.exit();
  });
  
  process.on("SIGTERM", () => {
    pythonService.kill();
    process.exit();
  });

  // Unified high-fidelity Word (.doc and .docx) to PDF conversion endpoint
  app.post("/api/convert-doc", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Vui lòng chọn tệp tin để chuyển đổi." });
      }

      const filename = req.file.originalname.toLowerCase();
      console.log(`[API convert-doc] Forwarding ${filename} (${req.file.size} bytes) to high-fidelity Python FastAPI service...`);

      // Prepare Multipart Form Data for Python FastAPI upload
      const formData = new FormData();
      const fileBlob = new Blob([req.file.buffer], { type: req.file.mimetype });
      formData.append("file", fileBlob, req.file.originalname);

      const fastapiResponse = await fetch("http://127.0.0.1:8000/convert", {
        method: "POST",
        body: formData,
      });

      if (!fastapiResponse.ok) {
        const errorText = await fastapiResponse.text();
        console.error(`[API convert-doc] Python service returned error: ${errorText}`);
        return res.status(500).json({ error: `Dịch vụ chuyển đổi Python báo lỗi: ${errorText}` });
      }

      const pdfBuffer = await fastapiResponse.arrayBuffer();
      console.log(`[API convert-doc] Conversion successful, returning PDF binary stream of ${pdfBuffer.byteLength} bytes.`);
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(req.file.originalname.replace(/\.docx?$/i, ''))}.pdf"`);
      res.send(Buffer.from(pdfBuffer));
    } catch (error: any) {
      console.error("[API convert-doc] Error converting document:", error);
      res.status(500).json({ error: `Lỗi kết nối với dịch vụ chuyển đổi: ${error.message || error}` });
    }
  });

  // High-fidelity image rotation preserving original dimensions, DPI & quality
  app.post("/api/rotate-image", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Vui lòng chọn tệp ảnh để xoay." });
      }

      const rawAngle = parseInt(req.body?.angle ?? "90", 10);
      const userAngle = (((isNaN(rawAngle) ? 0 : rawAngle) % 360) + 360) % 360;

      const inputBuffer = req.file.buffer;
      const meta = await sharp(inputBuffer, { limitInputPixels: false }).metadata();
      const format = (meta.format || "").toLowerCase();
      const isAnimated = format === "gif" || (format === "webp" && (meta.pages ?? 1) > 1);
      const orientation = meta.orientation || 1;

      if (userAngle === 0 && orientation === 1) {
        res.setHeader("Content-Type", req.file.mimetype || "application/octet-stream");
        if (meta.width) res.setHeader("X-Output-Width", String(meta.width));
        if (meta.height) res.setHeader("X-Output-Height", String(meta.height));
        if (format) res.setHeader("X-Output-Format", format);
        return res.send(inputBuffer);
      }

      const standardOrientAngle: Record<number, number> = {
        1: 0,
        3: 180,
        6: 90,
        8: 270,
      };

      let pipeline: sharp.Sharp;

      if (!isAnimated && orientation in standardOrientAngle) {
        const totalAngle = (standardOrientAngle[orientation] + userAngle) % 360;
        pipeline = sharp(inputBuffer, { limitInputPixels: false }).rotate(totalAngle);
      } else if (!isAnimated && [2, 4, 5, 7].includes(orientation)) {
        // Mirrored EXIF orientation: auto-orient cleanly to raw pixels first, then apply user rotation
        const { data, info } = await sharp(inputBuffer, { limitInputPixels: false })
          .rotate()
          .raw()
          .toBuffer({ resolveWithObject: true });
        pipeline = sharp(data, {
          raw: {
            width: info.width,
            height: info.height,
            channels: info.channels,
          },
          limitInputPixels: false,
        }).rotate(userAngle);
        if (meta.icc) {
          pipeline = pipeline.withIccProfile(meta.icc as unknown as string);
        }
      } else {
        pipeline = sharp(inputBuffer, { animated: isAnimated, limitInputPixels: false }).rotate(userAngle);
      }

      // Preserve original metadata (DPI, EXIF, ICC, XMP) and normalize Orientation to 1
      const metadataOptions: sharp.WriteableMetadata = { orientation: 1 };
      if (meta.density) {
        metadataOptions.density = meta.density;
      }
      pipeline = pipeline.withMetadata(metadataOptions);

      let mimeType = req.file.mimetype || "image/png";
      let outFormat = format;

      if (format === "jpeg" || format === "jpg") {
        pipeline = pipeline.jpeg({
          quality: 100,
          chromaSubsampling: "4:4:4",
          mozjpeg: false,
        });
        mimeType = "image/jpeg";
        outFormat = "jpg";
      } else if (format === "png") {
        pipeline = pipeline.png({ compressionLevel: 6 });
        mimeType = "image/png";
        outFormat = "png";
      } else if (format === "webp") {
        pipeline = pipeline.webp({ lossless: true, quality: 100 });
        mimeType = "image/webp";
        outFormat = "webp";
      } else if (format === "tiff" || format === "tif") {
        pipeline = pipeline.tiff({ quality: 100 });
        mimeType = "image/tiff";
        outFormat = "tiff";
      } else if (format === "gif") {
        pipeline = pipeline.gif();
        mimeType = "image/gif";
        outFormat = "gif";
      } else if (format === "avif") {
        pipeline = pipeline.avif({ lossless: true, quality: 100 });
        mimeType = "image/avif";
        outFormat = "avif";
      } else {
        pipeline = pipeline.png({ compressionLevel: 6 });
        mimeType = "image/png";
        outFormat = "png";
      }

      const { data: outputBuffer, info: outInfo } = await pipeline.toBuffer({ resolveWithObject: true });

      res.setHeader("Content-Type", mimeType);
      res.setHeader("X-Output-Width", String(outInfo.width));
      res.setHeader("X-Output-Height", String(outInfo.height));
      res.setHeader("X-Output-Format", outFormat);
      res.send(outputBuffer);
    } catch (error: any) {
      console.error("[API rotate-image] Error rotating image:", error);
      res.status(500).json({ error: `Lỗi khi xoay ảnh: ${error.message || error}` });
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
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  return app;
}

const appPromise = startServer();
export default appPromise;
