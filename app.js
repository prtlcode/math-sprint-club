(function () {
  const STORAGE_KEY = "math-sprint-club-progress-v1";
  const LEGACY_STORAGE_KEY = "math-sprint-club-progress-v2";
  const VERSION_URL = "/version.json";
  const FEEDBACK_MIN_MS = 2200;
  const state = {
    profile: loadProfile(),
    currentProblem: null,
    timerValue: 12,
    timerId: null,
    recognition: null,
    recognitionBusy: false,
    pendingReload: false,
    gameStarted: false,
    voices: [],
    activeUtterance: null,
    levelPulseTimer: null,
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
        "Not yet. We will bring back a close cousin soon.",
        "Almost. This family of facts will get another turn.",
        "Good effort. We will remix this one in a new way.",
      ],
      ja: [
        "まだだいじょうぶ。すこしかえてまたでるよ。",
        "おしいね。このもんだいはもういちどれんしゅうしよう。",
        "よくがんばったね。ちがうかたちでまたやろう。",
      ],
    },
    timeout: {
      en: [
        "Time is up. Breathe, then sprint again.",
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
      speechPref: raw.speechPref || "auto",
    };
  }

  function saveProfile() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profile));
  }

  function getLevelConfig(level) {
    const capped = Math.min(level, 12);
    return {
      maxFactor: Math.min(12 + Math.max(0, capped - 3) * 2, 24),
      timer: Math.max(6, 12 - Math.floor((capped - 1) / 2)),
      allowWord: true,
      allowVisual: true,
      allowMissing: capped >= 2,
      allowDivision: capped >= 2,
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
      { value: "word", weight: config.allowWord ? 2.6 : 0 },
      { value: "visual", weight: config.allowVisual ? 2.2 : 0 },
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
    };

    if (type === "word") {
      return buildWordProblem(baseProblem, config);
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
          ? `<span class="prompt-kicker">Read it</span>${equation}<br />What is the answer?`
          : `<span class="prompt-kicker">よんでみよう</span>${equation}<br />${rubyText("答", "こた")}えは いくつ？`,
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
          ? `<span class="prompt-kicker">Read it</span>${display}<br />Fill the missing number.`
          : `<span class="prompt-kicker">よんでみよう</span>${display}<br />${rubyText("空", "あ")}いている かずは？`,
      spokenText:
        problem.language === "English"
          ? `Fill the missing number. ${display.replace(/__/g, "blank")}.`
          : `あいている かずは なんですか。${display.replace(/__/g, "blank")}。`,
      visual: null,
    };
  }

  function buildVisualProblem(problem) {
    const textPrompt = problem.language === "English"
      ? (problem.operator === "x"
          ? `Count the groups in the picture. How many dots in all?`
          : `The picture shows equal groups. How many dots are in each group?`)
      : (problem.operator === "x"
          ? `${rubyText("絵", "え")}を みて、${rubyText("全", "ぜん")}${rubyText("部", "ぶ")}で いくつか こたえよう。`
          : `${rubyText("絵", "え")}を みて、1つぶんの かずを こたえよう。`);
    return {
      ...problem,
      modeLabel: "Visual",
      promptHtml:
        problem.language === "English"
          ? `<span class="prompt-kicker">Look and read</span>${textPrompt}`
          : `<span class="prompt-kicker">みて よんでみよう</span>${textPrompt}`,
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

  function buildWordProblem(problem, config) {
    const quantityA = englishQuantity(problem.a, config.allowWordNumberMix);
    const quantityB = englishQuantity(problem.b, config.allowWordNumberMix);
    const scenarios = problem.operator === "x"
      ? [
          {
            en:
              `${quantityA} treasure chests each hold ${quantityB} shiny coins. ` +
              `How many coins are there altogether?`,
            jaHtml:
              `${problem.a}${rubyText("個", "こ")}の ${rubyText("宝箱", "たからばこ")}に ${problem.b}${rubyText("枚", "まい")}ずつ ` +
              `${rubyText("金貨", "きんか")}が はいっています。${rubyText("全", "ぜん")}${rubyText("部", "ぶ")}で ` +
              `${rubyText("何", "なん")}${rubyText("枚", "まい")}？`,
            jaReading:
              `${problem.a}この たからばこに ${problem.b}まいずつ きんかが はいっています。ぜんぶで なんまい？`,
          },
          {
            en:
              `${quantityA} dragons guard ${quantityB} glowing gems each. ` +
              `How many gems are being guarded in all?`,
            jaHtml:
              `${problem.a}${rubyText("匹", "ひき")}の ドラゴンが ${problem.b}${rubyText("個", "こ")}ずつ ` +
              `${rubyText("光", "ひか")}る ${rubyText("宝石", "ほうせき")}を まもっています。` +
              `${rubyText("全", "ぜん")}${rubyText("部", "ぶ")}で ${rubyText("何", "なん")}${rubyText("個", "こ")}？`,
            jaReading:
              `${problem.a}ひきの ドラゴンが ${problem.b}こずつ ひかる ほうせきを まもっています。ぜんぶで なんこ？`,
          },
          {
            en:
              `${quantityA} dancers practice ${quantityB} spins in every round. ` +
              `How many spins happen after all the rounds?`,
            jaHtml:
              `${problem.a}${rubyText("回", "かい")}の れんしゅうで、まいかい ${problem.b}${rubyText("回", "かい")}ずつ まわります。` +
              `${rubyText("全", "ぜん")}${rubyText("部", "ぶ")}で ${rubyText("何", "なん")}${rubyText("回", "かい")}？`,
            jaReading:
              `${problem.a}かいの れんしゅうで、まいかい ${problem.b}かいずつ まわります。ぜんぶで なんかい？`,
          },
          {
            en:
              `${quantityA} bakery trays carry ${quantityB} moon cookies each. ` +
              `How many cookies are on all the trays?`,
            jaHtml:
              `${problem.a}${rubyText("枚", "まい")}の トレーに ${problem.b}${rubyText("個", "こ")}ずつ ` +
              `つきの クッキーが のっています。${rubyText("全", "ぜん")}${rubyText("部", "ぶ")}で ` +
              `${rubyText("何", "なん")}${rubyText("個", "こ")}？`,
            jaReading:
              `${problem.a}まいの トレーに ${problem.b}こずつ クッキーが のっています。ぜんぶで なんこ？`,
          },
        ]
      : [
          {
            en:
              `${englishQuantity(problem.a, config.allowWordNumberMix)} stickers are shared equally among ${quantityB} teammates. ` +
              `How many stickers does each teammate get?`,
            jaHtml:
              `${problem.a}${rubyText("枚", "まい")}の シールを ${problem.b}${rubyText("人", "にん")}の ` +
              `${rubyText("友達", "ともだち")}で ${rubyText("同", "おな")}じずつ ${rubyText("分", "わ")}けます。` +
              `1${rubyText("人", "にん")}${rubyText("分", "ぶん")}は ${rubyText("何", "なん")}${rubyText("枚", "まい")}？`,
            jaReading:
              `${problem.a}まいの シールを ${problem.b}にんの ともだちで おなじずつ わけます。ひとりぶんは なんまい？`,
          },
          {
            en:
              `${englishQuantity(problem.a, config.allowWordNumberMix)} noodles are packed into ${quantityB} bowls evenly. ` +
              `How many noodles go in each bowl?`,
            jaHtml:
              `${problem.a}${rubyText("本", "ほん")}の めんを ${problem.b}${rubyText("個", "こ")}の どんぶりに ` +
              `${rubyText("同", "おな")}じずつ ${rubyText("入", "い")}れます。1${rubyText("個", "こ")}の どんぶりには ` +
              `${rubyText("何", "なん")}${rubyText("本", "ほん")}？`,
            jaReading:
              `${problem.a}ほんの めんを ${problem.b}この どんぶりに おなじずつ いれます。ひとつには なんぼん？`,
          },
          {
            en:
              `${englishQuantity(problem.a, config.allowWordNumberMix)} stars are arranged into ${quantityB} equal constellations. ` +
              `How many stars are in each constellation?`,
            jaHtml:
              `${problem.a}${rubyText("個", "こ")}の ${rubyText("星", "ほし")}を ${problem.b}${rubyText("個", "こ")}の ` +
              `${rubyText("同", "おな")}じ ${rubyText("星座", "せいざ")}に ${rubyText("分", "わ")}けます。1つの ${rubyText("星座", "せいざ")}は ` +
              `${rubyText("何", "なん")}${rubyText("個", "こ")}？`,
            jaReading:
              `${problem.a}この ほしを ${problem.b}この おなじ せいざに わけます。ひとつの せいざは なんこ？`,
          },
          {
            en:
              `${englishQuantity(problem.a, config.allowWordNumberMix)} game points are split across ${quantityB} players evenly. ` +
              `How many points does each player get?`,
            jaHtml:
              `${problem.a}${rubyText("点", "てん")}を ${problem.b}${rubyText("人", "にん")}の プレイヤーで ` +
              `${rubyText("同", "おな")}じずつ ${rubyText("分", "わ")}けます。1${rubyText("人", "にん")}${rubyText("分", "ぶん")}は ` +
              `${rubyText("何", "なん")}${rubyText("点", "てん")}？`,
            jaReading:
              `${problem.a}てんを ${problem.b}にんの プレイヤーで おなじずつ わけます。ひとりぶんは なんてん？`,
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
      visual: null,
    };
  }

  function rubyText(kanji, reading) {
    return `<ruby>${kanji}<rt>${reading}</rt></ruby>`;
  }

  function englishQuantity(value, allowWords) {
    if (!allowWords || value > 20) {
      return String(value);
    }
    const word = numberToEnglishWord(value);
    const pattern = Math.random();
    if (pattern < 0.34) {
      return String(value);
    }
    if (pattern < 0.67) {
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
    if (value <= 20) {
      return small[value];
    }
    const tens = {
      30: "thirty",
      40: "forty",
      50: "fifty",
      60: "sixty",
      70: "seventy",
      80: "eighty",
      90: "ninety",
    };
    if (value < 100) {
      const tenPart = Math.floor(value / 10) * 10;
      const onePart = value % 10;
      return onePart === 0 ? tens[tenPart] : `${tens[tenPart]}-${small[onePart]}`;
    }
    return String(value);
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
    elements.languageLabel.textContent =
      problem.language === "English" ? "English question on screen and audio" : "日本語の問題を表示と音声で";
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
    stopSpeaking();
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
    speak(problem.spokenText, detectSpeechLang(problem.spokenText));
  }

  function detectSpeechLang(text) {
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

  async function evaluateAnswer(answer, timedOut) {
    const problem = state.currentProblem;
    if (!problem) {
      return;
    }
    stopTimer();
    state.profile.totalAnswered += 1;
    const stat = getFactStat(problem.key);
    stat.lastSeen = Date.now();

    let message;
    if (answer === problem.answer && !timedOut) {
      stat.correct += 1;
      stat.mastery = Math.min(10, stat.mastery + 2);
      state.profile.streak += 1;
      state.profile.bestStreak = Math.max(state.profile.bestStreak, state.profile.streak);
      state.profile.totalCorrect += 1;
      state.profile.xpInLevel += 18;
      message = randomLine(coachVoices.correct);
      setFeedback(message, "correct");
      playTone(true);
    } else {
      stat.wrong += 1;
      stat.mastery = Math.max(0, stat.mastery - 3);
      state.profile.streak = 0;
      state.profile.xpInLevel = Math.max(0, state.profile.xpInLevel - 4);
      message = timedOut
        ? `${randomLine(coachVoices.timeout)} Answer: ${problem.answer}`
        : `${randomLine(coachVoices.incorrect)} Answer: ${problem.answer}`;
      setFeedback(message, "incorrect");
      playTone(false);
    }

    const levelUpMessages = maybeLevelUp();
    saveProfile();
    updateDashboard();

    const speechQueue = [message, ...levelUpMessages];
    const speechStart = Date.now();
    for (const line of speechQueue) {
      await speak(line, detectSpeechLang(line));
    }
    const waited = Date.now() - speechStart;
    const remainder = Math.max(0, FEEDBACK_MIN_MS - waited);

    window.setTimeout(startRound, remainder + 300);
  }

  function maybeLevelUp() {
    const messages = [];
    let leveled = false;
    while (state.profile.xpInLevel >= 100) {
      state.profile.xpInLevel -= 100;
      state.profile.level += 1;
      messages.push(`Level up! Welcome to level ${state.profile.level}.`);
      leveled = true;
    }
    if (leveled) {
      const level = state.profile.level;
      elements.coachText.textContent =
        `Level ${level} unlocked. The colors and challenge both just got brighter.`;
      triggerLevelPulse();
    }
    return messages;
  }

  function triggerLevelPulse() {
    document.body.dataset.levelTone = String((state.profile.level - 1) % 5);
    document.body.classList.remove("level-up-pulse");
    void document.body.offsetWidth;
    document.body.classList.add("level-up-pulse");
    window.clearTimeout(state.levelPulseTimer);
    state.levelPulseTimer = window.setTimeout(() => {
      document.body.classList.remove("level-up-pulse");
    }, 1800);
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
    document.body.dataset.levelTone = String((state.profile.level - 1) % 5);
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
    return "Missed facts will return with new wording, visuals, and story twists until they feel easy.";
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
      ["kyoko", "otoya", "haruka", "sayaka", "nanami", "keita", "google 日本語", "sakura", "japanese"].forEach((token) => {
        if (name.includes(token)) {
          score += 4;
        }
      });
      ["compact", "novelty", "whisper"].forEach((token) => {
        if (name.includes(token)) {
          score -= 1;
        }
      });
    } else {
      if (voice.lang.toLowerCase().startsWith("en")) {
        score += 10;
      }
      ["samantha", "ava", "victoria", "google us english", "allison", "serena", "daniel"].forEach((token) => {
        if (name.includes(token)) {
          score += 3;
        }
      });
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
    const compatible = state.voices.filter((voice) => voice.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
    const pool = compatible.length ? compatible : state.voices;
    return pool
      .slice()
      .sort((left, right) => scoreVoice(right, lang) - scoreVoice(left, lang))[0] || null;
  }

  function stopSpeaking() {
    if (synth) {
      synth.cancel();
    }
    state.activeUtterance = null;
  }

  function speak(text, lang) {
    if (!synth || !text) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = getPreferredVoice(lang);
      utterance.lang = lang;
      utterance.voice = voice;
      utterance.rate = lang === "ja-JP" ? 0.9 : 0.98;
      utterance.pitch = lang === "ja-JP" ? 1.05 : 1;
      utterance.volume = 1;
      utterance.onend = () => {
        if (state.activeUtterance === utterance) {
          state.activeUtterance = null;
        }
        resolve();
      };
      utterance.onerror = () => {
        if (state.activeUtterance === utterance) {
          state.activeUtterance = null;
        }
        resolve();
      };
      stopSpeaking();
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
    };
    if (map[cleaned] !== undefined) {
      return map[cleaned];
    }
    const englishParts = cleaned.replace(/-/g, " ").split(/\s+/).filter(Boolean);
    const englishSmall = {
      zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
      ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
      sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
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
    };
    let englishCurrent = 0;
    let matchedEnglish = false;
    for (const part of englishParts) {
      if (englishSmall[part] !== undefined) {
        englishCurrent += englishSmall[part];
        matchedEnglish = true;
      } else if (englishTens[part] !== undefined) {
        englishCurrent += englishTens[part];
        matchedEnglish = true;
      } else if (part !== "and") {
        matchedEnglish = false;
        break;
      }
    }
    if (matchedEnglish) {
      return englishCurrent;
    }
    return null;
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
        speak(state.currentProblem.spokenText, detectSpeechLang(state.currentProblem.spokenText));
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
      state.recognition.lang = state.currentProblem && state.currentProblem.language === "Japanese" ? "ja-JP" : "en-US";
      elements.micButton.textContent = "Listening...";
      state.recognition.start();
    });
  }

  function init() {
    loadVoices();
    if (synth) {
      synth.onvoiceschanged = loadVoices;
    }
    setupRecognition();
    bindEvents();
    updateDashboard();
    elements.languageLabel.textContent = "Press Start";
    elements.promptText.innerHTML =
      `<span class="prompt-kicker">Ready?</span>Press Start Round to begin.<br />` +
      `Every question will appear as visible text and can also be read aloud.`;
    elements.visualZone.innerHTML = "";
    elements.timerLabel.textContent = String(state.timerValue);
    elements.updateText.textContent =
      "The app checks for new versions in the background and prefers higher-quality local voices when available.";
    checkForUpdates();
    window.setInterval(checkForUpdates, 5 * 60 * 1000);
  }

  init();
})();
