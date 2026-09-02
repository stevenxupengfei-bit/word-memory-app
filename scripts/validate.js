const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const words = JSON.parse(read("data/words.json"));
const examples = JSON.parse(read("data/examples.json"));
const manifest = JSON.parse(read("manifest.json"));
const html = read("index.html");

if (words.length !== 82) throw new Error(`Expected 82 words, received ${words.length}`);
const seen = new Set();
for (const item of words) {
  for (const key of ["word", "part", "phonetic", "definition", "imageQuery"]) {
    if (!String(item[key] || "").trim()) throw new Error(`${item.word || "unknown"} is missing ${key}`);
  }
  const key = item.word.toLowerCase();
  if (seen.has(key)) throw new Error(`Duplicate word: ${item.word}`);
  seen.add(key);
  if (!String(examples[item.word] || examples[key] || "").trim()) throw new Error(`${item.word} is missing a simple example`);
}

for (const file of ["app.js", "styles.css", "sw.js", "icons/icon-192.png", "icons/icon-512.png"]) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
}
if (!html.includes('type="email"') || !html.includes('rel="manifest"')) throw new Error("Email login or PWA manifest is not wired");
for (const id of ["voiceSelect", "speakExampleBtn", "importCamera", "ocrPanel", "changePasswordBtn", "passwordScreen", "currentPassword", "newPassword", "confirmPassword"]) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing UI control: ${id}`);
}
if (!read("app.js").includes('api("/api/change-password"') || !read("server.js").includes('url.pathname === "/api/change-password"')) {
  throw new Error("Password change flow is incomplete");
}
if (manifest.display !== "standalone" || manifest.icons.length < 2) throw new Error("Manifest is incomplete");

console.log(`Validated ${words.length} vocabulary entries, simple examples, female voice UI, image import, password controls, and PWA assets.`);
