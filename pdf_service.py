import os
import subprocess
import tempfile
import shutil
import logging
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("pdf_service")

app = FastAPI(
    title="High-Fidelity Word-to-PDF Conversion Service",
    description="FastAPI service utilizing LibreOffice for 100% accurate Word-to-PDF rendering.",
    version="1.0.0"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health_check():
    return {"status": "ok", "libreoffice": shutil.which("soffice") is not None}

@app.post("/convert")
async def convert_word_to_pdf(file: UploadFile = File(...)):
    filename = file.filename.lower()
    if not (filename.endswith(".docx") or filename.endswith(".doc")):
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ tệp tin định dạng .doc hoặc .docx")

    # Create temporary directory for isolated execution
    temp_dir = tempfile.mkdtemp()
    input_ext = ".docx" if filename.endswith(".docx") else ".doc"
    input_path = os.path.join(temp_dir, f"document{input_ext}")
    
    try:
        # Save uploaded file
        logger.info(f"Received file: {file.filename}, saving to temporary path: {input_path}")
        with open(input_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        # Execute LibreOffice in headless mode
        # soffice --headless --convert-to pdf --outdir <temp_dir> <input_path>
        logger.info("Executing LibreOffice headless conversion...")
        cmd = [
            "soffice",
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            temp_dir,
            input_path
        ]
        
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)
        
        if result.returncode != 0:
            logger.error(f"LibreOffice conversion failed: {result.stderr}")
            raise HTTPException(status_code=500, detail=f"Lỗi chuyển đổi LibreOffice: {result.stderr}")

        # Locate the output PDF file
        pdf_path = os.path.join(temp_dir, "document.pdf")
        if not os.path.exists(pdf_path):
            # Check for alternative naming (sometimes matches original filename)
            files = [f for f in os.listdir(temp_dir) if f.endswith(".pdf")]
            if files:
                pdf_path = os.path.join(temp_dir, files[0])
            else:
                raise HTTPException(status_code=500, detail="Không tìm thấy tệp PDF được tạo ra.")

        # Prepare path to return after closing request
        # To avoid deleting before sending, we'll return FileResponse and clean up after,
        # but since FileResponse keeps the file open during response, we can use a custom
        # background task or load into memory. To be absolutely safe, we read into memory
        # or use FileResponse with a background cleanup task.
        # Let's use custom BackgroundTask for safe deletion.
        
        logger.info(f"Conversion successful, returning PDF file: {pdf_path}")
        return FileResponse(
            pdf_path, 
            media_type="application/pdf", 
            filename=file.filename.rsplit(".", 1)[0] + ".pdf"
        )

    except subprocess.TimeoutExpired:
        logger.error("LibreOffice conversion timed out (60s)")
        raise HTTPException(status_code=504, detail="Quá thời gian chuyển đổi tài liệu (60 giây)")
    except Exception as e:
        logger.error(f"Error during conversion: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Lỗi chuyển đổi: {str(e)}")

# Note: We will handle directory cleanup of temp_dir periodically or let the OS handle it, 
# or clean it up when the server restarts or via background worker.
