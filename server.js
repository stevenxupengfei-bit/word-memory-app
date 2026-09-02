const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const root = __dirname;
const dataDir = path.join(root, "data");
const usersFile = path.join(dataDir, "users.json");
const wordInfoFile = path.join(dataDir, "word-info-cache.json");
const port = Number(process.env.PORT || 8787);
const sessionSecret = process.env.SESSION_SECRET || "dev-change-this-secret";
const smsDevMode = process.env.SMS_DEV_MODE !== "false";
const verificationCodes = new Map();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(usersFile);
  } catch {
    await fs.writeFile(usersFile, JSON.stringify({ users: [] }, null, 2));
  }
}

async function readUsers() {
  await ensureStore();
  const payload = await fs.readFile(usersFile, "utf8");
  return JSON.parse(payload);
}

async function writeUsers(store) {
  await fs.writeFile(usersFile, JSON.stringify(store, null, 2));
}

async function readWordInfoCache() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    return JSON.parse(await fs.readFile(wordInfoFile, "utf8"));
  } catch {
    return {};
  }
}

async function writeWordInfoCache(cache) {
  await fs.writeFile(wordInfoFile, JSON.stringify(cache, null, 2));
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("请求体不是有效 JSON");
    error.statusCode = 400;
    throw error;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("base64url");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const candidate = hashPassword(password, user.salt).hash;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(user.passwordHash));
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function createToken(userId) {
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  if (signature !== sign(payload)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded.sub || decoded.exp < Date.now()) return null;
    return decoded.sub;
  } catch {
    return null;
  }
}

async function currentUser(req) {
  const header = req.headers.authorization || "";
  const userId = verifyToken(header.replace(/^Bearer\s+/i, ""));
  if (!userId) return null;
  const store = await readUsers();
  return store.users.find((user) => user.id === userId) || null;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.email || user.name,
    email: user.email || user.name,
    phone: user.phone || "",
    createdAt: user.createdAt
  };
}

function publicWords(user) {
  return Array.isArray(user.customWords) ? user.customWords : [];
}

function validateCredentials(email, password) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanPassword = String(password || "");
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail) || cleanEmail.length > 120) {
    return { error: "请输入有效邮箱地址。" };
  }
  if (cleanPassword.length < 6) {
    return { error: "密码至少 6 位。" };
  }
  return { email: cleanEmail, password: cleanPassword };
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function validatePhone(phone) {
  const cleanPhone = normalizePhone(phone);
  if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
    return { error: "请输入有效的中国大陆手机号。" };
  }
  return { phone: cleanPhone };
}

function validatePassword(password) {
  const cleanPassword = String(password || "");
  if (cleanPassword.length < 6) return { error: "密码至少 6 位。" };
  return { password: cleanPassword };
}

function verificationKey(purpose, phone) {
  return `${purpose}:${phone}`;
}

function createVerificationCode(phone, purpose) {
  const code = String(crypto.randomInt(100000, 1000000));
  verificationCodes.set(verificationKey(purpose, phone), {
    code,
    attempts: 0,
    expiresAt: Date.now() + 5 * 60 * 1000
  });
  console.log(`[verification:${purpose}] ${phone} -> ${code}`);
  return code;
}

function verifyCode(phone, purpose, code) {
  const key = verificationKey(purpose, phone);
  const record = verificationCodes.get(key);
  if (!record || record.expiresAt < Date.now()) {
    verificationCodes.delete(key);
    return { error: "验证码已过期，请重新获取。" };
  }
  record.attempts += 1;
  if (record.attempts > 5) {
    verificationCodes.delete(key);
    return { error: "验证码尝试次数过多，请重新获取。" };
  }
  if (record.code !== String(code || "").trim()) {
    return { error: "验证码不正确。" };
  }
  verificationCodes.delete(key);
  return { ok: true };
}

function normalizeImportedWords(input) {
  if (!Array.isArray(input)) {
    const error = new Error("导入内容必须是单词数组。");
    error.statusCode = 400;
    throw error;
  }

  const cleaned = input
    .map((item) => ({
      word: String(item.word || "").trim(),
      definition: String(item.definition || "").trim(),
      source: "手动导入"
    }))
    .filter((item) => item.word && item.definition);

  if (!cleaned.length) {
    const error = new Error("没有识别到可导入的单词。");
    error.statusCode = 400;
    throw error;
  }

  if (cleaned.length > 1000) {
    const error = new Error("一次最多导入 1000 个单词。");
    error.statusCode = 400;
    throw error;
  }

  return cleaned.map((item) => ({
    id: `custom-${crypto.randomUUID()}`,
    word: item.word.slice(0, 80),
    definition: item.definition.slice(0, 1000),
    source: item.source,
    createdAt: new Date().toISOString()
  }));
}

function fallbackPhonetic(word) {
  const clean = String(word || "").toLowerCase().trim();
  if (!clean) return "";
  if (clean.includes(" ")) return clean.split(/\s+/).map(fallbackPhonetic).join(" ");
  return `/${clean.replace(/-/g, " ")}/`;
}

async function lookupWordInfo(word) {
  const clean = String(word || "").trim().toLowerCase();
  if (!/^[a-z][a-z\s-]{0,79}$/.test(clean)) {
    return { word: clean, phonetic: fallbackPhonetic(clean), source: "fallback" };
  }

  const cache = await readWordInfoCache();
  if (cache[clean]) return cache[clean];

  const info = { word: clean, phonetic: fallbackPhonetic(clean), source: "fallback" };
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(clean)}`, {
      signal: AbortSignal.timeout(4500)
    });
    if (response.ok) {
      const payload = await response.json();
      const entry = Array.isArray(payload) ? payload[0] : null;
      const phonetic = entry?.phonetic || entry?.phonetics?.find((item) => item.text)?.text || "";
      if (phonetic) {
        info.phonetic = phonetic;
        info.source = "dictionaryapi.dev";
      }
    }
  } catch {
    // Fallback keeps the UI useful when the public dictionary is unavailable.
  }

  cache[clean] = info;
  await writeWordInfoCache(cache);
  return info;
}

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/send-code") {
    const body = await readJson(req);
    const phoneCheck = validatePhone(body.phone);
    if (phoneCheck.error) return json(res, 400, { error: phoneCheck.error });
    const purpose = ["login", "register", "reset"].includes(body.purpose) ? body.purpose : "login";
    const store = await readUsers();
    const exists = store.users.some((user) => user.phone === phoneCheck.phone);
    if (purpose === "register" && exists) return json(res, 409, { error: "这个手机号已经注册，请直接用验证码登录。" });
    if ((purpose === "login" || purpose === "reset") && !exists) return json(res, 404, { error: "这个手机号还没有注册。" });
    const code = createVerificationCode(phoneCheck.phone, purpose);
    return json(res, 200, {
      ok: true,
      message: smsDevMode ? `开发验证码：${code}` : "验证码已发送。",
      devCode: smsDevMode ? code : undefined
    });
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    const body = await readJson(req);
    const validated = validateCredentials(body.email || body.name, body.password);
    if (validated.error) return json(res, 400, { error: validated.error });
    const phoneCheck = body.phone ? validatePhone(body.phone) : { phone: "" };
    if (phoneCheck.error) return json(res, 400, { error: phoneCheck.error });
    if (phoneCheck.phone) {
      const codeCheck = verifyCode(phoneCheck.phone, "register", body.code);
      if (codeCheck.error) return json(res, 400, { error: codeCheck.error });
    }

    const store = await readUsers();
    const exists = store.users.some((user) => String(user.email || user.name).toLowerCase() === validated.email);
    if (exists) return json(res, 409, { error: "这个邮箱已经被注册。" });
    if (phoneCheck.phone && store.users.some((user) => user.phone === phoneCheck.phone)) {
      return json(res, 409, { error: "这个手机号已经被注册。" });
    }

    const password = hashPassword(validated.password);
    const user = {
      id: crypto.randomUUID(),
      name: validated.email,
      email: validated.email,
      phone: phoneCheck.phone,
      salt: password.salt,
      passwordHash: password.hash,
      progress: {},
      customWords: [],
      createdAt: new Date().toISOString()
    };
    store.users.push(user);
    await writeUsers(store);
    return json(res, 201, { token: createToken(user.id), user: publicUser(user), progress: user.progress, words: publicWords(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readJson(req);
    const store = await readUsers();
    const email = String(body.email || body.name || "").trim().toLowerCase();
    const user = store.users.find((item) => String(item.email || item.name).toLowerCase() === email);
    if (!user || !verifyPassword(String(body.password || ""), user)) {
      return json(res, 401, { error: "邮箱或密码不正确。" });
    }
    return json(res, 200, { token: createToken(user.id), user: publicUser(user), progress: user.progress || {}, words: publicWords(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/login-code") {
    const body = await readJson(req);
    const phoneCheck = validatePhone(body.phone);
    if (phoneCheck.error) return json(res, 400, { error: phoneCheck.error });
    const codeCheck = verifyCode(phoneCheck.phone, "login", body.code);
    if (codeCheck.error) return json(res, 400, { error: codeCheck.error });
    const store = await readUsers();
    const user = store.users.find((item) => item.phone === phoneCheck.phone);
    if (!user) return json(res, 404, { error: "这个手机号还没有注册。" });
    return json(res, 200, { token: createToken(user.id), user: publicUser(user), progress: user.progress || {}, words: publicWords(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/reset-password") {
    const body = await readJson(req);
    const phoneCheck = validatePhone(body.phone);
    if (phoneCheck.error) return json(res, 400, { error: phoneCheck.error });
    const passwordCheck = validatePassword(body.password);
    if (passwordCheck.error) return json(res, 400, { error: passwordCheck.error });
    const codeCheck = verifyCode(phoneCheck.phone, "reset", body.code);
    if (codeCheck.error) return json(res, 400, { error: codeCheck.error });
    const store = await readUsers();
    const user = store.users.find((item) => item.phone === phoneCheck.phone);
    if (!user) return json(res, 404, { error: "这个手机号还没有注册。" });
    const password = hashPassword(passwordCheck.password);
    user.salt = password.salt;
    user.passwordHash = password.hash;
    user.updatedAt = new Date().toISOString();
    await writeUsers(store);
    return json(res, 200, { token: createToken(user.id), user: publicUser(user), progress: user.progress || {}, words: publicWords(user) });
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: "请先登录。" });
    return json(res, 200, { user: publicUser(user), progress: user.progress || {}, words: publicWords(user) });
  }

  if (req.method === "GET" && url.pathname === "/api/words") {
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: "请先登录。" });
    return json(res, 200, { words: publicWords(user) });
  }

  if (req.method === "GET" && url.pathname === "/api/word-info") {
    return json(res, 200, await lookupWordInfo(url.searchParams.get("word")));
  }

  if (req.method === "POST" && url.pathname === "/api/words/import") {
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: "请先登录。" });
    const body = await readJson(req);
    const imported = normalizeImportedWords(body.words);
    const store = await readUsers();
    const target = store.users.find((item) => item.id === user.id);
    target.customWords = [...(target.customWords || []), ...imported];
    target.updatedAt = new Date().toISOString();
    await writeUsers(store);
    return json(res, 201, { imported: imported.length, words: publicWords(target) });
  }

  if (req.method === "GET" && url.pathname === "/api/progress") {
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: "请先登录。" });
    return json(res, 200, { progress: user.progress || {} });
  }

  if (req.method === "PUT" && url.pathname === "/api/progress") {
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: "请先登录。" });
    const body = await readJson(req);
    const store = await readUsers();
    const target = store.users.find((item) => item.id === user.id);
    target.progress = body.progress && typeof body.progress === "object" ? body.progress : {};
    target.updatedAt = new Date().toISOString();
    await writeUsers(store);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "接口不存在。" });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, requested));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const noStore = [".html", ".js", ".css", ".json"].includes(ext);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": noStore ? "no-store" : "public, max-age=3600"
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    json(res, error.statusCode || 500, { error: error.message || "服务器错误。" });
  }
}

ensureStore().then(() => {
  http.createServer(route).listen(port, "0.0.0.0", () => {
    console.log(`Word memory app running at http://localhost:${port}`);
  });
});
