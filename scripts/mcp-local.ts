import { createServer } from "node:http";
import handler from "../api/mcp";

const port = Number(process.env.PORT ?? 3000);

createServer((request, response) => {
  if (request.url?.startsWith("/api/mcp")) {
    void handler(request, response);
    return;
  }
  response.statusCode = 404;
  response.end("Archboard MCP server: use /api/mcp");
}).listen(port, "127.0.0.1", () => {
  console.log(`Archboard MCP listening at http://127.0.0.1:${port}/api/mcp`);
});
