const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const { WebSocketServer, WebSocket } = require("ws");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 4000;

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
//   5. Upgrade WebSocket interne
// --------------------------

const server = app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
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
