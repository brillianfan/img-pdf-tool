import { renderAsync } from 'docx-preview';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

// Helper to safely parse colors in css format (e.g. rgb(r, g, b) or rgba(r, g, b, a))
function parseRgb(color: string) {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (match) {
    const r = parseInt(match[1]) / 255;
    const g = parseInt(match[2]) / 255;
    const b = parseInt(match[3]) / 255;
    const a = match[4] !== undefined ? parseFloat(match[4]) : 1;
    return { r, g, b, a };
  }
  return null;
}

// Safely fetch CDN fonts with a backup path
async function fetchFontSafe(url: string, fallbackUrl: string): Promise<ArrayBuffer> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    return await res.arrayBuffer();
  } catch (e) {
    console.warn(`Font fetch failed for ${url}, trying fallback: ${fallbackUrl}`);
    const res = await fetch(fallbackUrl);
    return await res.arrayBuffer();
  }
}

// Recursively traverse DOM to find valid, non-empty, visible text nodes
function getTextNodes(node: Node): Node[] {
  const textNodes: Node[] = [];
  if (node.nodeType === Node.TEXT_NODE) {
    if (node.textContent && node.textContent.trim().length > 0) {
      textNodes.push(node);
    }
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement;
    const style = window.getComputedStyle(element);
    if (style.display !== 'none' && style.visibility !== 'hidden') {
      for (let i = 0; i < node.childNodes.length; i++) {
        textNodes.push(...getTextNodes(node.childNodes[i]));
      }
    }
  }
  return textNodes;
}

// Measure word coordinates with high precision using browser Range API (zero DOM mutation)
function getTextNodeRuns(textNode: Text, pageRect: DOMRect): { text: string; x: number; y: number; width: number; height: number }[] {
  const text = textNode.textContent || "";
  const runs: { text: string; x: number; y: number; width: number; height: number }[] = [];
  
  // Find all non-whitespace tokens (preserving punctuation and alignments naturally)
  const regex = /\S+/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const word = match[0];
    const start = match.index;
    const end = regex.lastIndex;
    
    try {
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const rect = range.getBoundingClientRect();
      
      if (rect.width > 0 && rect.height > 0) {
        runs.push({
          text: word,
          x: rect.left - pageRect.left,
          y: rect.top - pageRect.top,
          width: rect.width,
          height: rect.height
        });
      }
    } catch (e) {
      console.warn("Range measurement failed for text run:", e);
    }
  }
  
  return runs;
}

export async function convertDocxToPdf(blob: Blob, onProgress?: (msg: string) => void): Promise<Blob> {
  if (onProgress) onProgress("Đang phân tích cấu trúc tệp Word...");

  // Create off-screen rendering container with precise standard Letter/A4 CSS width
  const tempDiv = document.createElement('div');
  tempDiv.style.position = 'fixed';
  tempDiv.style.left = '-10000px';
  tempDiv.style.top = '0';
  tempDiv.style.width = '816px'; 
  tempDiv.style.background = 'white';
  tempDiv.style.zIndex = '-9999';
  document.body.appendChild(tempDiv);

  const styleTag = document.createElement('style');
  styleTag.innerHTML = `
    .temp-docx-container {
      background: white !important;
      padding: 0 !important;
      margin: 0 !important;
      width: 100% !important;
    }
    .temp-docx-container .docx-wrapper {
      background: white !important;
      padding: 0 !important;
      margin: 0 !important;
      box-shadow: none !important;
    }
    .temp-docx-container .docx-wrapper > section {
      margin: 0 !important;
      box-shadow: none !important;
    }
  `;
  tempDiv.appendChild(styleTag);

  const renderDiv = document.createElement('div');
  renderDiv.className = 'temp-docx-container';
  tempDiv.appendChild(renderDiv);

  try {
    if (onProgress) onProgress("Đang dựng cấu trúc tài liệu Word...");
    
    // Render docx to browser HTML/CSS DOM structure
    await renderAsync(blob, renderDiv, undefined, {
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      experimental: true
    });

    // Wait a brief layout cycle to let heights, margins, and column layouts settle fully
    await new Promise(resolve => setTimeout(resolve, 150));

    if (onProgress) onProgress("Đang tải các phông chữ tiếng Việt chuẩn vector...");

    // Fetch Vietnamese unicode compatible fonts from cdnjs/pdfmake (Roboto) and JSDelivr (Tinos - Times New Roman equivalent)
    const fallbackUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.72/fonts/Roboto/Roboto-Regular.ttf';
    const [
      regularBytes, boldBytes, italicBytes, boldItalicBytes,
      serifRegularBytes, serifBoldBytes, serifItalicBytes, serifBoldItalicBytes
    ] = await Promise.all([
      fetchFontSafe('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.72/fonts/Roboto/Roboto-Regular.ttf', fallbackUrl),
      fetchFontSafe('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.72/fonts/Roboto/Roboto-Medium.ttf', fallbackUrl),
      fetchFontSafe('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.72/fonts/Roboto/Roboto-Italic.ttf', fallbackUrl),
      fetchFontSafe('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.72/fonts/Roboto/Roboto-MediumItalic.ttf', fallbackUrl),
      
      fetchFontSafe('https://cdn.jsdelivr.net/gh/google/fonts@main/apache/tinos/Tinos-Regular.ttf', fallbackUrl),
      fetchFontSafe('https://cdn.jsdelivr.net/gh/google/fonts@main/apache/tinos/Tinos-Bold.ttf', fallbackUrl),
      fetchFontSafe('https://cdn.jsdelivr.net/gh/google/fonts@main/apache/tinos/Tinos-Italic.ttf', fallbackUrl),
      fetchFontSafe('https://cdn.jsdelivr.net/gh/google/fonts@main/apache/tinos/Tinos-BoldItalic.ttf', fallbackUrl)
    ]);

    if (onProgress) onProgress("Đang khởi tạo cấu trúc Vector PDF...");

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    // Embed all typography subsets
    const fontRegular = await pdfDoc.embedFont(regularBytes);
    const fontBold = await pdfDoc.embedFont(boldBytes);
    const fontItalic = await pdfDoc.embedFont(italicBytes);
    const fontBoldItalic = await pdfDoc.embedFont(boldItalicBytes);

    const fontSerifRegular = await pdfDoc.embedFont(serifRegularBytes);
    const fontSerifBold = await pdfDoc.embedFont(serifBoldBytes);
    const fontSerifItalic = await pdfDoc.embedFont(serifItalicBytes);
    const fontSerifBoldItalic = await pdfDoc.embedFont(serifBoldItalicBytes);

    // Find all pages rendered as <section> elements
    const sections = renderDiv.querySelectorAll('.docx-wrapper > section');
    if (sections.length === 0) {
      throw new Error("Không thể trích xuất các trang từ tài liệu Word. Vui lòng kiểm tra lại định dạng tệp.");
    }

    const totalPages = sections.length;

    for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
      if (onProgress) {
        onProgress(`Đang xuất trang ${pageIdx + 1}/${totalPages} chuẩn vector sắc nét...`);
      }

      const section = sections[pageIdx] as HTMLElement;
      const pageRect = section.getBoundingClientRect();
      const pageWidth = pageRect.width;
      const pageHeight = pageRect.height;

      // 1 px CSS = 0.75 PDF pt
      const pdfPage = pdfDoc.addPage([pageWidth * 0.75, pageHeight * 0.75]);

      // --- Draw custom Page background if defined ---
      const sectionStyle = window.getComputedStyle(section);
      const secBg = sectionStyle.backgroundColor;
      if (secBg && secBg !== 'transparent' && secBg !== 'rgba(0, 0, 0, 0)') {
        const parsedBg = parseRgb(secBg);
        if (parsedBg && parsedBg.a > 0) {
          pdfPage.drawRectangle({
            x: 0,
            y: 0,
            width: pageWidth * 0.75,
            height: pageHeight * 0.75,
            color: rgb(parsedBg.r, parsedBg.g, parsedBg.b),
            opacity: parsedBg.a
          });
        }
      }

      // --- Pass 1: Draw element containers (Backgrounds and Borders of Tables, Blocks) ---
      const elements = Array.from(section.getElementsByTagName('*')) as HTMLElement[];
      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (w === 0 || h === 0) continue;

        const x = rect.left - pageRect.left;
        const y = rect.top - pageRect.top;

        const computed = window.getComputedStyle(el);

        // Draw element background if color is solid and visible
        const bgColor = computed.backgroundColor;
        if (bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)') {
          const parsedBg = parseRgb(bgColor);
          if (parsedBg && parsedBg.a > 0) {
            pdfPage.drawRectangle({
              x: x * 0.75,
              y: (pageHeight - y - h) * 0.75,
              width: w * 0.75,
              height: h * 0.75,
              color: rgb(parsedBg.r, parsedBg.g, parsedBg.b),
              opacity: parsedBg.a
            });
          }
        }

        // Draw structural borders
        const borderTypes = ['Top', 'Bottom', 'Left', 'Right'] as const;
        for (const borderType of borderTypes) {
          const borderWidth = parseFloat(computed[`border${borderType}Width` as any] || '0');
          const borderStyle = computed[`border${borderType}Style` as any];
          const borderColor = computed[`border${borderType}Color` as any];

          if (borderWidth > 0 && borderStyle !== 'none' && borderColor) {
            const parsedBorderColor = parseRgb(borderColor);
            if (parsedBorderColor) {
              let xStart = x;
              let yStart = y;
              let xEnd = x;
              let yEnd = y;

              if (borderType === 'Top') {
                xEnd = x + w;
              } else if (borderType === 'Bottom') {
                yStart = y + h;
                xEnd = x + w;
                yEnd = y + h;
              } else if (borderType === 'Left') {
                yEnd = y + h;
              } else if (borderType === 'Right') {
                xStart = x + w;
                xEnd = x + w;
                yEnd = y + h;
              }

              pdfPage.drawLine({
                start: { x: xStart * 0.75, y: (pageHeight - yStart) * 0.75 },
                end: { x: xEnd * 0.75, y: (pageHeight - yEnd) * 0.75 },
                thickness: borderWidth * 0.75,
                color: rgb(parsedBorderColor.r, parsedBorderColor.g, parsedBorderColor.b),
                opacity: parsedBorderColor.a
              });
            }
          }
        }
      }

      // --- Pass 2: Draw embedded images ---
      const images = Array.from(section.getElementsByTagName('img')) as HTMLImageElement[];
      for (const img of images) {
        const rect = img.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (w === 0 || h === 0) continue;

        const x = rect.left - pageRect.left;
        const y = rect.top - pageRect.top;
        const src = img.getAttribute('src');

        if (src) {
          try {
            const response = await fetch(src);
            const arrayBuffer = await response.arrayBuffer();
            let pdfImg;
            if (src.includes('image/png') || src.endsWith('.png')) {
              pdfImg = await pdfDoc.embedPng(arrayBuffer);
            } else {
              pdfImg = await pdfDoc.embedJpg(arrayBuffer);
            }

            pdfPage.drawImage(pdfImg, {
              x: x * 0.75,
              y: (pageHeight - y - h) * 0.75,
              width: w * 0.75,
              height: h * 0.75
            });
          } catch (e) {
            console.warn("Embedding image failed, skipping asset:", e);
          }
        }
      }

      // --- Pass 3: Draw true vector, selectable & searchable text ---
      const textNodes = getTextNodes(section);
      for (const textNode of textNodes) {
        const parentNode = textNode.parentNode;
        if (!parentNode) continue;

        const pEl = parentNode as HTMLElement;
        const computedStyle = window.getComputedStyle(pEl);

        const fontSizePx = parseFloat(computedStyle.fontSize || '14');
        const colorStr = computedStyle.color || 'rgb(0,0,0)';
        const parsedColor = parseRgb(colorStr) || { r: 0, g: 0, b: 0, a: 1 };

        const fontWeight = computedStyle.fontWeight;
        const fontStyle = computedStyle.fontStyle;
        const isBold = fontWeight === 'bold' || parseInt(fontWeight) > 500;
        const isItalic = fontStyle === 'italic';

        // Detect if typeface is Serif or Sans-Serif
        const fontFamily = computedStyle.fontFamily || "";
        const isSerif = fontFamily.toLowerCase().includes('serif') || 
                        fontFamily.toLowerCase().includes('times') || 
                        fontFamily.toLowerCase().includes('georgia') || 
                        fontFamily.toLowerCase().includes('roman');

        // Select the appropriate vector font instance
        let selectedFont = isSerif ? fontSerifRegular : fontRegular;
        if (isBold && isItalic) {
          selectedFont = isSerif ? fontSerifBoldItalic : fontBoldItalic;
        } else if (isBold) {
          selectedFont = isSerif ? fontSerifBold : fontBold;
        } else if (isItalic) {
          selectedFont = isSerif ? fontSerifItalic : fontItalic;
        }

        const textDecoration = computedStyle.textDecoration || computedStyle.textDecorationLine || "";
        const isUnderline = textDecoration.includes('underline');
        const isStrikethrough = textDecoration.includes('line-through');

        // Extract precise screen-drawn word offsets (leaves DOM pristine)
        const tokenMeasures = getTextNodeRuns(textNode as Text, pageRect);

        for (const token of tokenMeasures) {
          try {
            // Draw vector character blocks at high precision
            pdfPage.drawText(token.text, {
              x: token.x * 0.75,
              // Offset baseline carefully (82% height ratio)
              y: (pageHeight - (token.y + token.height * 0.82)) * 0.75,
              size: fontSizePx * 0.75,
              font: selectedFont,
              color: rgb(parsedColor.r, parsedColor.g, parsedColor.b),
              opacity: parsedColor.a
            });

            // Underline decor
            if (isUnderline && token.text.trim()) {
              pdfPage.drawLine({
                start: { x: token.x * 0.75, y: (pageHeight - (token.y + token.height * 0.88)) * 0.75 },
                end: { x: (token.x + token.width) * 0.75, y: (pageHeight - (token.y + token.height * 0.88)) * 0.75 },
                thickness: (fontSizePx * 0.07) * 0.75,
                color: rgb(parsedColor.r, parsedColor.g, parsedColor.b),
                opacity: parsedColor.a
              });
            }

            // Strikethrough decor
            if (isStrikethrough && token.text.trim()) {
              pdfPage.drawLine({
                start: { x: token.x * 0.75, y: (pageHeight - (token.y + token.height * 0.55)) * 0.75 },
                end: { x: (token.x + token.width) * 0.75, y: (pageHeight - (token.y + token.height * 0.55)) * 0.75 },
                thickness: (fontSizePx * 0.07) * 0.75,
                color: rgb(parsedColor.r, parsedColor.g, parsedColor.b),
                opacity: parsedColor.a
              });
            }
          } catch (err) {
            console.warn("Error rendering vector token:", token.text, err);
          }
        }
      }
    }

    if (onProgress) onProgress("Đang kết xuất tệp PDF vector độ nét cao hoàn chỉnh...");
    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });

  } catch (err: any) {
    console.error("High fidelity conversion failed:", err);
    throw new Error(`Lỗi trong quá trình chuyển đổi vector PDF: ${err.message || err}`);
  } finally {
    // Safely cleanup off-screen DOM resources
    if (document.body.contains(tempDiv)) {
      document.body.removeChild(tempDiv);
    }
  }
}
