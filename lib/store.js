// Dateispeicher: users.json und data/projects/<id>.json. Atomar geschrieben, Backup alle 10 Minuten.
const fs = require("fs");
const path = require("path");

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bak = file.replace(/\.json$/, ".bak.json");
  try { if (Date.now() - fs.statSync(bak).mtimeMs > 600000) fs.copyFileSync(file, bak); } catch (_) { try { fs.copyFileSync(file, bak); } catch (_) {} }
  fs.writeFileSync(file + ".tmp", text);
  fs.renameSync(file + ".tmp", file);
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return fallback; }
}

function open(dir) {
  const usersFile = path.join(dir, "users.json");
  const projDir = path.join(dir, "projects");
  const timers = new Map();
  // Gleich nach Änderungen speichern, aber gebündelt (Timer pro Datei)
  function later(key, fn) { clearTimeout(timers.get(key)); timers.set(key, setTimeout(() => { timers.delete(key); try { fn(); } catch (e) { console.error("Speichern fehlgeschlagen:", e.message); } }, 400)); }
  return {
    loadUsers: () => readJson(usersFile, { users: [] }).users,
    saveUsers: (users) => later("users", () => writeAtomic(usersFile, JSON.stringify({ users }))),
    loadProjects() {
      let files = [];
      try { files = fs.readdirSync(projDir).filter((f) => /^[a-z0-9]+\.json$/.test(f) && !f.endsWith(".bak.json")); } catch (_) {}
      return files.map((f) => readJson(path.join(projDir, f), null)).filter((p) => p && p.meta && p.state);
    },
    saveProject: (p) => later("p:" + p.meta.id, () => writeAtomic(path.join(projDir, p.meta.id + ".json"), JSON.stringify({ meta: p.meta, state: p.state }))),
    deleteProject(id) { clearTimeout(timers.get("p:" + id)); for (const s of [".json", ".bak.json"]) try { fs.unlinkSync(path.join(projDir, id + s)); } catch (_) {} },
    flush() { for (const [k, t] of timers) { clearTimeout(t); } },
  };
}
module.exports = { open };
