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

const rdkitHostport = process.env.RDKIT_HOSTPORT;
const configuredRdkitUrl = process.env.RDKIT_URL;
const RDKIT_URL = configuredRdkitUrl
  || (rdkitHostport ? `http://${rdkitHostport}` : null)
  || "http://localhost:5000";

// Track RDKit liveness without blocking requests
const rdkit = { alive: false, checking: false };

const pingRdkit = () => {
  if (rdkit.checking) return; // already in flight
  rdkit.checking = true;
  axios.get(`${RDKIT_URL}/health`, { timeout: 60000 })
    .then(() => { rdkit.alive = true; })
    .catch(() => { rdkit.alive = false; })
    .finally(() => { rdkit.checking = false; });
};

// Health check for this Node server itself
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Non-blocking warmup: returns instantly, fires background ping
app.get("/warmup", (req, res) => {
  pingRdkit(); // fire and forget
  if (rdkit.alive) {
    res.json({ status: "ok", rdkit: "alive" });
  } else {
    res.status(503).json({
      status: rdkit.checking ? "waking" : "sleeping",
      rdkit: "offline",
      target: RDKIT_URL
    });
  }
});

// Keep pinging RDKit every 30s while Node is alive, so it stays warm
setInterval(pingRdkit, 30 * 1000);

const upload = multer({ dest: os.tmpdir() });

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
    rdkit.alive = false; // mark offline so next warmup poll re-checks
    const status = err.response?.status || 500;
    res.status(status).json({ error: "RDKit service failed", detail });
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
    rdkit.alive = false; // mark offline
    if (req.files) {
      for (const file of req.files) {
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }
    const status = err.response?.status || 500;
    res.status(status).json({ error: "Upload failed", detail });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Node gateway running on port ${PORT}`);
  console.log(`RDKit target: ${RDKIT_URL}`);
  pingRdkit(); // ping RDKit immediately on startup
});
