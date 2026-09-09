(function () {
  "use strict";

  // ================= CONFIG =================
  // Dán URL Apps Script Web App của bạn vào giữa 2 dấu ngoặc kép dưới đây.
  // Làm 1 lần duy nhất — app sẽ luôn dùng URL này, không cần dán lại kể cả
  // khi xóa cache trình duyệt hay dùng trên thiết bị khác.
  const HARDCODED_API_URL = "";

  const CONFIG_KEY = "hsk-app-api-url"; // chỉ dùng dự phòng nếu chưa nhúng URL ở trên
  const PASSWORD_KEY = "hsk-app-password";
  let API_URL = HARDCODED_API_URL || localStorage.getItem(CONFIG_KEY) || "";
  let APP_PASSWORD = localStorage.getItem(PASSWORD_KEY) || "";

  const FIELD = {
    LEVEL: "LEVEL",
    STT: "No.",
    WORD: "VOCAB",
    PINYIN: "PINYIN",
    POS: "PART-OF-SPEECH",
    MEANING: "MEANING",
    HAN_VIET: "HAN-VIET",
    TOPIC: "TOPIC",
    EXAMPLE: "EXAMPLE",
    EXAMPLE_PINYIN: "EXAMPLE PINYIN",
    EXAMPLE_MEANING: "EXAMPLE MEANING",
    MASTERY: "OK",
  };

  // Flashcard chỉ dùng đúng 8 kiểu mặt trước/sau này (cố định, không phụ
  // thuộc toggle Hán Việt/Loại từ nữa). Toggle Pinyin quyết định có thêm
  // 4 kiểu liên quan tới pinyin hay chỉ dùng 4 kiểu nghĩa/ví dụ cơ bản.
  const FLASHCARD_FORMATS_BASE = [
    [FIELD.MEANING, FIELD.WORD], [FIELD.WORD, FIELD.MEANING],
    [FIELD.EXAMPLE, FIELD.EXAMPLE_MEANING], [FIELD.EXAMPLE_MEANING, FIELD.EXAMPLE],
  ];
  const FLASHCARD_FORMATS_PINYIN_EXTRA = [
    [FIELD.WORD, FIELD.PINYIN], [FIELD.PINYIN, FIELD.WORD],
    [FIELD.EXAMPLE, FIELD.EXAMPLE_PINYIN], [FIELD.EXAMPLE_PINYIN, FIELD.EXAMPLE],
  ];
  // Các field thuộc "câu ví dụ" — thẻ có mặt nào rơi vào nhóm này thì không
  // hiện nhãn Loại từ (Part-of-speech vốn chỉ áp dụng cho từ vựng đơn lẻ).
  const EXAMPLE_FIELDS = [FIELD.EXAMPLE, FIELD.EXAMPLE_PINYIN, FIELD.EXAMPLE_MEANING];

  let ALL_WORDS = [];
  let MASTERY_MAX = 5;

  // So khớp tên cột kiểu "khoan dung": bỏ dấu tiếng Việt, không phân biệt
  // hoa/thường, bỏ khoảng trắng thừa. Nhờ vậy dù cột trong Sheet ghi
  // "Từ vựng", "TỪ VỰNG ", hay dùng font gõ dấu khác cũng vẫn nhận ra.
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
  function getLevel(w) { return normStr(w[FIELD.LEVEL]); }
  function getTopic(w) { return normStr(w[FIELD.TOPIC]); }

  // ================= DOM =================
  const $ = (id) => document.getElementById(id);
  const els = {
    setupModal: $("setupModal"), apiUrlInput: $("apiUrlInput"),
    setupTitle: $("setupTitle"), setupDesc: $("setupDesc"),
    saveApiUrlBtn: $("saveApiUrlBtn"), setupError: $("setupError"),
    app: $("app"), dataStatus: $("dataStatus"),
    refreshBtn: $("refreshBtn"), settingsBtn: $("settingsBtn"),
    levelFilter: $("levelFilter"), topicFilter: $("topicFilter"),
    pinyinToggle: $("pinyinToggle"), hanVietToggle: $("hanVietToggle"),
    handwriteToggle: $("handwriteToggle"),
    handwriteToggleWrap: $("handwriteToggleWrap"),
    hintOutlineToggle: $("hintOutlineToggle"), hintOutlineWrap: $("hintOutlineWrap"),
    tabs: $("tabs"),
    viewCard: $("view-card"), viewQuiz: $("view-quiz"),
    shuffleBtn: $("shuffleBtn"), cardProgressLabel: $("cardProgressLabel"),
    flashcard: $("flashcard"), frontTag: $("frontTag"), frontText: $("frontText"),
    backTag: $("backTag"), backText: $("backText"),
    frontNoTag: $("frontNoTag"), backNoTag: $("backNoTag"),
    frontPosTag: $("frontPosTag"), backPosTag: $("backPosTag"),
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

  // Với 1 mặt thẻ (front/back là tên field), chọn đúng đoạn tiếng Trung cần đọc:
  // field thuộc nhóm ví dụ -> đọc câu ví dụ; còn lại -> đọc từ vựng.
  function audioTextForField(word, field) {
    if (field === FIELD.EXAMPLE || field === FIELD.EXAMPLE_PINYIN || field === FIELD.EXAMPLE_MEANING) {
      return (word[FIELD.EXAMPLE] || "").toString().trim();
    }
    return (word[FIELD.WORD] || "").toString().trim();
  }

  // ================= Handwriting pad (vẽ chữ Hán bằng bút/ngón tay) =================
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
  });
  els.hintOutlineToggle.addEventListener("change", () => {
    localStorage.setItem(HINT_OUTLINE_KEY, els.hintOutlineToggle.checked ? "1" : "0");
  });

  function charCountFor(text) {
    return (text || "").toString().trim().length || 1;
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

  // Gắn Pointer Events (chuột/ngón tay/Apple Pencil đều dùng chung API này) lên canvas.
  // Đồng thời đếm số nét (mỗi lần nhấc bút = 1 nét) và tổng độ dài mực đã vẽ,
  // dùng làm ngưỡng chặn kiểu "vẽ nguệch ngoạc rồi bấm đúng".
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

  // Ngưỡng tối thiểu "chấp nhận được" cho 1 lượt viết tay: không phải nhận
  // diện nét đúng/sai thật sự (không có OCR), chỉ chặn kiểu vẽ 1 nét nguệch
  // ngoạc qua loa rồi tự nhận là đúng.
  function handwriteThreshold(charCount) {
    return {
      minStrokes: Math.max(2, charCount),
      minLength: charCount * 45,
    };
  }

  // Chèn bảng vẽ vào 1 container, tự dò kích thước sau khi đã nằm trong DOM.
  // Trả về hàm kiểm tra "đã viết đủ chưa" để dùng khi bấm Xem đáp án.
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

  // ================= HanziWriter (nhận diện nét vẽ thật, miễn phí, chạy trong trình duyệt) =================
  // Thư viện mã nguồn mở hanzi-writer (MIT) có sẵn dữ liệu nét chuẩn cho hàng
  // nghìn chữ Hán và biết chấm đúng/sai từng nét (đúng hướng, đúng thứ tự) —
  // không cần API key, không tốn phí. Nếu thư viện không tải được (offline)
  // hoặc dữ liệu 1 ký tự nào đó lỗi, tự động rơi về bảng vẽ tự chấm ở trên.
  const HANZI_WRITER_READY = typeof window.HanziWriter !== "undefined";

  function charsOf(text) {
    return Array.from((text || "").toString().trim());
  }

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

  // Gắn HanziWriter cho các ô đã có sẵn trong container (do renderHanziQuizHtml tạo).
  // cbs: { onComplete(), onSkip(), onLoadError() }
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

    // Lưới an toàn: nếu sau vài giây ô nào đó vẫn trống trơn (dữ liệu không tải
    // được nhưng callback lỗi không bắn ra vì lý do gì đó), coi như lỗi tải.
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

  // Hàm dùng chung cho các câu hỏi chỉ cần viết 1 chuỗi chữ Hán rồi tự động
  // chấm (không cần bấm nút): thử HanziWriter trước, lỗi thì rơi về canvas.
  // cbs: { onComplete(), onSkip(), onFallbackCanvas(isSufficientFn) }
  function setupHandwritingAnswer(container, targetText, cbs) {
    const chars = charsOf(targetText);
    if (HANZI_WRITER_READY && chars.length > 0) {
      container.innerHTML = renderHanziQuizHtml(chars);
      mountHanziQuiz(container, chars, {
        onComplete: cbs.onComplete,
        onSkip: cbs.onSkip,
        onLoadError: () => {
          container.innerHTML = handwritePadHtml("hwCanvas");
          const isSufficient = mountHandwritePad(container, "hwCanvas", targetText);
          cbs.onFallbackCanvas(isSufficient);
          showToast("Không tải được dữ liệu nét chữ cho ký tự này, chuyển sang bảng vẽ tự chấm.");
        },
      });
    } else {
      container.innerHTML = handwritePadHtml("hwCanvas");
      const isSufficient = mountHandwritePad(container, "hwCanvas", targetText);
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
      const rawRows = json.rows || [];
      const rawHeaders = json.headers && json.headers.length
        ? json.headers
        : (rawRows[0] ? Object.keys(rawRows[0]) : []);

      // Ánh xạ mỗi tên cột "chuẩn" (FIELD.*) tới tên cột thật tìm thấy trong Sheet
      const canonicalNames = Object.values(FIELD);
      const headerMap = {}; // canonical -> actual header key in the raw data
      const unmatched = [];
      canonicalNames.forEach((canon) => {
        const target = keyNorm(canon);
        const found = rawHeaders.find((h) => keyNorm(h) === target);
        if (found) headerMap[canon] = found;
        else unmatched.push(canon);
      });

      ALL_WORDS = rawRows.map((row) => {
        const obj = {};
        canonicalNames.forEach((canon) => {
          const actualKey = headerMap[canon];
          obj[canon] = actualKey ? row[actualKey] : "";
        });
        obj._row = row._row;
        return obj;
      });

      MASTERY_MAX = json.masteryMax || 5;

      if (unmatched.length) {
        showToast("Không tìm thấy cột: " + unmatched.join(", ") + ". Cột có trong Sheet: " + rawHeaders.join(", "));
      }
      if (ALL_WORDS.length && !ALL_WORDS.some((w) => getTopic(w))) {
        console.warn("Không tìm thấy giá trị nào ở cột CHỦ ĐỀ. Kiểm tra lại tên cột trong Sheet.");
      }
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
    const levels = [...new Set(ALL_WORDS.map(getLevel).filter(Boolean))].sort();
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
    const pool = level === "all" ? ALL_WORDS : ALL_WORDS.filter((w) => getLevel(w) === level);
    const topics = [...new Set(pool.map(getTopic).filter(Boolean))].sort();
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
      if (level !== "all" && getLevel(w) !== level) return false;
      if (topic !== "all" && getTopic(w) !== topic) return false;
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
    const formats = els.pinyinToggle.checked
      ? FLASHCARD_FORMATS_BASE.concat(FLASHCARD_FORMATS_PINYIN_EXTRA)
      : FLASHCARD_FORMATS_BASE;
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

    const recordNo = c.word[FIELD.STT];
    els.frontNoTag.textContent = recordNo ? "No. " + recordNo : "";
    els.backNoTag.textContent = recordNo ? "No. " + recordNo : "";

    const isExampleCard = EXAMPLE_FIELDS.includes(c.front) || EXAMPLE_FIELDS.includes(c.back);
    const pos = (c.word[FIELD.POS] || "").toString().trim();
    const showPos = !isExampleCard && !!pos;
    els.frontPosTag.textContent = pos;
    els.backPosTag.textContent = pos;
    els.frontPosTag.classList.toggle("hidden", !showPos);
    els.backPosTag.classList.toggle("hidden", !showPos);

    els.cardProgressLabel.textContent = `Thẻ ${cardIndex + 1} / ${deck.length}`;
  }

  function goToCard(i) {
    if (deck.length === 0) return;
    cardIndex = (i + deck.length) % deck.length;
    renderCard();
  }

  // ================= Quiz =================
  const QUIZ_TYPES_BASE = ["wordToMeaning", "meaningToWord", "pinyinToBoth", "listenWord"];
  let quizQueue = [];
  let quizCorrectCount = 0;
  let quizTotalCount = 0;
  let missedWords = []; // các từ đã trả lời sai ít nhất 1 lần trong phiên này
  let syncEnabled = false; // có mật khẩu -> thử ghi điểm lên Sheet
  let currentQuestion = null; // { word, type }

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
    // Hỏi mật khẩu mỗi lần bắt đầu 1 phiên kiểm tra mới. Nhập đúng -> điểm
    // được ghi lên Sheet; bỏ trống -> vẫn làm bài, tính điểm bình thường,
    // chỉ là không ghi lên Sheet.
    els.quizPasswordInput.value = APP_PASSWORD || "";
    els.quizPasswordModal.classList.remove("hidden");
    setTimeout(() => els.quizPasswordInput.focus(), 50);
  }

  function beginQuizSession() {
    const pool = filteredWords().filter((w) => masteryNum(w) < MASTERY_MAX);
    if (pool.length === 0) {
      els.quizStart.classList.add("hidden");
      els.quizSession.classList.add("hidden");
      els.quizDone.classList.remove("hidden");
      els.quizDoneTitle.textContent = "Chủ đề này đã thuộc hết! 🎉";
      els.quizDoneDesc.textContent = "Tất cả các từ trong chủ đề đã đạt mức thuộc tối đa.";
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
    missedWords = [];
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
      if (missedWords.length === 0) {
        els.quizDoneMissed.innerHTML = "";
      } else {
        const items = missedWords.map((w) =>
          `<li><span class="hz">${w[FIELD.WORD]}</span><span class="mn">${w[FIELD.PINYIN]} — ${w[FIELD.MEANING]}</span></li>`
        ).join("");
        els.quizDoneMissed.innerHTML = `
          <p class="missed-title">Các từ đã trả lời sai (nên ôn lại):</p>
          <ul class="missed-list">${items}</ul>`;
      }
      return;
    }
    const word = quizQueue[0];
    const types = QUIZ_TYPES_BASE.slice();
    if ((word[FIELD.EXAMPLE] || "").toString().trim()) types.push("listenExample");
    if (els.hanVietToggle.checked && (word[FIELD.HAN_VIET] || "").toString().trim()) types.push("hanVietToBoth");
    const type = types[Math.floor(Math.random() * types.length)];
    currentQuestion = { word, type };
    renderQuestion();
  }

  // Dùng chung cho các câu hỏi "đưa 1 cách đọc (pinyin/Hán Việt) -> gõ lại
  // TỪ VỰNG + NGHĨA". Chỉ khác nhau ở giá trị hiển thị trên prompt.
  function renderRecallBothQuestion(word, handwrite, promptValue) {
    els.quizPromptText.textContent = promptValue;
    fitText(els.quizPromptText, promptValue, 40);
    const meaningInputHtml = `
      <label for="ansMeaning2">Gõ lại NGHĨA</label>
      <input type="text" id="ansMeaning2" class="text-input" autocomplete="off">`;
    if (handwrite && HANZI_WRITER_READY) {
      currentQuestion.hanziAutoMode = true;
      const chars = charsOf(word[FIELD.WORD]);
      els.quizAnswers.innerHTML = renderHanziQuizHtml(chars) + meaningInputHtml;
      mountHanziQuiz(els.quizAnswers, chars, {
        onComplete: () => {
          currentQuestion.hanziAllCorrect = true;
          showToast("Đã viết đúng chữ Hán — giờ gõ nghĩa rồi bấm Kiểm tra.");
        },
        onSkip: () => finalizeAnswer(word, false, `Từ đúng: ${word[FIELD.WORD]} — Nghĩa đúng: ${word[FIELD.MEANING]}`),
        onLoadError: () => {
          currentQuestion.hanziAutoMode = false;
          els.quizAnswers.innerHTML = `
            <label for="ansWord2">Gõ lại TỪ VỰNG (chữ Hán)</label>
            <input type="text" id="ansWord2" class="text-input" autocomplete="off">` + meaningInputHtml;
        },
      });
    } else {
      els.quizAnswers.innerHTML = `
        <label for="ansWord2">Gõ lại TỪ VỰNG (chữ Hán)</label>
        <input type="text" id="ansWord2" class="text-input" autocomplete="off">` + meaningInputHtml;
    }
  }

  function renderQuestion() {
    const { word, type } = currentQuestion;
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
      if (handwrite) {
        els.submitAnswerBtn.classList.add("hidden");
        setupHandwritingAnswer(els.quizAnswers, word[FIELD.WORD], {
          onComplete: () => finalizeAnswer(word, true, ""),
          onSkip: () => finalizeAnswer(word, false, `Từ đúng: ${word[FIELD.WORD]} (${word[FIELD.PINYIN]})`),
          onFallbackCanvas: (isSufficient) => {
            currentQuestion.needsSelfGrade = true;
            currentQuestion.checkHandwriteSufficient = isSufficient;
            els.submitAnswerBtn.textContent = "Xem đáp án";
            els.submitAnswerBtn.classList.remove("hidden");
          },
        });
      } else {
        els.quizAnswers.innerHTML = `
          <label for="ansWord">Gõ lại TỪ VỰNG (chữ Hán)</label>
          <input type="text" id="ansWord" class="text-input" autocomplete="off">`;
      }
    } else if (type === "pinyinToBoth") {
      els.quizPromptTag.textContent = FIELD.PINYIN;
      renderRecallBothQuestion(word, handwrite, word[FIELD.PINYIN]);
    } else if (type === "hanVietToBoth") {
      els.quizPromptTag.textContent = FIELD.HAN_VIET;
      renderRecallBothQuestion(word, handwrite, word[FIELD.HAN_VIET]);
    } else if (type === "listenWord") {
      els.quizPromptTag.textContent = "NGHE TỪ";
      els.quizPromptText.textContent = "🔊";
      els.quizPromptText.style.fontSize = (isTabletScreen() ? 64 : 48) + "px";
      els.quizSpeakBtn.classList.remove("hidden");
      if (handwrite) {
        els.submitAnswerBtn.classList.add("hidden");
        setupHandwritingAnswer(els.quizAnswers, word[FIELD.WORD], {
          onComplete: () => finalizeAnswer(word, true, ""),
          onSkip: () => finalizeAnswer(word, false, `Từ đúng: ${word[FIELD.WORD]} (${word[FIELD.PINYIN]}) — ${word[FIELD.MEANING]}`),
          onFallbackCanvas: (isSufficient) => {
            currentQuestion.needsSelfGrade = true;
            currentQuestion.checkHandwriteSufficient = isSufficient;
            els.submitAnswerBtn.textContent = "Xem đáp án";
            els.submitAnswerBtn.classList.remove("hidden");
          },
        });
      } else {
        els.quizAnswers.innerHTML = `
          <label for="ansListenWord">Gõ lại từ bạn vừa nghe (chữ Hán)</label>
          <input type="text" id="ansListenWord" class="text-input" autocomplete="off">`;
      }
      speak(word[FIELD.WORD]);
    } else if (type === "listenExample") {
      els.quizPromptTag.textContent = "NGHE CÂU";
      els.quizPromptText.textContent = "🔊";
      els.quizPromptText.style.fontSize = (isTabletScreen() ? 64 : 48) + "px";
      els.quizSpeakBtn.classList.remove("hidden");
      if (handwrite) {
        els.submitAnswerBtn.classList.add("hidden");
        setupHandwritingAnswer(els.quizAnswers, word[FIELD.EXAMPLE], {
          onComplete: () => finalizeAnswer(word, true, ""),
          onSkip: () => finalizeAnswer(word, false, `Câu đúng: ${word[FIELD.EXAMPLE]} (${word[FIELD.EXAMPLE_PINYIN]}) — ${word[FIELD.EXAMPLE_MEANING]}`),
          onFallbackCanvas: (isSufficient) => {
            currentQuestion.needsSelfGrade = true;
            currentQuestion.checkHandwriteSufficient = isSufficient;
            els.submitAnswerBtn.textContent = "Xem đáp án";
            els.submitAnswerBtn.classList.remove("hidden");
          },
        });
      } else {
        els.quizAnswers.innerHTML = `
          <label for="ansListenExample">Gõ lại câu bạn vừa nghe (chữ Hán)</label>
          <input type="text" id="ansListenExample" class="text-input" autocomplete="off">`;
      }
      speak(word[FIELD.EXAMPLE]);
    }
    els.quizProgressLabel.textContent = `Còn lại: ${quizQueue.length} · Đúng: ${quizCorrectCount}/${quizTotalCount}`;
    const firstInput = els.quizAnswers.querySelector("input");
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
  }

  // Hiện đáp án đúng + 2 nút tự chấm, dùng cho các câu hỏi bật chế độ viết tay
  function revealSelfGrade() {
    const { word, type, checkHandwriteSufficient } = currentQuestion;

    if (checkHandwriteSufficient && !checkHandwriteSufficient()) {
      showToast("Hãy viết đủ nét hơn trước khi xem đáp án (xem số nét đã đếm dưới bảng vẽ).");
      return;
    }

    let answerText = "";
    let pendingMeaningOk = null;

    if (type === "meaningToWord" || type === "listenWord") {
      answerText = `${word[FIELD.WORD]} (${word[FIELD.PINYIN]}) — ${word[FIELD.MEANING]}`;
    } else if (type === "pinyinToBoth" || type === "hanVietToBoth") {
      const valMeaning = $("ansMeaning2") ? $("ansMeaning2").value : "";
      pendingMeaningOk = meaningMatches(valMeaning, word[FIELD.MEANING]);
      answerText = `${word[FIELD.WORD]} — ${word[FIELD.MEANING]}` +
        (pendingMeaningOk ? "" : " (phần nghĩa bạn gõ chưa đúng)");
    } else if (type === "listenExample") {
      answerText = `${word[FIELD.EXAMPLE]} (${word[FIELD.EXAMPLE_PINYIN]}) — ${word[FIELD.EXAMPLE_MEANING]}`;
    }

    currentQuestion.revealed = true;
    currentQuestion.pendingMeaningOk = pendingMeaningOk;
    els.selfGradeAnswer.textContent = answerText;
    fitText(els.selfGradeAnswer, answerText, 32);
    els.selfGradePanel.classList.remove("hidden");
    els.submitAnswerBtn.classList.add("hidden");
  }

  function finalizeSelfGrade(selfOk) {
    const { word, pendingMeaningOk } = currentQuestion;
    const overallCorrect = selfOk && (pendingMeaningOk === null || pendingMeaningOk === undefined ? true : pendingMeaningOk);
    const summary = els.selfGradeAnswer.textContent;
    els.selfGradePanel.classList.add("hidden");
    els.submitAnswerBtn.classList.remove("hidden");
    finalizeAnswer(word, overallCorrect, summary);
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
    } else if (type === "pinyinToBoth" || type === "hanVietToBoth") {
      const valMeaning = $("ansMeaning2") ? $("ansMeaning2").value : "";
      const mOk = meaningMatches(valMeaning, word[FIELD.MEANING]);
      let wOk;
      let wordNote = "";
      if (currentQuestion.hanziAutoMode) {
        wOk = !!currentQuestion.hanziAllCorrect;
        wordNote = wOk ? "" : " (bạn chưa viết xong/đúng chữ Hán)";
      } else {
        const valWord = $("ansWord2") ? $("ansWord2").value : "";
        wOk = wordMatches(valWord, word[FIELD.WORD]);
        wordNote = wOk ? "" : " (bạn gõ sai chữ Hán)";
      }
      correct = wOk && mOk;
      correctSummary = `Từ đúng: ${word[FIELD.WORD]} — Nghĩa đúng: ${word[FIELD.MEANING]}` +
        wordNote + (!mOk ? " (bạn gõ sai nghĩa)" : "");
    } else if (type === "listenWord") {
      const val = $("ansListenWord") ? $("ansListenWord").value : "";
      correct = wordMatches(val, word[FIELD.WORD]);
      correctSummary = `Từ đúng: ${word[FIELD.WORD]} (${word[FIELD.PINYIN]}) — ${word[FIELD.MEANING]}`;
    } else if (type === "listenExample") {
      const val = $("ansListenExample") ? $("ansListenExample").value : "";
      correct = wordMatches(val, word[FIELD.EXAMPLE]);
      correctSummary = `Câu đúng: ${word[FIELD.EXAMPLE]} (${word[FIELD.EXAMPLE_PINYIN]}) — ${word[FIELD.EXAMPLE_MEANING]}`;
    }

    await finalizeAnswer(word, correct, correctSummary);
  }

  // Phần đuôi dùng chung: cập nhật đếm số, ghi lên Sheet nếu đúng, xếp lại
  // hàng đợi nếu sai, và hiển thị phản hồi. Dùng cho cả 2 đường: gõ chữ (tự
  // động chấm) và viết tay (người dùng tự chấm).
  async function finalizeAnswer(word, correct, correctSummary) {
    quizTotalCount++;
    quizQueue.shift();

    if (correct) {
      quizCorrectCount++;
      els.feedbackVerdict.textContent = "✓ Chính xác!";
      els.feedbackVerdict.className = "feedback-verdict correct";
      els.feedbackCorrect.textContent = "";
      if (syncEnabled) {
        try {
          const res = await apiPost({ action: "incrementMastery", row: word._row });
          word[FIELD.MASTERY] = res.newValue;
        } catch (err) {
          if (err.authError) {
            showToast("Sai mật khẩu — điểm chỉ tính tạm trên máy, chưa ghi lên Sheet.");
          } else {
            showToast("Không đồng bộ được lên Sheet: " + err.message);
          }
        }
      }
    } else {
      quizQueue.push(word); // hỏi lại sau trong cùng phiên
      if (!missedWords.some((w) => w._row === word._row)) missedWords.push(word);
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
      if (!HARDCODED_API_URL) localStorage.setItem(CONFIG_KEY, API_URL);
      els.setupModal.classList.add("hidden");
      els.app.classList.remove("hidden");
    } else {
      els.setupError.textContent = "Không kết nối được. Kiểm tra lại URL và quyền truy cập (Anyone) khi Deploy.";
    }
  });

  if (HARDCODED_API_URL) {
    els.settingsBtn.classList.add("hidden"); // URL đã cố định, không còn gì để chỉnh qua đây nữa
  } else {
    els.settingsBtn.addEventListener("click", () => {
      els.apiUrlInput.classList.remove("hidden");
      els.apiUrlInput.value = API_URL;
      els.setupTitle.textContent = "Cài đặt kết nối";
      els.setupDesc.textContent = "Dán URL Apps Script Web App bạn đã deploy từ Sheet \"HSK\" vào đây. Xem hướng dẫn trong file backend-apps-script.gs.txt đi kèm.";
      els.setupError.textContent = "";
      els.setupModal.classList.remove("hidden");
    });
  }

  els.refreshBtn.addEventListener("click", () => loadData(true));

  els.levelFilter.addEventListener("change", () => {
    populateTopics();
    buildFlashcardDeck();
  });
  els.topicFilter.addEventListener("change", buildFlashcardDeck);
  els.pinyinToggle.addEventListener("change", buildFlashcardDeck);
  const HAN_VIET_TOGGLE_KEY = "hsk-app-hanviet-toggle";
  els.hanVietToggle.checked = localStorage.getItem(HAN_VIET_TOGGLE_KEY) === "1";
  els.hanVietToggle.addEventListener("change", () => {
    localStorage.setItem(HAN_VIET_TOGGLE_KEY, els.hanVietToggle.checked ? "1" : "0");
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
    showToast("Đã xáo trộn & đổi kiểu thẻ");
  });
  els.flashcard.addEventListener("click", () => {
    els.flashcard.classList.toggle("flipped");
  });
  els.speakFrontBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (deck.length === 0) return;
    const c = deck[cardIndex];
    speak(audioTextForField(c.word, c.front));
  });
  els.speakBackBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (deck.length === 0) return;
    const c = deck[cardIndex];
    speak(audioTextForField(c.word, c.back));
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
    const { word, type } = currentQuestion;
    if (type === "listenWord") speak(word[FIELD.WORD]);
    else if (type === "listenExample") speak(word[FIELD.EXAMPLE]);
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
    if (API_URL) {
      els.setupModal.classList.add("hidden");
      els.app.classList.remove("hidden");
      await loadData(false); // nếu sai/thiếu mật khẩu, loadData tự mở lại modal
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
