/**
 * Handles high-fidelity conversion of .docx and .doc documents using our robust 
 * LibreOffice Linux server engine to guarantee 100% accurate styling, alignments, and margins.
 */

export async function convertDocxToPdf(file: File, onProgress?: (msg: string) => void): Promise<Blob> {
  if (onProgress) onProgress("Đang kết nối với máy chủ chuyển đổi chất lượng cao...");
  return sendFileToBackendConverter(file, onProgress);
}

export async function convertDocToPdf(file: File, onProgress?: (msg: string) => void): Promise<Blob> {
  if (onProgress) onProgress("Đang kết nối với máy chủ chuyển đổi chất lượng cao...");
  return sendFileToBackendConverter(file, onProgress);
}

async function sendFileToBackendConverter(file: File, onProgress?: (msg: string) => void): Promise<Blob> {
  const formData = new FormData();
  formData.append("file", file);

  if (onProgress) onProgress("Đang tải tệp lên và tiến hành kết xuất PDF chính xác 100% (LibreOffice)...");

  const response = await fetch("/api/convert-doc", {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Máy chủ báo lỗi chuyển đổi (${response.status})`);
  }

  if (onProgress) onProgress("Đang chuẩn bị tải tệp PDF đã hoàn thành...");
  return await response.blob();
}
