import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/** Default bind address for `statuscraft serve`: loopback only. */
export const SERVE_HOST = "127.0.0.1";

/**
 * Resolves a request path inside `root`, or returns null if it would escape
 * it. The containment check compares against `root + separator`, so a
 * sibling directory that merely shares the prefix (`dist-site-private`) is
 * rejected too.
 */
export function resolveInside(root: string, urlPath: string): string | null {
  const relative = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = resolve(root + relative);
  if (filePath !== root && !filePath.startsWith(root + sep)) return null;
  return filePath;
}

/** A minimal static file server for previewing a generated site. */
export function createStaticServer(root: string): Server {
  return createServer((req, res) => {
    void (async () => {
      const urlPath = (req.url ?? "/").split("?")[0] as string;
      const filePath = resolveInside(root, urlPath);
      if (filePath === null) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      try {
        const body = await readFile(filePath);
        const type = MIME[extname(filePath)] ?? "application/octet-stream";
        res.writeHead(200, { "Content-Type": type }).end(body);
      } catch {
        res.writeHead(404).end("Not found");
      }
    })();
  });
}
