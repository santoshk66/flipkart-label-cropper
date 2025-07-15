import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import pkg from 'pdfjs-dist';
const { getDocument } = pkg;

const app = express();
app.use(cors());
app.use(express.static(path.join(process.cwd(), 'public')));
app.use('/outputs', express.static(path.join(process.cwd(), 'outputs')));

// Ensure necessary directories exist
async function ensureDirs() {
  const dirs = ['uploads', 'outputs'];
  await Promise.all(dirs.map(dir =>
    fs.mkdir(path.join(process.cwd(), dir), { recursive: true })
  ));
}

// Multer setup for single PDF
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'), false);
  }
});

// Default crop boxes (in points, as fallback)
const DEFAULT_CROP = {
  label: { x: 30, y: 30, width: 535, height: 320 },
  invoice: { x: 30, y: 360, width: 535, height: 462 }
};

// Validate crop coordinates
function validateCrop(crop, pageWidth, pageHeight) {
  const { x, y, width, height } = crop;
  console.log(`Validating crop: x=${x}, y=${y}, width=${width}, height=${height}, page=${pageWidth}x${pageHeight}`);
  if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height)) {
    console.warn('Invalid crop coordinates, using defaults');
    return null; // Signal to use default crop
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0) {
    throw new Error('Crop coordinates must be positive and non-zero');
  }
  if (x + width > pageWidth || y + height > pageHeight) {
    throw new Error(`Crop coordinates exceed page bounds (${pageWidth}x${pageHeight})`);
  }
  return { x, y, width, height };
}

// Upload endpoint: crops labels and invoices, alternates in output PDF
app.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a PDF file under field name "pdf"' });
    }

    const srcBytes = await fs.readFile(req.file.path);
    const srcBytesArray = new Uint8Array(srcBytes);
    const srcPdf = await PDFDocument.load(srcBytes);
    const pdfjsDoc = await getDocument({ data: srcBytesArray, disableWorker: true }).promise;

    // Get page size from first page
    const p0 = srcPdf.getPage(0);
    const pageWidth = p0.getWidth();
    const pageHeight = p0.getHeight();
    console.log(`Original page size: ${pageWidth}pt × ${pageHeight}pt`);

    // Get crop coordinates from form data
    let labelCrop = validateCrop({
      x: parseFloat(req.body.labelX),
      y: parseFloat(req.body.labelY),
      width: parseFloat(req.body.labelWidth),
      height: parseFloat(req.body.labelHeight)
    }, pageWidth, pageHeight) || DEFAULT_CROP.label;

    let invoiceCrop = validateCrop({
      x: parseFloat(req.body.invoiceX),
      y: parseFloat(req.body.invoiceY),
      width: parseFloat(req.body.invoiceWidth),
      height: parseFloat(req.body.invoiceHeight)
    }, pageWidth, pageHeight) || DEFAULT_CROP.invoice;

    console.log('Label Crop:', labelCrop);
    console.log('Invoice Crop:', invoiceCrop);

    const outputPdf = await PDFDocument.create();
    let validPages = 0;
    let skippedPages = [];

    for (let i = 0; i < srcPdf.getPageCount(); i++) {
      // Get page size for each page
      const srcPage = srcPdf.getPage(i);
      const pageWidth = srcPage.getWidth();
      const pageHeight = srcPage.getHeight();
      console.log(`Processing page ${i + 1}: ${pageWidth}x${pageHeight}`);

      // Extract text using pdfjs-dist
      const page = await pdfjsDoc.getPage(i + 1);
      const textContent = await page.getTextContent();
      const text = textContent.items.map(item => item.str).join(' ').toLowerCase();
      console.log(`Page ${i + 1} text: ${text.substring(0, 100)}...`);

      // Simplified filtering to include more pages
      if (text.length < 10 && !text.includes('soni singh') && !text.includes('tax invoice')) {
        skippedPages.push({ page: i + 1, reason: `Insufficient content (${text.length} chars)`, text });
        console.log(`Skipping page ${i + 1}: insufficient content (${text.length} chars)`);
        continue;
      }

      // Identify label and invoice pages (broader criteria)
      const isLabel = text.includes('ordered through') || text.includes('soni singh') || text.includes('label');
      const isInvoice = text.includes('tax invoice') || text.includes('fssai license number') || text.includes('declaration') || text.includes('invoice');

      if (!isLabel && !isInvoice) {
        skippedPages.push({ page: i + 1, reason: 'Not identified as label or invoice', text });
        console.log(`Skipping page ${i + 1}: not identified as label or invoice`);
        continue;
      }

      // Copy page for both label and invoice
      const [labelPage] = await outputPdf.copyPages(srcPdf, [i]);
      const [invoicePage] = await outputPdf.copyPages(srcPdf, [i]);

      // Crop and set page size for label
      if (isLabel) {
        try {
          labelPage.setCropBox(labelCrop.x, labelCrop.y, labelCrop.width, labelCrop.height);
          labelPage.setMediaBox(0, 0, labelCrop.width, labelCrop.height);
          console.log(`Label page ${i + 1} crop: x=${labelCrop.x}, y=${labelCrop.y}, w=${labelCrop.width}, h=${labelCrop.height}`);
          outputPdf.addPage(labelPage);
          validPages++;
          console.log(`Added label page ${i + 1}`);
        } catch (err) {
          console.error(`Error processing label page ${i + 1}:`, err);
          skippedPages.push({ page: i + 1, reason: `Label crop error: ${err.message}`, text });
        }
      }

      // Crop and set page size for invoice
      if (isInvoice) {
        try {
          invoicePage.setCropBox(invoiceCrop.x, invoiceCrop.y, invoiceCrop.width, invoiceCrop.height);
          invoicePage.setMediaBox(0, 0, invoiceCrop.width, invoiceCrop.height);
          console.log(`Invoice page ${i + 1} crop: x=${invoiceCrop.x}, y=${invoiceCrop.y}, w=${invoiceCrop.width}, h=${invoiceCrop.height}`);
          outputPdf.addPage(invoicePage);
          validPages++;
          console.log(`Added invoice page ${i + 1}`);
        } catch (err) {
          console.error(`Error processing invoice page ${i + 1}:`, err);
          skippedPages.push({ page: i + 1, reason: `Invoice crop error: ${err.message}`, text });
        }
      }
    }

    if (validPages === 0) {
      console.log('Skipped pages:', JSON.stringify(skippedPages, null, 2));
      throw new Error(`No valid label or invoice pages found. Skipped pages: ${JSON.stringify(skippedPages)}`);
    }

    console.log(`Total valid pages added: ${validPages}`);
    const outputBytes = await outputPdf.save();
    const filename = `alternating_${Date.now()}.pdf`;
    const outPath = path.join('outputs', filename);
    await fs.writeFile(outPath, outputBytes);

    // Clean up uploaded file
    await fs.unlink(req.file.path);

    res.json({ file: `/outputs/${filename}`, cropUsed: { labelCrop, invoiceCrop }, pagesProcessed: validPages });
  } catch (err) {
    console.error('Processing error:', err);
    res.status(500).json({ error: err.message });
  }
});

ensureDirs()
  .then(() => app.listen(process.env.PORT || 3000, () =>
    console.log('Server running on port', process.env.PORT || 3000)
  ))
  .catch(err => console.error('Directory initialization error:', err));
