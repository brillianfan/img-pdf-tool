import piexif from 'piexifjs';
import UTIF from 'utif';
import heic2any from 'heic2any';
import { changeDpiInPng, changeDpiInJpeg } from './dpiUtils';

export interface RotateImageResult {
  blob: Blob;
  width: number;
  height: number;
  extension: string;
}

function normalizeAngle(angle: number): number {
  return ((Math.round(angle) % 360) + 360) % 360;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Không thể đọc dữ liệu ảnh'));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string, fallbackMime: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/data:([^;]+);/);
  const mime = mimeMatch ? mimeMatch[1] : fallbackMime;
  const byteString = atob(base64);
  const ab = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    ab[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mime });
}

function extractPngDpi(buffer: ArrayBuffer): number | null {
  const uint8 = new Uint8Array(buffer);
  if (uint8.length < 33) return null;
  // Verify PNG signature
  if (uint8[0] !== 0x89 || uint8[1] !== 0x50 || uint8[2] !== 0x4e || uint8[3] !== 0x47) {
    return null;
  }
  let pos = 8;
  while (pos <= uint8.length - 12) {
    const chunkLen =
      ((uint8[pos] << 24) | (uint8[pos + 1] << 16) | (uint8[pos + 2] << 8) | uint8[pos + 3]) >>> 0;
    if (pos + 12 + chunkLen > uint8.length) break;
    const chunkType = String.fromCharCode(uint8[pos + 4], uint8[pos + 5], uint8[pos + 6], uint8[pos + 7]);
    if (chunkType === 'pHYs' && chunkLen === 9) {
      const view = new DataView(buffer, pos + 8, 9);
      const xPpm = view.getUint32(0);
      const unit = view.getUint8(8);
      if (unit === 1 && xPpm > 0) {
        return Math.round(xPpm / 39.3701);
      }
      return null;
    }
    if (chunkType === 'IEND') break;
    pos += 12 + chunkLen;
  }
  return null;
}

function extractJpegJfifDpi(buffer: ArrayBuffer): number | null {
  const uint8 = new Uint8Array(buffer);
  if (uint8.length < 20 || uint8[0] !== 0xff || uint8[1] !== 0xd8) return null;
  const limit = Math.min(uint8.length - 16, 4096);
  for (let i = 2; i < limit; i++) {
    if (
      uint8[i] === 0xff &&
      uint8[i + 1] === 0xe0 &&
      uint8[i + 4] === 0x4a && // J
      uint8[i + 5] === 0x46 && // F
      uint8[i + 6] === 0x49 && // I
      uint8[i + 7] === 0x46    // F
    ) {
      const units = uint8[i + 11];
      const xDensity = (uint8[i + 12] << 8) | uint8[i + 13];
      if (units === 1 && xDensity > 0) return xDensity; // dots per inch
      if (units === 2 && xDensity > 0) return Math.round(xDensity * 2.54); // dots per cm -> dpi
      return null;
    }
  }
  return null;
}

async function preserveJpegMetadata(
  origFile: Blob,
  rotatedBlob: Blob,
  outWidth: number,
  outHeight: number
): Promise<Blob> {
  try {
    const origBuffer = await origFile.arrayBuffer();
    const jfifDpi = extractJpegJfifDpi(origBuffer);
    const origDataUrl = await blobToDataUrl(origFile);
    let rotatedDataUrl = await blobToDataUrl(rotatedBlob);

    let exifDpi: number | null = null;
    try {
      const exifObj = piexif.load(origDataUrl);
      if (exifObj['0th']) {
        exifObj['0th'][piexif.ImageIFD.Orientation] = 1;
        const xRes = exifObj['0th'][piexif.ImageIFD.XResolution];
        const resUnit = exifObj['0th'][piexif.ImageIFD.ResolutionUnit];
        if (Array.isArray(xRes) && xRes.length === 2 && xRes[1] > 0) {
          const val = xRes[0] / xRes[1];
          if (resUnit === 3) {
            exifDpi = Math.round(val * 2.54);
          } else if (val > 0) {
            exifDpi = Math.round(val);
          }
        }
      }
      if (exifObj['Exif']) {
        if (piexif.ExifIFD.PixelXDimension in exifObj['Exif']) {
          exifObj['Exif'][piexif.ExifIFD.PixelXDimension] = outWidth;
        }
        if (piexif.ExifIFD.PixelYDimension in exifObj['Exif']) {
          exifObj['Exif'][piexif.ExifIFD.PixelYDimension] = outHeight;
        }
      }
      // Remove stale unrotated thumbnail to prevent EXIF corruption/size bloat
      delete exifObj.thumbnail;
      delete exifObj['1st'];

      const exifBytes = piexif.dump(exifObj);
      rotatedDataUrl = piexif.insert(exifBytes, rotatedDataUrl);
    } catch {
      // Original JPEG may not contain EXIF; continue with JFIF DPI preservation
    }

    let finalBlob = dataUrlToBlob(rotatedDataUrl, 'image/jpeg');
    const targetDpi = exifDpi || jfifDpi;
    if (targetDpi && targetDpi > 0) {
      finalBlob = await changeDpiInJpeg(finalBlob, targetDpi);
    }
    return finalBlob;
  } catch {
    return rotatedBlob;
  }
}

async function rotateTiffFile(file: File, angle: number): Promise<RotateImageResult> {
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf);
  if (!ifds || ifds.length === 0) {
    throw new Error(`Không thể giải mã tệp TIFF: ${file.name}`);
  }
  const page = ifds[0];
  UTIF.decodeImage(buf, page);
  const rgba = UTIF.toRGBA8(page);
  const srcW = page.width;
  const srcH = page.height;

  if (!srcW || !srcH || !rgba || rgba.length < srcW * srcH * 4) {
    throw new Error(`Dữ liệu TIFF không hợp lệ: ${file.name}`);
  }

  const outW = angle === 90 || angle === 270 ? srcH : srcW;
  const outH = angle === 90 || angle === 270 ? srcW : srcH;
  const outRgba = new Uint8Array(outW * outH * 4);

  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      let nx = x;
      let ny = y;
      if (angle === 90) {
        nx = srcH - 1 - y;
        ny = x;
      } else if (angle === 180) {
        nx = srcW - 1 - x;
        ny = srcH - 1 - y;
      } else if (angle === 270) {
        nx = y;
        ny = srcW - 1 - x;
      }
      const srcIdx = (y * srcW + x) * 4;
      const dstIdx = (ny * outW + nx) * 4;
      outRgba[dstIdx] = rgba[srcIdx];
      outRgba[dstIdx + 1] = rgba[srcIdx + 1];
      outRgba[dstIdx + 2] = rgba[srcIdx + 2];
      outRgba[dstIdx + 3] = rgba[srcIdx + 3];
    }
  }

  const encoded = UTIF.encodeImage(outRgba, outW, outH);
  return {
    blob: new Blob([encoded], { type: 'image/tiff' }),
    width: outW,
    height: outH,
    extension: file.name.toLowerCase().endsWith('.tif') ? 'tif' : 'tiff',
  };
}

async function decodeImageSource(blob: Blob): Promise<{
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fallback to HTMLImageElement below
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      resolve({
        source: img,
        width,
        height,
        cleanup: () => URL.revokeObjectURL(url),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không thể giải mã tệp ảnh này trong trình duyệt.'));
    };
    img.src = url;
  });
}

function mimeToExtension(mime: string, originalExt: string): string {
  const m = mime.toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') {
    return originalExt === 'jpeg' || originalExt === 'jfif' ? originalExt : 'jpg';
  }
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/tiff') return originalExt === 'tif' ? 'tif' : 'tiff';
  return originalExt || 'png';
}

function encodeCanvas(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b && b.size > 0) resolve(b);
        else reject(new Error('Không thể xuất dữ liệu ảnh sau khi xoay.'));
      },
      mimeType,
      quality
    );
  });
}

async function encodeAdaptiveQuality(
  canvas: HTMLCanvasElement,
  mimeType: string,
  targetSizeBytes: number
): Promise<Blob> {
  // Start at 0.92 (high visual fidelity without libjpeg quality-1.0 bloat)
  const initialQuality = 0.92;
  const initialBlob = await encodeCanvas(canvas, mimeType, initialQuality);

  if (targetSizeBytes <= 0) {
    return initialBlob;
  }

  // Already within a tight range of the original file size
  if (initialBlob.size <= targetSizeBytes * 1.05 && initialBlob.size >= targetSizeBytes * 0.85) {
    return initialBlob;
  }

  if (initialBlob.size > targetSizeBytes * 1.05) {
    // Search downward in [0.75, 0.92] to match original size without unnecessary bloat
    let low = 0.75;
    let high = initialQuality;
    let bestUnder: Blob | null = null;
    let lastBlob = initialBlob;

    for (let step = 0; step < 4; step++) {
      const mid = (low + high) / 2;
      const candidate = await encodeCanvas(canvas, mimeType, mid);
      lastBlob = candidate;
      if (candidate.size <= targetSizeBytes * 1.03) {
        bestUnder = candidate;
        low = mid;
      } else {
        high = mid;
      }
    }
    return bestUnder || lastBlob;
  } else {
    // Initial 0.92 is smaller than 85% of original -> original was higher bitrate;
    // safely step up within [0.92, 0.97] (avoiding 0.98-1.0 exponential size explosion)
    let low = initialQuality;
    let high = 0.97;
    let best: Blob = initialBlob;

    for (let step = 0; step < 4; step++) {
      const mid = (low + high) / 2;
      const candidate = await encodeCanvas(canvas, mimeType, mid);
      if (candidate.size <= targetSizeBytes * 1.05) {
        best = candidate;
        low = mid;
      } else {
        high = mid;
      }
    }
    return best;
  }
}

export async function rotateImagePreserveOriginal(file: File, rawAngle: number): Promise<RotateImageResult> {
  const angle = normalizeAngle(rawAngle);
  const lowerName = file.name.toLowerCase();
  const origExtMatch = lowerName.match(/\.([^.]+)$/);
  const origExt = origExtMatch ? origExtMatch[1] : 'png';

  if (angle === 0) {
    return {
      blob: file,
      width: 0,
      height: 0,
      extension: origExt,
    };
  }

  // Handle TIFF natively using UTIF (lossless pixel permutation)
  if (origExt === 'tif' || origExt === 'tiff' || file.type === 'image/tiff') {
    return rotateTiffFile(file, angle);
  }

  // Handle HEIC/HEIF by converting to high-quality JPEG (avoids massive PNG bloat on camera photos)
  let workingBlob: Blob = file;
  let workingExt = origExt;
  let workingMime = file.type;
  let targetSizeBytes = file.size;

  if (origExt === 'heic' || origExt === 'heif') {
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
    workingBlob = Array.isArray(converted) ? converted[0] : converted;
    workingExt = 'jpg';
    workingMime = 'image/jpeg';
    targetSizeBytes = Math.max(workingBlob.size, Math.round(file.size * 1.35));
  }

  const decoded = await decodeImageSource(workingBlob);
  try {
    const srcW = decoded.width;
    const srcH = decoded.height;
    if (!srcW || !srcH) {
      throw new Error(`Không đọc được kích thước ảnh: ${file.name}`);
    }

    const outW = angle === 90 || angle === 270 ? srcH : srcW;
    const outH = angle === 90 || angle === 270 ? srcW : srcH;

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Trình duyệt không hỗ trợ xử lý Canvas.');
    }

    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (angle === 90) {
      ctx.translate(outW, 0);
      ctx.rotate(Math.PI / 2);
    } else if (angle === 180) {
      ctx.translate(outW, outH);
      ctx.rotate(Math.PI);
    } else if (angle === 270) {
      ctx.translate(0, outH);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(decoded.source, 0, 0, srcW, srcH);
    ctx.restore();

    const isJpeg =
      workingMime === 'image/jpeg' ||
      workingMime === 'image/jpg' ||
      workingExt === 'jpg' ||
      workingExt === 'jpeg' ||
      workingExt === 'jfif';
    const isWebp = workingMime === 'image/webp' || workingExt === 'webp';

    const targetMime = isJpeg ? 'image/jpeg' : isWebp ? 'image/webp' : 'image/png';

    let outBlob: Blob;
    if (targetMime === 'image/png') {
      outBlob = await encodeCanvas(canvas, 'image/png');
    } else {
      outBlob = await encodeAdaptiveQuality(canvas, targetMime, targetSizeBytes);
    }

    // Preserve original DPI and EXIF metadata
    if (outBlob.type === 'image/jpeg') {
      outBlob = await preserveJpegMetadata(workingBlob, outBlob, outW, outH);
    } else if (outBlob.type === 'image/png') {
      const origPngDpi = extractPngDpi(await workingBlob.arrayBuffer());
      if (origPngDpi && origPngDpi > 0) {
        outBlob = await changeDpiInPng(outBlob, origPngDpi);
      }
    }

    return {
      blob: outBlob,
      width: outW,
      height: outH,
      extension: mimeToExtension(outBlob.type, workingExt),
    };
  } finally {
    decoded.cleanup();
  }
}
