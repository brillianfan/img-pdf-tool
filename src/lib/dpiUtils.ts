import piexif from 'piexifjs';

/**
 * Helper to change DPI in JPEG and PNG blobs without changing pixels.
 */

export async function changeDpiInPng(blob: Blob, dpi: number): Promise<Blob> {
  // 1 DPI = 39.3701 pixels per meter
  const pixelsPerMeter = Math.round(dpi * 39.3701);
  
  const physChunk = new Uint8Array(21);
  const view = new DataView(physChunk.buffer);
  
  view.setUint32(0, 9); // Length: 9 bytes
  view.setUint8(4, 0x70); // p
  view.setUint8(5, 0x48); // H
  view.setUint8(6, 0x59); // Y
  view.setUint8(7, 0x73); // s
  view.setUint32(8, pixelsPerMeter); // X
  view.setUint32(12, pixelsPerMeter); // Y
  view.setUint8(16, 1); // Unit: meter
  
  // CRC calculation
  let crc = 0xffffffff;
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
  }
  
  for (let i = 4; i < 17; i++) {
    crc = crcTable[(crc ^ physChunk[i]) & 0xff] ^ (crc >>> 8);
  }
  view.setUint32(17, crc ^ 0xffffffff);

  const arrayBuffer = await blob.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  
  // Find where to insert (after IHDR)
  let insertPos = 8; // Skip PNG signature
  const ihdrLen = (uint8[8] << 24) | (uint8[9] << 16) | (uint8[10] << 8) | uint8[11];
  insertPos = 8 + 4 + 4 + ihdrLen + 4; // Signature + Len + Type + Data + CRC

  // Find if pHYs already exists by walking chunks instead of blind substring search
  let existingPhys = -1;
  let pos = 8; // skip signature
  while (pos <= uint8.length - 12) {
    const chunkLen = ((uint8[pos] << 24) | (uint8[pos+1] << 16) | (uint8[pos+2] << 8) | uint8[pos+3]) >>> 0;
    if (pos + 8 + chunkLen + 4 > uint8.length) {
      break;
    }
    const chunkType = String.fromCharCode(uint8[pos+4], uint8[pos+5], uint8[pos+6], uint8[pos+7]);
    if (chunkType === 'pHYs' || chunkType === 'pHys' || chunkType === 'pHyS') {
      existingPhys = pos;
      break;
    }
    pos += 12 + chunkLen;
    if (chunkType === 'IEND') break;
  }

  if (existingPhys !== -1) {
    const part1 = uint8.slice(0, existingPhys);
    const part2 = uint8.slice(existingPhys + 21);
    const newUint8 = new Uint8Array(part1.length + part2.length);
    newUint8.set(part1);
    newUint8.set(part2, part1.length);
    // Find new insertion pos
    let newPos = 8 + 12 + ihdrLen; // Simplified after IHDR
    const final = new Uint8Array(newUint8.length + 21);
    final.set(newUint8.slice(0, newPos));
    final.set(physChunk, newPos);
    final.set(newUint8.slice(newPos), newPos + 21);
    return new Blob([final], { type: 'image/png' });
  } else {
    const final = new Uint8Array(uint8.length + 21);
    final.set(uint8.slice(0, insertPos));
    final.set(physChunk, insertPos);
    final.set(uint8.slice(insertPos), insertPos + 21);
    return new Blob([final], { type: 'image/png' });
  }
}

export async function changeDpiInJpeg(blob: Blob, dpi: number): Promise<Blob> {
  const reader = new FileReader();
  const base64Promise = new Promise<string>((resolve) => {
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
  const base64 = await base64Promise;
  
  try {
    const exifObj = piexif.load(base64);
    exifObj['0th'][piexif.ImageIFD.XResolution] = [dpi, 1];
    exifObj['0th'][piexif.ImageIFD.YResolution] = [dpi, 1];
    exifObj['0th'][piexif.ImageIFD.ResolutionUnit] = 2; // inches
    
    // Also set JFIF app0 manually to be sure
    const exifBytes = piexif.dump(exifObj);
    let newBase64 = piexif.insert(exifBytes, base64);
    
    const byteString = atob(newBase64.split(',')[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    
    // Inject or update JFIF app0
    let uint8 = ia;
    let jfifFound = false;
    for (let i = 0; i < uint8.length - 20; i++) {
      if (uint8[i] === 0xff && uint8[i+1] === 0xe0 && uint8[i+4] === 0x4a && uint8[i+5] === 0x46) {
        // App0 (JFIF) found. 
        // Correct JFIF offsets: units at 11, X at 12,13, Y at 14,15 (relative to 0xFFE0 marker start)
        uint8[i+11] = 1; // dots per inch
        uint8[i+12] = (dpi >> 8) & 0xff;
        uint8[i+13] = dpi & 0xff;
        uint8[i+14] = (dpi >> 8) & 0xff;
        uint8[i+15] = dpi & 0xff;
        jfifFound = true;
        break;
      }
    }
    
    if (!jfifFound && uint8[0] === 0xff && uint8[1] === 0xd8) {
       const app0 = new Uint8Array([
          0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
          0x01, 0x01, 0x01, (dpi >> 8) & 0xff, dpi & 0xff, (dpi >> 8) & 0xff, dpi & 0xff, 0x00, 0x00
       ]);
       const final = new Uint8Array(uint8.length + app0.length);
       final.set(uint8.slice(0, 2));
       final.set(app0, 2);
       final.set(uint8.slice(2), 2 + app0.length);
       uint8 = final;
    }

    return new Blob([uint8], { type: 'image/jpeg' });
  } catch (e) {
    console.error("DPI error", e);
    // Even if piexif fails, we try manual JFIF update
    const arrayBuffer = await blob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    for (let i = 0; i < uint8.length - 20; i++) {
        if (uint8[i] === 0xff && uint8[i+1] === 0xe0 && uint8[i+4] === 0x4a && uint8[i+5] === 0x46) {
            uint8[i+11] = 1;
            uint8[i+12] = (dpi >> 8) & 0xff;
            uint8[i+13] = dpi & 0xff;
            uint8[i+14] = (dpi >> 8) & 0xff;
            uint8[i+15] = dpi & 0xff;
            return new Blob([uint8], { type: 'image/jpeg' });
        }
    }
    return blob;
  }
}

export async function changeDpi(blob: Blob, dpi: number): Promise<Blob> {
  const name = (blob as any).name || '';
  const type = blob.type || '';
  const isPng = type === 'image/png' || name.toLowerCase().endsWith('.png');
  const isJpeg = type === 'image/jpeg' || type === 'image/jpg' || name.toLowerCase().endsWith('.jpg') || name.toLowerCase().endsWith('.jpeg');
  
  if (isJpeg) {
    return changeDpiInJpeg(blob, dpi);
  }
  if (isPng) {
    return changeDpiInPng(blob, dpi);
  }

  // Fallback: search magic signature bytes in slice
  try {
    const slice = blob.slice(0, 8);
    const buf = await slice.arrayBuffer();
    const arr = new Uint8Array(buf);
    if (arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4E && arr[3] === 0x47) {
      return changeDpiInPng(blob, dpi);
    }
    if (arr[0] === 0xFF && arr[1] === 0xD8) {
      return changeDpiInJpeg(blob, dpi);
    }
  } catch (e) {
    console.error("Signature check failed", e);
  }
  return blob;
}
