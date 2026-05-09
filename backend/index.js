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
const rdkitHost = process.env.RDKIT_HOST;
const rdkitPort = process.env.RDKIT_PORT;
const configuredRdkitUrl = process.env.RDKIT_URL;
const RDKIT_URL = (configuredRdkitUrl
  || (rdkitHostport ? `http://${rdkitHostport}` : null)
  || (rdkitHost && rdkitPort ? `http://${rdkitHost}:${rdkitPort}` : null)
  || "http://localhost:5000").replace(/\/+$/, "");

const RDKIT_HEALTH_TIMEOUT_MS = Number(process.env.RDKIT_HEALTH_TIMEOUT_MS || 60000);
const RDKIT_REQUEST_TIMEOUT_MS = Number(process.env.RDKIT_REQUEST_TIMEOUT_MS || 120000);
const RDKIT_KEEPALIVE_MS = Number(process.env.RDKIT_KEEPALIVE_MS || 10 * 60 * 1000);
const RDKIT_RETRIES = Number(process.env.RDKIT_RETRIES || 2);

// Track RDKit liveness without blocking requests
const rdkit = { alive: false, checking: false };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableRdkitError = (err) => {
  if (!err.response) return true;
  return err.response.status >= 500 || err.response.status === 429;
};

const pingRdkit = async () => {
  if (rdkit.checking) return rdkit.alive; // already in flight
  rdkit.checking = true;
  try {
    await axios.get(`${RDKIT_URL}/health`, { timeout: RDKIT_HEALTH_TIMEOUT_MS });
    rdkit.alive = true;
  } catch {
    rdkit.alive = false;
  } finally {
    rdkit.checking = false;
  }
  return rdkit.alive;
};

const requestRdkit = async (configOrFactory, options = {}) => {
  const retries = options.retries ?? RDKIT_RETRIES;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const config = typeof configOrFactory === "function"
        ? configOrFactory()
        : configOrFactory;
      const response = await axios({
        timeout: RDKIT_REQUEST_TIMEOUT_MS,
        ...config
      });
      rdkit.alive = true;
      return response;
    } catch (err) {
      lastError = err;
      rdkit.alive = false;

      if (attempt >= retries || !isRetryableRdkitError(err)) {
        break;
      }

      await pingRdkit();
      await sleep(Math.min(5000 * (attempt + 1), 15000));
    }
  }

  throw lastError;
};

// Health check for this Node server itself
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Non-blocking warmup: returns instantly, fires background ping
app.get("/warmup", (req, res) => {
  pingRdkit(); // fire and forget
  if (rdkit.alive) {
    res.json({ status: "ok", rdkit: "alive", ready: true });
  } else {
    res.json({
      status: rdkit.checking ? "waking" : "sleeping",
      rdkit: "offline",
      target: RDKIT_URL,
      ready: false
    });
  }
});

// Keep RDKit warm while Node is alive. Render free instances sleep after about 15 minutes,
// so the default 10-minute interval is enough without flooding the service.
if (RDKIT_KEEPALIVE_MS > 0) {
  setInterval(pingRdkit, RDKIT_KEEPALIVE_MS);
}

const upload = multer({ dest: os.tmpdir() });

// SMILES route
app.post("/api/check", async (req, res) => {
  try {
    const response = await requestRdkit({
      method: "post",
      url: `${RDKIT_URL}/check`,
      data: { smiles: req.body.smiles }
    });
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

    const response = await requestRdkit(() => {
      const formData = new FormData();
      for (const file of req.files) {
        formData.append("files", fs.createReadStream(file.path), file.originalname);
      }

      return {
        method: "post",
        url: `${RDKIT_URL}/upload`,
        data: formData,
        headers: formData.getHeaders()
      };
    }, { retries: 1 });

    res.json(response.data);
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("Upload Error:", detail);
    rdkit.alive = false; // mark offline
    const retryAfter = err.response?.headers?.["retry-after"];
    if (retryAfter) {
      res.set("Retry-After", String(retryAfter));
    }
    const status = err.response?.status || 500;
    res.status(status).json({ error: "Upload failed", detail });
  } finally {
    if (req.files) {
      for (const file of req.files) {
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Node gateway running on port ${PORT}`);
  console.log(`RDKit target: ${RDKIT_URL}`);
  console.log(`RDKit keepalive: ${RDKIT_KEEPALIVE_MS > 0 ? `${RDKIT_KEEPALIVE_MS}ms` : "disabled"}`);
  pingRdkit(); // ping RDKit immediately on startup
});
