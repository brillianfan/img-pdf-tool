import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import multer from "multer";
import WordExtractor from "word-extractor";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { spawn } from "child_process";

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
