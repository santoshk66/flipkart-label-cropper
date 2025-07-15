const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb } = require("pdf-lib");

const app = express();
app.use(cors());
app.use(express.static("public")); // 👈 Serve static files from public folder

const upload = multer({ dest: "uploads/" });

// Serve HTML upload form on root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const convertToThermalLabels = async (inputPath) => {
  const A4_HEIGHT = 842;
  const A4_WIDTH = 595;
  const LABEL_WIDTH = 213;
  const LABEL_HEIGHT = 354;

  const originalPdf = await PDFDocument.load(fs.readFileSync(inputPath));
  const outputPdf = await PDFDocument.create();

  for (const page of originalPdf.getPages()) {
    const [embeddedPage] = await outputPdf.embedPages([page]);

    const labelPage = outputPdf.addPage([LABEL_WIDTH, LABEL_HEIGHT]);
    labelPage.drawPage(embeddedPage, {
      x: 0,
      y: 0,
      width: LABEL_WIDTH,
      height: LABEL_HEIGHT * 2,
      clip: { x: 0, y: A4_HEIGHT / 2, width: A4_WIDTH, height: A4_HEIGHT / 2 }
    });

    const invoicePage = outputPdf.addPage([LABEL_WIDTH, LABEL_HEIGHT]);
    invoicePage.drawPage(embeddedPage, {
      x: 0,
      y: 0,
      width: LABEL_WIDTH,
      height: LABEL_HEIGHT * 2,
      clip: { x: 0, y: 0, width: A4_WIDTH, height: A4_HEIGHT / 2 }
    });
  }

  return await outputPdf.save();
};

app.post("/upload", upload.single("pdf"), async (req, res) => {
  const inputPath = req.file.path;
  const outputBuffer = await convertToThermalLabels(inputPath);
  const outputPath = path.join(__dirname, "output", `converted.pdf`);

  fs.writeFileSync(outputPath, outputBuffer);
  res.download(outputPath, "Thermal_Labels_Merged.pdf", () => {
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);
  });
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
