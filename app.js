import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { PDFDocument } from 'pdf-lib';

const app = express();
app.use(cors());
app.use(express.static('public'));
// Expose outputs
app.use('/outputs', express.static(path.join(process.cwd(), 'outputs')));

async function ensureDirs() {
  const dirs = ['uploads', 'outputs'];
  await Promise.all(dirs.map(dir =>
    fs.mkdir(path.join(process.cwd(), dir), { recursive: true })
  ));
}

// Accept two files: labels PDF and invoices PDF
const upload = multer({ dest: 'uploads/' });

app.post('/upload', upload.fields([
  { name: 'labels', maxCount: 1 },
  { name: 'invoices', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files.labels || !req.files.invoices) {
      return res.status(400).json({ error: 'Please upload both labels and invoices PDFs' });
    }
    const labelsBytes = await fs.readFile(req.files.labels[0].path);
    const invoicesBytes = await fs.readFile(req.files.invoices[0].path);

    const labelsPdf = await PDFDocument.load(labelsBytes);
    const invoicesPdf = await PDFDocument.load(invoicesBytes);
    const outputPdf = await PDFDocument.create();

    const num = Math.min(labelsPdf.getPageCount(), invoicesPdf.getPageCount());
    for (let i = 0; i < num; i++) {
      const [labPage] = await outputPdf.copyPages(labelsPdf, [i]);
      outputPdf.addPage(labPage);
      const [invPage] = await outputPdf.copyPages(invoicesPdf, [i]);
      outputPdf.addPage(invPage);
    }

    const outBytes = await outputPdf.save();
    const filename = `combined_${Date.now()}.pdf`;
    const outPath = path.join('outputs', filename);
    await fs.writeFile(outPath, outBytes);

    res.json({ file: `/outputs/${filename}` });
  } catch (err) {
    console.error('Combine error:', err);
    res.status(500).json({ error: err.message });
  }
});

ensureDirs()
  .then(() => app.listen(process.env.PORT || 3000, () =>
    console.log('Server running on port', process.env.PORT || 3000)
  ))
  .catch(err => console.error('Dir init error', err));
