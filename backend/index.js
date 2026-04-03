import express from "express";
import axios from "axios";
import multer from "multer";
import cors from "cors";
import FormData from "form-data";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const RDKIT_URL = process.env.RDKIT_URL || "http://localhost:5000";

// SMILES route
app.post("/api/check", async (req, res) => {
  try {
    const response = await axios.post(`${RDKIT_URL}/check`, {
      smiles: req.body.smiles
    });
    res.json(response.data);
  } catch (err) {
    console.error("RDKit Check Error:", err?.message);
    res.status(500).json({ error: "RDKit AI Service failed" });
  }
});

// File upload route
app.post("/api/upload", upload.array("files"), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const formData = new FormData();
    for (const file of req.files) {
      formData.append("files", fs.createReadStream(file.path), file.originalname);
    }

    const response = await axios.post(
      `${RDKIT_URL}/upload`,
      formData,
      { headers: formData.getHeaders() }
    );

    // Clean up temp files
    for (const file of req.files) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }

    res.json(response.data);
  } catch (err) {
    console.error("Upload Error:", err?.message);
    // Cleanup if possible
    if (req.files) {
      for (const file of req.files) {
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }
    res.status(500).json({ error: "Upload failed" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Node gateway running on port ${PORT}`));
