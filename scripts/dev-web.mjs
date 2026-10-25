import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".json": "application/json",
};
const server = http.createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    const file =
      path === "/"
        ? "assets/studio/poster.html"
        : path === "/demo.png"
          ? "docs/images/source.png"
          : path === "/demo.json"
            ? "docs/examples/metrocard.json"
            : /^\/[a-z-]+\.(js|css)$/.test(path)
              ? `assets/studio${path}`
              : null;
    if (!file) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const body = await readFile(resolve(root, file));
    response.writeHead(200, {
      "Content-Type": types[extname(file)],
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
server.listen(Number(process.env.PORT || 4173), "127.0.0.1", () => {
  console.log(`Poster Studio: http://127.0.0.1:${server.address().port}`);
});
