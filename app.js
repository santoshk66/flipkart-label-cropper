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

const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'), false);
  }
});

app.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    const srcBytes = await fs.readFile(req.file.path);
    const srcPdf = await PDFDocument.load(srcBytes);
    const labelsPdf = await PDFDocument.create();
    const invoicesPdf = await PDFDocument.create();

    // For each page, split vertically into label (top) & invoice (bottom)
    for (let i = 0; i < srcPdf.getPageCount(); i++) {
      const [origLabelPage] = await labelsPdf.copyPages(srcPdf, [i]);
      const [origInvPage]   = await invoicesPdf.copyPages(srcPdf, [i]);

      const page = srcPdf.getPage(i);
      const width = page.getWidth();
      const height = page.getHeight();
      const halfHeight = height / 2;

      // LABEL (top half)
      origLabelPage.setCropBox(0, halfHeight, width, halfHeight);
      origLabelPage.setMediaBox(0, 0, width, halfHeight);
      labelsPdf.addPage(origLabelPage);

      // INVOICE (bottom half)
      origInvPage.setCropBox(0, 0, width, halfHeight);
      origInvPage.setMediaBox(0, 0, width, halfHeight);
      invoicesPdf.addPage(origInvPage);
    }

    const labelsBytes = await labelsPdf.save();
    const invBytes    = await invoicesPdf.save();

    const timestamp = Date.now();
    const labelsFilename = `labels_${timestamp}.pdf`;
    const invFilename    = `invoices_${timestamp}.pdf`;
    await fs.writeFile(path.join('outputs', labelsFilename), labelsBytes);
    await fs.writeFile(path.join('outputs', invFilename), invBytes);

    res.json({
      labels: `/outputs/${labelsFilename}`,
      invoices: `/outputs/${invFilename}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

ensureDirs()
  .then(() => app.listen(process.env.PORT || 3000, () =>
    console.log('Server running on port', process.env.PORT || 3000)
  ))
  .catch(err => console.error('Dir init error', err));
