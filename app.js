(function () {
  const STORAGE_KEY = "math-sprint-club-progress-v1";
  const VERSION_URL = "/version.json";
  const state = {
    profile: loadProfile(),
    currentProblem: null,
    timerValue: 12,
    timerId: null,
    xpInLevel: 0,
    recognition: null,
    recognitionBusy: false,
    pendingReload: false,
    gameStarted: false,
  };

  const elements = {
    levelLabel: document.getElementById("levelLabel"),
    streakLabel: document.getElementById("streakLabel"),
    bestLabel: document.getElementById("bestLabel"),
    modeLabel: document.getElementById("modeLabel"),
    timerLabel: document.getElementById("timerLabel"),
    languageLabel: document.getElementById("languageLabel"),
    promptText: document.getElementById("promptText"),
    visualZone: document.getElementById("visualZone"),
    answerInput: document.getElementById("answerInput"),
    submitButton: document.getElementById("submitButton"),
    micButton: document.getElementById("micButton"),
    feedbackText: document.getElementById("feedbackText"),
    repeatButton: document.getElementById("repeatButton"),
    skipButton: document.getElementById("skipButton"),
    startRow: document.getElementById("startRow"),
    startButton: document.getElementById("startButton"),
    xpFill: document.getElementById("xpFill"),
    xpLabel: document.getElementById("xpLabel"),
    coachText: document.getElementById("coachText"),
    focusFacts: document.getElementById("focusFacts"),
    updateText: document.getElementById("updateText"),
    groupTemplate: document.getElementById("groupTemplate"),
  };

  const speechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const synth = window.speechSynthesis || null;

  const coachVoices = {
    correct: {
      en: [
        "Quick thinking. Keep the streak alive.",
        "Nice job. You are getting faster.",
        "Yes. That fact is locking into memory.",
      ],
      ja: [
        "すばやいね。れんぞくせいかい！",
        "いいね。どんどんはやくなっているよ。",
        "そのちょうし。おぼえてきたね。",
      ],
    },
    incorrect: {
      en: [
        "Not yet. Let us try a close cousin soon.",
        "Almost. This one will come back for practice.",
        "Good effort. We will repeat it in a new way.",
      ],
      ja: [
        "まだだいじょうぶ。すこしかえてまたでるよ。",
        "おしいね。このもんだいはもういちどれんしゅうしよう。",
        "よくがんばったね。ちがうかたちでまたやろう。",
      ],
    },
    timeout: {
      en: [
        "Time is up. Breathe, then race the next one.",
        "The clock won that round. You can restart the streak.",
      ],
      ja: [
        "じかんぎれ。つぎでまたチャレンジしよう。",
        "いまはとけいのかち。つぎでれんぞくせいかいをもどそう。",
      ],
    },
  };

  function loadProfile() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (stored && typeof stored === "object") {
        return normalizeProfile(stored);
      }
    } catch (error) {
      console.warn("Failed to load profile", error);
    }
    return normalizeProfile({});
  }

  function normalizeProfile(raw) {
    return {
      streak: Number(raw.streak || 0),
      bestStreak: Number(raw.bestStreak || 0),
      level: Number(raw.level || 1),
      totalCorrect: Number(raw.totalCorrect || 0),
      totalAnswered: Number(raw.totalAnswered || 0),
      xpInLevel: Number(raw.xpInLevel || 0),
      factStats: raw.factStats && typeof raw.factStats === "object" ? raw.factStats : {},
      seenProblemIds: Array.isArray(raw.seenProblemIds) ? raw.seenProblemIds.slice(-80) : [],
      lastVersion: raw.lastVersion || null,
    };
  }

  function saveProfile() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profile));
  }

  function getLevelConfig(level) {
    const capped = Math.min(level, 8);
    return {
      maxFactor: Math.min(12 + Math.max(0, capped - 3) * 2, 20),
      timer: Math.max(6, 12 - Math.floor((capped - 1) / 2)),
      allowWord: capped >= 1,
      allowVisual: capped >= 1,
      allowMissing: capped >= 2,
      allowDivision: capped >= 2,
    };
  }

  function getFactKey(operator, a, b) {
    if (operator === "x") {
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      return `${min}x${max}`;
    }
    return `${a}÷${b}`;
  }

  function getFactStat(key) {
    if (!state.profile.factStats[key]) {
      state.profile.factStats[key] = {
        correct: 0,
        wrong: 0,
        mastery: 0,
        lastSeen: 0,
      };
    }
    return state.profile.factStats[key];
  }

  function weightedChoice(items) {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    for (const item of items) {
      roll -= item.weight;
      if (roll <= 0) {
        return item.value;
      }
    }
    return items[items.length - 1].value;
  }

  function pickOperands(operator, config) {
    const facts = [];
    for (let a = 2; a <= config.maxFactor; a += 1) {
      for (let b = 2; b <= config.maxFactor; b += 1) {
        if (operator === "x" || a % b === 0) {
          const key = getFactKey(operator, a, b);
          const stat = getFactStat(key);
          const wrongPressure = stat.wrong * 2.2;
          const notMastered = 7 - stat.mastery;
          const freshness = Date.now() - stat.lastSeen > 45000 ? 1.5 : 0.3;
          const weight = Math.max(0.8, wrongPressure + notMastered + freshness);
          facts.push({ value: { a, b, key }, weight });
        }
      }
    }
    return weightedChoice(facts);
  }

  function pickDivisionOperands(config) {
    const facts = [];
    for (let divisor = 2; divisor <= config.maxFactor; divisor += 1) {
      for (let quotient = 2; quotient <= config.maxFactor; quotient += 1) {
        const dividend = divisor * quotient;
        const key = getFactKey("÷", dividend, divisor);
        const stat = getFactStat(key);
        const wrongPressure = stat.wrong * 2.2;
        const notMastered = 7 - stat.mastery;
        const freshness = Date.now() - stat.lastSeen > 45000 ? 1.5 : 0.3;
        const weight = Math.max(0.8, wrongPressure + notMastered + freshness);
        facts.push({ value: { a: dividend, b: divisor, key }, weight });
      }
    }
    return weightedChoice(facts);
  }

  function chooseProblemType(config) {
    const pool = [
      { value: "equation", weight: 3 },
      { value: "word", weight: config.allowWord ? 2.3 : 0 },
      { value: "visual", weight: config.allowVisual ? 2 : 0 },
      { value: "missing", weight: config.allowMissing ? 1.8 : 0 },
    ].filter((item) => item.weight > 0);
    return weightedChoice(pool);
  }

  function chooseOperator(config) {
    return weightedChoice([
      { value: "x", weight: 3.8 },
      { value: "÷", weight: config.allowDivision ? 2.2 : 0 },
    ].filter((item) => item.weight > 0));
  }

  function buildProblem() {
    const config = getLevelConfig(state.profile.level);
    const type = chooseProblemType(config);
    const operator = chooseOperator(config);
    const language = Math.random() < 0.5 ? "English" : "Japanese";
    let a;
    let b;
    let key;

    if (operator === "x") {
      ({ a, b, key } = pickOperands("x", config));
    } else {
      ({ a, b, key } = pickDivisionOperands(config));
    }

    const answer = operator === "x" ? a * b : a / b;
    const factStat = getFactStat(key);

    const baseProblem = {
      id: `${type}-${operator}-${a}-${b}-${Date.now()}`,
      type,
      operator,
      a,
      b,
      key,
      answer,
      language,
      timer: config.timer,
      factStat,
    };

    if (type === "word") {
      return buildWordProblem(baseProblem);
    }
    if (type === "visual") {
      return buildVisualProblem(baseProblem);
    }
    if (type === "missing") {
      return buildMissingProblem(baseProblem);
    }
    return buildEquationProblem(baseProblem);
  }

  function buildEquationProblem(problem) {
    const equation = `${problem.a} ${problem.operator} ${problem.b} = ?`;
    return {
      ...problem,
      modeLabel: "Equation",
      promptHtml:
        problem.language === "English"
          ? `${equation}<br />What is the answer?`
          : `${equation}<br />${rubyText("答", "こた")}えは いくつ？`,
      spokenText:
        problem.language === "English"
          ? `${sayEquation(problem)}. What is the answer?`
          : `${sayEquationJapanese(problem)}。こたえは いくつ？`,
      visual: null,
    };
  }

  function buildMissingProblem(problem) {
    const hideLeft = Math.random() < 0.5;
    const display = problem.operator === "x"
      ? `${hideLeft ? "__" : problem.a} x ${hideLeft ? problem.b : "__"} = ${problem.answer}`
      : `${hideLeft ? "__" : problem.a} ÷ ${hideLeft ? problem.b : "__"} = ${problem.answer}`;
    const missingValue = hideLeft ? problem.a : problem.b;
    return {
      ...problem,
      answer: missingValue,
      modeLabel: "Missing Number",
      promptHtml:
        problem.language === "English"
          ? `${display}<br />Fill the missing number.`
          : `${display}<br />${rubyText("空", "あ")}いている かずは？`,
      spokenText:
        problem.language === "English"
          ? `Fill the missing number. ${display.replace(/__/g, "blank")}.`
          : `あいている かずは なんですか。${display.replace(/__/g, "blank")}。`,
      visual: null,
    };
  }

  function buildVisualProblem(problem) {
    return {
      ...problem,
      modeLabel: "Visual",
      promptHtml:
        problem.language === "English"
          ? (problem.operator === "x"
              ? "Count the groups. How many dots in all?"
              : "The dots are shared equally. How many in each group?")
          : (problem.operator === "x"
              ? `${rubyText("全", "ぜん")}${rubyText("部", "ぶ")}で いくつ？`
              : `1つぶんは いくつ？`),
      spokenText:
        problem.language === "English"
          ? (problem.operator === "x"
              ? `${problem.a} groups of ${problem.b}. How many dots in all?`
              : `${problem.a} dots split into ${problem.b} groups. How many in each group?`)
          : (problem.operator === "x"
              ? `${problem.a}こ の グループに ${problem.b}こ ずつ。ぜんぶで いくつ？`
              : `${problem.a}この ドットを ${problem.b}つ に わけると 1つぶんは いくつ？`),
      visual: {
        groups: problem.operator === "x" ? problem.a : problem.b,
        dotsPerGroup: problem.operator === "x" ? problem.b : problem.answer,
      },
    };
  }

  function buildWordProblem(problem) {
    const scenarios = problem.operator === "x"
      ? [
          {
            en: `${problem.a} baskets have ${problem.b} apples each. How many apples are there?`,
            jaHtml:
              `${problem.a}${rubyText("個", "こ")}の かごに ${problem.b}${rubyText("個", "こ")}ずつ りんごが あります。` +
              `${rubyText("全", "ぜん")}${rubyText("部", "ぶ")}で ${rubyText("何", "なん")}${rubyText("個", "こ")}？`,
            jaReading: `${problem.a}この かごに ${problem.b}こずつ りんごが あります。ぜんぶで なんこ？`,
          },
          {
            en: `${problem.a} robots collect ${problem.b} stars each. How many stars altogether?`,
            jaHtml:
              `${problem.a}${rubyText("台", "だい")}の ロボットが それぞれ ${problem.b}${rubyText("個", "こ")}ずつ ` +
              `${rubyText("星", "ほし")}を ${rubyText("集", "あつ")}めます。` +
              `${rubyText("全", "ぜん")}${rubyText("部", "ぶ")}で ${rubyText("何", "なん")}${rubyText("個", "こ")}？`,
            jaReading: `${problem.a}だいの ロボットが それぞれ ${problem.b}こずつ ほしを あつめます。ぜんぶで なんこ？`,
          },
        ]
      : [
          {
            en: `${problem.a} cookies are shared with ${problem.b} friends equally. How many cookies does each friend get?`,
            jaHtml:
              `${problem.a}${rubyText("個", "こ")}の クッキーを ${problem.b}${rubyText("人", "にん")}で ` +
              `${rubyText("同", "おな")}じずつ ${rubyText("分", "わ")}けます。1${rubyText("人", "にん")}${rubyText("分", "ぶん")}は ` +
              `${rubyText("何", "なん")}${rubyText("個", "こ")}？`,
            jaReading: `${problem.a}この クッキーを ${problem.b}にんで おなじずつ わけます。ひとりぶんは なんこ？`,
          },
          {
            en: `${problem.a} stickers are packed into ${problem.b} equal bags. How many stickers go in each bag?`,
            jaHtml:
              `${problem.a}${rubyText("枚", "まい")}の シールを ${problem.b}${rubyText("個", "こ")}の ` +
              `${rubyText("袋", "ふくろ")}に ${rubyText("同", "おな")}じずつ ${rubyText("入", "い")}れます。` +
              `1${rubyText("個", "こ")}の ${rubyText("袋", "ふくろ")}には ${rubyText("何", "なん")}${rubyText("枚", "まい")}？`,
            jaReading: `${problem.a}まいの シールを ${problem.b}この ふくろに おなじずつ いれます。1この ふくろには なんまい？`,
          },
        ];
    const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];
    return {
      ...problem,
      modeLabel: "Word Problem",
      promptHtml: problem.language === "English" ? scenario.en : scenario.jaHtml,
      spokenText: problem.language === "English" ? scenario.en : scenario.jaReading,
      visual: null,
    };
  }

  function rubyText(kanji, reading) {
    return `<ruby>${kanji}<rt>${reading}</rt></ruby>`;
  }

  function sayEquation(problem) {
    return problem.operator === "x"
      ? `${problem.a} times ${problem.b}`
      : `${problem.a} divided by ${problem.b}`;
  }

  function sayEquationJapanese(problem) {
    return problem.operator === "x"
      ? `${problem.a} かける ${problem.b}`
      : `${problem.a} わる ${problem.b}`;
  }

  function renderProblem(problem) {
    elements.modeLabel.textContent = problem.modeLabel;
    elements.languageLabel.textContent = problem.language;
    elements.promptText.innerHTML = problem.promptHtml;
    elements.answerInput.value = "";
    elements.answerInput.focus();
    renderVisual(problem.visual);
    clearFeedback();
  }

  function renderVisual(visual) {
    elements.visualZone.innerHTML = "";
    if (!visual) {
      return;
    }
    for (let groupIndex = 0; groupIndex < visual.groups; groupIndex += 1) {
      const node = elements.groupTemplate.content.firstElementChild.cloneNode(true);
      const dots = node.querySelector(".group-dots");
      const label = node.querySelector(".group-label");
      for (let dotIndex = 0; dotIndex < visual.dotsPerGroup; dotIndex += 1) {
        const dot = document.createElement("div");
        dot.className = "dot";
        dots.appendChild(dot);
      }
      label.textContent = `Group ${groupIndex + 1}`;
      elements.visualZone.appendChild(node);
    }
  }

  function startRound() {
    if (state.pendingReload) {
      window.location.reload();
      return;
    }
    state.gameStarted = true;
    elements.startRow.classList.add("hidden");
    stopTimer();
    const problem = buildProblem();
    state.currentProblem = problem;
    state.profile.seenProblemIds.push(problem.id);
    state.profile.seenProblemIds = state.profile.seenProblemIds.slice(-80);
    state.timerValue = problem.timer;
    renderProblem(problem);
    updateDashboard();
    startTimer();
    speak(problem.spokenText, pickLanguage(problem.spokenText));
  }

  function pickLanguage(text) {
    return /[ぁ-んァ-ン一-龯]/.test(text) ? "ja-JP" : "en-US";
  }

  function startTimer() {
    elements.timerLabel.textContent = String(state.timerValue);
    state.timerId = window.setInterval(() => {
      state.timerValue -= 1;
      elements.timerLabel.textContent = String(Math.max(0, state.timerValue));
      if (state.timerValue <= 0) {
        handleTimeout();
      }
    }, 1000);
  }

  function stopTimer() {
    if (state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function handleSubmit() {
    if (!state.currentProblem) {
      return;
    }
    const raw = elements.answerInput.value.trim();
    const answer = Number.parseInt(raw, 10);
    if (Number.isNaN(answer)) {
      setFeedback("Enter or say a number. すうじで こたえてね。", "incorrect");
      return;
    }
    evaluateAnswer(answer, false);
  }

  function evaluateAnswer(answer, timedOut) {
    const problem = state.currentProblem;
    if (!problem) {
      return;
    }
    stopTimer();
    state.profile.totalAnswered += 1;
    const stat = getFactStat(problem.key);
    stat.lastSeen = Date.now();

    if (answer === problem.answer && !timedOut) {
      stat.correct += 1;
      stat.mastery = Math.min(10, stat.mastery + 2);
      state.profile.streak += 1;
      state.profile.bestStreak = Math.max(state.profile.bestStreak, state.profile.streak);
      state.profile.totalCorrect += 1;
      state.profile.xpInLevel += 18;
      state.xpInLevel = state.profile.xpInLevel;
      const message = randomLine(coachVoices.correct);
      setFeedback(message, "correct");
      playTone(true);
      speak(message, pickLanguage(message));
    } else {
      stat.wrong += 1;
      stat.mastery = Math.max(0, stat.mastery - 3);
      state.profile.streak = 0;
      state.profile.xpInLevel = Math.max(0, state.profile.xpInLevel - 4);
      state.xpInLevel = state.profile.xpInLevel;
      const message = timedOut
        ? `${randomLine(coachVoices.timeout)} Answer: ${problem.answer}`
        : `${randomLine(coachVoices.incorrect)} Answer: ${problem.answer}`;
      setFeedback(message, "incorrect");
      playTone(false);
      speak(message, pickLanguage(message));
    }

    maybeLevelUp();
    saveProfile();
    updateDashboard();
    window.setTimeout(startRound, 1800);
  }

  function maybeLevelUp() {
    while (state.profile.xpInLevel >= 100) {
      state.profile.xpInLevel -= 100;
      state.profile.level += 1;
      const message = `Level up! Now on level ${state.profile.level}.`;
      elements.coachText.textContent =
        `You unlocked bigger numbers and faster rounds. Level ${state.profile.level} is ready.`;
      speak(message, "en-US");
    }
  }

  function handleTimeout() {
    evaluateAnswer(Number.NaN, true);
  }

  function setFeedback(message, type) {
    elements.feedbackText.textContent = message;
    elements.feedbackText.className = `feedback ${type}`;
  }

  function clearFeedback() {
    elements.feedbackText.textContent = "";
    elements.feedbackText.className = "feedback";
  }

  function updateDashboard() {
    elements.levelLabel.textContent = String(state.profile.level);
    elements.streakLabel.textContent = String(state.profile.streak);
    elements.bestLabel.textContent = String(state.profile.bestStreak);
    const xpPercent = Math.max(0, Math.min(100, state.profile.xpInLevel));
    elements.xpFill.style.width = `${xpPercent}%`;
    elements.xpLabel.textContent = `${xpPercent}%`;
    elements.coachText.textContent = buildCoachText();
    renderFocusFacts();
  }

  function buildCoachText() {
    const accuracy = state.profile.totalAnswered
      ? Math.round((state.profile.totalCorrect / state.profile.totalAnswered) * 100)
      : 0;
    if (state.profile.streak >= 8) {
      return "Amazing pace. The next questions may stretch past the 10 times table.";
    }
    if (accuracy >= 80) {
      return "Strong accuracy. The game is gently speeding up and mixing in harder forms.";
    }
    return "Missed facts will return with new wording and visuals until they feel easy.";
  }

  function renderFocusFacts() {
    const entries = Object.entries(state.profile.factStats)
      .sort((left, right) => {
        const a = left[1];
        const b = right[1];
        return (b.wrong - b.mastery) - (a.wrong - a.mastery);
      })
      .slice(0, 6);
    elements.focusFacts.innerHTML = "";
    if (!entries.length) {
      const chip = document.createElement("div");
      chip.className = "fact-chip";
      chip.textContent = "New learner";
      elements.focusFacts.appendChild(chip);
      return;
    }
    entries.forEach(([fact]) => {
      const chip = document.createElement("div");
      chip.className = "fact-chip";
      chip.textContent = fact;
      elements.focusFacts.appendChild(chip);
    });
  }

  function randomLine(group) {
    const useJapanese = Math.random() < 0.4;
    const lines = useJapanese ? group.ja : group.en;
    return lines[Math.floor(Math.random() * lines.length)];
  }

  function playTone(isSuccess) {
    const context = window.AudioContext || window.webkitAudioContext;
    if (!context) {
      return;
    }
    const audio = new context();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = isSuccess ? 660 : 220;
    gain.gain.value = 0.001;
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    oscillator.frequency.exponentialRampToValueAtTime(isSuccess ? 880 : 140, audio.currentTime + 0.28);
    oscillator.stop(audio.currentTime + 0.36);
  }

  function speak(text, lang) {
    if (!synth) {
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1;
    synth.cancel();
    synth.speak(utterance);
  }

  function setupRecognition() {
    if (!speechRecognition) {
      elements.micButton.disabled = true;
      elements.micButton.textContent = "Voice unavailable";
      return;
    }
    const recognition = new speechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;
    recognition.onresult = (event) => {
      state.recognitionBusy = false;
      const options = Array.from(event.results[0]).map((item) => item.transcript);
      const match = options.map(parseSpokenNumber).find((value) => value !== null);
      if (match === null) {
        setFeedback("I heard words but not a number. Try again.", "incorrect");
        return;
      }
      elements.answerInput.value = String(match);
      evaluateAnswer(match, false);
    };
    recognition.onend = () => {
      state.recognitionBusy = false;
      elements.micButton.textContent = "Speak";
    };
    recognition.onerror = () => {
      state.recognitionBusy = false;
      elements.micButton.textContent = "Speak";
      setFeedback("Voice input needs another try. Typing also works.", "incorrect");
    };
    state.recognition = recognition;
  }

  function parseSpokenNumber(text) {
    const cleaned = text.trim().toLowerCase();
    const direct = Number.parseInt(cleaned, 10);
    if (!Number.isNaN(direct)) {
      return direct;
    }
    const map = {
      zero: 0,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
      thirteen: 13,
      fourteen: 14,
      fifteen: 15,
      sixteen: 16,
      seventeen: 17,
      eighteen: 18,
      nineteen: 19,
      twenty: 20,
      ichi: 1,
      ni: 2,
      san: 3,
      yon: 4,
      go: 5,
      roku: 6,
      nana: 7,
      hachi: 8,
      kyuu: 9,
      juu: 10,
      hitotsu: 1,
      futatsu: 2,
      mittsu: 3,
      yottsu: 4,
      itsutsu: 5,
      nijuu: 20,
      sanjuu: 30,
      yonjuu: 40,
      gojuu: 50,
      rokujuu: 60,
      nanajuu: 70,
      hachijuu: 80,
      kyuujuu: 90,
    };
    if (map[cleaned] !== undefined) {
      return map[cleaned];
    }
    const englishParts = cleaned
      .replace(/-/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const englishSmall = {
      zero: 0,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
      thirteen: 13,
      fourteen: 14,
      fifteen: 15,
      sixteen: 16,
      seventeen: 17,
      eighteen: 18,
      nineteen: 19,
    };
    const englishTens = {
      twenty: 20,
      thirty: 30,
      forty: 40,
      fifty: 50,
      sixty: 60,
      seventy: 70,
      eighty: 80,
      ninety: 90,
      hundred: 100,
    };
    let englishTotal = 0;
    let englishCurrent = 0;
    let matchedEnglish = false;
    for (const part of englishParts) {
      if (englishSmall[part] !== undefined) {
        englishCurrent += englishSmall[part];
        matchedEnglish = true;
      } else if (englishTens[part] && englishTens[part] < 100) {
        englishCurrent += englishTens[part];
        matchedEnglish = true;
      } else if (part === "hundred") {
        englishCurrent = Math.max(1, englishCurrent) * 100;
        matchedEnglish = true;
      } else if (part !== "and") {
        matchedEnglish = false;
        break;
      }
    }
    if (matchedEnglish) {
      englishTotal += englishCurrent;
      return englishTotal;
    }

    const compactRomaji = cleaned.replace(/\s+/g, "");
    const romajiTens = {
      juu: 10,
      nijuu: 20,
      sanjuu: 30,
      yonjuu: 40,
      gojuu: 50,
      rokujuu: 60,
      nanajuu: 70,
      hachijuu: 80,
      kyuujuu: 90,
      hyaku: 100,
      nihyaku: 200,
      sanbyaku: 300,
      yonhyaku: 400,
    };
    const romajiOnes = {
      ichi: 1,
      ni: 2,
      san: 3,
      yon: 4,
      go: 5,
      roku: 6,
      nana: 7,
      hachi: 8,
      kyuu: 9,
    };
    for (const [tensWord, tensValue] of Object.entries(romajiTens)) {
      if (compactRomaji === tensWord) {
        return tensValue;
      }
      if (compactRomaji.startsWith(tensWord) && romajiOnes[compactRomaji.slice(tensWord.length)] !== undefined) {
        return tensValue + romajiOnes[compactRomaji.slice(tensWord.length)];
      }
    }

    const japaneseDigits = cleaned
      .replace(/いち/g, "1")
      .replace(/に/g, "2")
      .replace(/さん/g, "3")
      .replace(/よん|し/g, "4")
      .replace(/ご/g, "5")
      .replace(/ろく/g, "6")
      .replace(/なな|しち/g, "7")
      .replace(/はち/g, "8")
      .replace(/きゅう|く/g, "9")
      .replace(/じゅう/g, "10")
      .replace(/ひゃく/g, "100");
    const parsedJapanese = Number.parseInt(japaneseDigits, 10);
    return Number.isNaN(parsedJapanese) ? null : parsedJapanese;
  }

  async function checkForUpdates() {
    try {
      const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const version = await response.json();
      if (!state.profile.lastVersion) {
        state.profile.lastVersion = version.version;
        saveProfile();
        return;
      }
      if (version.version !== state.profile.lastVersion) {
        elements.updateText.textContent =
          "A new version is ready. The app will refresh after this round.";
        state.profile.lastVersion = version.version;
        state.pendingReload = true;
        saveProfile();
      }
    } catch (error) {
      console.warn("Update check failed", error);
    }
  }

  function bindEvents() {
    elements.submitButton.addEventListener("click", handleSubmit);
    elements.answerInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        handleSubmit();
      }
    });
    elements.repeatButton.addEventListener("click", () => {
      if (state.currentProblem) {
        speak(state.currentProblem.spokenText, pickLanguage(state.currentProblem.spokenText));
      }
    });
    elements.skipButton.addEventListener("click", () => {
      evaluateAnswer(Number.NaN, true);
    });
    elements.startButton.addEventListener("click", () => {
      startRound();
    });
    elements.micButton.addEventListener("click", () => {
      if (!state.gameStarted) {
        setFeedback("Press Start Round first.", "incorrect");
        return;
      }
      if (!state.recognition || state.recognitionBusy) {
        return;
      }
      state.recognitionBusy = true;
      state.recognition.lang = Math.random() < 0.5 ? "en-US" : "ja-JP";
      elements.micButton.textContent = "Listening...";
      state.recognition.start();
    });
  }

  function init() {
    setupRecognition();
    bindEvents();
    updateDashboard();
    elements.languageLabel.textContent = "Press Start";
    elements.promptText.innerHTML = "Press Start Round to begin.";
    elements.visualZone.innerHTML = "";
    elements.timerLabel.textContent = String(state.timerValue);
    checkForUpdates();
    window.setInterval(checkForUpdates, 5 * 60 * 1000);
  }

  init();
})();
