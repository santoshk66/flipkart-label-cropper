import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { PDFDocument } from 'pdf-lib';

const app = express();
app.use(cors());
app.use(express.static('public'));
// Serve generated PDF
app.use('/outputs', express.static(path.join(process.cwd(), 'outputs')));

async function ensureDirs() {
  const dirs = ['uploads', 'outputs'];
  await Promise.all(dirs.map(dir =>
    fs.mkdir(path.join(process.cwd(), dir), { recursive: true })
  ));
}

const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'), false);
  }
});

// Split each page into two: first label (top half), then invoice (bottom half), and combine into one PDF
app.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    const srcBytes = await fs.readFile(req.file.path);
    const srcPdf = await PDFDocument.load(srcBytes);
    const outputPdf = await PDFDocument.create();

    for (let i = 0; i < srcPdf.getPageCount(); i++) {
      // Copy pages from source
      const [labelPage] = await outputPdf.copyPages(srcPdf, [i]);
      const [invoicePage] = await outputPdf.copyPages(srcPdf, [i]);

      const orig = srcPdf.getPage(i);
      const width = orig.getWidth();
      const height = orig.getHeight();
      const splitY = height / 2;

      // Label = top half
      labelPage.setCropBox(0, splitY, width, splitY);
      labelPage.setMediaBox(0, 0, width, splitY);
      outputPdf.addPage(labelPage);

      // Invoice = bottom half
      invoicePage.setCropBox(0, 0, width, splitY);
      invoicePage.setMediaBox(0, 0, width, splitY);
      outputPdf.addPage(invoicePage);
    }

    const outputBytes = await outputPdf.save();
    const filename = `combined_${Date.now()}.pdf`;
    const outPath = path.join('outputs', filename);
    await fs.writeFile(outPath, outputBytes);

    res.json({ file: `/outputs/${filename}` });
  } catch (err) {
    console.error('Processing error:', err);
    res.status(500).json({ error: err.message });
  }
});

ensureDirs()
  .then(() => app.listen(process.env.PORT || 3000, () =>
    console.log('Server running on port', process.env.PORT || 3000)
  ))
  .catch(err => console.error('Dir init error', err));
