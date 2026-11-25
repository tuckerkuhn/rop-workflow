// A stand-in for KoboToolbox on this laptop only: serves two sample photos and a list of forms. Nothing here is real data.
import http from "node:http";
import fs from "node:fs";
// The account's list of forms: empty, or what the file named in FAKE_FORMS holds (a JSON list of
// { uid, name }), so the Setup step that lists forms can be walked before and after "an upload".
const forms = () => { try { return JSON.parse(fs.readFileSync(process.env.FAKE_FORMS, "utf8")); } catch { return []; } };
http.createServer((req, res) => {
  if (req.url.startsWith("/api/v2/assets/?") && req.headers.authorization === "Token fake-token") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ results: forms().map((f) => ({ ...f, deployment__active: true, deployment__submission_count: 0 })), next: null }));
  }
  const f = req.url.includes("handover") ? "handover.jpg" : req.url.includes("note") ? "note.jpg" : null;
  if (!f || req.headers.authorization !== "Token fake-token") { res.writeHead(f ? 401 : 404); return res.end(); }
  const b = fs.readFileSync(new URL(f, import.meta.url));
  res.writeHead(200, { "content-type": "image/jpeg", "content-length": b.length }); res.end(b);
}).listen(4010, () => console.log("fake kobo on 4010"));
