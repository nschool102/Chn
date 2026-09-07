(function () {
  "use strict";

  // ================= CONFIG =================
  const CONFIG_KEY = "hsk-app-api-url";
  let API_URL = localStorage.getItem(CONFIG_KEY) || "";

  const FIELD = {
    LEVEL: "CẤP ĐỘ",
    STT: "STT",
    WORD: "TỪ VỰNG",
    PINYIN: "PINYIN",
    MEANING: "NGHĨA",
    TOPIC: "CHỦ ĐỀ",
    EXAMPLE: "VÍ DỤ",
    EXAMPLE_PINYIN: "PINYIN VÍ DỤ",
    EXAMPLE_MEANING: "NGHĨA VÍ DỤ",
    MASTERY: "THUỘC RỒI",
  };

  const FORMATS_WITH_PINYIN = [
    [FIELD.PINYIN, FIELD.MEANING], [FIELD.MEANING, FIELD.PINYIN],
    [FIELD.WORD, FIELD.MEANING], [FIELD.MEANING, FIELD.WORD],
    [FIELD.WORD, FIELD.PINYIN], [FIELD.PINYIN, FIELD.WORD],
    [FIELD.EXAMPLE_PINYIN, FIELD.EXAMPLE_MEANING], [FIELD.EXAMPLE_MEANING, FIELD.EXAMPLE_PINYIN],
    [FIELD.EXAMPLE, FIELD.EXAMPLE_PINYIN], [FIELD.EXAMPLE_PINYIN, FIELD.EXAMPLE],
    [FIELD.EXAMPLE, FIELD.MEANING], [FIELD.MEANING, FIELD.EXAMPLE],
  ];
  const FORMATS_NO_PINYIN = [
    [FIELD.WORD, FIELD.MEANING], [FIELD.MEANING, FIELD.WORD],
    [FIELD.EXAMPLE, FIELD.MEANING], [FIELD.MEANING, FIELD.EXAMPLE],
  ];

  let ALL_WORDS = [];
  let MASTERY_MAX = 5;

  // ================= DOM =================
  const $ = (id) => document.getElementById(id);
  const els = {
    setupModal: $("setupModal"), apiUrlInput: $("apiUrlInput"),
    saveApiUrlBtn: $("saveApiUrlBtn"), setupError: $("setupError"),
    app: $("app"), dataStatus: $("dataStatus"),
    refreshBtn: $("refreshBtn"), settingsBtn: $("settingsBtn"),
    levelFilter: $("levelFilter"), topicFilter: $("topicFilter"),
    pinyinToggle: $("pinyinToggle"), tabs: $("tabs"),
    viewCard: $("view-card"), viewQuiz: $("view-quiz"),
    shuffleBtn: $("shuffleBtn"), cardProgressLabel: $("cardProgressLabel"),
    flashcard: $("flashcard"), frontTag: $("frontTag"), frontText: $("frontText"),
    backTag: $("backTag"), backText: $("backText"),
    prevBtn: $("prevBtn"), nextBtn: $("nextBtn"),
    quizStart: $("quizStart"), quizStartError: $("quizStartError"), startQuizBtn: $("startQuizBtn"),
    quizSession: $("quizSession"), quizProgressLabel: $("quizProgressLabel"),
    quizPromptTag: $("quizPromptTag"), quizPromptText: $("quizPromptText"),
    quizAnswers: $("quizAnswers"), submitAnswerBtn: $("submitAnswerBtn"),
    quizFeedback: $("quizFeedback"), feedbackVerdict: $("feedbackVerdict"),
    feedbackCorrect: $("feedbackCorrect"), nextQuestionBtn: $("nextQuestionBtn"),
    quizDone: $("quizDone"), quizDoneTitle: $("quizDoneTitle"), quizDoneDesc: $("quizDoneDesc"),
    quizRestartBtn: $("quizRestartBtn"),
    toast: $("toast"),
  };

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  // ================= API =================
  async function apiGet() {
    const res = await fetch(API_URL, { method: "GET" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Lỗi tải dữ liệu");
    return json;
  }

  async function apiPost(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Lỗi cập nhật");
    return json;
  }

  function masteryNum(w) {
    const v = w[FIELD.MASTERY];
    if (v === "" || v === null || typeof v === "undefined" || isNaN(v)) return 0;
    return Number(v);
  }

  // ================= Load data =================
  async function loadData(showLoadingToast) {
    els.dataStatus.textContent = "Đang tải…";
    try {
      const json = await apiGet();
      ALL_WORDS = json.rows || [];
      MASTERY_MAX = json.masteryMax || 5;
      els.dataStatus.textContent = `${ALL_WORDS.length} từ đã tải`;
      populateFilters();
      buildFlashcardDeck();
      if (showLoadingToast) showToast("Đã cập nhật dữ liệu mới nhất");
      return true;
    } catch (err) {
      els.dataStatus.textContent = "Lỗi tải dữ liệu";
      showToast("Không tải được dữ liệu: " + err.message);
      return false;
    }
  }

  // ================= Filters =================
  function populateFilters() {
    const levels = [...new Set(ALL_WORDS.map((w) => w[FIELD.LEVEL]).filter(Boolean))].sort();
    const prevLevel = els.levelFilter.value;
    els.levelFilter.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "Tất cả cấp độ";
    els.levelFilter.appendChild(allOpt);
    levels.forEach((lv) => {
      const opt = document.createElement("option");
      opt.value = lv;
      opt.textContent = lv;
      els.levelFilter.appendChild(opt);
    });
    if (levels.includes(prevLevel) || prevLevel === "all") els.levelFilter.value = prevLevel;
    populateTopics();
  }

  function populateTopics() {
    const level = els.levelFilter.value || "all";
    const pool = level === "all" ? ALL_WORDS : ALL_WORDS.filter((w) => w[FIELD.LEVEL] === level);
    const topics = [...new Set(pool.map((w) => w[FIELD.TOPIC]).filter(Boolean))].sort();
    const prevTopic = els.topicFilter.value;
    els.topicFilter.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "Tất cả chủ đề";
    els.topicFilter.appendChild(allOpt);
    topics.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      els.topicFilter.appendChild(opt);
    });
    if (topics.includes(prevTopic) || prevTopic === "all") els.topicFilter.value = prevTopic;
  }

  function filteredWords() {
    const level = els.levelFilter.value || "all";
    const topic = els.topicFilter.value || "all";
    return ALL_WORDS.filter((w) => {
      if (level !== "all" && w[FIELD.LEVEL] !== level) return false;
      if (topic !== "all" && w[FIELD.TOPIC] !== topic) return false;
      return true;
    });
  }

  // ================= Flashcard =================
  let deck = [];
  let cardIndex = 0;

  function pickFormat(word, formats) {
    const valid = formats.filter(([a, b]) => {
      const va = (word[a] || "").toString().trim();
      const vb = (word[b] || "").toString().trim();
      return va && vb;
    });
    if (valid.length === 0) return [FIELD.WORD, FIELD.MEANING];
    return valid[Math.floor(Math.random() * valid.length)];
  }

  function buildFlashcardDeck() {
    const words = filteredWords();
    const formats = els.pinyinToggle.checked ? FORMATS_WITH_PINYIN : FORMATS_NO_PINYIN;
    deck = words.map((w) => {
      const [f, b] = pickFormat(w, formats);
      return { word: w, front: f, back: b };
    });
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    cardIndex = 0;
    renderCard();
  }

  function fitText(el, text, base) {
    const len = (text || "").length;
    let size = base;
    if (len > 10) size = base * 0.75;
    if (len > 22) size = base * 0.55;
    if (len > 40) size = base * 0.4;
    el.style.fontSize = size + "px";
  }

  function renderCard() {
    els.flashcard.classList.remove("flipped");
    if (deck.length === 0) {
      els.frontText.textContent = "Không có từ nào khớp bộ lọc";
      els.backText.textContent = "";
      els.cardProgressLabel.textContent = "0 / 0";
      return;
    }
    const c = deck[cardIndex];
    els.frontTag.textContent = c.front;
    els.backTag.textContent = c.back;
    const frontVal = (c.word[c.front] || "").toString();
    const backVal = (c.word[c.back] || "").toString();
    els.frontText.textContent = frontVal;
    els.backText.textContent = backVal;
    fitText(els.frontText, frontVal, 56);
    fitText(els.backText, backVal, 24);
    els.cardProgressLabel.textContent = `Thẻ ${cardIndex + 1} / ${deck.length}`;
  }

  function goToCard(i) {
    if (deck.length === 0) return;
    cardIndex = (i + deck.length) % deck.length;
    renderCard();
  }

  // ================= Quiz =================
  const QUIZ_TYPES = ["wordToMeaning", "meaningToWord", "pinyinToBoth"];
  let quizQueue = [];
  let quizCorrectCount = 0;
  let quizTotalCount = 0;
  let currentQuestion = null; // { word, type }

  function stripDiacritics(str) {
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");
  }

  function normalizeLoose(str) {
    return stripDiacritics(str.toLowerCase().trim().replace(/\s+/g, " "));
  }

  function meaningMatches(userInput, correctField) {
    const norm = normalizeLoose(userInput || "");
    if (!norm) return false;
    const candidates = (correctField || "")
      .split(/[\/,;]/)
      .map((s) => normalizeLoose(s))
      .filter(Boolean);
    return candidates.includes(norm);
  }

  function wordMatches(userInput, correctField) {
    return (userInput || "").toString().trim() === (correctField || "").toString().trim();
  }

  function startQuiz() {
    const topic = els.topicFilter.value;
    if (!topic || topic === "all") {
      els.quizStartError.textContent = "Vui lòng chọn 1 chủ đề cụ thể (không phải \"Tất cả\") để bắt đầu kiểm tra.";
      return;
    }
    els.quizStartError.textContent = "";
    const pool = filteredWords().filter((w) => masteryNum(w) < MASTERY_MAX);
    if (pool.length === 0) {
      els.quizStart.classList.add("hidden");
      els.quizSession.classList.add("hidden");
      els.quizDone.classList.remove("hidden");
      els.quizDoneTitle.textContent = "Chủ đề này đã thuộc hết! 🎉";
      els.quizDoneDesc.textContent = "Tất cả các từ trong chủ đề đã đạt mức thuộc tối đa.";
      return;
    }
    quizQueue = pool.slice();
    for (let i = quizQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [quizQueue[i], quizQueue[j]] = [quizQueue[j], quizQueue[i]];
    }
    quizCorrectCount = 0;
    quizTotalCount = 0;
    els.quizStart.classList.add("hidden");
    els.quizDone.classList.add("hidden");
    els.quizSession.classList.remove("hidden");
    nextQuestion();
  }

  function nextQuestion() {
    els.quizFeedback.classList.add("hidden");
    if (quizQueue.length === 0) {
      els.quizSession.classList.add("hidden");
      els.quizDone.classList.remove("hidden");
      els.quizDoneTitle.textContent = "Hoàn thành phiên kiểm tra! 🎉";
      els.quizDoneDesc.textContent = `Bạn đã trả lời đúng ${quizCorrectCount}/${quizTotalCount} lượt trong chủ đề này.`;
      return;
    }
    const word = quizQueue[0];
    const type = QUIZ_TYPES[Math.floor(Math.random() * QUIZ_TYPES.length)];
    currentQuestion = { word, type };
    renderQuestion();
  }

  function renderQuestion() {
    const { word, type } = currentQuestion;
    els.quizAnswers.innerHTML = "";
    if (type === "wordToMeaning") {
      els.quizPromptTag.textContent = FIELD.WORD;
      els.quizPromptText.textContent = word[FIELD.WORD];
      fitText(els.quizPromptText, word[FIELD.WORD], 56);
      els.quizAnswers.innerHTML = `
        <label for="ansMeaning">Gõ lại NGHĨA</label>
        <input type="text" id="ansMeaning" class="text-input" autocomplete="off">`;
    } else if (type === "meaningToWord") {
      els.quizPromptTag.textContent = FIELD.MEANING;
      els.quizPromptText.textContent = word[FIELD.MEANING];
      fitText(els.quizPromptText, word[FIELD.MEANING], 40);
      els.quizAnswers.innerHTML = `
        <label for="ansWord">Gõ lại TỪ VỰNG (chữ Hán)</label>
        <input type="text" id="ansWord" class="text-input" autocomplete="off">`;
    } else {
      els.quizPromptTag.textContent = FIELD.PINYIN;
      els.quizPromptText.textContent = word[FIELD.PINYIN];
      fitText(els.quizPromptText, word[FIELD.PINYIN], 40);
      els.quizAnswers.innerHTML = `
        <label for="ansWord2">Gõ lại TỪ VỰNG (chữ Hán)</label>
        <input type="text" id="ansWord2" class="text-input" autocomplete="off">
        <label for="ansMeaning2">Gõ lại NGHĨA</label>
        <input type="text" id="ansMeaning2" class="text-input" autocomplete="off">`;
    }
    els.quizProgressLabel.textContent = `Còn lại: ${quizQueue.length} · Đúng: ${quizCorrectCount}/${quizTotalCount}`;
    const firstInput = els.quizAnswers.querySelector("input");
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
  }

  async function submitAnswer() {
    if (!currentQuestion) return;
    const { word, type } = currentQuestion;
    let correct = false;
    let correctSummary = "";

    if (type === "wordToMeaning") {
      const val = $("ansMeaning") ? $("ansMeaning").value : "";
      correct = meaningMatches(val, word[FIELD.MEANING]);
      correctSummary = `Nghĩa đúng: ${word[FIELD.MEANING]}`;
    } else if (type === "meaningToWord") {
      const val = $("ansWord") ? $("ansWord").value : "";
      correct = wordMatches(val, word[FIELD.WORD]);
      correctSummary = `Từ đúng: ${word[FIELD.WORD]} (${word[FIELD.PINYIN]})`;
    } else {
      const valWord = $("ansWord2") ? $("ansWord2").value : "";
      const valMeaning = $("ansMeaning2") ? $("ansMeaning2").value : "";
      const wOk = wordMatches(valWord, word[FIELD.WORD]);
      const mOk = meaningMatches(valMeaning, word[FIELD.MEANING]);
      correct = wOk && mOk;
      correctSummary = `Từ đúng: ${word[FIELD.WORD]} — Nghĩa đúng: ${word[FIELD.MEANING]}` +
        (!wOk ? " (bạn gõ sai chữ Hán)" : "") + (!mOk ? " (bạn gõ sai nghĩa)" : "");
    }

    quizTotalCount++;
    quizQueue.shift();

    if (correct) {
      quizCorrectCount++;
      els.feedbackVerdict.textContent = "✓ Chính xác!";
      els.feedbackVerdict.className = "feedback-verdict correct";
      els.feedbackCorrect.textContent = "";
      try {
        const res = await apiPost({ action: "incrementMastery", row: word._row });
        word[FIELD.MASTERY] = res.newValue;
      } catch (err) {
        showToast("Không đồng bộ được lên Sheet: " + err.message);
      }
    } else {
      quizQueue.push(word); // hỏi lại sau trong cùng phiên
      els.feedbackVerdict.textContent = "✗ Chưa đúng";
      els.feedbackVerdict.className = "feedback-verdict incorrect";
      els.feedbackCorrect.textContent = correctSummary;
    }

    els.quizFeedback.classList.remove("hidden");
    els.quizProgressLabel.textContent = `Còn lại: ${quizQueue.length} · Đúng: ${quizCorrectCount}/${quizTotalCount}`;
  }

  // ================= Events =================
  els.saveApiUrlBtn.addEventListener("click", async () => {
    const url = els.apiUrlInput.value.trim();
    if (!url.startsWith("https://script.google.com/")) {
      els.setupError.textContent = "URL không hợp lệ. Phải bắt đầu bằng https://script.google.com/";
      return;
    }
    els.setupError.textContent = "Đang kết nối…";
    API_URL = url;
    const ok = await loadData(false);
    if (ok) {
      localStorage.setItem(CONFIG_KEY, API_URL);
      els.setupModal.classList.add("hidden");
      els.app.classList.remove("hidden");
    } else {
      els.setupError.textContent = "Không kết nối được. Kiểm tra lại URL và quyền truy cập (Anyone) khi Deploy.";
    }
  });

  els.settingsBtn.addEventListener("click", () => {
    els.apiUrlInput.value = API_URL;
    els.setupError.textContent = "";
    els.setupModal.classList.remove("hidden");
  });

  els.refreshBtn.addEventListener("click", () => loadData(true));

  els.levelFilter.addEventListener("change", () => {
    populateTopics();
    buildFlashcardDeck();
  });
  els.topicFilter.addEventListener("change", buildFlashcardDeck);
  els.pinyinToggle.addEventListener("change", buildFlashcardDeck);

  els.tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    [...els.tabs.children].forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    els.viewCard.classList.toggle("hidden", view !== "card");
    els.viewQuiz.classList.toggle("hidden", view !== "quiz");
    if (view === "quiz") {
      els.quizSession.classList.add("hidden");
      els.quizDone.classList.add("hidden");
      els.quizStart.classList.remove("hidden");
      els.quizStartError.textContent = "";
    }
  });

  els.shuffleBtn.addEventListener("click", () => {
    buildFlashcardDeck();
    showToast("Đã xáo trộn & đổi kiểu thẻ");
  });
  els.flashcard.addEventListener("click", () => {
    els.flashcard.classList.toggle("flipped");
  });
  els.prevBtn.addEventListener("click", () => goToCard(cardIndex - 1));
  els.nextBtn.addEventListener("click", () => goToCard(cardIndex + 1));

  let cardTouchStartX = null;
  els.flashcard.addEventListener("touchstart", (e) => { cardTouchStartX = e.changedTouches[0].clientX; });
  els.flashcard.addEventListener("touchend", (e) => {
    if (cardTouchStartX === null) return;
    const dx = e.changedTouches[0].clientX - cardTouchStartX;
    if (Math.abs(dx) > 60) goToCard(cardIndex + (dx < 0 ? 1 : -1));
    cardTouchStartX = null;
  });

  els.startQuizBtn.addEventListener("click", startQuiz);
  els.submitAnswerBtn.addEventListener("click", submitAnswer);
  els.nextQuestionBtn.addEventListener("click", nextQuestion);
  els.quizRestartBtn.addEventListener("click", () => {
    els.quizDone.classList.add("hidden");
    els.quizStart.classList.remove("hidden");
  });
  els.quizAnswers.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitAnswer(); }
  });

  // ================= Init =================
  async function init() {
    if (API_URL) {
      els.setupModal.classList.add("hidden");
      els.app.classList.remove("hidden");
      await loadData(false);
    } else {
      els.setupModal.classList.remove("hidden");
      els.app.classList.add("hidden");
    }
  }
  init();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
