const STORE_KEY = "youdao-word-memory-progress-v1";
const TOKEN_KEY = "word-memory-auth-token";
const LOCAL_ACCOUNTS_KEY = "word-memory-local-accounts-v2";
const LOCAL_WORDS_KEY = "word-memory-local-words-v2";
const QUIZ_MODE_KEY = "word-memory-quiz-mode";
const INTERVALS = [0, 1, 3, 7, 15, 30, 60];
const DAILY_NEW_LIMIT = 12;
const MASTER_LEVEL = 5;
const WORDS_PER_PAGE = 20;

let words = [];
let baseWords = [];
let customWords = [];
let memoryNotes = {};
let progress = {};
let currentId = null;
let filter = "due";
let listPage = 1;
let authMode = "login";
let codeTimer = null;
let codeSeconds = 0;
let quizMode = localStorage.getItem(QUIZ_MODE_KEY) || "forward";
let currentUser = null;
let token = localStorage.getItem(TOKEN_KEY) || "";
let saveTimer = null;
let photoSalt = Number(localStorage.getItem("word-memory-photo-salt") || "1");
let activePhotoKey = "";
let activeInfoKey = "";
const wordInfoCache = {};
const STATIC_HOST = location.hostname.endsWith("github.io") || location.protocol === "file:";

const $ = (id) => document.getElementById(id);
const todayStart = () => new Date(new Date().toDateString()).getTime();
const dayMs = 24 * 60 * 60 * 1000;

async function boot() {
  baseWords = await loadWords();
  memoryNotes = await loadMemoryNotes();
  rebuildWords();
  progress = {};
  bindEvents();
  await restoreSession();
  prepareProgress();
  selectNext();
  render();
  window.setInterval(render, 60 * 1000);
}

async function loadMemoryNotes() {
  try {
    const response = await fetch("data/mnemonics.json");
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
}

async function loadWords() {
  try {
    const response = await fetch("data/words.json");
    if (!response.ok) throw new Error(response.statusText);
    return await response.json();
  } catch (error) {
    document.body.innerHTML = `<main class="fallback"><h1>需要通过本地服务器打开</h1><p>运行：npm start</p><p>然后访问：http://localhost:8787</p></main>`;
    throw error;
  }
}

function bindEvents() {
  $("authForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (authMode === "register") {
      register();
    } else if (authMode === "code") {
      loginByCode();
    } else if (authMode === "reset") {
      resetPassword();
    } else {
      login();
    }
  });
  $("registerBtn").addEventListener("click", toggleRegisterMode);
  $("sendCodeBtn").addEventListener("click", sendCode);
  document.querySelectorAll(".auth-tab").forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
  });
  $("logoutBtn").addEventListener("click", logout);
  $("importBtn").addEventListener("click", openImport);
  $("closeImportBtn").addEventListener("click", closeImport);
  $("cancelImportBtn").addEventListener("click", closeImport);
  $("confirmImportBtn").addEventListener("click", importWords);
  $("importFile").addEventListener("change", readImportFile);
  $("refreshPhotoBtn").addEventListener("click", refreshPhoto);
  $("memoryPhoto").addEventListener("error", () => {
    const fallbackKey = $("memoryPhoto").dataset.photoKey || currentWord()?.id || "word";
    $("memoryPhoto").src = `https://picsum.photos/seed/${stableNumber(`${fallbackKey}-fallback`)}/900/560`;
  });
  $("memoryPhoto").addEventListener("load", () => {
    $("memoryPhoto").classList.remove("loading");
  });
  $("showBtn").addEventListener("click", () => $("definitionBox").classList.remove("hidden"));
  $("checkBtn").addEventListener("click", checkAnswer);
  $("againBtn").addEventListener("click", () => grade("again"));
  $("hardBtn").addEventListener("click", () => grade("hard"));
  $("goodBtn").addEventListener("click", () => grade("good"));
  $("easyBtn").addEventListener("click", () => grade("easy"));
  $("speakBtn").addEventListener("click", speakCurrent);
  $("searchInput").addEventListener("input", () => {
    listPage = 1;
    renderList();
  });
  $("prevPageBtn").addEventListener("click", () => changeListPage(-1));
  $("nextPageBtn").addEventListener("click", () => changeListPage(1));
  $("exportBtn").addEventListener("click", exportProgress);
  $("resetBtn").addEventListener("click", resetProgress);
  document.querySelectorAll(".mode-btn").forEach((button) => {
    button.addEventListener("click", () => setQuizMode(button.dataset.mode));
  });
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      filter = button.dataset.filter;
      listPage = 1;
      document.querySelectorAll(".tab").forEach((tabButton) => tabButton.classList.toggle("active", tabButton === button));
      selectNext();
      render();
    });
  });
}

function setQuizMode(mode) {
  quizMode = mode === "reverse" ? "reverse" : "forward";
  localStorage.setItem(QUIZ_MODE_KEY, quizMode);
  $("definitionBox").classList.add("hidden");
  $("answerInput").value = "";
  resetQuizFeedback();
  renderCard();
}

async function restoreSession() {
  if (!token) {
    setAuthVisible(true);
    return;
  }

  if (token.startsWith("local:")) {
    const email = decodeURIComponent(token.slice(6));
    const accounts = readLocalAccounts();
    if (accounts[email]) {
      currentUser = { id: email, name: email, email, local: true };
      customWords = readLocalWords(email);
      rebuildWords();
      progress = readAccountProgress(email);
      setAuthVisible(false);
      return;
    }
  }

  try {
    const session = await api("/api/me");
    currentUser = session.user;
    customWords = session.words || [];
    rebuildWords();
    progress = normalizeServerProgress(session.progress);
    saveLocal();
    setAuthVisible(false);
  } catch {
    token = "";
    localStorage.removeItem(TOKEN_KEY);
    setAuthVisible(true);
  }
}

async function login() {
  await authenticate("/api/login", "login");
}

async function register() {
  await authenticate("/api/register", "register");
}

function toggleRegisterMode() {
  authMode = authMode === "login" ? "register" : "login";
  renderAuthMode();
}

function setAuthMode(mode) {
  authMode = ["login", "register"].includes(mode) ? mode : "login";
  renderAuthMode();
}

function renderAuthMode() {
  const registering = authMode === "register";
  const codeLogin = false;
  const resetting = false;
  $("loginBtn").textContent = registering ? "创建邮箱账户" : "登录";
  $("registerBtn").textContent = registering ? "返回登录" : "注册新账号";
  $("passwordLabel").textContent = resetting ? "新密码" : "密码";
  $("authPassword").autocomplete = registering || resetting ? "new-password" : "current-password";
  $("authPassword").required = !codeLogin;
  $("authName").required = authMode === "login" || registering;
  $("authPhone").required = false;
  $("authCode").required = false;
  $("nameField").classList.toggle("hidden", codeLogin || resetting);
  $("phoneField").classList.add("hidden");
  $("codeField").classList.add("hidden");
  $("authPassword").closest("label").classList.toggle("hidden", codeLogin);
  $("authMessage").classList.toggle("info", registering || codeLogin || resetting);
  document.querySelectorAll(".auth-tab").forEach((button) => button.classList.toggle("active", button.dataset.authMode === authMode));
  const messages = {
    login: "",
    register: "为你或孩子输入各自邮箱和至少 6 位密码，即可建立独立学习档案。",
    code: "输入已注册手机号，获取验证码后即可登录。",
    reset: "用手机号验证码验证身份，然后设置新密码。"
  };
  setAuthMessage(messages[authMode] || "");
}

async function authenticate(endpoint, mode = "login") {
  setAuthMessage("");
  const email = $("authName").value.trim().toLowerCase();
  const password = $("authPassword").value;
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    setAuthMessage("请输入有效邮箱地址。");
    return;
  }
  if (password.length < 6) {
    setAuthMessage("密码至少 6 位。");
    return;
  }

  try {
    if (STATIC_HOST) {
      await authenticateLocally(email, password, mode);
      return;
    }
    const result = await api(endpoint, {
      method: "POST",
      body: { email, name: email, password },
      auth: false,
    });
    await enterSession(result);
  } catch (error) {
    if (error.network) {
      await authenticateLocally(email, password, mode);
    } else {
      $("authMessage").classList.remove("info");
      setAuthMessage(error.message);
    }
  }
}

async function authenticateLocally(email, password, mode) {
  const accounts = readLocalAccounts();
  const digest = await passwordDigest(email, password);
  if (mode === "register") {
    if (accounts[email]) throw new Error("这个邮箱已经创建过账户，请直接登录。");
    accounts[email] = { passwordHash: digest, createdAt: new Date().toISOString() };
    localStorage.setItem(LOCAL_ACCOUNTS_KEY, JSON.stringify(accounts));
  } else if (!accounts[email] || accounts[email].passwordHash !== digest) {
    throw new Error("邮箱或密码不正确；第一次使用请先创建账户。");
  }
  await enterSession({
    token: `local:${encodeURIComponent(email)}`,
    user: { id: email, name: email, email, local: true },
    progress: readAccountProgress(email),
    words: readLocalWords(email),
  });
}

async function passwordDigest(email, password) {
  const bytes = new TextEncoder().encode(`${email}\n${password}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readLocalAccounts() {
  return JSON.parse(localStorage.getItem(LOCAL_ACCOUNTS_KEY) || "{}");
}

function readAccountProgress(email) {
  return JSON.parse(localStorage.getItem(`${STORE_KEY}:${email}`) || "{}");
}

function readLocalWords(email) {
  return JSON.parse(localStorage.getItem(`${LOCAL_WORDS_KEY}:${email}`) || "[]");
}

async function loginByCode() {
  await authenticate("/api/login-code");
}

async function resetPassword() {
  await authenticate("/api/reset-password");
}

async function enterSession(result) {
  token = result.token;
  currentUser = result.user;
  customWords = result.words || [];
  rebuildWords();
  localStorage.setItem(TOKEN_KEY, token);
  progress = normalizeServerProgress(result.progress);
  saveLocal();
  await saveRemoteNow();
  setAuthVisible(false);
  authMode = "login";
  renderAuthMode();
  prepareProgress();
  selectNext();
  render();
}

async function sendCode() {
  const phone = $("authPhone").value.trim();
  const purpose = authMode === "register" ? "register" : authMode === "reset" ? "reset" : "login";
  try {
    const result = await api("/api/send-code", {
      method: "POST",
      body: { phone, purpose },
      auth: false,
    });
    $("authMessage").classList.add("info");
    setAuthMessage(result.message || "验证码已发送。");
    startCodeCountdown();
  } catch (error) {
    $("authMessage").classList.remove("info");
    setAuthMessage(error.message);
  }
}

function startCodeCountdown() {
  codeSeconds = 60;
  window.clearInterval(codeTimer);
  updateCodeButton();
  codeTimer = window.setInterval(() => {
    codeSeconds -= 1;
    updateCodeButton();
    if (codeSeconds <= 0) window.clearInterval(codeTimer);
  }, 1000);
}

function updateCodeButton() {
  $("sendCodeBtn").disabled = codeSeconds > 0;
  $("sendCodeBtn").textContent = codeSeconds > 0 ? `${codeSeconds}s` : "获取验证码";
}

function logout() {
  token = "";
  currentUser = null;
  localStorage.removeItem(TOKEN_KEY);
  authMode = "login";
  renderAuthMode();
  setAuthVisible(true);
  $("userName").textContent = "未登录";
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (options.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(path, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (cause) {
    const error = new Error("网络暂时不可用");
    error.network = true;
    error.cause = cause;
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function setAuthVisible(visible) {
  $("authScreen").classList.toggle("hidden", !visible);
  document.body.classList.toggle("locked", visible);
  if (!visible && currentUser) $("userName").textContent = currentUser.email || currentUser.name;
}

function setAuthMessage(message) {
  $("authMessage").textContent = message || "";
}

function rebuildWords() {
  const normalizedBase = baseWords.map((item, index) => ({
    ...item,
    id: item.id || slug(item.word, index),
    custom: false,
  }));
  const normalizedCustom = customWords.map((item, index) => ({
    ...item,
    id: item.id || `custom-${slug(item.word, index)}`,
    custom: true,
  }));
  words = [...normalizedBase, ...normalizedCustom];
}

function prepareProgress() {
  words.forEach((item, index) => {
    item.id ||= slug(item.word, index);
    progress[item.id] ||= freshProgress();
  });
}

function freshProgress() {
  return {
    seen: 0,
    correct: 0,
    attempts: 0,
    streak: 0,
    level: 0,
    dueAt: 0,
    firstSeenAt: 0,
    misses: 0,
    checks: freshChecks(),
    lastCheck: null,
    lastGrade: "new",
  };
}

function freshChecks() {
  return {
    forward: 0,
    forwardHits: 0,
    reverse: 0,
    reverseHits: 0,
    lastForwardHitAt: 0,
    lastReverseHitAt: 0,
  };
}

function normalizeServerProgress(serverProgress) {
  const next = serverProgress && typeof serverProgress === "object" ? { ...serverProgress } : {};
  words.forEach((word) => {
    next[word.id] ||= freshProgress();
  });
  return next;
}

function mergeProgress(localProgress, serverProgress) {
  const merged = { ...serverProgress };
  words.forEach((word) => {
    const local = localProgress[word.id];
    const remote = serverProgress[word.id];
    if (!local) return;
    if (!remote || (local.lastReviewed || 0) > (remote.lastReviewed || 0)) {
      merged[word.id] = local;
    }
  });
  return merged;
}

function slug(word, index) {
  return `${word.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}`;
}

function reviewedDueWords() {
  const now = Date.now();
  return words
    .filter((word) => progress[word.id].seen > 0 && progress[word.id].dueAt <= now)
    .sort((a, b) => (progress[a.id].dueAt || 0) - (progress[b.id].dueAt || 0));
}

function newLearnedTodayCount() {
  const start = todayStart();
  return words.filter((word) => {
    const p = progress[word.id];
    return p.seen > 0 && (p.firstSeenAt || p.lastReviewed || 0) >= start;
  }).length;
}

function todaysNewWords() {
  const remaining = Math.max(0, DAILY_NEW_LIMIT - newLearnedTodayCount());
  return words.filter((word) => progress[word.id].seen === 0).slice(0, remaining);
}

function dueWords() {
  return [...reviewedDueWords(), ...todaysNewWords()];
}

function filteredWords() {
  const q = $("searchInput").value.trim().toLowerCase();
  let list = words;
  if (filter === "due") list = dueWords();
  if (filter === "new") list = words.filter((word) => progress[word.id].seen === 0);
  if (filter === "weak") list = weakWords();
  if (q) {
    list = list.filter((word) => `${word.word} ${word.definition}`.toLowerCase().includes(q));
  }
  return list;
}

function selectNext() {
  const list = filteredWords();
  currentId = (list[0] || words[0])?.id || null;
}

function selectWord(id) {
  currentId = id;
  $("definitionBox").classList.add("hidden");
  $("answerInput").value = "";
  resetQuizFeedback();
  renderCard();
  renderList();
}

function changeListPage(delta) {
  const total = filteredWords().length;
  const pages = pageCount(total);
  listPage = clamp(listPage + delta, 1, pages);
  renderList();
}

function focusCurrentListPage() {
  const list = filteredWords();
  const index = list.findIndex((word) => word.id === currentId);
  if (index >= 0) listPage = Math.floor(index / WORDS_PER_PAGE) + 1;
}

function currentWord() {
  return words.find((word) => word.id === currentId) || words[0];
}

function render() {
  $("deckMeta").textContent = `${words.length} 个词 | 导入 ${customWords.length} 个`;
  $("dueCount").textContent = dueWords().length;
  $("learnedCount").textContent = words.filter((word) => progress[word.id].seen > 0).length;
  $("masteredCount").textContent = masteredWords().length;
  $("userName").textContent = currentUser?.email || currentUser?.name || "未登录";
  renderCoach();
  renderList();
  renderCard();
  renderPlan();
}

function renderCoach() {
  const reviewedDue = reviewedDueWords().length;
  const newToday = todaysNewWords().length;
  const learnedToday = newLearnedTodayCount();
  const mastered = masteredWords().length;
  const remaining = words.filter((word) => progress[word.id].seen === 0).length;
  const weak = weakWords().length;
  const daily = dailyProgress();
  $("coachToday").textContent = `今天先复习 ${reviewedDue} 个到期词，再新学 ${newToday} 个词。`;
  $("coachProgress").textContent = `今日已新学 ${learnedToday}/${DAILY_NEW_LIMIT}；稳定掌握 ${mastered}/${words.length}；薄弱词 ${weak}；未开始 ${remaining}。`;
  $("dailyProgressText").textContent = `今日完成 ${daily.done} / ${daily.total}`;
  $("dailyProgressBar").style.width = `${daily.percent}%`;
}

function dailyProgress() {
  const start = todayStart();
  const done = words.filter((word) => (progress[word.id].lastReviewed || 0) >= start).length;
  const remaining = dueWords().length;
  const total = done + remaining;
  return {
    done,
    remaining,
    total,
    percent: total ? Math.round((done / total) * 100) : 100,
  };
}

function renderList() {
  const list = filteredWords();
  const active = currentWord();
  listPage = clamp(listPage, 1, pageCount(list.length));
  const start = (listPage - 1) * WORDS_PER_PAGE;
  const pageItems = list.slice(start, start + WORDS_PER_PAGE);
  $("wordList").innerHTML = pageItems
    .map((word) => {
      const p = progress[word.id];
      return `<li class="${active?.id === word.id ? "active" : ""}" data-id="${word.id}">
        <span><strong>${escapeHtml(word.word)}${word.custom ? '<em class="custom-tag">导入</em>' : ""}</strong><small>${escapeHtml(partOfSpeechText(word))} · ${escapeHtml(shortDefinition(word.definition))}</small><small>${escapeHtml(forgetText(p))}</small></span>
        <span class="badge">L${p.level} ${recallBadge(p)}</span>
      </li>`;
    })
    .join("");
  $("wordList").querySelectorAll("li").forEach((li) => li.addEventListener("click", () => selectWord(li.dataset.id)));
  renderPager(list.length);
}

function renderPager(total) {
  const pages = pageCount(total);
  const start = total ? (listPage - 1) * WORDS_PER_PAGE + 1 : 0;
  const end = Math.min(total, listPage * WORDS_PER_PAGE);
  $("pageInfo").textContent = `${listPage} / ${pages} · ${start}-${end} / ${total}`;
  $("prevPageBtn").disabled = listPage <= 1;
  $("nextPageBtn").disabled = listPage >= pages;
}

function pageCount(total) {
  return Math.max(1, Math.ceil(total / WORDS_PER_PAGE));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function recallBadge(p) {
  const checks = p.checks || {};
  const forward = (checks.forwardHits || 0) > 0 ? "F" : "-";
  const reverse = (checks.reverseHits || 0) > 0 ? "R" : "-";
  return `${forward}/${reverse}`;
}

function renderCard() {
  const word = currentWord();
  if (!word) return;
  const list = filteredWords();
  const index = Math.max(0, list.findIndex((item) => item.id === word.id)) + 1;
  const reverse = quizMode === "reverse";
  const core = noteCore(word);
  $("queueLabel").textContent = filter === "due" ? "今日队列" : filter === "new" ? "新词队列" : filter === "weak" ? "薄弱队列" : "全部词表";
  $("wordTitle").textContent = reverse ? core : word.word;
  $("promptLabel").textContent = reverse ? "中文核心义" : "单词";
  $("currentWord").textContent = reverse ? core : word.word;
  $("partLine").textContent = `词性：${partOfSpeechText(word)}`;
  $("definitionText").textContent = reverse ? `${word.word}：${word.definition}` : word.definition;
  $("meaningLabel").textContent = reverse ? "作答方向" : "中文释义";
  $("meaningText").textContent = reverse ? "写出对应英文单词或短语。" : chineseMeaning(word.definition);
  $("mnemonicText").innerHTML = mnemonicFor(word).map((line) => `<span>${escapeHtml(line)}</span>`).join("");
  $("cardIndex").textContent = `${index || 1} / ${list.length || words.length}`;
  $("forgetLine").textContent = `遗忘时间：${forgetText(progress[word.id])}`;
  $("studyCard").classList.toggle("reverse-mode", reverse);
  $("mnemonicBox").classList.toggle("hidden", reverse);
  $("memoryPhotoFigure").classList.toggle("hidden", reverse);
  $("speakBtn").disabled = reverse;
  document.querySelectorAll(".mode-btn").forEach((button) => button.classList.toggle("active", button.dataset.mode === quizMode));
  if (reverse) {
    $("phoneticLine").textContent = "音标：答完再看，避免提示词形。";
  } else {
    renderWordInfo(word);
    renderMemoryPhoto(word);
  }
}

function weakWords() {
  return words.filter((word) => {
    const p = progress[word.id] || {};
    return (p.misses || 0) >= 2 || p.lastGrade === "again" || (p.streak === 0 && p.attempts >= 2) || (p.level >= MASTER_LEVEL && !hasBidirectionalRecall(p));
  });
}

function masteredWords() {
  return words.filter((word) => {
    const p = progress[word.id] || {};
    return p.level >= MASTER_LEVEL && hasBidirectionalRecall(p);
  });
}

function hasBidirectionalRecall(p) {
  const checks = p.checks || {};
  return (checks.forwardHits || 0) > 0 && (checks.reverseHits || 0) > 0;
}

function renderPlan() {
  const word = currentWord();
  const p = word ? progress[word.id] : freshProgress();
  $("reviewPlan").innerHTML = INTERVALS.slice(1).map((day, index) => {
    const active = p.level === index + 1;
    return `<div><b>${day} 天</b><span>${active ? "当前阶段" : formatDate(todayStart() + day * dayMs)}</span></div>`;
  }).join("");
}

function grade(kind) {
  const word = currentWord();
  const p = progress[word.id];
  p.seen += p.seen ? 0 : 1;
  if (!p.firstSeenAt) p.firstSeenAt = Date.now();
  p.attempts += 1;
  p.lastReviewed = Date.now();
  p.lastAnswer = $("answerInput").value.trim();
  p.lastCheck ||= null;

  if (kind === "again") {
    p.misses = (p.misses || 0) + 1;
    p.streak = 0;
    p.level = 0;
    p.dueAt = Date.now() + 10 * 60 * 1000;
  } else {
    p.correct += 1;
    p.streak += 1;
    const jump = kind === "easy" ? 2 : 1;
    p.level = Math.min(INTERVALS.length - 1, Math.max(1, p.level + jump));
    const extra = kind === "hard" ? 0.5 : 1;
    p.dueAt = todayStart() + INTERVALS[p.level] * dayMs * extra;
  }

  p.lastGrade = kind;
  save();
  $("definitionBox").classList.add("hidden");
  $("answerInput").value = "";
  resetQuizFeedback();
  currentId = nextAfter(word.id)?.id || filteredWords()[0]?.id || words[0].id;
  focusCurrentListPage();
  render();
}

function checkAnswer() {
  const word = currentWord();
  if (!word) return;
  const p = progress[word.id];
  const answer = $("answerInput").value.trim();
  const result = evaluateAnswer(word, answer, quizMode);
  p.checks = normalizeChecks(p.checks);
  if (quizMode === "reverse") {
    p.checks.reverse += 1;
    if (result.matched) {
      p.checks.reverseHits += 1;
      p.checks.lastReverseHitAt = Date.now();
    }
  } else {
    p.checks.forward += 1;
    if (result.matched) {
      p.checks.forwardHits += 1;
      p.checks.lastForwardHitAt = Date.now();
    }
  }
  p.lastCheck = {
    at: Date.now(),
    answer,
    matched: result.matched,
    score: result.score,
    expected: result.expected,
    mode: quizMode,
  };
  if (!result.matched) p.misses = (p.misses || 0) + 1;
  save();
  renderQuizFeedback(result);
  renderCoach();
  renderList();
}

function normalizeChecks(checks) {
  return { ...freshChecks(), ...(checks || {}) };
}

function evaluateAnswer(word, answer, mode = "forward") {
  const expected = mode === "reverse" ? reverseAnswerTargets(word) : answerTargets(word);
  const normalizedAnswer = normalizeAnswer(answer);
  if (!normalizedAnswer) {
    return {
      matched: false,
      score: 0,
      expected,
      message: mode === "reverse"
        ? `先写出英文单词。中文提示：${noteCore(word)}`
        : `先写出中文核心义。目标词：${expected.slice(0, 4).join(" / ")}`,
    };
  }
  const hits = expected.filter((target) => normalizedAnswer.includes(normalizeAnswer(target)));
  const score = expected.length ? hits.length / Math.min(expected.length, 4) : 0;
  const matched = hits.length > 0;
  return {
    matched,
    score,
    expected,
    message: matched
      ? `命中：${hits.slice(0, 3).join(" / ")}。可以按真实熟练度点“记住”或“很熟”。`
      : mode === "reverse"
        ? `暂未写出英文：${expected[0]}。建议先点“忘了”或“模糊”。`
        : `暂未命中核心义：${expected.slice(0, 4).join(" / ")}。建议先点“忘了”或“模糊”。`,
  };
}

function reverseAnswerTargets(word) {
  const clean = String(word.word || "").trim();
  const compact = clean.toLowerCase();
  return [...new Set([clean, compact, compact.replace(/-/g, " "), compact.replace(/\s+/g, "-")].filter(Boolean))];
}

function noteCore(word) {
  const note = memoryNotes[word.word] || memoryNotes[word.word.toLowerCase()] || {};
  return note.core || firstMeaning(word.definition) || chineseMeaning(word.definition) || "核心义";
}

function answerTargets(word) {
  const note = memoryNotes[word.word] || memoryNotes[word.word.toLowerCase()] || {};
  const raw = [
    note.core,
    firstMeaning(word.definition),
    ...String(word.definition || "").split(/[；;，,。；\s]+/),
  ];
  return [...new Set(raw
    .map((item) => String(item || "").replace(/^(n|v|vt|vi|adj|adv|prep|pron|conj)\./, "").trim())
    .filter((item) => /[\u4e00-\u9fa5]/.test(item))
    .map((item) => item.replace(/[（）()【】\[\]<>\s]/g, ""))
    .filter((item) => item.length >= 2)
  )].slice(0, 8);
}

function normalizeAnswer(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, "")
    .trim();
}

function renderQuizFeedback(result) {
  $("quizFeedback").textContent = result.message;
  $("quizFeedback").classList.toggle("ok", result.matched);
  $("quizFeedback").classList.toggle("warn", !result.matched);
}

function resetQuizFeedback() {
  $("quizFeedback").textContent = "先默写，再自查。";
  $("quizFeedback").classList.remove("ok", "warn");
}

function nextAfter(id) {
  const list = filteredWords().filter((word) => word.id !== id);
  return list[0] || words.find((word) => progress[word.id].dueAt <= Date.now() && word.id !== id);
}

function save() {
  saveLocal();
  queueRemoteSave();
}

function saveLocal() {
  const account = currentUser?.email || currentUser?.name;
  if (account) localStorage.setItem(`${STORE_KEY}:${account.toLowerCase()}`, JSON.stringify(progress));
}

function queueRemoteSave() {
  if (!token || currentUser?.local) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveRemoteNow, 350);
}

async function saveRemoteNow() {
  if (!token || currentUser?.local) return;
  try {
    await api("/api/progress", {
      method: "PUT",
      body: { progress },
    });
  } catch (error) {
    console.warn("Progress sync failed:", error.message);
  }
}

function shortDefinition(definition) {
  return definition.replace(/\s+/g, " ").slice(0, 72);
}

function chineseMeaning(definition) {
  return String(definition || "")
    .replace(/^(n|v|vt|vi|adj|adv|prep|pron|conj)\./, "")
    .replace(/\s+/g, " ")
    .trim();
}

function partOfSpeechText(word) {
  if (word?.part) return word.part;
  const definition = String(word?.definition || "");
  const labels = {
    n: "名词",
    v: "动词",
    vt: "及物动词",
    vi: "不及物动词",
    adj: "形容词",
    adv: "副词",
    prep: "介词",
    pron: "代词",
    conj: "连词",
    interj: "感叹词",
    num: "数词",
    art: "冠词",
    abbr: "缩写",
  };
  const hits = [...definition.matchAll(/\b(vt|vi|adj|adv|prep|pron|conj|interj|num|art|abbr|n|v)\./gi)]
    .map((match) => match[1].toLowerCase())
    .map((key) => labels[key])
    .filter(Boolean);
  const unique = [...new Set(hits)];
  return unique.length ? unique.join(" / ") : "未标注";
}

function firstMeaning(definition) {
  return definition
    .replace(/^(n|v|vt|vi|adj|adv|prep|pron|conj)\./, "")
    .split(/[；;，,。]/)[0]
    .trim();
}

function mnemonicFor(word) {
  const term = word.word;
  const clean = term.toLowerCase();
  const note = memoryNotes[term] || memoryNotes[clean];
  if (note) {
    return [
      `核心义：${note.core || firstMeaning(word.definition) || "先抓一个最常用意思"}。`,
      `画面：${note.image}`,
      `记忆钩子：${note.hook}`,
      `例句：${note.example}`,
    ].filter((line) => !line.endsWith("undefined"));
  }
  const pieces = term.includes(" ") ? term.split(" ") : term.split(/-/);
  const family = words
    .filter((item) => item.word !== term && sameFamily(clean, item.word.toLowerCase()))
    .slice(0, 4)
    .map((item) => item.word);
  const affix = affixHint(clean);
  const meaning = firstMeaning(word.definition);
  const lines = [];

  if (pieces.length > 1) lines.push(`拆分：${pieces.join(" + ")}，先把短语画面连起来。`);
  if (affix) lines.push(affix);
  lines.push(`画面：看到 “${term}” 时，脑中放一秒钟的场景：${meaning || "核心释义"}。`);
  if (family.length) lines.push(`同族/近形：${family.join("、")}，一起复习能减少孤立记忆。`);
  lines.push(`回忆钩子：遮住释义，只用首字母 ${term[0].toUpperCase()} 和词形长度 ${term.length} 逼自己说出中文。`);
  return lines;
}

function sameFamily(a, b) {
  const stemA = a.replace(/(ing|ed|ly|s|es|tion|ment|ness|ous|ive|al)$/i, "");
  const stemB = b.replace(/(ing|ed|ly|s|es|tion|ment|ness|ous|ive|al)$/i, "");
  return stemA.length >= 4 && stemB.length >= 4 && (stemA.includes(stemB) || stemB.includes(stemA));
}

function affixHint(word) {
  const hints = [
    ["over", "前缀 over- 常有“过度、超过”的感觉。"],
    ["sub", "前缀 sub- 常有“在下、替代、次级”的感觉。"],
    ["con", "con-/com- 常有“一起、共同、加强”的感觉。"],
    ["pre", "pre- 常有“预先、在前”的感觉。"],
    ["re", "re- 常有“再次、回到”的感觉。"],
    ["un", "un- 常有“否定、相反”的感觉。"],
    ["ly", "-ly 多把形容词变成副词。"],
    ["tion", "-tion 常提示名词动作或结果。"],
    ["ive", "-ive 常提示形容词性质或倾向。"],
    ["ous", "-ous 常提示“具有某种性质”。"],
  ];
  const hit = hints.find(([affix]) => word.startsWith(affix) || word.endsWith(affix));
  return hit?.[1] || "";
}

function speakCurrent() {
  const word = currentWord();
  if (!word || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(word.word);
  utterance.lang = "en-US";
  utterance.rate = 0.85;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function exportProgress() {
  const payload = {
    exportedAt: new Date().toISOString(),
    user: currentUser,
    words: words.map((word) => ({ ...word, progress: progress[word.id] })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "word-memory-progress.json";
  a.click();
  URL.revokeObjectURL(url);
}

function resetProgress() {
  if (!confirm("清空当前账号的学习进度？")) return;
  progress = {};
  words.forEach((item) => (progress[item.id] = freshProgress()));
  save();
  selectNext();
  render();
}

function refreshPhoto() {
  photoSalt += 1;
  localStorage.setItem("word-memory-photo-salt", String(photoSalt));
  renderMemoryPhoto(currentWord());
}

function renderMemoryPhoto(word) {
  if (!word) return;
  const scene = photoSceneFor(word);
  const photoKey = `${word.id}-${photoSalt}`;
  if (activePhotoKey === photoKey && $("memoryPhoto").getAttribute("src")) {
    $("photoCaption").textContent = `${word.word} 照片联想：${scene.caption}`;
    return;
  }
  activePhotoKey = photoKey;
  const lock = stableNumber(photoKey);
  const tagPath = scene.tags.map((tag) => encodeURIComponent(tag)).join(",");
  const imageUrl = `https://loremflickr.com/900/560/${tagPath}/all?lock=${lock}&word=${encodeURIComponent(word.word)}`;
  $("memoryPhoto").classList.add("loading");
  $("memoryPhoto").dataset.photoKey = photoKey;
  $("memoryPhoto").removeAttribute("src");
  $("memoryPhoto").alt = `${word.word} 的具象化照片`;
  $("photoCaption").textContent = `${word.word} 照片联想：${scene.caption}`;
  window.requestAnimationFrame(() => {
    if ($("memoryPhoto").dataset.photoKey === photoKey) {
      $("memoryPhoto").src = imageUrl;
    }
  });
}

async function renderWordInfo(word) {
  if (!word) return;
  const key = word.word.toLowerCase();
  activeInfoKey = key;
  const fallback = word.phonetic || phoneticFallback(word.word);
  if (word.phonetic) {
    $("phoneticLine").textContent = `音标：${word.phonetic}`;
    return;
  }
  $("phoneticLine").textContent = `音标：${fallback}（查询中）`;
  if (wordInfoCache[key]) {
    $("phoneticLine").textContent = `音标：${wordInfoCache[key].phonetic || fallback}`;
    return;
  }
  try {
    const info = await api(`/api/word-info?word=${encodeURIComponent(word.word)}`, { auth: false });
    wordInfoCache[key] = info;
    if (activeInfoKey === key) {
      $("phoneticLine").textContent = `音标：${info.phonetic || fallback}`;
    }
  } catch {
    if (activeInfoKey === key) $("phoneticLine").textContent = `音标：${fallback}`;
  }
}

function phoneticFallback(word) {
  const clean = String(word || "").toLowerCase().trim();
  if (!clean) return "/";
  if (clean.includes(" ")) return clean.split(/\s+/).map(phoneticFallback).join(" ");
  return `/${clean.replace(/-/g, " ")}/`;
}

function photoSceneFor(word) {
  const term = word.word.toLowerCase().trim();
  const dictionary = {
    detain: ["police", "arrest", "handcuffs"],
    theft: ["stolen", "wallet", "crime"],
    petty: ["small", "argument", "coins"],
    "mountain-climbing": ["mountain", "climbing", "rope"],
    trip: ["travel", "road", "suitcase"],
    cramp: ["leg", "pain", "runner"],
    seize: ["hand", "grab", "action"],
    seized: ["police", "seized", "evidence"],
    conduct: ["conductor", "orchestra", "performance"],
    volleyball: ["volleyball", "sport", "court"],
    pour: ["pouring", "water", "glass"],
    overexcite: ["excited", "crowd", "celebration"],
    overexcited: ["excited", "child", "celebration"],
    sensational: ["news", "headline", "crowd"],
    informative: ["classroom", "presentation", "learning"],
    relief: ["relief", "smile", "comfort"],
    festival: ["festival", "lanterns", "crowd"],
    celebration: ["celebration", "party", "confetti"],
    ritual: ["ritual", "ceremony", "candles"],
    discipline: ["discipline", "training", "student"],
    whereabout: ["map", "location", "search"],
    illustration: ["illustration", "drawing", "artist"],
    secure: ["lock", "security", "door"],
    "check on": ["doctor", "checkup", "care"],
    chore: ["housework", "cleaning", "home"],
    utter: ["speaking", "mouth", "microphone"],
    "swear by": ["promise", "hand", "oath"],
    involve: ["teamwork", "meeting", "people"],
    constantly: ["clock", "routine", "time"],
  };
  const tags = dictionary[term] || fallbackPhotoTags(word);
  return {
    tags,
    caption: buildPhotoCaption(word, tags),
  };
}

function fallbackPhotoTags(word) {
  if (word.imageQuery) return word.imageQuery.split(/\s+/).filter(Boolean).slice(0, 4);
  const termTags = word.word
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((part) => /^[a-z]{3,}$/.test(part))
    .slice(0, 2);
  const meaning = firstMeaning(word.definition);
  const meaningTags = meaningToTags(meaning);
  return [...new Set([...termTags, ...meaningTags, "memory"])].slice(0, 3);
}

function meaningToTags(meaning) {
  const text = String(meaning || "");
  const hints = [
    [/盗|偷|窃/, ["stolen", "wallet"]],
    [/拘留|逮捕|抓住|夺取/, ["police", "arrest"]],
    [/旅行|短程/, ["travel", "road"]],
    [/疼|痛|痉挛/, ["pain", "runner"]],
    [/组织|实施|进行/, ["meeting", "teamwork"]],
    [/排球/, ["volleyball", "court"]],
    [/宽慰|轻松|缓解/, ["smile", "comfort"]],
    [/节日|庆祝/, ["festival", "party"]],
    [/仪式/, ["ceremony", "candles"]],
    [/安全|保护/, ["lock", "security"]],
    [/教育|信息|学习/, ["classroom", "learning"]],
    [/钱|赃物|硬币/, ["coins", "wallet"]],
    [/山|攀岩|攀登/, ["mountain", "climbing"]],
  ];
  return hints.find(([pattern]) => pattern.test(text))?.[1] || ["scene", "life"];
}

function buildPhotoCaption(word, tags) {
  const meaning = firstMeaning(word.definition) || "核心意思";
  return `用“${tags.join(" + ")}”这张画面绑定“${meaning}”。`;
}

function stableNumber(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return (hash % 100000) + 1;
}

function forgetText(p) {
  if (!p || !p.seen) return "还没学习，记忆尚未建立";
  if (!p.dueAt || p.dueAt <= Date.now()) return "现在该复习，已经进入遗忘风险区";
  return `${relativeTime(p.dueAt - Date.now())} 后可能淡忘`;
}

function relativeTime(ms) {
  const minutes = Math.max(1, Math.round(ms / (60 * 1000)));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天`;
  return `${Math.round(days / 30)} 个月`;
}

function openImport() {
  if (!currentUser) {
    setAuthVisible(true);
    setAuthMessage("请先登录，再导入你的个人单词。");
    return;
  }
  $("importText").value = "";
  $("importFile").value = "";
  setImportMessage("");
  $("importScreen").classList.remove("hidden");
  document.body.classList.add("locked");
}

function closeImport() {
  $("importScreen").classList.add("hidden");
  document.body.classList.toggle("locked", !$("authScreen").classList.contains("hidden"));
}

async function readImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  $("importText").value = await file.text();
  setImportMessage(`已读取文件：${file.name}`);
}

async function importWords() {
  setImportMessage("");
  let imported;
  try {
    imported = parseImportedWords($("importText").value);
  } catch (error) {
    setImportMessage(error.message);
    return;
  }

  try {
    if (currentUser?.local) {
      const email = currentUser.email.toLowerCase();
      const stamped = imported.map((item, index) => ({
        ...item,
        id: `custom-${Date.now()}-${index}`,
        source: "个人导入",
      }));
      customWords = [...customWords, ...stamped];
      localStorage.setItem(`${LOCAL_WORDS_KEY}:${email}`, JSON.stringify(customWords));
      rebuildWords();
      prepareProgress();
      saveLocal();
      selectNext();
      render();
      setImportMessage(`已导入 ${stamped.length} 个单词。`);
      window.setTimeout(closeImport, 650);
      return;
    }
    const result = await api("/api/words/import", {
      method: "POST",
      body: { words: imported },
    });
    customWords = result.words || [];
    rebuildWords();
    prepareProgress();
    saveLocal();
    selectNext();
    render();
    setImportMessage(`已导入 ${result.imported} 个单词。`);
    window.setTimeout(closeImport, 650);
  } catch (error) {
    setImportMessage(error.message);
  }
}

function parseImportedWords(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("请粘贴单词内容，或先选择文件。");

  if (raw.startsWith("[") || raw.startsWith("{")) {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.words;
    return normalizeImportedList(list);
  }

  const rows = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseImportLine)
    .filter(Boolean);

  return normalizeImportedList(rows);
}

function parseImportLine(line) {
  const csv = parseCsvLine(line);
  if (csv.length >= 2) {
    return { word: csv[0], definition: csv.slice(1).join("；") };
  }
  const match = line.match(/^([A-Za-z][A-Za-z\s-]*[A-Za-z])[\s，,；;：:]+(.+)$/);
  if (!match) return null;
  return { word: match[1], definition: match[2] };
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normalizeImportedList(list) {
  if (!Array.isArray(list)) throw new Error("JSON 需要是数组，或包含 words 数组。");
  const cleaned = list
    .map((item) => ({
      word: String(item.word || "").trim(),
      definition: String(item.definition || item.meaning || "").trim(),
    }))
    .filter((item) => item.word && item.definition);
  if (!cleaned.length) throw new Error("没有识别到可导入的单词。");
  return cleaned;
}

function setImportMessage(message) {
  $("importMessage").textContent = message || "";
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

boot();
