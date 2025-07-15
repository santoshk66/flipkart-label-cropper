import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { PDFDocument } from 'pdf-lib';

const app = express();
app.use(cors());
app.use(express.static('public'));

const targetFolders = ['uploads', 'outputs'];
async function ensureDirs() {
  await Promise.all(targetFolders.map(dir =>
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

let LABEL_CROP = { x: 0, y: 500, width: 595, height: 350 };
let INVOICE_CROP = { x: 0, y: 0, width: 595, height: 500 };

app.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    const srcBytes = await fs.readFile(req.file.path);
    const srcPdf = await PDFDocument.load(srcBytes);
    const labelsPdf = await PDFDocument.create();
    const invoicesPdf = await PDFDocument.create();

    for (let i = 0; i < srcPdf.getPageCount(); i++) {
      const [srcPage] = await labelsPdf.copyPages(srcPdf, [i]);
      const [invPage] = await invoicesPdf.copyPages(srcPdf, [i]);

      srcPage.setCropBox(LABEL_CROP.x, LABEL_CROP.y, LABEL_CROP.width, LABEL_CROP.height);
      srcPage.setMediaBox(0, 0, LABEL_CROP.width, LABEL_CROP.height);
      labelsPdf.addPage(srcPage);

      invPage.setCropBox(INVOICE_CROP.x, INVOICE_CROP.y, INVOICE_CROP.width, INVOICE_CROP.height);
      invPage.setMediaBox(0, 0, INVOICE_CROP.width, INVOICE_CROP.height);
      invoicesPdf.addPage(invPage);
    }

    const labelsBytes = await labelsPdf.save();
    const invBytes = await invoicesPdf.save();
    const labelsPath = path.join('outputs', \`labels_\${Date.now()}.pdf\`);
    const invPath = path.join('outputs', \`invoices_\${Date.now()}.pdf\`);
    await fs.writeFile(labelsPath, labelsBytes);
    await fs.writeFile(invPath, invBytes);

    res.json({ labels: labelsPath, invoices: invPath });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
ensureDirs()
  .then(() => app.listen(PORT, () => console.log(\`Server running on port \${PORT}\`)))
  .catch(err => console.error('Error initializing directories', err));
