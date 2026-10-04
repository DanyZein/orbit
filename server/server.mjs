// Orbit's server: serves the built app and keeps its data as JSON files on disk.
//
// Deliberately dependency-free - the whole server is this one file, so deploying is copying two
// directories and installing a systemd unit. Needs Node 18+ for global fetch and import.meta.
//
//   GET /api/storage/:key   -> { key, value }  |  404 when nothing is stored yet
//   PUT /api/storage/:key   -> { key, value }
//   GET /*                  -> the app out of dist/
//
// Every write is atomic (write a temp file, then rename) and the previous contents are copied
// into backups/ before being replaced. That second part is not paranoia: the app writes the
// whole entries array on every change, so any bug that produces a short array - or a boot that
// failed and fell back to defaults - would otherwise destroy the file with no way back.

import { createServer } from "node:http";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "127.0.0.1"; // the tunnel is local; never bind this publicly
// resolve() so both are absolute and use one separator style. comparing a forward-slash env
// value against path.join's backslashes is how the dist containment check wrongly 403d on windows
const DATA_DIR = resolve(process.env.ORBIT_DATA || "/var/lib/orbit");
const DIST_DIR = resolve(
  process.env.ORBIT_DIST || join(import.meta.dirname, "..", "dist"),
);
const BACKUP_DIR = join(DATA_DIR, "backups");
const BACKUP_KEEP = 20;
const MAX_BODY = 5 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// "orbit:entries" -> entries.json. Anything outside [a-z0-9_-] is dropped, so a crafted key
// cannot walk out of the data directory.
function fileFor(key) {
  const name = String(key)
    .replace(/^orbit:/, "")
    .replace(/[^a-z0-9_-]/gi, "")
    .toLowerCase();
  if (!name) throw new HttpError(400, "empty key");
  return { name, path: join(DATA_DIR, `${name}.json`) };
}

async function pruneBackups(name) {
  const mine = (await readdir(BACKUP_DIR))
    .filter((f) => f.startsWith(`${name}-`) && f.endsWith(".json"))
    .sort(); // the timestamp is ISO-derived, so lexical order is chronological
  for (const old of mine.slice(0, Math.max(0, mine.length - BACKUP_KEEP)))
    await unlink(join(BACKUP_DIR, old)).catch(() => {});
}

async function readKey(key) {
  const { path } = fileFor(key);
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    throw new HttpError(500, `${key} on disk is not valid JSON - restore one from backups/`);
  }
}

async function writeKey(key, body) {
  const { name, path } = fileFor(key);

  // the app sends a JSON string; store it back as real JSON so the file stays readable
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    throw new HttpError(400, "value is not valid JSON");
  }

  await mkdir(BACKUP_DIR, { recursive: true });
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await copyFile(path, join(BACKUP_DIR, `${name}-${stamp}.json`));
    await pruneBackups(name);
  } catch {
    // nothing on disk yet - first write for this key, nothing to back up
  }

  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, path); // atomic within the same filesystem: no half-written file ever
  return JSON.stringify(value);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function serveStatic(res, pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
  const target = join(DIST_DIR, rel);
  if (target !== DIST_DIR && !target.startsWith(DIST_DIR + sep))
    throw new HttpError(403, "forbidden");

  let body;
  let headers;
  try {
    body = await readFile(target);
    headers = { "content-type": TYPES[extname(target)] || "application/octet-stream" };
    // vite fingerprints everything under assets/, so those can be cached forever
    if (rel.startsWith("assets" + sep) || rel.startsWith("assets/"))
      headers["cache-control"] = "public, max-age=31536000, immutable";
  } catch {
    // anything unknown (including "/") gets the app shell
    body = await readFile(join(DIST_DIR, "index.html"));
    headers = { "content-type": TYPES[".html"], "cache-control": "no-cache" };
  }
  res.writeHead(200, headers);
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (pathname.startsWith("/api/storage/")) {
      const key = decodeURIComponent(pathname.slice("/api/storage/".length));
      if (req.method === "GET") {
        const value = await readKey(key);
        if (value === null) return sendJson(res, 404, { error: "not found" });
        return sendJson(res, 200, { key, value });
      }
      if (req.method === "PUT") {
        const value = await writeKey(key, await readBody(req));
        return sendJson(res, 200, { key, value });
      }
      return sendJson(res, 405, { error: "method not allowed" });
    }

    if (req.method !== "GET" && req.method !== "HEAD")
      return sendJson(res, 405, { error: "method not allowed" });
    await serveStatic(res, pathname);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error("orbit:", err);
    if (!res.headersSent) sendJson(res, status, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`orbit listening on http://${HOST}:${PORT}`);
  console.log(`  app    : ${DIST_DIR}`);
  console.log(`  data   : ${DATA_DIR}`);
  console.log(`  backups: ${BACKUP_DIR} (keeping ${BACKUP_KEEP})`);
});
