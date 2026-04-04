import express from "express";
import axios from "axios";
import multer from "multer";
import cors from "cors";
import FormData from "form-data";
import fs from "fs";
import os from "os";

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Warmup: ping the rdkit service so it wakes up
app.get("/warmup", async (req, res) => {
  try {
    await axios.get(`${RDKIT_URL}/health`, { timeout: 50000 });
    res.json({ status: "rdkit awake" });
  } catch (err) {
    res.status(503).json({ status: "rdkit sleeping", error: err.message });
  }
});

const upload = multer({ dest: os.tmpdir() });

const RDKIT_URL = process.env.RDKIT_URL || "http://localhost:5000";

// SMILES route
app.post("/api/check", async (req, res) => {
  try {
    const response = await axios.post(`${RDKIT_URL}/check`, {
      smiles: req.body.smiles
    }, { timeout: 30000 });
    res.json(response.data);
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("RDKit Check Error:", detail);
    res.status(500).json({ error: "RDKit service failed", detail });
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
      { headers: formData.getHeaders(), timeout: 60000 }
    );

    // Clean up temp files
    for (const file of req.files) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }

    res.json(response.data);
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("Upload Error:", detail);
    if (req.files) {
      for (const file of req.files) {
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }
    res.status(500).json({ error: "Upload failed", detail });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Node gateway running on port ${PORT}`));
