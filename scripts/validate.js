const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const words = JSON.parse(read("data/words.json"));
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
}

for (const file of ["app.js", "styles.css", "sw.js", "icons/icon-192.png", "icons/icon-512.png"]) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
}
if (!html.includes('type="email"') || !html.includes('rel="manifest"')) throw new Error("Email login or PWA manifest is not wired");
if (manifest.display !== "standalone" || manifest.icons.length < 2) throw new Error("Manifest is incomplete");

console.log(`Validated ${words.length} unique vocabulary entries, email login UI, and PWA assets.`);
