const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const { WebSocketServer } = require("ws");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 4000;

// OpenAI client (pour future usage IA, non utilisé ici pour le test)
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

// Endpoint POST minimal pour debug : /api/audio-chunk
app.post("/api/audio-chunk", (req, res) => {
  console.log("Endpoint /api/audio-chunk appelé");
  res.json({ transcript: "OK test", advice: "Conseil test" });
});

// (ne mets rien d'autre à la fin du fichier !)
