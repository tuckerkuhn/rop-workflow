// A stand-in for KoboToolbox on this laptop only: serves two sample photos. Nothing here is real data.
import http from "node:http";
import fs from "node:fs";
http.createServer((req, res) => {
  const f = req.url.includes("handover") ? "handover.jpg" : req.url.includes("note") ? "note.jpg" : null;
  if (!f || req.headers.authorization !== "Token fake-token") { res.writeHead(f ? 401 : 404); return res.end(); }
  const b = fs.readFileSync(new URL(f, import.meta.url));
  res.writeHead(200, { "content-type": "image/jpeg", "content-length": b.length }); res.end(b);
}).listen(4010, () => console.log("fake kobo on 4010"));
