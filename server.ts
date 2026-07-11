import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import multer from "multer";
import WordExtractor from "word-extractor";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

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

  // Endpoint to convert old Word .doc to beautiful layout-reconstructive HTML via Gemini
  app.post("/api/convert-doc", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Vui lòng chọn tệp tin để chuyển đổi." });
      }

      const filename = req.file.originalname.toLowerCase();
      console.log(`[API convert-doc] Processing ${filename} (${req.file.size} bytes)`);

      let extractedText = "";

      if (filename.endsWith(".doc")) {
        const extractor = new WordExtractor();
        const extracted = await extractor.extract(req.file.buffer);
        extractedText = extracted.getBody();
      } else {
        return res.status(400).json({ error: "Định dạng tệp không được hỗ trợ. Chỉ hỗ trợ tệp tin .doc trên endpoint này." });
      }

      if (!extractedText || extractedText.trim().length === 0) {
        return res.status(400).json({ error: "Không thể trích xuất văn bản từ tệp tin Word .doc này. Tệp có thể trống hoặc bị lỗi." });
      }

      console.log(`[API convert-doc] Extracted ${extractedText.length} characters of text. Invoking Gemini model for smart layout generation...`);

      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        console.error("[API convert-doc] Missing GEMINI_API_KEY environment variable");
        return res.status(500).json({ error: "Lỗi cấu hình máy chủ: Thiếu API key của Gemini." });
      }

      const ai = new GoogleGenAI({
        apiKey: geminiApiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      // We use gemini-3.5-flash as recommended by the gemini-api skill for general text rebuilding tasks
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Analyze the following raw text extracted from a Word (.doc) document.
Your task is to reconstruct this document into a highly professional, clean, semantic, and modern HTML document (including standard Margins, Padding, and complete CSS styling).

Ensure that:
1. It uses clean, modern typography (Arial, Calibri, Times New Roman, or standard sans-serif/serif system fonts). Since this is a Vietnamese document, use standard Vietnamese-compatible fonts.
2. Proper line heights (e.g., 1.5), margins (e.g., 20mm standard document margins), font sizes, and heading hierarchies are applied to create an elegant corporate/official document layout.
3. Tables are styled beautifully with clean thin borders, proper column alignments, padded cells, and a distinctive table header row.
4. Document paragraphs are properly spaced and aligned (standard justify alignment is usually used for Vietnamese formal documents).
5. All text content is preserved 100% accurately and completely. Do NOT summarize, modify, or omit any text, sentences, or names.
6. The output must be a complete self-contained HTML page starting with <!DOCTYPE html> and containing <html>, <head> with styles, and <body>.
7. Return ONLY the raw HTML code. Do NOT wrap the output in markdown code blocks (such as \`\`\`html ... \`\`\`), do NOT include any introductory or concluding explanation text. Just start directly with <!DOCTYPE html>.

Extracted Document Text:
${extractedText}`,
      });

      let htmlContent = response.text || "";
      
      // Sanitization/cleanup of markdown fences if present
      if (htmlContent.includes("```html")) {
        htmlContent = htmlContent.split("```html")[1].split("```")[0];
      } else if (htmlContent.includes("```")) {
        htmlContent = htmlContent.split("```")[1].split("```")[0];
      }
      
      htmlContent = htmlContent.trim();
      console.log(`[API convert-doc] Smart HTML generated successfully (${htmlContent.length} characters)`);

      res.json({ html: htmlContent });
    } catch (error: any) {
      console.error("[API convert-doc] Error processing document:", error);
      res.status(500).json({ error: `Lỗi xử lý tài liệu: ${error.message || error}` });
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
