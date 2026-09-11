(function () {
  "use strict";

  // ================= CONFIG =================
  // URL Apps Script Web App được đọc từ file URL_WEBAPP.txt (cùng thư mục).
  // Cần đổi URL sau này thì chỉ sửa file .txt đó, không cần đụng vào app.js.
  const URL_FILE = "./URL_WEBAPP.txt";

  const CONFIG_KEY = "hsk-app-api-url"; // chỉ dùng dự phòng nếu không đọc được file .txt
  const PASSWORD_KEY = "hsk-app-password";
  let API_URL = "";
  let usingFileUrl = false; // true nếu URL lấy được từ URL_WEBAPP.txt
  let APP_PASSWORD = localStorage.getItem(PASSWORD_KEY) || "";

  async function resolveApiUrl() {
    try {
      // Thêm tham số chống cache để luôn đọc bản mới nhất của file .txt.
      const res = await fetch(URL_FILE + "?t=" + Date.now(), { cache: "no-store" });
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text) return { url: text, fromFile: true };
      }
    } catch (err) {
      // bỏ qua, rơi xuống phương án dự phòng bên dưới
    }
    return { url: localStorage.getItem(CONFIG_KEY) || "", fromFile: false };
  }

  // ================= Field maps (tên cột "chuẩn" cho từng sheet) =================
  const HSK_FIELD = {
    ID: "VOCAB_ID",
    WORD: "VOCAB",
    PINYIN: "PINYIN",
    POS: "PART-OF-SPEECH",
    MEANING: "MEANING",
    EXAMPLE: "EXAMPLE",
    EXAMPLE_PINYIN: "EXAMPLE PINYIN",
    EXAMPLE_MEANING: "EXAMPLE MEANING",
    LEVEL: "LEVEL",
    HAN_VIET: "HAN-VIET",
    TOPIC: "TOPIC",
  };
  const GT_FIELD = {
    ID: "SENT_ID",
    CHN: "CHN",
    PINYIN: "PINYIN",
    VIE: "VIE",
    TOPIC: "TOPIC",
  };

  let ALL_HSK_WORDS = [];
  let ALL_GT_SENTENCES = [];
  let PROGRESS_MAP = {}; // id -> OK (số)
  let MASTERY_MAX = 5;

  // So khớp tên cột kiểu "khoan dung": bỏ dấu tiếng Việt, không phân biệt
  // hoa/thường, bỏ hết ký tự không phải chữ/số.
  function stripDiacritics(s) {
    return (s || "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/gi, "d");
  }
  function keyNorm(s) {
    return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function normStr(s) {
    return (s || "").toString().normalize("NFC").trim();
  }

  // Ánh xạ mảng row thô (key = tên cột thật trong Sheet) sang key chuẩn theo
  // fieldMap, dùng so khớp khoan dung (bỏ dấu/hoa-thường/khoảng trắng).
  function remapRows(rawRows, rawHeaders, fieldMap) {
    const canonicalNames = Object.values(fieldMap);
    const headerMap = {};
    canonicalNames.forEach((canon) => {
      const target = keyNorm(canon);
      const found = rawHeaders.find((h) => keyNorm(h) === target);
      if (found) headerMap[canon] = found;
    });
    return rawRows.map((row) => {
      const obj = {};
      canonicalNames.forEach((canon) => {
        const actualKey = headerMap[canon];
        obj[canon] = actualKey ? row[actualKey] : "";
      });
      obj._row = row._row;
      return obj;
    });
  }

  function masteryNum(id) {
    const v = PROGRESS_MAP[id];
    return typeof v === "number" && !isNaN(v) ? v : 0;
  }

  // ================= Unified study item =================
  // { id, kind: 'vocab'|'example'|'sentence', hanzi, pinyin, meaning, pos, hanViet, topic, level }
  function hskRowToVocabItem(row) {
    return {
      id: normStr(row[HSK_FIELD.ID]), kind: "vocab",
      hanzi: row[HSK_FIELD.WORD], pinyin: row[HSK_FIELD.PINYIN],
      pos: row[HSK_FIELD.POS], meaning: row[HSK_FIELD.MEANING], hanViet: row[HSK_FIELD.HAN_VIET],
      topic: row[HSK_FIELD.TOPIC], level: row[HSK_FIELD.LEVEL],
    };
  }
  function hskRowToExampleItem(row) {
    return {
      id: normStr(row[HSK_FIELD.ID]), kind: "example",
      hanzi: row[HSK_FIELD.EXAMPLE], pinyin: row[HSK_FIELD.EXAMPLE_PINYIN],
      pos: "", meaning: row[HSK_FIELD.EXAMPLE_MEANING], hanViet: "",
      topic: row[HSK_FIELD.TOPIC], level: row[HSK_FIELD.LEVEL],
    };
  }
  function gtRowToSentenceItem(row) {
    return {
      id: normStr(row[GT_FIELD.ID]), kind: "sentence",
      hanzi: row[GT_FIELD.CHN], pinyin: row[GT_FIELD.PINYIN],
      pos: "", meaning: row[GT_FIELD.VIE], hanViet: "",
      topic: row[GT_FIELD.TOPIC], level: "",
    };
  }

  // ================= DOM =================
  const $ = (id) => document.getElementById(id);
  const els = {
    setupModal: $("setupModal"), apiUrlInput: $("apiUrlInput"),
    setupTitle: $("setupTitle"), setupDesc: $("setupDesc"),
    saveApiUrlBtn: $("saveApiUrlBtn"), setupError: $("setupError"),
    app: $("app"), dataStatus: $("dataStatus"),
    refreshBtn: $("refreshBtn"), settingsBtn: $("settingsBtn"),
    levelFilter: $("levelFilter"), topicFilter: $("topicFilter"),
    contentTypeFilter: $("contentTypeFilter"),
    pinyinToggle: $("pinyinToggle"), hanVietToggle: $("hanVietToggle"),
    handwriteToggle: $("handwriteToggle"),
    handwriteToggleWrap: $("handwriteToggleWrap"),
    hintOutlineToggle: $("hintOutlineToggle"), hintOutlineWrap: $("hintOutlineWrap"),
    tabs: $("tabs"),
    viewCard: $("view-card"), viewQuiz: $("view-quiz"),
    shuffleBtn: $("shuffleBtn"), cardProgressLabel: $("cardProgressLabel"),
    flashcard: $("flashcard"),
    frontSideTag: $("frontSideTag"), backSideTag: $("backSideTag"),
    frontText: $("frontText"), backText: $("backText"),
    frontIdTag: $("frontIdTag"), backIdTag: $("backIdTag"),
    frontPosTag: $("frontPosTag"), backPosTag: $("backPosTag"),
    frontHanVietLine: $("frontHanVietLine"), backPinyinLine: $("backPinyinLine"),
    flashcardPractice: $("flashcardPractice"), flashcardPracticeArea: $("flashcardPracticeArea"),
    speakFrontBtn: $("speakFrontBtn"), speakBackBtn: $("speakBackBtn"),
    prevBtn: $("prevBtn"), nextBtn: $("nextBtn"),
    quizStart: $("quizStart"), quizStartError: $("quizStartError"), startQuizBtn: $("startQuizBtn"),
    quizSession: $("quizSession"), quizProgressLabel: $("quizProgressLabel"),
    quizPromptTag: $("quizPromptTag"), quizPromptText: $("quizPromptText"),
    quizSpeakBtn: $("quizSpeakBtn"),
    quizAnswers: $("quizAnswers"), submitAnswerBtn: $("submitAnswerBtn"),
    selfGradePanel: $("selfGradePanel"), selfGradeAnswer: $("selfGradeAnswer"),
    selfCorrectBtn: $("selfCorrectBtn"), selfIncorrectBtn: $("selfIncorrectBtn"),
    quizFeedback: $("quizFeedback"), feedbackVerdict: $("feedbackVerdict"),
    feedbackCorrect: $("feedbackCorrect"), nextQuestionBtn: $("nextQuestionBtn"),
    quizDone: $("quizDone"), quizDoneTitle: $("quizDoneTitle"), quizDoneDesc: $("quizDoneDesc"),
    quizDoneMissed: $("quizDoneMissed"),
    quizRestartBtn: $("quizRestartBtn"),
    quizPasswordModal: $("quizPasswordModal"), quizPasswordInput: $("quizPasswordInput"),
    quizPasswordConfirmBtn: $("quizPasswordConfirmBtn"), quizPasswordSkipBtn: $("quizPasswordSkipBtn"),
    toast: $("toast"),
  };

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  // ================= Text-to-speech =================
  let zhVoice = null;
  function pickVoice() {
    if (!("speechSynthesis" in window)) return;
    const voices = speechSynthesis.getVoices();
    zhVoice =
      voices.find((v) => v.lang === "zh-CN") ||
      voices.find((v) => v.lang && v.lang.startsWith("zh")) ||
      null;
  }
  if ("speechSynthesis" in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  function speak(text) {
    if (!text) return;
    if (!("speechSynthesis" in window)) {
      showToast("Trình duyệt không hỗ trợ phát âm");
      return;
    }
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "zh-CN";
    utter.rate = 0.85;
    if (zhVoice) utter.voice = zhVoice;
    speechSynthesis.speak(utter);
  }

  // ================= Handwriting pad (canvas dự phòng) =================
  const HANDWRITE_KEY = "hsk-app-handwrite";
  const HINT_OUTLINE_KEY = "hsk-app-hint-outline";
  els.handwriteToggle.checked = localStorage.getItem(HANDWRITE_KEY) === "1";
  els.hintOutlineToggle.checked = localStorage.getItem(HINT_OUTLINE_KEY) === "1";

  function syncHintOutlineVisibility() {
    els.hintOutlineWrap.classList.toggle("hidden", !els.handwriteToggle.checked);
  }
  syncHintOutlineVisibility();
  els.handwriteToggle.addEventListener("change", () => {
    localStorage.setItem(HANDWRITE_KEY, els.handwriteToggle.checked ? "1" : "0");
    syncHintOutlineVisibility();
    refreshActiveWidgets();
  });
  els.hintOutlineToggle.addEventListener("change", () => {
    localStorage.setItem(HINT_OUTLINE_KEY, els.hintOutlineToggle.checked ? "1" : "0");
    refreshActiveWidgets();
  });

  // Áp dụng ngay lập tức cho màn hình đang mở khi đổi toggle liên quan tới
  // viết tay/nét mờ gợi ý — không cần đợi sang thẻ/câu tiếp theo.
  function refreshActiveWidgets() {
    if (!els.viewQuiz.classList.contains("hidden") && !els.quizSession.classList.contains("hidden") && currentQuestion) {
      renderQuestion();
    }
    if (!els.viewCard.classList.contains("hidden")) {
      updatePracticeArea();
    }
  }

  function charCountFor(text) {
    return (text || "").toString().trim().length || 1;
  }
  function charsOf(text) {
    return Array.from((text || "").toString().trim());
  }

  function handwritePadHtml(canvasId) {
    return `
      <div class="handwrite-pad-wrap">
        <canvas class="handwrite-canvas" id="${canvasId}"></canvas>
        <p class="stroke-counter" id="${canvasId}-counter">Đã viết: 0 nét</p>
        <button type="button" class="ghost-btn" data-clear-for="${canvasId}">Xóa nét vẽ</button>
      </div>`;
  }

  function drawGuide(ctx, w, h, charCount, hintChars) {
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.strokeStyle = "rgba(178,52,52,0.32)";
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    if (charCount > 0 && charCount <= 8) {
      const boxW = w / charCount;
      for (let i = 1; i < charCount; i++) {
        ctx.beginPath();
        ctx.moveTo(boxW * i, 0);
        ctx.lineTo(boxW * i, h);
        ctx.stroke();
      }
      if (hintChars && hintChars.length) {
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(43,38,34,0.22)";
        ctx.font = `${Math.floor(Math.min(boxW, h) * 0.62)}px "Noto Serif SC", serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        hintChars.forEach((ch, i) => {
          ctx.fillText(ch, boxW * i + boxW / 2, h / 2);
        });
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(0, h * 0.72);
      ctx.lineTo(w, h * 0.72);
      ctx.stroke();
      if (hintChars && hintChars.length) {
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(43,38,34,0.22)";
        ctx.font = `${Math.floor(h * 0.5)}px "Noto Serif SC", serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(hintChars.join(""), 8, h * 0.62);
      }
    }
    ctx.restore();
  }

  function initHandwriteCanvas(canvasEl, targetText, onChange, showHint) {
    const dpr = window.devicePixelRatio || 1;
    const charCount = charCountFor(targetText);
    const hintChars = showHint ? charsOf(targetText) : null;
    let ctx;
    function resize() {
      const cssW = canvasEl.clientWidth || 300;
      const cssH = canvasEl.clientHeight || 170;
      canvasEl.width = Math.max(1, Math.round(cssW * dpr));
      canvasEl.height = Math.max(1, Math.round(cssH * dpr));
      ctx = canvasEl.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawGuide(ctx, cssW, cssH, charCount, hintChars);
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#2B2622";
      canvasEl._strokeCount = 0;
      canvasEl._inkLength = 0;
      if (onChange) onChange(0, 0);
    }
    resize();

    let drawing = false;
    let last = null;
    let movedThisStroke = false;
    function getPos(e) {
      const rect = canvasEl.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    function down(e) {
      drawing = true;
      movedThisStroke = false;
      last = getPos(e);
      if (canvasEl.setPointerCapture) {
        try { canvasEl.setPointerCapture(e.pointerId); } catch (err) {}
      }
      e.preventDefault();
    }
    function move(e) {
      if (!drawing) return;
      const p = getPos(e);
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 1) {
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        canvasEl._inkLength += dist;
        movedThisStroke = true;
        last = p;
      }
      e.preventDefault();
    }
    function up() {
      if (drawing && movedThisStroke) {
        canvasEl._strokeCount += 1;
        if (onChange) onChange(canvasEl._strokeCount, canvasEl._inkLength);
      }
      drawing = false;
    }

    canvasEl.addEventListener("pointerdown", down);
    canvasEl.addEventListener("pointermove", move);
    canvasEl.addEventListener("pointerup", up);
    canvasEl.addEventListener("pointerleave", up);
    canvasEl.addEventListener("pointercancel", up);

    canvasEl._clearHandwrite = resize;
  }

  function handwriteThreshold(charCount) {
    return { minStrokes: Math.max(2, charCount), minLength: charCount * 45 };
  }

  function mountHandwritePad(container, canvasId, targetText) {
    const canvasEl = container.querySelector("#" + canvasId);
    const counterEl = container.querySelector("#" + canvasId + "-counter");
    if (!canvasEl) return () => true;
    const charCount = charCountFor(targetText);
    const threshold = handwriteThreshold(charCount);
    const showHint = els.hintOutlineToggle.checked;

    function updateCounter(strokes) {
      if (!counterEl) return;
      const ok = strokes >= threshold.minStrokes;
      counterEl.textContent = `Đã viết: ${strokes} nét (tối thiểu ~${threshold.minStrokes} nét cho ${charCount} chữ)`;
      counterEl.classList.toggle("insufficient", !ok && strokes > 0);
    }

    requestAnimationFrame(() => {
      initHandwriteCanvas(canvasEl, targetText, (strokes) => updateCounter(strokes), showHint);
    });
    const clearBtn = container.querySelector('[data-clear-for="' + canvasId + '"]');
    if (clearBtn) clearBtn.addEventListener("click", () => canvasEl._clearHandwrite && canvasEl._clearHandwrite());

    return function isSufficient() {
      const strokes = canvasEl._strokeCount || 0;
      const length = canvasEl._inkLength || 0;
      return strokes >= threshold.minStrokes && length >= threshold.minLength;
    };
  }

  // ================= HanziWriter (nhận diện nét vẽ thật) =================
  const HANZI_WRITER_READY = typeof window.HanziWriter !== "undefined";

  function renderHanziQuizHtml(chars) {
    const boxes = chars.map((c, i) => `<div class="hanzi-quiz-target" id="hzTarget-${i}"></div>`).join("");
    return `
      <div class="hanzi-quiz-row" id="hanziQuizRow">${boxes}</div>
      <p class="hanzi-quiz-status" id="hanziQuizStatus">Viết từng nét theo đúng thứ tự — chữ xấu không sao, miễn đúng nét.</p>
      <div class="hanzi-quiz-controls">
        <button type="button" class="ghost-btn" id="hanziHintBtn">Gợi ý nét</button>
        <button type="button" class="ghost-btn" id="hanziSkipBtn">Tôi không biết, bỏ qua</button>
      </div>`;
  }

  function mountHanziQuiz(container, chars, cbs) {
    let completed = 0;
    let failed = false;
    const writers = [];
    const statusEl = container.querySelector("#hanziQuizStatus");

    function triggerLoadError() {
      if (failed) return;
      failed = true;
      cbs.onLoadError();
    }

    chars.forEach((ch, i) => {
      const target = container.querySelector("#hzTarget-" + i);
      if (!target || failed) return;
      let writer;
      try {
        writer = HanziWriter.create(target, ch, {
          width: target.clientWidth || 84,
          height: target.clientHeight || 84,
          padding: 6,
          showOutline: els.hintOutlineToggle.checked,
          strokeColor: "#2B2622",
          outlineColor: "#E4DCC8",
          highlightColor: "#B23434",
          drawingWidth: 5,
          showHintAfterMisses: 3,
          leniency: 1.3,
          onLoadCharDataError: triggerLoadError,
        });
      } catch (err) {
        triggerLoadError();
        return;
      }
      writers.push(writer);
      writer.quiz({
        onComplete: function () {
          if (failed) return;
          completed++;
          target.classList.add("done");
          if (statusEl) statusEl.textContent = `Đã viết đúng: ${completed} / ${chars.length} chữ`;
          if (completed >= chars.length) cbs.onComplete();
        },
      });
    });

    setTimeout(() => {
      if (failed || completed >= chars.length) return;
      const anyEmpty = chars.some((_, i) => {
        const t = container.querySelector("#hzTarget-" + i);
        return !t || t.children.length === 0;
      });
      if (anyEmpty) triggerLoadError();
    }, 4000);

    const hintBtn = container.querySelector("#hanziHintBtn");
    if (hintBtn) {
      hintBtn.addEventListener("click", () => {
        if (failed) return;
        const idx = Math.min(completed, writers.length - 1);
        if (writers[idx]) writers[idx].animateCharacter();
      });
    }
    const skipBtn = container.querySelector("#hanziSkipBtn");
    if (skipBtn) {
      skipBtn.addEventListener("click", () => {
        if (failed) return;
        failed = true;
        cbs.onSkip();
      });
    }
  }

  function setupHandwritingAnswer(container, targetText, cbs) {
    const chars = charsOf(targetText);
    if (HANZI_WRITER_READY && chars.length > 0) {
      container.innerHTML = renderHanziQuizHtml(chars);
      mountHanziQuiz(container, chars, {
        onComplete: cbs.onComplete,
        onSkip: cbs.onSkip,
        onLoadError: () => {
          container.innerHTML = handwritePadHtml("hwCanvas");
          const isSufficient = mountHandwritePad(container, "hwCanvas", charCountFor(targetText));
          cbs.onFallbackCanvas(isSufficient);
          showToast("Không tải được dữ liệu nét chữ cho ký tự này, chuyển sang bảng vẽ tự chấm.");
        },
      });
    } else {
      container.innerHTML = handwritePadHtml("hwCanvas");
      const isSufficient = mountHandwritePad(container, "hwCanvas", charCountFor(targetText));
      cbs.onFallbackCanvas(isSufficient);
    }
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
      body: JSON.stringify(Object.assign({ password: APP_PASSWORD || "" }, payload)),
    });
    const json = await res.json();
    if (!json.ok) {
      const err = new Error(json.error || "Lỗi cập nhật");
      err.authError = !!json.authError;
      throw err;
    }
    return json;
  }

  // ================= Load data =================
  async function loadData(showLoadingToast) {
    els.dataStatus.textContent = "Đang tải…";
    try {
      const json = await apiGet();
      ALL_HSK_WORDS = remapRows(json.hskRows || [], json.hskHeaders || [], HSK_FIELD);
      ALL_GT_SENTENCES = remapRows(json.giaoTiepRows || [], json.giaoTiepHeaders || [], GT_FIELD);
      PROGRESS_MAP = {};
      Object.keys(json.progress || {}).forEach((k) => { PROGRESS_MAP[k] = Number(json.progress[k]) || 0; });
      MASTERY_MAX = json.masteryMax || 5;

      els.dataStatus.textContent = `${ALL_HSK_WORDS.length} từ HSK · ${ALL_GT_SENTENCES.length} câu giao tiếp`;
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
  function isGiaoTiep() {
    return els.levelFilter.value === "giaotiep";
  }

  function populateFilters() {
    // Giữ 2 option cố định (Giao tiếp, Tất cả cấp độ), chỉ thêm các HSK level động
    const prevLevel = els.levelFilter.value || "giaotiep";
    [...els.levelFilter.querySelectorAll("option")].forEach((opt) => {
      if (opt.value !== "giaotiep" && opt.value !== "all") opt.remove();
    });
    const levels = [...new Set(ALL_HSK_WORDS.map((w) => normStr(w[HSK_FIELD.LEVEL])).filter(Boolean))].sort();
    levels.forEach((lv) => {
      const opt = document.createElement("option");
      opt.value = lv;
      opt.textContent = lv;
      els.levelFilter.appendChild(opt);
    });
    const validValues = ["giaotiep", "all", ...levels];
    els.levelFilter.value = validValues.includes(prevLevel) ? prevLevel : "giaotiep";
    syncContentTypeDisabled();
    populateTopics();
  }

  function syncContentTypeDisabled() {
    els.contentTypeFilter.disabled = isGiaoTiep();
  }

  function populateTopics() {
    const prevTopic = els.topicFilter.value;
    els.topicFilter.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "Tất cả chủ đề";
    els.topicFilter.appendChild(allOpt);

    let topics;
    if (isGiaoTiep()) {
      topics = [...new Set(ALL_GT_SENTENCES.map((s) => normStr(s[GT_FIELD.TOPIC])).filter(Boolean))].sort();
    } else {
      const level = els.levelFilter.value;
      const pool = level === "all" ? ALL_HSK_WORDS : ALL_HSK_WORDS.filter((w) => normStr(w[HSK_FIELD.LEVEL]) === level);
      topics = [...new Set(pool.map((w) => normStr(w[HSK_FIELD.TOPIC])).filter(Boolean))].sort();
    }
    topics.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      els.topicFilter.appendChild(opt);
    });
    if (topics.includes(prevTopic) || prevTopic === "all") els.topicFilter.value = prevTopic;
  }

  // Trả về mảng "study item" (đã chuẩn hóa) khớp bộ lọc hiện tại
  function filteredItems() {
    const topic = els.topicFilter.value || "all";

    if (isGiaoTiep()) {
      return ALL_GT_SENTENCES
        .filter((s) => topic === "all" || normStr(s[GT_FIELD.TOPIC]) === topic)
        .map(gtRowToSentenceItem);
    }

    const level = els.levelFilter.value || "all";
    const mode = els.contentTypeFilter.value || "both";
    const words = ALL_HSK_WORDS.filter((w) => {
      if (level !== "all" && normStr(w[HSK_FIELD.LEVEL]) !== level) return false;
      if (topic !== "all" && normStr(w[HSK_FIELD.TOPIC]) !== topic) return false;
      return true;
    });
    let items = [];
    if (mode === "vocab" || mode === "both") {
      items = items.concat(words.map(hskRowToVocabItem));
    }
    if (mode === "example" || mode === "both") {
      items = items.concat(
        words.filter((w) => (w[HSK_FIELD.EXAMPLE] || "").toString().trim()).map(hskRowToExampleItem)
      );
    }
    return items;
  }

  // ================= Flashcard =================
  let deck = [];
  let cardIndex = 0;
  let cardIsFlipped = false;

  function buildFlashcardDeck() {
    const items = filteredItems();
    deck = items.map((item) => ({ item, reversed: Math.random() < 0.5 }));
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    cardIndex = 0;
    renderCard();
  }

  const isTabletScreen = () => window.matchMedia("(min-width: 700px)").matches;

  function fitText(el, text, base) {
    const len = (text || "").length;
    const scaledBase = isTabletScreen() ? Math.round(base * 1.3) : base;
    let size = scaledBase;
    if (len > 10) size = scaledBase * 0.75;
    if (len > 22) size = scaledBase * 0.55;
    if (len > 40) size = scaledBase * 0.4;
    el.style.fontSize = size + "px";
  }

  // Vẽ 1 mặt thẻ theo "kind" ('meaning' hoặc 'hanzi'), dùng chung cho cả
  // mặt trước lẫn mặt sau vì chiều hiển thị được xáo trộn ngẫu nhiên.
  function renderFace(faceEls, kind, item) {
    const isHanzi = kind === "hanzi";
    const mainText = isHanzi ? (item.hanzi || "") : (item.meaning || "");
    faceEls.text.textContent = mainText;
    faceEls.text.className = isHanzi ? "card-main-hanzi" : "card-main-meaning";
    fitText(faceEls.text, mainText, isHanzi ? 52 : 26);

    const pos = (item.pos || "").toString().trim();
    faceEls.posTag.textContent = pos;
    faceEls.posTag.classList.toggle("hidden", !pos);

    if (isHanzi) {
      const showPinyin = els.pinyinToggle.checked && (item.pinyin || "").toString().trim();
      faceEls.extraLine.textContent = showPinyin ? item.pinyin : "";
      faceEls.extraLine.classList.toggle("hidden", !showPinyin);
    } else {
      const showHanViet = els.hanVietToggle.checked && (item.hanViet || "").toString().trim();
      faceEls.extraLine.textContent = showHanViet ? "Hán Việt: " + item.hanViet : "";
      faceEls.extraLine.classList.toggle("hidden", !showHanViet);
    }

    faceEls.idTag.textContent = item.id ? "ID: " + item.id : "";
    faceEls.sideTag.textContent = isHanzi ? "CHỮ HÁN" : "NGHĨA";
  }

  function renderCard() {
    els.flashcard.classList.remove("flipped");
    cardIsFlipped = false;
    if (deck.length === 0) {
      els.frontText.textContent = "Không có từ/câu nào khớp bộ lọc";
      els.backText.textContent = "";
      els.cardProgressLabel.textContent = "0 / 0";
      [els.frontPosTag, els.backPosTag, els.frontHanVietLine, els.backPinyinLine].forEach((el) => el.classList.add("hidden"));
      els.frontIdTag.textContent = "";
      els.backIdTag.textContent = "";
      els.flashcardPractice.classList.add("hidden");
      return;
    }
    const entry = deck[cardIndex];
    const item = entry.item;
    const frontKind = entry.reversed ? "hanzi" : "meaning";
    const backKind = entry.reversed ? "meaning" : "hanzi";

    renderFace(
      { text: els.frontText, posTag: els.frontPosTag, extraLine: els.frontHanVietLine, idTag: els.frontIdTag, sideTag: els.frontSideTag },
      frontKind, item
    );
    renderFace(
      { text: els.backText, posTag: els.backPosTag, extraLine: els.backPinyinLine, idTag: els.backIdTag, sideTag: els.backSideTag },
      backKind, item
    );

    els.cardProgressLabel.textContent = `Thẻ ${cardIndex + 1} / ${deck.length}`;
    updatePracticeArea();
  }

  // Luyện viết chữ Hán ngay trên flashcard: hiện khi bật "Viết tay" VÀ mặt
  // đang xem là mặt "nghĩa" (tức đang cần nhớ lại/viết ra chữ Hán tương ứng).
  // Đây chỉ là luyện tập tự do, không chấm điểm, không ảnh hưởng tiến độ.
  function updatePracticeArea() {
    if (deck.length === 0) {
      els.flashcardPractice.classList.add("hidden");
      return;
    }
    const entry = deck[cardIndex];
    const frontKind = entry.reversed ? "hanzi" : "meaning";
    const backKind = entry.reversed ? "meaning" : "hanzi";
    const visibleKind = cardIsFlipped ? backKind : frontKind;
    const shouldShow = els.handwriteToggle.checked && visibleKind === "meaning";

    els.flashcardPractice.classList.toggle("hidden", !shouldShow);
    if (shouldShow) mountFlashcardPractice(els.flashcardPracticeArea, entry.item.hanzi);
  }

  function mountFlashcardPractice(container, hanziText) {
    const chars = charsOf(hanziText);
    if (HANZI_WRITER_READY && chars.length > 0) {
      container.innerHTML = renderHanziQuizHtml(chars);
      mountHanziQuiz(container, chars, {
        onComplete: () => showToast("Viết đúng rồi! Lật thẻ để so đáp án."),
        onSkip: () => {},
        onLoadError: () => {
          container.innerHTML = handwritePadHtml("hwPracticeCanvas");
          mountHandwritePad(container, "hwPracticeCanvas", hanziText);
        },
      });
    } else {
      container.innerHTML = handwritePadHtml("hwPracticeCanvas");
      mountHandwritePad(container, "hwPracticeCanvas", hanziText);
    }
  }

  function goToCard(i) {
    if (deck.length === 0) return;
    cardIndex = (i + deck.length) % deck.length;
    renderCard();
  }

  // ================= Quiz =================
  const QUIZ_TYPES_BASE = ["hanziToMeaning", "meaningToHanzi", "pinyinToBoth", "listenHanzi"];
  let quizQueue = [];
  let quizCorrectCount = 0;
  let quizTotalCount = 0;
  let missedItems = [];
  let syncEnabled = false;
  let currentQuestion = null; // { item, type }

  function normalizeLoose(str) {
    const cleaned = (str || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ")
      .replace(/^[.,;:!?…"'()\-\s]+|[.,;:!?…"'()\-\s]+$/g, "");
    return stripDiacritics(cleaned);
  }

  function meaningMatches(userInput, correctField) {
    const norm = normalizeLoose(userInput || "");
    if (!norm) return false;
    const candidates = (correctField || "")
      .split(/[\/,;]|\.\.\.|…/)
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
    els.quizPasswordInput.value = APP_PASSWORD || "";
    els.quizPasswordModal.classList.remove("hidden");
    setTimeout(() => els.quizPasswordInput.focus(), 50);
  }

  function beginQuizSession() {
    const pool = filteredItems().filter((it) => masteryNum(it.id) < MASTERY_MAX);
    if (pool.length === 0) {
      els.quizStart.classList.add("hidden");
      els.quizSession.classList.add("hidden");
      els.quizDone.classList.remove("hidden");
      els.quizDoneTitle.textContent = "Chủ đề này đã thuộc hết! 🎉";
      els.quizDoneDesc.textContent = "Tất cả từ/câu trong chủ đề đã đạt mức thuộc tối đa.";
      els.quizDoneMissed.innerHTML = "";
      return;
    }
    quizQueue = pool.slice();
    for (let i = quizQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [quizQueue[i], quizQueue[j]] = [quizQueue[j], quizQueue[i]];
    }
    quizCorrectCount = 0;
    quizTotalCount = 0;
    missedItems = [];
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
      els.quizDoneDesc.textContent = `Bạn đã trả lời đúng ${quizCorrectCount}/${quizTotalCount} lượt trong chủ đề này.` +
        (syncEnabled ? "" : " (Chưa lưu lên Sheet vì không nhập mật khẩu.)");
      if (missedItems.length === 0) {
        els.quizDoneMissed.innerHTML = "";
      } else {
        const items = missedItems.map((it) =>
          `<li><span class="hz">${it.hanzi}</span><span class="mn">${it.pinyin ? it.pinyin + " — " : ""}${it.meaning}</span></li>`
        ).join("");
        els.quizDoneMissed.innerHTML = `
          <p class="missed-title">Các từ/câu đã trả lời sai (nên ôn lại):</p>
          <ul class="missed-list">${items}</ul>`;
      }
      return;
    }
    const item = quizQueue[0];
    const types = QUIZ_TYPES_BASE.slice();
    if (els.hanVietToggle.checked && (item.hanViet || "").toString().trim()) types.push("hanVietToBoth");
    const type = types[Math.floor(Math.random() * types.length)];
    currentQuestion = { item, type };
    renderQuestion();
  }

  function renderRecallBothQuestion(item, handwrite, promptValue) {
    els.quizPromptText.textContent = promptValue;
    fitText(els.quizPromptText, promptValue, 40);
    const meaningInputHtml = `
      <label for="ansMeaning2">Gõ lại NGHĨA</label>
      <input type="text" id="ansMeaning2" class="text-input" autocomplete="off">`;
    if (handwrite && HANZI_WRITER_READY) {
      currentQuestion.hanziAutoMode = true;
      const chars = charsOf(item.hanzi);
      els.quizAnswers.innerHTML = renderHanziQuizHtml(chars) + meaningInputHtml;
      mountHanziQuiz(els.quizAnswers, chars, {
        onComplete: () => {
          currentQuestion.hanziAllCorrect = true;
          showToast("Đã viết đúng chữ Hán — giờ gõ nghĩa rồi bấm Kiểm tra.");
        },
        onSkip: () => finalizeAnswer(item, false, `Từ/câu đúng: ${item.hanzi} — Nghĩa đúng: ${item.meaning}`),
        onLoadError: () => {
          currentQuestion.hanziAutoMode = false;
          els.quizAnswers.innerHTML = `
            <label for="ansWord2">Gõ lại (chữ Hán)</label>
            <input type="text" id="ansWord2" class="text-input" autocomplete="off">` + meaningInputHtml;
        },
      });
    } else {
      els.quizAnswers.innerHTML = `
        <label for="ansWord2">Gõ lại (chữ Hán)</label>
        <input type="text" id="ansWord2" class="text-input" autocomplete="off">` + meaningInputHtml;
    }
  }

  function renderQuestion() {
    const { item, type } = currentQuestion;
    els.quizAnswers.innerHTML = "";
    els.quizSpeakBtn.classList.add("hidden");
    els.quizPromptText.classList.remove("hidden");
    els.selfGradePanel.classList.add("hidden");
    els.submitAnswerBtn.classList.remove("hidden");
    els.submitAnswerBtn.textContent = "Kiểm tra";
    currentQuestion.needsSelfGrade = false;
    currentQuestion.revealed = false;
    currentQuestion.pendingMeaningOk = null;
    currentQuestion.checkHandwriteSufficient = null;
    currentQuestion.hanziAutoMode = false;
    currentQuestion.hanziAllCorrect = false;

    const handwrite = els.handwriteToggle.checked;

    if (type === "hanziToMeaning") {
      els.quizPromptTag.textContent = "CHỮ / CÂU";
      els.quizPromptText.textContent = item.hanzi;
      fitText(els.quizPromptText, item.hanzi, 48);
      els.quizAnswers.innerHTML = `
        <label for="ansMeaning">Gõ lại NGHĨA</label>
        <input type="text" id="ansMeaning" class="text-input" autocomplete="off">`;
    } else if (type === "meaningToHanzi") {
      els.quizPromptTag.textContent = "NGHĨA";
      els.quizPromptText.textContent = item.meaning;
      fitText(els.quizPromptText, item.meaning, 32);
      if (handwrite) {
        els.submitAnswerBtn.classList.add("hidden");
        setupHandwritingAnswer(els.quizAnswers, item.hanzi, {
          onComplete: () => finalizeAnswer(item, true, ""),
          onSkip: () => finalizeAnswer(item, false, `Đúng: ${item.hanzi}${item.pinyin ? " (" + item.pinyin + ")" : ""}`),
          onFallbackCanvas: (isSufficient) => {
            currentQuestion.needsSelfGrade = true;
            currentQuestion.checkHandwriteSufficient = isSufficient;
            els.submitAnswerBtn.textContent = "Xem đáp án";
            els.submitAnswerBtn.classList.remove("hidden");
          },
        });
      } else {
        els.quizAnswers.innerHTML = `
          <label for="ansWord">Gõ lại (chữ Hán)</label>
          <input type="text" id="ansWord" class="text-input" autocomplete="off">`;
      }
    } else if (type === "pinyinToBoth") {
      els.quizPromptTag.textContent = "PINYIN";
      renderRecallBothQuestion(item, handwrite, item.pinyin);
    } else if (type === "hanVietToBoth") {
      els.quizPromptTag.textContent = "HÁN VIỆT";
      renderRecallBothQuestion(item, handwrite, item.hanViet);
    } else if (type === "listenHanzi") {
      els.quizPromptTag.textContent = "NGHE";
      els.quizPromptText.textContent = "🔊";
      els.quizPromptText.style.fontSize = (isTabletScreen() ? 64 : 48) + "px";
      els.quizSpeakBtn.classList.remove("hidden");
      if (handwrite) {
        els.submitAnswerBtn.classList.add("hidden");
        setupHandwritingAnswer(els.quizAnswers, item.hanzi, {
          onComplete: () => finalizeAnswer(item, true, ""),
          onSkip: () => finalizeAnswer(item, false, `Đúng: ${item.hanzi}${item.pinyin ? " (" + item.pinyin + ")" : ""} — ${item.meaning}`),
          onFallbackCanvas: (isSufficient) => {
            currentQuestion.needsSelfGrade = true;
            currentQuestion.checkHandwriteSufficient = isSufficient;
            els.submitAnswerBtn.textContent = "Xem đáp án";
            els.submitAnswerBtn.classList.remove("hidden");
          },
        });
      } else {
        els.quizAnswers.innerHTML = `
          <label for="ansListen">Gõ lại những gì bạn vừa nghe (chữ Hán)</label>
          <input type="text" id="ansListen" class="text-input" autocomplete="off">`;
      }
      speak(item.hanzi);
    }
    els.quizProgressLabel.textContent = `Còn lại: ${quizQueue.length} · Đúng: ${quizCorrectCount}/${quizTotalCount}`;
    const firstInput = els.quizAnswers.querySelector("input");
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
  }

  function revealSelfGrade() {
    const { item, type, checkHandwriteSufficient } = currentQuestion;
    if (checkHandwriteSufficient && !checkHandwriteSufficient()) {
      showToast("Hãy viết đủ nét hơn trước khi xem đáp án (xem số nét đã đếm dưới bảng vẽ).");
      return;
    }
    let answerText = "";
    let pendingMeaningOk = null;

    if (type === "meaningToHanzi" || type === "listenHanzi") {
      answerText = `${item.hanzi}${item.pinyin ? " (" + item.pinyin + ")" : ""} — ${item.meaning}`;
    } else if (type === "pinyinToBoth" || type === "hanVietToBoth") {
      const valMeaning = $("ansMeaning2") ? $("ansMeaning2").value : "";
      pendingMeaningOk = meaningMatches(valMeaning, item.meaning);
      answerText = `${item.hanzi} — ${item.meaning}` + (pendingMeaningOk ? "" : " (phần nghĩa bạn gõ chưa đúng)");
    }

    currentQuestion.revealed = true;
    currentQuestion.pendingMeaningOk = pendingMeaningOk;
    els.selfGradeAnswer.textContent = answerText;
    fitText(els.selfGradeAnswer, answerText, 32);
    els.selfGradePanel.classList.remove("hidden");
    els.submitAnswerBtn.classList.add("hidden");
  }

  function finalizeSelfGrade(selfOk) {
    const { item, pendingMeaningOk } = currentQuestion;
    const overallCorrect = selfOk && (pendingMeaningOk === null || pendingMeaningOk === undefined ? true : pendingMeaningOk);
    const summary = els.selfGradeAnswer.textContent;
    els.selfGradePanel.classList.add("hidden");
    els.submitAnswerBtn.classList.remove("hidden");
    finalizeAnswer(item, overallCorrect, summary);
  }

  function handleSubmitClick() {
    if (!currentQuestion) return;
    if (currentQuestion.needsSelfGrade && !currentQuestion.revealed) {
      revealSelfGrade();
    } else if (!currentQuestion.needsSelfGrade) {
      submitAnswer();
    }
  }

  async function submitAnswer() {
    if (!currentQuestion) return;
    const { item, type } = currentQuestion;
    let correct = false;
    let correctSummary = "";

    if (type === "hanziToMeaning") {
      const val = $("ansMeaning") ? $("ansMeaning").value : "";
      correct = meaningMatches(val, item.meaning);
      correctSummary = `Nghĩa đúng: ${item.meaning}`;
    } else if (type === "meaningToHanzi") {
      const val = $("ansWord") ? $("ansWord").value : "";
      correct = wordMatches(val, item.hanzi);
      correctSummary = `Đúng: ${item.hanzi}${item.pinyin ? " (" + item.pinyin + ")" : ""}`;
    } else if (type === "pinyinToBoth" || type === "hanVietToBoth") {
      const valMeaning = $("ansMeaning2") ? $("ansMeaning2").value : "";
      const mOk = meaningMatches(valMeaning, item.meaning);
      let wOk;
      let wordNote = "";
      if (currentQuestion.hanziAutoMode) {
        wOk = !!currentQuestion.hanziAllCorrect;
        wordNote = wOk ? "" : " (bạn chưa viết xong/đúng chữ Hán)";
      } else {
        const valWord = $("ansWord2") ? $("ansWord2").value : "";
        wOk = wordMatches(valWord, item.hanzi);
        wordNote = wOk ? "" : " (bạn gõ sai chữ Hán)";
      }
      correct = wOk && mOk;
      correctSummary = `Đúng: ${item.hanzi} — Nghĩa đúng: ${item.meaning}` +
        wordNote + (!mOk ? " (bạn gõ sai nghĩa)" : "");
    } else if (type === "listenHanzi") {
      const val = $("ansListen") ? $("ansListen").value : "";
      correct = wordMatches(val, item.hanzi);
      correctSummary = `Đúng: ${item.hanzi}${item.pinyin ? " (" + item.pinyin + ")" : ""} — ${item.meaning}`;
    }

    await finalizeAnswer(item, correct, correctSummary);
  }

  async function finalizeAnswer(item, correct, correctSummary) {
    quizTotalCount++;
    quizQueue.shift();

    if (correct) {
      quizCorrectCount++;
      els.feedbackVerdict.textContent = "✓ Chính xác!";
      els.feedbackVerdict.className = "feedback-verdict correct";
      els.feedbackCorrect.textContent = "";
      if (syncEnabled) {
        try {
          const res = await apiPost({ action: "incrementMastery", id: item.id });
          PROGRESS_MAP[item.id] = res.newValue;
        } catch (err) {
          if (err.authError) {
            showToast("Sai mật khẩu — điểm chỉ tính tạm trên máy, chưa ghi lên Sheet.");
          } else {
            showToast("Không đồng bộ được lên Sheet: " + err.message);
          }
        }
      }
    } else {
      quizQueue.push(item);
      if (!missedItems.some((it) => it.id === item.id && it.kind === item.kind)) missedItems.push(item);
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
    API_URL = url;
    els.setupError.textContent = "Đang kết nối…";
    const ok = await loadData(false);
    if (ok) {
      if (!usingFileUrl) localStorage.setItem(CONFIG_KEY, API_URL);
      els.setupModal.classList.add("hidden");
      els.app.classList.remove("hidden");
    } else {
      els.setupError.textContent = "Không kết nối được. Kiểm tra lại URL và quyền truy cập (Anyone) khi Deploy.";
    }
  });

  els.settingsBtn.addEventListener("click", () => {
    els.apiUrlInput.classList.remove("hidden");
    els.apiUrlInput.value = API_URL;
    els.setupTitle.textContent = "Cài đặt kết nối";
    els.setupDesc.textContent = "Dán URL Apps Script Web App bạn đã deploy vào đây. Xem hướng dẫn trong file backend-apps-script.gs.txt đi kèm.";
    els.setupError.textContent = "";
    els.setupModal.classList.remove("hidden");
  });

  els.refreshBtn.addEventListener("click", () => loadData(true));

  els.levelFilter.addEventListener("change", () => {
    syncContentTypeDisabled();
    populateTopics();
    buildFlashcardDeck();
  });
  els.topicFilter.addEventListener("change", buildFlashcardDeck);
  els.contentTypeFilter.addEventListener("change", buildFlashcardDeck);
  els.pinyinToggle.addEventListener("change", renderCard);

  const HAN_VIET_TOGGLE_KEY = "hsk-app-hanviet-toggle";
  els.hanVietToggle.checked = localStorage.getItem(HAN_VIET_TOGGLE_KEY) === "1";
  els.hanVietToggle.addEventListener("change", () => {
    localStorage.setItem(HAN_VIET_TOGGLE_KEY, els.hanVietToggle.checked ? "1" : "0");
    renderCard();
  });

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
    showToast("Đã xáo trộn bộ thẻ");
  });
  els.flashcard.addEventListener("click", () => {
    cardIsFlipped = !cardIsFlipped;
    els.flashcard.classList.toggle("flipped", cardIsFlipped);
    updatePracticeArea();
  });
  els.speakFrontBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (deck.length === 0) return;
    speak(deck[cardIndex].item.hanzi);
  });
  els.speakBackBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (deck.length === 0) return;
    speak(deck[cardIndex].item.hanzi);
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
  els.quizPasswordConfirmBtn.addEventListener("click", () => {
    APP_PASSWORD = els.quizPasswordInput.value.trim();
    localStorage.setItem(PASSWORD_KEY, APP_PASSWORD);
    syncEnabled = !!APP_PASSWORD;
    els.quizPasswordModal.classList.add("hidden");
    beginQuizSession();
  });
  els.quizPasswordSkipBtn.addEventListener("click", () => {
    syncEnabled = false;
    els.quizPasswordModal.classList.add("hidden");
    beginQuizSession();
  });

  els.quizSpeakBtn.addEventListener("click", () => {
    if (!currentQuestion) return;
    speak(currentQuestion.item.hanzi);
  });
  els.submitAnswerBtn.addEventListener("click", handleSubmitClick);
  els.selfCorrectBtn.addEventListener("click", () => finalizeSelfGrade(true));
  els.selfIncorrectBtn.addEventListener("click", () => finalizeSelfGrade(false));
  els.nextQuestionBtn.addEventListener("click", nextQuestion);
  els.quizRestartBtn.addEventListener("click", () => {
    els.quizDone.classList.add("hidden");
    els.quizStart.classList.remove("hidden");
  });
  els.quizAnswers.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); handleSubmitClick(); }
  });

  // ================= Init =================
  async function init() {
    const resolved = await resolveApiUrl();
    API_URL = resolved.url;
    usingFileUrl = resolved.fromFile;
    if (usingFileUrl) els.settingsBtn.classList.add("hidden"); // URL quản lý qua file .txt, khỏi cần chỉnh tay

    if (API_URL) {
      els.setupModal.classList.add("hidden");
      els.app.classList.remove("hidden");
      await loadData(false);
    } else {
      els.apiUrlInput.classList.remove("hidden");
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
