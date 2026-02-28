'use strict';

const puppeteer = require('puppeteer');
const path      = require('path');
const fs        = require('fs');

const DOCUMENTS_DIR = path.resolve(__dirname, '../../uploads/documents');

// Ensure output directory exists at module load time
if (!fs.existsSync(DOCUMENTS_DIR)) {
  fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Convert a file path or URL to a base64 data URI.
 * Returns null silently if the file cannot be read.
 */
function toDataUri(filePath) {
  if (!filePath) return null;
  try {
    if (/^https?:\/\//i.test(filePath)) return filePath; // remote URL — pass through
    const abs  = path.resolve(filePath);
    const data = fs.readFileSync(abs);
    const ext  = path.extname(abs).replace('.', '').toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Build the full HTML document wrapping the caller-supplied body content.
 */
function buildHtml({ htmlContent, logoUri, signatureUri, stampUri, watermark }) {
  const logoHtml = logoUri
    ? `<img src="${logoUri}" class="logo" alt="Organization Logo" />`
    : '<span class="logo-placeholder">LOGO</span>';

  const watermarkHtml = watermark
    ? `<div class="watermark">${watermark}</div>`
    : '';

  const signatureHtml = signatureUri
    ? `<img src="${signatureUri}" class="sig-img" alt="Signature" />`
    : '<div class="sig-line"></div>';

  const stampHtml = stampUri
    ? `<img src="${stampUri}" class="stamp-img" alt="Stamp" />`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      color: #1a1a1a;
      background: #fff;
    }

    /* ---------- WATERMARK ---------- */
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-35deg);
      font-size: 72px;
      font-weight: 900;
      color: rgba(0, 0, 0, 0.06);
      white-space: nowrap;
      pointer-events: none;
      z-index: 0;
      user-select: none;
    }

    /* ---------- HEADER ---------- */
    .doc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 32px;
      border-bottom: 2px solid #1a3c6e;
      margin-bottom: 24px;
    }
    .logo { height: 60px; max-width: 180px; object-fit: contain; }
    .logo-placeholder {
      font-size: 22px;
      font-weight: 700;
      color: #1a3c6e;
      letter-spacing: 2px;
    }

    /* ---------- BODY CONTENT ---------- */
    .doc-body {
      position: relative;
      z-index: 1;
      padding: 0 32px 100px;
    }

    /* ---------- FOOTER ---------- */
    .doc-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 14px 32px;
      border-top: 1px solid #dde3ed;
      background: #fff;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      z-index: 2;
    }
    .footer-signature { text-align: center; }
    .footer-signature .sig-label {
      display: block;
      font-size: 10px;
      color: #666;
      margin-top: 4px;
    }
    .sig-img  { height: 48px; max-width: 140px; object-fit: contain; display: block; margin: 0 auto; }
    .sig-line { width: 140px; border-bottom: 1px solid #555; margin-bottom: 2px; }
    .stamp-img { height: 64px; width: 64px; object-fit: contain; }

    /* ---------- PAGE NUMBERS (Puppeteer headerTemplate/footerTemplate not used; handled via CSS) ---------- */
    @page { margin: 0; }
  </style>
</head>
<body>

  ${watermarkHtml}

  <div class="doc-header">
    ${logoHtml}
  </div>

  <div class="doc-body">
    ${htmlContent}
  </div>

  <div class="doc-footer">
    <div class="footer-signature">
      ${signatureHtml}
      <span class="sig-label">Authorised Signature</span>
    </div>
    <div>
      ${stampHtml}
    </div>
  </div>

</body>
</html>`;
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * generatePdf(options)
 *
 * @param {object}  options
 * @param {string}  options.htmlContent       - HTML body to inject into the document template
 * @param {string}  [options.organizationLogo] - File path or URL for the header logo
 * @param {string}  [options.signatureImage]   - File path or URL for the footer signature
 * @param {string}  [options.stampImage]       - File path or URL for the footer stamp
 * @param {string}  [options.watermark]        - Optional watermark text (e.g. "CONFIDENTIAL")
 * @param {string}  options.outputFileName     - Desired filename (without extension)
 *
 * @returns {Promise<{success: boolean, filePath: string|null, error: string|null}>}
 *   Never throws — returns {success: false, filePath: null, error: message} on failure.
 */
async function generatePdf({
  htmlContent,
  organizationLogo = null,
  signatureImage   = null,
  stampImage       = null,
  watermark        = null,
  watermarkText    = null,   // alias for watermark
  outputFileName,
}) {
  watermark = watermark ?? watermarkText;
  let browser = null;

  try {
    const logoUri      = toDataUri(organizationLogo);
    const signatureUri = toDataUri(signatureImage);
    const stampUri     = toDataUri(stampImage);

    const html = buildHtml({ htmlContent, logoUri, signatureUri, stampUri, watermark });

    const safeFileName = outputFileName
      ? outputFileName.replace(/[^a-zA-Z0-9_\-]/g, '_')
      : `document_${Date.now()}`;

    const outputPath = path.join(DOCUMENTS_DIR, `${safeFileName}.pdf`);

    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: 'networkidle0' });

    await page.pdf({
      path:              outputPath,
      format:            'A4',
      printBackground:   true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    return { success: true, filePath: outputPath, error: null };
  } catch (err) {
    console.error('[PDF] Generation failed:', err.message);
    return { success: false, filePath: null, error: err.message };
  } finally {
    if (browser) {
      await browser.close().catch((e) => console.error('[PDF] Browser close error:', e.message));
    }
  }
}

module.exports = { generatePdf };
