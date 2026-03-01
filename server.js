const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const { WebSocketServer, WebSocket } = require("ws");
const path = require("path");
const https = require("https");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 4000;

// Serve static files (geo-stats UI)
app.use(express.static(path.join(__dirname, "public")));

// --------------------------
//   1. WebSocket interne
// --------------------------
const wss = new WebSocketServer({ noServer: true });
let clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});

// PUSH Helper
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const c of clients) {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  }
}

// --------------------------
//   2. Connexion Realtime OpenAI
// --------------------------

const realtimeWS = new WebSocket(
  "wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview",
  {
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1"
    }
  }
);

realtimeWS.on("open", () => {
  console.log("Connected to OpenAI Realtime API");

  // Contexte / prompt permanent
  const instructions = `
Tu es un coach de vente.
Analyse chaque transcription audio entrante en temps réel.
Donne un conseil ACTIONNABLE et concis (1-2 phrases) au commercial.
`;

  realtimeWS.send(
    JSON.stringify({
      type: "session.update",
      session: {
        instructions,
        modalities: ["text", "audio"]
      }
    })
  );
});

// --------------------------
//   3. Gestion des events OpenAI
// --------------------------

realtimeWS.on("message", (msg) => {
  let event = JSON.parse(msg);

  // Transcription partielle en streaming
  if (event.type === "response.output_text.delta") {
    broadcast({
      type: "transcription_part",
      text: event.delta
    });
  }

  // Fin de transcription + conseil
  if (event.type === "response.output_text.done") {
    broadcast({
      type: "transcription_result",
      text: event.text
    });
  }

  // Message complet (avec le conseil généré)
  if (event.type === "response.completed") {
    if (event.response?.output_text) {
      broadcast({
        type: "ai_advice",
        advice: event.response.output_text[0]?.content
      });
    }
  }
});

realtimeWS.on("error", (err) => {
  console.error("Realtime OpenAI error:", err);
});

realtimeWS.on("close", () => {
  console.log("Realtime OpenAI closed.");
});

// --------------------------
//   4. Endpoint HTTP /api/audio-chunk
// --------------------------

app.post("/api/audio-chunk", async (req, res) => {
  try {
    const { audioBase64 } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ error: "missing_audio" });
    }

    // Envoi du chunk audio à OpenAI (base64 PCM16 ou Opus)
    realtimeWS.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: audioBase64
      })
    );

    // Déclenche un traitement de ce segment
    realtimeWS.send(
      JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["text"]
        }
      })
    );

    res.json({ status: "chunk_sent" });
  } catch (e) {
    console.error("Erreur endpoint audio-chunk:", e);
    res.status(500).json({ error: "processing_error" });
  }
});

// --------------------------
//   5. Geo-Stats API (Somme)
// --------------------------

// Fetch JSON from a URL using the built-in https module
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error("JSON parse error: " + e.message)); }
      });
    }).on("error", reject);
  });
}

// Deterministic pseudo-random from an integer seed (consistent values on each call)
function seededRand(seed) {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

// GET /api/geo-stats/somme
// Returns GeoJSON FeatureCollection of Somme communes enriched with
// simulated elderly-population statistics (60+, 75+, 85+).
app.get("/api/geo-stats/somme", async (req, res) => {
  try {
    const url =
      "https://geo.api.gouv.fr/departements/80/communes" +
      "?geometry=contour&format=geojson&fields=code,nom,population,codesPostaux";

    const geojson = await fetchJson(url);

    const features = geojson.features.map((feature) => {
      const codeNum = parseInt(feature.properties.code, 10) || 0;
      const pop     = feature.properties.population || 400;

      // Rural communes (small population) tend to have older populations
      const urbanFactor = Math.min(1, pop / 20000);
      const baseRate    = 0.28 - urbanFactor * 0.13; // 28 % rural → 15 % urban

      const r1 = seededRand(codeNum * 13);
      const r2 = seededRand(codeNum * 7);
      const r3 = seededRand(codeNum * 19);

      const pct60 = Math.max(0.10, Math.min(0.42, baseRate + (r1 - 0.5) * 0.10));
      const pct75 = pct60 * (0.40 + r2 * 0.08);
      const pct85 = pct75 * (0.30 + r3 * 0.10);

      return {
        ...feature,
        properties: {
          ...feature.properties,
          pct60Plus: +(pct60 * 100).toFixed(1),
          pct75Plus: +(pct75 * 100).toFixed(1),
          pct85Plus: +(pct85 * 100).toFixed(1),
          nb60Plus:  Math.round(pop * pct60),
          nb75Plus:  Math.round(pop * pct75),
          nb85Plus:  Math.round(pop * pct85),
        },
      };
    });

    res.json({ type: "FeatureCollection", features });
  } catch (err) {
    console.error("[geo-stats]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------
//   6. Upgrade WebSocket interne
// --------------------------

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`GéoStats UI → http://localhost:${PORT}/geo-stats.html`);
});

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});
