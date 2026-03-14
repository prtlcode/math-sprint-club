(function () {
  const STORAGE_KEY = "math-sprint-club-progress-v1";
  const LEGACY_STORAGE_KEY = "math-sprint-club-progress-v2";
  const VERSION_URL = "/version.json";
  const RESET_MARKER = "2026-03-14-reset-1";
  const FEEDBACK_MIN_MS = 2200;
  const state = {
    profile: loadProfile(),
    sessionProfile: null,
    currentProblem: null,
    timerValue: 12,
    timerId: null,
    pendingReload: false,
    gameStarted: false,
    paused: false,
    pauseReason: "",
    nextAction: "continue",
    recognition: null,
    recognitionBusy: false,
    voices: [],
    activeUtterance: null,
    levelPulseTimer: null,
    buddyMessages: [],
  };

  const elements = {
    levelLabel: document.getElementById("levelLabel"),
    streakLabel: document.getElementById("streakLabel"),
    bestLabel: document.getElementById("bestLabel"),
    modeLabel: document.getElementById("modeLabel"),
    timerLabel: document.getElementById("timerLabel"),
    timerToggle: document.getElementById("timerToggle"),
    timerModeLabel: document.getElementById("timerModeLabel"),
    languageLabel: document.getElementById("languageLabel"),
    promptText: document.getElementById("promptText"),
    visualZone: document.getElementById("visualZone"),
    answerInput: document.getElementById("answerInput"),
    submitButton: document.getElementById("submitButton"),
    micButton: document.getElementById("micButton"),
    feedbackText: document.getElementById("feedbackText"),
    startRow: document.getElementById("startRow"),
    startButton: document.getElementById("startButton"),
    pauseButton: document.getElementById("pauseButton"),
    pauseCard: document.getElementById("pauseCard"),
    pauseTitle: document.getElementById("pauseTitle"),
    pauseCopy: document.getElementById("pauseCopy"),
    pauseResumeButton: document.getElementById("pauseResumeButton"),
    tipsButton: document.getElementById("tipsButton"),
    tipsDrawer: document.getElementById("tipsDrawer"),
    repeatButton: document.getElementById("repeatButton"),
    skipButton: document.getElementById("skipButton"),
    xpFill: document.getElementById("xpFill"),
    xpLabel: document.getElementById("xpLabel"),
    coachText: document.getElementById("coachText"),
    focusFacts: document.getElementById("focusFacts"),
    updateText: document.getElementById("updateText"),
    groupTemplate: document.getElementById("groupTemplate"),
    buddyPanel: document.getElementById("buddyPanel"),
    buddyLog: document.getElementById("buddyLog"),
    buddyInput: document.getElementById("buddyInput"),
    buddySendButton: document.getElementById("buddySendButton"),
    buddyHintButton: document.getElementById("buddyHintButton"),
    buddyStatus: document.getElementById("buddyStatus"),
  };

  const speechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const synth = window.speechSynthesis || null;

  const coachVoices = {
    correct: {
      en: [
        "Quick thinking. Keep the streak alive.",
        "You snapped that answer into place.",
        "Nice speed. That fact is sticking.",
      ],
      ja: [
        "すばやいね。れんぞくせいかい！",
        "いいね。どんどんはやくなっているよ。",
        "そのちょうし。おぼえてきたね。",
      ],
    },
    incorrect: {
      en: [
        "Not yet. Pause and think it through.",
        "Almost. Let us reflect on this one.",
        "Good effort. Take a moment with the answer.",
      ],
      ja: [
        "まだだいじょうぶ。すこし とまって かんがえよう。",
        "おしいね。こたえを いっしょに みてみよう。",
        "よくがんばったね。ここで ひといき つこう。",
      ],
    },
    timeout: {
      en: [
        "Time is up. Pause, breathe, and get ready for the next one.",
        "The clock won that round. Take a moment, then continue.",
      ],
      ja: [
        "じかんぎれ。ひといき ついてから つぎに いこう。",
        "いまは とけいの かち。すこし やすんで つぎへ いこう。",
      ],
    },
  };

  function loadProfile() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (stored && typeof stored === "object") {
        return normalizeProfile(stored);
      }
      const legacyStored = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "null");
      if (legacyStored && typeof legacyStored === "object") {
        return normalizeProfile(legacyStored);
      }
    } catch (error) {
      console.warn("Failed to load profile", error);
    }
    return normalizeProfile({});
  }

  function normalizeProfile(raw) {
    const profile = {
      streak: Number(raw.streak || 0),
      bestStreak: Number(raw.bestStreak || 0),
      level: Number(raw.level || 1),
      totalCorrect: Number(raw.totalCorrect || 0),
      totalAnswered: Number(raw.totalAnswered || 0),
      xpInLevel: Number(raw.xpInLevel || 0),
      factStats: raw.factStats && typeof raw.factStats === "object" ? raw.factStats : {},
      seenProblemIds: Array.isArray(raw.seenProblemIds) ? raw.seenProblemIds.slice(-80) : [],
      lastVersion: raw.lastVersion || null,
      speechPref: raw.speechPref || "auto",
      testMode: Boolean(raw.testMode),
      resetMarker: raw.resetMarker || null,
    };
    if (profile.resetMarker !== RESET_MARKER) {
      profile.level = 0;
      profile.bestStreak = 0;
      profile.streak = 0;
      profile.xpInLevel = 0;
      profile.resetMarker = RESET_MARKER;
    }
    return profile;
  }

  function saveProfile() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profile));
  }

  function cloneFactStats(stats) {
    return JSON.parse(JSON.stringify(stats || {}));
  }

  function createSessionProfile() {
    return {
      streak: state.profile.streak,
      bestStreak: state.profile.bestStreak,
      level: state.profile.level,
      totalCorrect: state.profile.totalCorrect,
      totalAnswered: state.profile.totalAnswered,
      xpInLevel: state.profile.xpInLevel,
      factStats: cloneFactStats(state.profile.factStats),
    };
  }

  function getActiveProfile() {
    if (state.profile.testMode) {
      if (!state.sessionProfile) {
        state.sessionProfile = createSessionProfile();
      }
      return state.sessionProfile;
    }
    return state.profile;
  }

  function getLevelConfig(level) {
    const effectiveLevel = Math.max(0, Math.min(level, 12));
    return {
      maxFactor: Math.min(10 + Math.max(0, effectiveLevel - 2) * 2, 24),
      timer: Math.max(6, 12 - Math.floor(effectiveLevel / 2)),
      allowWord: true,
      allowVisual: true,
      allowMissing: effectiveLevel >= 2,
      allowDivision: effectiveLevel >= 1,
      allowWordNumberMix: true,
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
    const activeProfile = getActiveProfile();
    if (!activeProfile.factStats[key]) {
      activeProfile.factStats[key] = {
        correct: 0,
        wrong: 0,
        mastery: 0,
        lastSeen: 0,
      };
    }
    return activeProfile.factStats[key];
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
          const weight = Math.max(1, 7 - stat.mastery + stat.wrong * 2 + (Date.now() - stat.lastSeen > 45000 ? 1.5 : 0.3));
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
        const weight = Math.max(1, 7 - stat.mastery + stat.wrong * 2 + (Date.now() - stat.lastSeen > 45000 ? 1.5 : 0.3));
        facts.push({ value: { a: dividend, b: divisor, key }, weight });
      }
    }
    return weightedChoice(facts);
  }

  function chooseProblemType(config) {
    return weightedChoice([
      { value: "equation", weight: 3 },
      { value: "word", weight: 2.7 },
      { value: "visual", weight: 2.2 },
      { value: "missing", weight: config.allowMissing ? 1.8 : 0 },
    ].filter((item) => item.weight > 0));
  }

  function chooseOperator(config) {
    return weightedChoice([
      { value: "x", weight: 3.8 },
      { value: "÷", weight: config.allowDivision ? 2.2 : 0 },
    ].filter((item) => item.weight > 0));
  }

  function buildProblem() {
    const activeProfile = getActiveProfile();
    const config = getLevelConfig(activeProfile.level);
    const type = chooseProblemType(config);
    const operator = chooseOperator(config);
    const language = Math.random() < 0.55 ? "English" : "Japanese";
    let a;
    let b;
    let key;

    if (operator === "x") {
      ({ a, b, key } = pickOperands("x", config));
    } else {
      ({ a, b, key } = pickDivisionOperands(config));
    }

    const answer = operator === "x" ? a * b : a / b;
    const base = {
      id: `${type}-${operator}-${a}-${b}-${Date.now()}`,
      type,
      operator,
      a,
      b,
      key,
      answer,
      language,
      timer: config.timer,
    };

    if (type === "word") {
      return buildWordProblem(base);
    }
    if (type === "visual") {
      return buildVisualProblem(base);
    }
    if (type === "missing") {
      return buildMissingProblem(base);
    }
    return buildEquationProblem(base);
  }

  function buildEquationProblem(problem) {
    const equation = `${problem.a} ${problem.operator} ${problem.b} = ?`;
    return {
      ...problem,
      modeLabel: "Equation",
      promptHtml:
        problem.language === "English"
          ? `<span class="prompt-kicker">Read it</span>${equation}<br />What is the answer?`
          : `<span class="prompt-kicker">よんでみよう</span>${equation}<br />${rubyText("答", "こた")}えは いくつ？`,
      spokenText:
        problem.language === "English"
          ? `${sayEquation(problem)}. What is the answer?`
          : `${sayEquationJapanese(problem)}。こたえは いくつ？`,
      plainPrompt:
        problem.language === "English"
          ? `${equation} What is the answer?`
          : `${problem.a} ${problem.operator} ${problem.b}。こたえは いくつ？`,
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
          ? `<span class="prompt-kicker">Read it</span>${display}<br />Fill the missing number.`
          : `<span class="prompt-kicker">よんでみよう</span>${display}<br />${rubyText("空", "あ")}いている かずは？`,
      spokenText:
        problem.language === "English"
          ? `Fill the missing number. ${display.replace(/__/g, "blank")}.`
          : `あいている かずは なんですか。`,
      plainPrompt:
        problem.language === "English"
          ? `${display} Fill the missing number.`
          : `${display} あいている かずは？`,
      visual: null,
    };
  }

  function buildVisualProblem(problem) {
    const promptText = problem.language === "English"
      ? (problem.operator === "x"
          ? "Look at the picture. How many dots are there in all?"
          : "Look at the picture. How many dots are in each equal group?")
      : (problem.operator === "x"
          ? `${rubyText("絵", "え")}を みて、${rubyText("全", "ぜん")}${rubyText("部", "ぶ")}で いくつか こたえよう。`
          : `${rubyText("絵", "え")}を みて、1つぶんの かずを こたえよう。`);
    return {
      ...problem,
      modeLabel: "Visual",
      promptHtml:
        problem.language === "English"
          ? `<span class="prompt-kicker">Look and read</span>${promptText}`
          : `<span class="prompt-kicker">みて よんでみよう</span>${promptText}`,
      spokenText:
        problem.language === "English"
          ? (problem.operator === "x"
              ? `${problem.a} groups of ${problem.b}. How many dots in all?`
              : `${problem.a} dots split into ${problem.b} groups. How many are in each group?`)
          : (problem.operator === "x"
              ? `${problem.a}こ の グループに ${problem.b}こ ずつ。ぜんぶで いくつ？`
              : `${problem.a}この ドットを ${problem.b}つ に わけると 1つぶんは いくつ？`),
      plainPrompt: stripHtml(promptText),
      visual: {
        groups: problem.operator === "x" ? problem.a : problem.b,
        dotsPerGroup: problem.operator === "x" ? problem.b : problem.answer,
      },
    };
  }

  function buildWordProblem(problem) {
    const aDisplay = englishQuantity(problem.a);
    const bDisplay = englishQuantity(problem.b);
    const scenarios = problem.operator === "x"
      ? [
          {
            en: `${aDisplay} treasure chests each hold ${bDisplay} shiny coins. How many coins are there altogether?`,
            jaHtml: `${problem.a}${rubyText("個", "こ")}の ${rubyText("宝箱", "たからばこ")}に ${problem.b}${rubyText("枚", "まい")}ずつ ${rubyText("金貨", "きんか")}が はいっています。${rubyText("全", "ぜん")}${rubyText("部", "ぶ")}で ${rubyText("何", "なん")}${rubyText("枚", "まい")}？`,
            jaReading: `${problem.a}この たからばこに ${problem.b}まいずつ きんかが はいっています。ぜんぶで なんまい？`,
          },
          {
            en: `${aDisplay} dancers practice ${bDisplay} spins in every round. How many spins happen after all the rounds?`,
            jaHtml: `${problem.a}${rubyText("回", "かい")}の れんしゅうで、まいかい ${problem.b}${rubyText("回", "かい")}ずつ まわります。${rubyText("全", "ぜん")}${rubyText("部", "ぶ")}で ${rubyText("何", "なん")}${rubyText("回", "かい")}？`,
            jaReading: `${problem.a}かいの れんしゅうで、まいかい ${problem.b}かいずつ まわります。ぜんぶで なんかい？`,
          },
          {
            en: `${aDisplay} dragons guard ${bDisplay} glowing gems each. How many gems are being guarded in all?`,
            jaHtml: `${problem.a}${rubyText("匹", "ひき")}の ドラゴンが ${problem.b}${rubyText("個", "こ")}ずつ ${rubyText("光", "ひか")}る ${rubyText("宝石", "ほうせき")}を まもっています。${rubyText("全", "ぜん")}${rubyText("部", "ぶ")}で ${rubyText("何", "なん")}${rubyText("個", "こ")}？`,
            jaReading: `${problem.a}ひきの ドラゴンが ${problem.b}こずつ ひかる ほうせきを まもっています。ぜんぶで なんこ？`,
          },
        ]
      : [
          {
            en: `${englishQuantity(problem.a)} stickers are shared equally among ${bDisplay} teammates. How many stickers does each teammate get?`,
            jaHtml: `${problem.a}${rubyText("枚", "まい")}の シールを ${problem.b}${rubyText("人", "にん")}の ${rubyText("友達", "ともだち")}で ${rubyText("同", "おな")}じずつ ${rubyText("分", "わ")}けます。1${rubyText("人", "にん")}${rubyText("分", "ぶん")}は ${rubyText("何", "なん")}${rubyText("枚", "まい")}？`,
            jaReading: `${problem.a}まいの シールを ${problem.b}にんの ともだちで おなじずつ わけます。ひとりぶんは なんまい？`,
          },
          {
            en: `${englishQuantity(problem.a)} stars are arranged into ${bDisplay} equal constellations. How many stars are in each constellation?`,
            jaHtml: `${problem.a}${rubyText("個", "こ")}の ${rubyText("星", "ほし")}を ${problem.b}${rubyText("個", "こ")}の ${rubyText("同", "おな")}じ ${rubyText("星座", "せいざ")}に ${rubyText("分", "わ")}けます。1つの ${rubyText("星座", "せいざ")}は ${rubyText("何", "なん")}${rubyText("個", "こ")}？`,
            jaReading: `${problem.a}この ほしを ${problem.b}この おなじ せいざに わけます。ひとつの せいざは なんこ？`,
          },
          {
            en: `${englishQuantity(problem.a)} game points are split across ${bDisplay} players evenly. How many points does each player get?`,
            jaHtml: `${problem.a}${rubyText("点", "てん")}を ${problem.b}${rubyText("人", "にん")}の プレイヤーで ${rubyText("同", "おな")}じずつ ${rubyText("分", "わ")}けます。1${rubyText("人", "にん")}${rubyText("分", "ぶん")}は ${rubyText("何", "なん")}${rubyText("点", "てん")}？`,
            jaReading: `${problem.a}てんを ${problem.b}にんの プレイヤーで おなじずつ わけます。ひとりぶんは なんてん？`,
          },
        ];
    const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];
    return {
      ...problem,
      modeLabel: "Word Problem",
      promptHtml:
        problem.language === "English"
          ? `<span class="prompt-kicker">Read it</span>${scenario.en}`
          : `<span class="prompt-kicker">よんでみよう</span>${scenario.jaHtml}`,
      spokenText: problem.language === "English" ? scenario.en : scenario.jaReading,
      plainPrompt: problem.language === "English" ? scenario.en : scenario.jaReading,
      visual: null,
    };
  }

  function rubyText(kanji, reading) {
    return `<ruby>${kanji}<rt>${reading}</rt></ruby>`;
  }

  function englishQuantity(value) {
    if (value > 20) {
      return String(value);
    }
    const word = numberToEnglishWord(value);
    const roll = Math.random();
    if (roll < 0.34) {
      return String(value);
    }
    if (roll < 0.67) {
      return word;
    }
    return `${value} (${word})`;
  }

  function numberToEnglishWord(value) {
    const small = [
      "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
      "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
      "seventeen", "eighteen", "nineteen", "twenty",
    ];
    return small[value] || String(value);
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

  function stripHtml(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
  }

  function renderProblem(problem) {
    elements.modeLabel.textContent = problem.modeLabel;
    elements.languageLabel.textContent =
      problem.language === "English" ? "English question on screen and audio" : "日本語の問題を表示と音声で";
    elements.promptText.innerHTML = problem.promptHtml;
    elements.answerInput.value = "";
    renderVisual(problem.visual);
    clearFeedback();
    elements.answerInput.focus();
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
    stopSpeaking();
    state.gameStarted = true;
    state.paused = false;
    state.pauseReason = "";
    state.nextAction = "continue";
    elements.startRow.classList.add("hidden");
    hidePauseCard();
    stopTimer();
    const problem = buildProblem();
    state.currentProblem = problem;
    state.profile.seenProblemIds.push(problem.id);
    state.profile.seenProblemIds = state.profile.seenProblemIds.slice(-80);
    renderProblem(problem);
    state.timerValue = problem.timer;
    updateDashboard();
    startTimer();
    speak(problem.spokenText, detectSpeechLang(problem.spokenText));
  }

  function startTimer() {
    elements.timerLabel.textContent = String(state.timerValue);
    state.timerId = window.setInterval(() => {
      if (state.paused) {
        return;
      }
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

  function pauseCurrent(reason, copy, nextAction) {
    state.paused = true;
    state.pauseReason = reason;
    state.nextAction = nextAction || "resume-current";
    stopTimer();
    elements.pauseCard.classList.remove("hidden");
    elements.pauseTitle.textContent =
      reason === "wrong" ? "Pause and Reflect" :
      reason === "level-up" ? "Level Complete" :
      "Paused";
    elements.pauseCopy.textContent = copy;
    elements.pauseResumeButton.textContent =
      nextAction === "next-problem" ? "Next Problem" :
      nextAction === "resume-current" ? "Resume Timer" :
      "Continue";
    elements.buddyPanel.classList.add("highlight");
    elements.buddyStatus.textContent =
      "Buddy spotlight: ask for a hint, a step-by-step explanation, or a simpler version of the problem.";
    elements.answerInput.blur();
  }

  function hidePauseCard() {
    elements.pauseCard.classList.add("hidden");
    elements.buddyPanel.classList.remove("highlight");
    elements.buddyStatus.textContent =
      "Pause the game any time if you want the buddy to explain a problem.";
  }

  function resumeFromPause() {
    const action = state.nextAction;
    state.paused = false;
    state.pauseReason = "";
    hidePauseCard();
    if (action === "resume-current" && state.currentProblem) {
      startTimer();
      elements.answerInput.focus();
      return;
    }
    startRound();
  }

  function detectSpeechLang(text) {
    return /[ぁ-んァ-ン一-龯]/.test(text) ? "ja-JP" : "en-US";
  }

  function handleSubmit() {
    if (!state.currentProblem || state.paused) {
      return;
    }
    const answer = Number.parseInt(elements.answerInput.value.trim(), 10);
    if (Number.isNaN(answer)) {
      setFeedback("Enter or say a number. すうじで こたえてね。", "incorrect");
      return;
    }
    evaluateAnswer(answer, false);
  }

  async function evaluateAnswer(answer, timedOut) {
    const problem = state.currentProblem;
    if (!problem) {
      return;
    }
    stopTimer();
    const activeProfile = getActiveProfile();
    activeProfile.totalAnswered += 1;
    const stat = getFactStat(problem.key);
    stat.lastSeen = Date.now();

    let message;
    let shouldPauseAfter = false;
    let pauseCopy = "";
    let nextAction = "continue";

    if (answer === problem.answer && !timedOut) {
      stat.correct += 1;
      stat.mastery = Math.min(10, stat.mastery + 2);
      activeProfile.streak += 1;
      activeProfile.bestStreak = Math.max(activeProfile.bestStreak, activeProfile.streak);
      activeProfile.totalCorrect += 1;
      activeProfile.xpInLevel += 18;
      message = randomLine(coachVoices.correct);
      setFeedback(message, "correct");
      playTone(true);
    } else {
      stat.wrong += 1;
      stat.mastery = Math.max(0, stat.mastery - 3);
      activeProfile.streak = 0;
      activeProfile.xpInLevel = Math.max(0, activeProfile.xpInLevel - 4);
      message = timedOut
        ? `${randomLine(coachVoices.timeout)} Answer: ${problem.answer}`
        : `${randomLine(coachVoices.incorrect)} Answer: ${problem.answer}`;
      setFeedback(message, "incorrect");
      playTone(false);
      shouldPauseAfter = true;
      nextAction = "next-problem";
      pauseCopy = `Take a breath and look at the answer: ${problem.answer}. Ask the buddy if you want it explained in a simpler way.`;
    }

    const levelUpMessages = maybeLevelUp(activeProfile);
    if (levelUpMessages.length) {
      shouldPauseAfter = true;
      nextAction = "next-problem";
      pauseCopy = "You finished a level. Enjoy the pause, then continue when you are ready.";
    }

    if (!state.profile.testMode) {
      saveProfile();
    }
    updateDashboard();

    const speechQueue = [message, ...levelUpMessages];
    const speechStart = Date.now();
    for (const line of speechQueue) {
      await speak(line, detectSpeechLang(line));
    }
    const waited = Date.now() - speechStart;
    const remainder = Math.max(0, FEEDBACK_MIN_MS - waited);
    await wait(remainder);

    if (shouldPauseAfter) {
      pauseCurrent(levelUpMessages.length ? "level-up" : "wrong", pauseCopy, nextAction);
      return;
    }
    window.setTimeout(startRound, 300);
  }

  function maybeLevelUp(activeProfile) {
    const messages = [];
    let leveled = false;
    while (activeProfile.xpInLevel >= 100) {
      activeProfile.xpInLevel -= 100;
      activeProfile.level += 1;
      messages.push(`Level up! Welcome to level ${activeProfile.level}.`);
      leveled = true;
    }
    if (leveled) {
      const level = activeProfile.level;
      elements.coachText.textContent =
        state.profile.testMode
          ? `Test mode level ${level}. Real learner progress is unchanged.`
          : `Level ${level} unlocked. The colors and challenge both just got brighter.`;
      triggerLevelPulse(level);
    }
    return messages;
  }

  function triggerLevelPulse(level) {
    document.body.dataset.levelTone = String(levelToneIndex(level));
    document.body.classList.remove("level-up-pulse");
    void document.body.offsetWidth;
    document.body.classList.add("level-up-pulse");
    window.clearTimeout(state.levelPulseTimer);
    state.levelPulseTimer = window.setTimeout(() => {
      document.body.classList.remove("level-up-pulse");
    }, 1800);
  }

  function levelToneIndex(level) {
    return Math.max(0, level - 1) % 5;
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
    const activeProfile = getActiveProfile();
    elements.levelLabel.textContent = String(activeProfile.level);
    elements.streakLabel.textContent = String(activeProfile.streak);
    elements.bestLabel.textContent = String(activeProfile.bestStreak);
    const xpPercent = Math.max(0, Math.min(100, activeProfile.xpInLevel));
    elements.xpFill.style.width = `${xpPercent}%`;
    elements.xpLabel.textContent = `${xpPercent}%`;
    elements.coachText.textContent = buildCoachText(activeProfile);
    renderFocusFacts();
    document.body.dataset.levelTone = String(levelToneIndex(activeProfile.level));
    elements.timerToggle.classList.toggle("test-mode-active", state.profile.testMode);
    elements.timerModeLabel.textContent = state.profile.testMode ? "Test" : "Time";
  }

  function buildCoachText(activeProfile) {
    const accuracy = activeProfile.totalAnswered
      ? Math.round((activeProfile.totalCorrect / activeProfile.totalAnswered) * 100)
      : 0;
    if (state.profile.testMode) {
      return "Test mode is on. You can explore here without changing the learner's saved progress.";
    }
    if (activeProfile.streak >= 8) {
      return "Amazing pace. The next questions may stretch past the 10 times table.";
    }
    if (accuracy >= 80) {
      return "Strong accuracy. The game is gently speeding up and mixing in harder forms.";
    }
    return "Missed facts will return with new wording, visuals, and story twists until they feel easy.";
  }

  function renderFocusFacts() {
    elements.focusFacts.innerHTML = "";
    if (state.profile.testMode) {
      appendFactChip("Test mode");
      return;
    }
    const entries = Object.entries(state.profile.factStats)
      .sort((left, right) => (right[1].wrong - right[1].mastery) - (left[1].wrong - left[1].mastery))
      .slice(0, 6);
    if (!entries.length) {
      appendFactChip("New learner");
      return;
    }
    entries.forEach(([fact]) => appendFactChip(fact));
  }

  function appendFactChip(label) {
    const chip = document.createElement("div");
    chip.className = "fact-chip";
    chip.textContent = label;
    elements.focusFacts.appendChild(chip);
  }

  function randomLine(group) {
    const useJapanese = Math.random() < 0.4;
    const lines = useJapanese ? group.ja : group.en;
    return lines[Math.floor(Math.random() * lines.length)];
  }

  function playTone(isSuccess) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }
    const audio = new AudioContextClass();
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

  function loadVoices() {
    if (!synth) {
      state.voices = [];
      return;
    }
    state.voices = synth.getVoices();
  }

  function scoreVoice(voice, lang) {
    const name = `${voice.name} ${voice.lang}`.toLowerCase();
    let score = 0;
    if (lang === "ja-JP") {
      if (voice.lang.toLowerCase().startsWith("ja")) {
        score += 10;
      }
      ["kyoko", "otoya", "haruka", "sayaka", "nanami", "keita", "japanese"].forEach((token) => {
        if (name.includes(token)) {
          score += 4;
        }
      });
    } else if (voice.lang.toLowerCase().startsWith("en")) {
      score += 10;
    }
    if (voice.localService) {
      score += 1;
    }
    if (voice.default) {
      score += 1;
    }
    return score;
  }

  function getPreferredVoice(lang) {
    if (!state.voices.length) {
      return null;
    }
    const compatible = state.voices.filter((voice) =>
      voice.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())
    );
    const pool = compatible.length ? compatible : state.voices;
    return pool.slice().sort((a, b) => scoreVoice(b, lang) - scoreVoice(a, lang))[0] || null;
  }

  function stopSpeaking() {
    if (synth) {
      synth.cancel();
    }
    state.activeUtterance = null;
  }

  async function speak(text, lang) {
    if (!text) {
      return;
    }
    return speakWithBrowser(text, lang);
  }

  function speakWithBrowser(text, lang) {
    if (!synth) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = getPreferredVoice(lang);
      utterance.lang = lang;
      utterance.rate = lang === "ja-JP" ? 0.9 : 0.98;
      utterance.pitch = lang === "ja-JP" ? 1.03 : 1;
      utterance.onend = resolve;
      utterance.onerror = resolve;
      synth.cancel();
      state.activeUtterance = utterance;
      synth.speak(utterance);
    });
  }

  function setupRecognition() {
    if (!speechRecognition) {
      elements.micButton.disabled = true;
      elements.micButton.textContent = "Voice unavailable";
      return;
    }
    const recognition = new speechRecognition();
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
      zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
      sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
      ichi: 1, ni: 2, san: 3, yon: 4, go: 5, roku: 6, nana: 7, hachi: 8, kyuu: 9, juu: 10,
    };
    return map[cleaned] !== undefined ? map[cleaned] : null;
  }

  function addBuddyMessage(role, text) {
    state.buddyMessages.push({ role, text });
    state.buddyMessages = state.buddyMessages.slice(-16);
    renderBuddyMessages();
  }

  function renderBuddyMessages() {
    elements.buddyLog.innerHTML = "";
    if (!state.buddyMessages.length) {
      addBuddyMessage("buddy", "I can explain the current problem, give a hint, or make it simpler.");
      return;
    }
    state.buddyMessages.forEach((message) => {
      const item = document.createElement("div");
      item.className = `buddy-message ${message.role}`;
      item.textContent = message.text;
      elements.buddyLog.appendChild(item);
    });
    elements.buddyLog.scrollTop = elements.buddyLog.scrollHeight;
  }

  async function askBuddy(prompt) {
    const problem = state.currentProblem;
    if (!problem) {
      addBuddyMessage("buddy", "Start a round first, then I can help with that problem.");
      return;
    }
    addBuddyMessage("user", prompt);
    elements.buddyStatus.textContent = "Buddy is thinking...";
    addBuddyMessage("buddy", localBuddyReply(prompt, problem));
    elements.buddyStatus.textContent = "Buddy is ready.";
  }

  function localBuddyReply(prompt, problem) {
    const lower = prompt.toLowerCase();
    if (lower.includes("hint")) {
      return problem.operator === "x"
        ? "Hint: multiplication is equal groups. Count how many groups there are, then how many are in each group."
        : "Hint: division means sharing equally. Ask how many groups there are and how many must go in each one.";
    }
    if (lower.includes("answer")) {
      return `The answer is ${problem.answer}. Try to explain why that answer fits the story or picture.`;
    }
    return problem.operator === "x"
      ? "Try this: first find the number of groups, then the amount in each group, then put them together."
      : "Try this: think about how the total is being shared fairly. What number fits in each equal group?";
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
        state.profile.lastVersion = version.version;
        state.pendingReload = true;
        saveProfile();
        elements.updateText.textContent = "A new version is ready. It will refresh after the current round.";
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
    elements.startButton.addEventListener("click", startRound);
    elements.pauseButton.addEventListener("click", () => {
      if (!state.currentProblem || state.paused) {
        return;
      }
      pauseCurrent("manual", "Timer paused. Ask the buddy for help, then resume when you are ready.", "resume-current");
    });
    elements.pauseResumeButton.addEventListener("click", resumeFromPause);
    elements.tipsButton.addEventListener("click", () => {
      elements.tipsDrawer.classList.toggle("hidden");
    });
    elements.repeatButton.addEventListener("click", () => {
      if (state.currentProblem) {
        speak(state.currentProblem.spokenText, detectSpeechLang(state.currentProblem.spokenText));
      }
    });
    elements.skipButton.addEventListener("click", () => {
      if (!state.paused) {
        evaluateAnswer(Number.NaN, true);
      }
    });
    elements.timerToggle.addEventListener("click", () => {
      state.profile.testMode = !state.profile.testMode;
      state.sessionProfile = state.profile.testMode ? createSessionProfile() : null;
      saveProfile();
      updateDashboard();
      setFeedback(
        state.profile.testMode
          ? "Test mode on. Progress changes will not affect the learner's saved stats."
          : "Test mode off. Real progress tracking is active again.",
        "correct"
      );
    });
    elements.micButton.addEventListener("click", () => {
      if (!state.currentProblem || state.paused) {
        return;
      }
      if (!state.recognition || state.recognitionBusy) {
        return;
      }
      state.recognitionBusy = true;
      state.recognition.lang = state.currentProblem.language === "Japanese" ? "ja-JP" : "en-US";
      elements.micButton.textContent = "Listening...";
      state.recognition.start();
    });
    elements.buddySendButton.addEventListener("click", () => {
      const prompt = elements.buddyInput.value.trim();
      if (!prompt) {
        return;
      }
      elements.buddyInput.value = "";
      askBuddy(prompt);
    });
    elements.buddyInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        elements.buddySendButton.click();
      }
    });
    elements.buddyHintButton.addEventListener("click", () => {
      askBuddy("Give me a hint for this problem.");
    });
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function init() {
    loadVoices();
    if (synth) {
      synth.onvoiceschanged = loadVoices;
    }
    setupRecognition();
    bindEvents();
    updateDashboard();
    renderBuddyMessages();
    elements.languageLabel.textContent = "Press Start";
    elements.promptText.innerHTML =
      `<span class="prompt-kicker">Ready?</span>Press Start Round to begin.<br />Every question stays visible on screen, and the buddy can help if something feels confusing.`;
    elements.visualZone.innerHTML = "";
    elements.timerLabel.textContent = String(state.timerValue);
    elements.updateText.textContent =
      "The app checks for new versions in the background and uses the best free voices available on the device.";
    saveProfile();
    checkForUpdates();
    window.setInterval(checkForUpdates, 5 * 60 * 1000);
  }

  init();
})();
