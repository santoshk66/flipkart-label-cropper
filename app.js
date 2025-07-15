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

--- a/app.js
+++ b/app.js
@@ app.post('/upload', upload.single('pdf'), async (req, res) => {
-    const srcPdf = await PDFDocument.load(srcBytes);
+    const srcPdf = await PDFDocument.load(srcBytes);

+    // 👉 Log this once so you confirm the page is 216×355pt
+    const p0 = srcPdf.getPage(0);
+    console.log(`Original page size: ${p0.getWidth()}pt × ${p0.getHeight()}pt`);

+    // 👉 Exact crop boxes (in PDF points) for your shipping label & invoice.
+    //    Adjust these if your “Tax Invoice” heading sits a little higher/lower.
+    const LABEL_CROP   = { x: 0, y: 231, width: 216, height: 124 };
+    const INVOICE_CROP = { x: 0, y:   0, width: 216, height: 231 };

    const outputPdf = await PDFDocument.create();

    for (let i = 0; i < srcPdf.getPageCount(); i++) {
      // copy the original page twice
      const [labelPage]   = await outputPdf.copyPages(srcPdf, [i]);
      const [invoicePage] = await outputPdf.copyPages(srcPdf, [i]);

      // 1️⃣ Crop out **only** the label block
      labelPage.setCropBox(
        LABEL_CROP.x, LABEL_CROP.y,
        LABEL_CROP.width, LABEL_CROP.height
      );
      labelPage.setMediaBox(0, 0, LABEL_CROP.width, LABEL_CROP.height);
      outputPdf.addPage(labelPage);

      // 2️⃣ Crop out **only** the invoice block
      invoicePage.setCropBox(
        INVOICE_CROP.x, INVOICE_CROP.y,
        INVOICE_CROP.width, INVOICE_CROP.height
      );
      invoicePage.setMediaBox(0, 0, INVOICE_CROP.width, INVOICE_CROP.height);
      outputPdf.addPage(invoicePage);
    }

    const outputBytes = await outputPdf.save();
    // … rest of your save + response logic …


ensureDirs()
  .then(() => app.listen(process.env.PORT || 3000, () =>
    console.log('Server running on port', process.env.PORT || 3000)
  ))
  .catch(err => console.error('Dir init error', err));
