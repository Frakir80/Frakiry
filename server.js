const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const OpenAI = require("openai"); // ← correction ici
const { WebSocketServer } = require("ws");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 4000;

// OpenAI client (pour transcription + conseils)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// WebSocket serveur pour pousser le feedback en live
const wss = new WebSocketServer({ noServer: true });
let clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});

// HTTP serveur + upgrade WebSocket
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

// Endpoint pour recevoir des chunks audio (PCM/opus en base64 par ex.)
app.post("/api/audio-chunk", (req, res) => {
  console.log("Endpoint /api/audio-chunk appelé"); // Ceci doit apparaître dans Railway
  res.json({ transcript: "OK test", advice: "Conseil test" });
});



    const advice = completion.choices[0].message.content;

    // 3) Broadcast du conseil aux clients WebSocket connectés sur cette session
    const payload = JSON.stringify({
      type: "advice",
      sessionId,
      role,
      transcript,
      advice,
      timestamp: new Date().toISOString(),
    });

    clients.forEach((ws) => {
      ws.send(payload);
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "processing_error" });
  }
});
