import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { PDFDocument } from 'pdf-lib';

const app = express();
app.use(cors());
app.use(express.static('public'));
app.use('/outputs', express.static(path.join(process.cwd(), 'outputs')));

async function ensureDirs() {
  const dirs = ['uploads', 'outputs'];
  await Promise.all(dirs.map(dir =>
    fs.mkdir(path.join(process.cwd(), dir), { recursive: true })
  ));
}

// Accept single PDF upload
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'), false);
  }
});

app.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please upload a PDF file under field name "pdf"' });
    const srcBytes = await fs.readFile(req.file.path);
    const srcPdf = await PDFDocument.load(srcBytes);
    const outputPdf = await PDFDocument.create();

    for (let i = 0; i < srcPdf.getPageCount(); i++) {
      // Copy original page twice
      const [labelPage] = await outputPdf.copyPages(srcPdf, [i]);
      const [invoicePage] = await outputPdf.copyPages(srcPdf, [i]);

      const orig = srcPdf.getPage(i);
      const width = orig.getWidth();
      const height = orig.getHeight();
      // Adjust these based on measured crop regions
      const LABEL_CROP = { x: 0,    y: 0, width: 250, height: 841 };
      const INV_CROP   = { x: 250,  y: 0, width: 345, height: 841 };

      // Crop label (first)
      labelPage.setCropBox(
        LABEL_CROP.x, LABEL_CROP.y,
        LABEL_CROP.width, LABEL_CROP.height
      );

      labelPage.setMediaBox(0, 0, LABEL_CROP.width, LABEL_CROP.height);
      outputPdf.addPage(labelPage);

      // Crop invoice (second)
      invoicePage.setCropBox(
        INV_CROP.x, INV_CROP.y,
        INV_CROP.width, INV_CROP.height
      );
      invoicePage.setMediaBox(0, 0, INV_CROP.width, INV_CROP.height);
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
