import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const port = Number(process.env.PORT || 4174);
const tracePath = new URL("../demo/langgraph-example.ndjson", import.meta.url);

const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"ok":true,"protocol":"langgraph-astream-events-v2-ndjson"}\n');
    return;
  }
  if (request.url !== "/events") {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Use /events or /health\n");
    return;
  }

  response.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Connection": "keep-alive",
  });
  const lines = (await readFile(tracePath, "utf8")).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let previousTimestamp = 0;
  for (const line of lines) {
    if (response.destroyed) break;
    const event = JSON.parse(line);
    const timestamp = Number(event.timestamp || 0);
    await sleep(Math.max(0, Math.min(2500, timestamp - previousTimestamp)));
    if (response.destroyed) break;
    response.write(`${line}\n`);
    previousTimestamp = timestamp;
  }
  response.end();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`LangGraph NDJSON demo stream: http://127.0.0.1:${port}/events`);
});
