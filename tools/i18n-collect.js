// Sammelt alle sichtbaren UI-Texte, die in einer Sprache ohne Wörterbuch (?lang=en) unübersetzt bleiben.
// Aufruf: node tools/i18n-collect.js  (startet einen Testserver, fährt alle Seiten und Zustände ab, schreibt tools/i18n-collected.json)
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
let chromium; try { chromium = require("playwright").chromium; } catch (_) { chromium = require(require("child_process").execSync("npm root -g").toString().trim() + "/playwright").chromium; }
const PORT = 4097, U = `http://localhost:${PORT}`, DATA = "/tmp/sw-collect-" + Date.now();
(async () => {
  const srv = spawn("node", ["server.js"], { env: { ...process.env, PORT, DATA_DIR: DATA }, cwd: path.join(__dirname, "..") });
  await new Promise((r) => setTimeout(r, 1200));
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  await ctx.addInitScript(() => { window.I18N_DICTS = { en: {} }; }); // leeres Wörterbuch: alles gilt als unübersetzt, so entsteht die vollständige Liste
  const all = new Set(), errs = [];
  const grab = async (pg) => { try { for (const s of await pg.evaluate(() => I18N.missing())) all.add(s); } catch (_) {} };
  const open = async (url, wait = 1200) => { const pg = await ctx.newPage(); pg.on("pageerror", (e) => errs.push(url + " " + e.message)); pg.on("dialog", (d) => d.accept()); await pg.goto(U + url + (url.includes("?") ? "&" : "?") + "lang=en"); await pg.waitForTimeout(wait); return pg; };
  const step = async (name, fn) => { try { await fn(); } catch (e) { errs.push(name + ": " + e.message.split("\n")[0]); } };

  // Anmeldung / Registrierung
  let pg = await open("/", 600); await grab(pg); await pg.close();
  pg = await open("/login", 500); await pg.fill("#email", "x@y.de"); await pg.fill("#pw", "falsch123"); await pg.click("#go"); await pg.waitForTimeout(600); await grab(pg); await pg.close();
  pg = await open("/signup", 500); await pg.fill("#name", "Anna Test"); await pg.fill("#email", "anna@test.de"); await pg.fill("#pw", "kurz"); await pg.click("#go"); await pg.waitForTimeout(600); await grab(pg);
  await pg.fill("#pw", "geheim1234"); await pg.click("#go"); await pg.waitForURL("**/app"); await pg.waitForTimeout(500); await grab(pg);
  await step("newproj", async () => { await pg.click("[data-new]"); await pg.waitForTimeout(300); await grab(pg); await pg.click(".modal .primary"); await pg.waitForTimeout(500); await grab(pg); await pg.fill("#npName", "Gala 2026"); await pg.click(".modal .primary"); await pg.waitForURL(/\/p\/.+\//); });
  const base = pg.url().replace(/\/$/, ""); const pid = base.split("/p/")[1];
  await pg.waitForTimeout(800); await grab(pg);
  const act = (a) => pg.evaluate(async ([pid, a]) => (await fetch(`/api/p/${pid}/action`, { method: "POST", headers: { "x-cl": "1", "Content-Type": "application/json" }, body: JSON.stringify(a) })).status, [pid, a]);
  const adm = (a) => pg.evaluate(async ([pid, a]) => (await (await fetch(`/api/p/${pid}/admin`, { method: "POST", headers: { "x-cl": "1", "Content-Type": "application/json" }, body: JSON.stringify(a) })).json()), [pid, a]);

  // Regie in verschiedenen Zuständen
  await step("regie", async () => {
    const r = await open(`/p/${pid}/`, 900); await grab(r);
    await act({ type: "start" }); await act({ type: "addTime", ms: 60000 }); await act({ type: "addTime", ms: -60000 }); await act({ type: "message", text: "Hallo", visible: true }); await act({ type: "ready", gewerk: "licht", state: "ready" }); await act({ type: "ready", gewerk: "ton", state: "wait" });
    await act({ type: "lower", data: { title: "Anna", subtitle: "Gast", visible: true } }); await act({ type: "draftStart" }); await r.waitForTimeout(900); await grab(r);
    await act({ type: "pause" }); await r.waitForTimeout(500); await grab(r); await act({ type: "next" }); await act({ type: "prev" }); await act({ type: "stop" }); await act({ type: "roll", on: true }); await r.waitForTimeout(700); await grab(r); await act({ type: "roll", on: false });
    for (const t of ["g", "l", "m", "p"]) { await r.click(`[data-tab="${t}"]`); await r.waitForTimeout(200); await grab(r); }
    await r.hover("#uiScreens"); await r.click("#uiScreens"); await r.waitForTimeout(400); await grab(r); await r.mouse.click(5, 5); await r.click("#uiUser"); await r.waitForTimeout(300); await grab(r); await r.close();
  });
  // Editor mit Entwurf, Änderungsliste, Rückfragen, Cues
  await step("editor", async () => {
    await act({ type: "draftDiscard" });
    const e = await open(`/p/${pid}/editor`, 900); await grab(e);
    await e.click("#bDraft"); await e.waitForTimeout(700);
    await e.locator(".rd .r").nth(1).click(); await e.waitForTimeout(400); await grab(e);
    await e.locator('#insp [data-f="title"]').fill("Geändert"); await e.keyboard.press("Tab"); await e.waitForTimeout(700); await e.click('#insp [data-a="cueadd"]'); await e.waitForTimeout(500); await e.click('#insp [data-a="cueact"]').catch(() => {}); await e.waitForTimeout(300); await grab(e);
    await e.click("#bBreak"); await e.waitForTimeout(500); await grab(e); await e.click("#bGroup"); await e.waitForTimeout(500); await grab(e);
    await e.locator('.rd .r.g [data-a="del"]').first().click().catch(() => {}); await e.waitForTimeout(300); await grab(e); await e.keyboard.press("Escape"); await e.mouse.click(5, 5);
    await e.click("#dayEdit"); await e.click('[data-tab="st"]'); await e.waitForTimeout(300); await grab(e); await e.click('[data-tab="io"]'); await e.waitForTimeout(300); await grab(e);
    await e.click("#bDiff"); await e.waitForTimeout(300); await grab(e); await e.click("#bPublish"); await e.waitForTimeout(300); await grab(e); await e.click("#bAskNo"); await e.click("#bDiscard"); await e.waitForTimeout(300); await grab(e); await e.click("#bAskNo");
    await act({ type: "gewerkAdd" }); await act({ type: "dayAdd" }); await act({ type: "dayDelete", id: "tag1" }).catch(() => {}); await e.waitForTimeout(700); await grab(e);
    await e.click("#bPublish"); await e.click("#bPubYes"); await e.waitForTimeout(900); await grab(e); await e.close();
  });
  await step("timeline", async () => { for (const q of ["", "?mode=days"]) { const t = await open(`/p/${pid}/timeline${q}`, 1100); await grab(t); if (!q) { await t.click(".tl-bar"); await t.waitForTimeout(300); await grab(t); await t.click("#bEdit"); await t.waitForTimeout(900); await grab(t); } await t.close(); } });
  await step("integrations", async () => {
    const i = await open(`/p/${pid}/integrations`, 1000); await grab(i);
    await i.click("#tAdd"); await i.waitForTimeout(500); await i.locator('.trow [data-f="type"]').selectOption("osc"); await i.waitForTimeout(400); await i.click("#rAdd"); await i.waitForTimeout(500); await i.click("#tkAdd"); await i.waitForTimeout(500); await grab(i);
    await i.locator('.trow [data-a="test"]').click().catch(() => {}); await i.waitForTimeout(800); await grab(i);
    await i.click("#tAdd"); await i.waitForTimeout(400); await grab(i); await i.close();
    const ed = await open(`/p/${pid}/editor`, 900); await ed.locator(".rd .r").nth(1).click(); await ed.waitForTimeout(400); await ed.click('#insp [data-a="actadd"]').catch(() => {}); await ed.waitForTimeout(400); await ed.click('#insp [data-a="cueact"]').catch(() => {}); await ed.waitForTimeout(400); await grab(ed); await ed.close();
  });
  await step("grafik", async () => { const g = await open(`/p/${pid}/grafik`, 1000); await grab(g); await g.click("#bSave"); await g.waitForTimeout(300); await grab(g); await g.fill("#fTitle", "Test"); await g.click("#bSave"); await g.waitForTimeout(400); await g.click("#bPng").catch(() => {}); await g.waitForTimeout(1500); await grab(g); await g.click("#bShare"); await g.waitForTimeout(500); await grab(g); await g.close(); });
  await step("settings", async () => {
    const s = await open(`/p/${pid}/settings`, 1000); await grab(s);
    await adm({ type: "memberAdd", email: "ben@test.de", role: "editor" }); await adm({ type: "shareCreate", view: "timer" }); await adm({ type: "shareCreate", view: "gewerk", params: { g: "licht" } });
    await s.reload(); await s.waitForTimeout(1000); await grab(s);
    await s.click('[data-a="rm"]').catch(() => {}); await s.waitForTimeout(300); await grab(s); await s.keyboard.press("Escape"); await s.mouse.click(5, 5);
    await s.click("#bDel"); await s.waitForTimeout(300); await grab(s); await s.close();
  });
  for (const v of ["timer", "stage", "backstage", "public", "clock", "lower", "print", "gewerk", "gewerk?g=licht"]) await step(v, async () => { const p = await open(`/p/${pid}/${v}`, 1000); await p.mouse.move(100, 100); await p.waitForTimeout(300); await grab(p); await p.close(); });
  await step("share", async () => { const sh = (await adm({ type: "shareCreate", view: "backstage" })).share; const p = await open("/s/" + sh.url.split("/s/")[1], 900); await grab(p); await p.close(); const bad = await open("/s/ungueltig", 400); await grab(bad); await bad.close(); const nf = await open("/p/nichtda/", 400); await grab(nf); await nf.close(); });
  // Fehlermeldungen vom Server
  await step("errors", async () => {
    const t = await open(`/p/${pid}/editor`, 600);
    for (const a of [{ type: "dayAdd", data: {} }]) await t.evaluate(() => 0);
    await t.close();
  });
  fs.writeFileSync(path.join(__dirname, "i18n-collected.json"), JSON.stringify([...all].sort(), null, 1));
  console.log("gesammelt:", all.size, "Fehler:", errs);
  await b.close(); srv.kill();
})().catch((e) => { console.error(e); process.exit(1); });
