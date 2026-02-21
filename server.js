const http = require("http");
const WebSocket = require("ws");

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Server is running");
});

const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {
  console.log("Client connected");

  ws.on("message", message => {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message.toString());
      }
    });
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});