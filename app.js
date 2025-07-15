import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import pkg from 'pdfjs-dist';
const { getDocument, GlobalWorkerOptions } = pkg;

// Set the worker source for pdfjs-dist (use CDN for simplicity)
GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

const app = express();
app.use(cors());
app.use(express.static('public'));
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

// Default crop boxes (in points, assuming A4 input: 595x842)
const DEFAULT_CROP = {
  label: { x: 50, y: 50, width: 495, height: 300 }, // Top section for labels
  invoice: { x: 50, y: 350, width: 495, height: 442 } // Bottom section for invoices
};

// Upload endpoint: crops labels and invoices, alternates in output PDF
app.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a PDF file under field name "pdf"' });
    }

    const srcBytes = await fs.readFile(req.file.path);
    
    // Load PDF with pdf-lib for cropping
    const srcPdf = await PDFDocument.load(srcBytes);

    // Load PDF with pdfjs-dist for text extraction
    const pdfjsDoc = await getDocument({ data: srcBytes }).promise;

    // Log original page size
    const p0 = srcPdf.getPage(0);
    console.log(`Original page size: ${p0.getWidth()}pt × ${p0.getHeight()}pt`);

    // Get custom crop coordinates from query parameters (if provided)
    const labelCrop = {
      x: parseFloat(req.query.labelX) || DEFAULT_CROP.label.x,
      y: parseFloat(req.query.labelY) || DEFAULT_CROP.label.y,
      width: parseFloat(req.query.labelWidth) || DEFAULT_CROP.label.width,
      height: parseFloat(req.query.labelHeight) || DEFAULT_CROP.label.height
    };
    const invoiceCrop = {
      x: parseFloat(req.query.invoiceX) || DEFAULT_CROP.invoice.x,
      y: parseFloat(req.query.invoiceY) || DEFAULT_CROP.invoice.y,
      width: parseFloat(req.query.invoiceWidth) || DEFAULT_CROP.invoice.width,
      height: parseFloat(req.query.invoiceHeight) || DEFAULT_CROP.invoice.height
    };

    const outputPdf = await PDFDocument.create();

    for (let i = 0; i < srcPdf.getPageCount(); i++) {
      // Extract text using pdfjs-dist
      const page = await pdfjsDoc.getPage(i + 1);
      const textContent = await page.getTextContent();
      const text = textContent.items.map(item => item.str).join(' ').toLowerCase();
      const isInvoice = text.includes('tax invoice');
      const isLabel = text.includes('ordered through') && text.includes('soni singh');

      // Copy page for both label and invoice using pdf-lib
      const [labelPage] = await outputPdf.copyPages(srcPdf, [i]);
      const [invoicePage] = await outputPdf.copyPages(srcPdf, [i]);

      // Crop and scale label
      labelPage.setCropBox(labelCrop.x, labelCrop.y, labelCrop.width, labelCrop.height);
      labelPage.setMediaBox(0, 0, labelCrop.width, labelCrop.height);
      const labelScale = Math.min(2126 / labelCrop.width, 3543 / labelCrop.height);
      labelPage.scale(labelScale, labelScale);
      outputPdf.addPage(labelPage);

      // Crop and scale invoice
      invoicePage.setCropBox(invoiceCrop.x, invoiceCrop.y, invoiceCrop.width, invoiceCrop.height);
      invoicePage.setMediaBox(0, 0, invoiceCrop.width, invoiceCrop.height);
      const invoiceScale = Math.min(2126 / invoiceCrop.width, 3543 / invoiceCrop.height);
      invoicePage.scale(invoiceScale, invoiceScale);
      outputPdf.addPage(invoicePage);
    }

    const outputBytes = await outputPdf.save();
    const filename = `alternating_${Date.now()}.pdf`;
    const outPath = path.join('outputs', filename);
    await fs.writeFile(outPath, outputBytes);

    // Clean up uploaded file
    await fs.unlink(req.file.path);

    res.json({ file: `/outputs/${filename}`, cropUsed: { labelCrop, invoiceCrop } });
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
