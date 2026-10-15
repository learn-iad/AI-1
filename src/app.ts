import { assignments } from "./data/assignments";
import {
  evaluatePrompt,
  formatEvaluationMessage,
} from "./lib/evaluatePrompt";
import {
  BADGE_DEFS,
  badgesEarned,
  computeNewBadges,
  levelFromXp,
  xpFromAttempt,
  type LevelInfo,
} from "./lib/gamification";
import { renderMarkdownLite } from "./lib/renderMarkdown";
import {
  hasSeenMobileNavHint,
  loadState,
  markMobileNavHintSeen,
  saveState,
  type PersistedState,
} from "./lib/storage";
import type { Assignment, ChatMessage, CriterionResult, EvaluationResult } from "./types";
import { EXCELLENT_PERCENT, PASS_PERCENT } from "./types";
import "./styles/global.css";

const QUEST_ITEMS: { id: string; label: string; bonus?: boolean }[] = [
  { id: "role", label: "Роль для ИИ" },
  { id: "context", label: "Контекст: документ и аудитория" },
  { id: "task", label: "Чёткая задача" },
  { id: "tone", label: "Тон и язык" },
  { id: "constraints", label: "Ограничения" },
  { id: "outputFormat", label: "Формат ответа", bonus: true },
];

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}

function scoreRingSvg(percent: number, size = 72): string {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;
  const color =
    percent >= EXCELLENT_PERCENT
      ? "var(--score-high)"
      : percent >= PASS_PERCENT
        ? "var(--score-mid)"
        : "var(--score-low)";
  return `<svg width="${size}" height="${size}" class="score-ring" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-muted)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"
      transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" class="score-ring__text">${percent}</text>
  </svg>`;
}

function criteriaHtml(criteria: CriterionResult[]): string {
  const items = criteria
    .map((c) => {
      const pct = c.maxScore ? Math.round((c.score / c.maxScore) * 100) : 0;
      const ok = c.found ? " criteria__fill--ok" : "";
      return `<li class="criteria__item">
        <div class="criteria__head"><span class="criteria__label">${c.label}</span><span class="criteria__pts">${c.score}/${c.maxScore}</span></div>
        <div class="criteria__track"><div class="criteria__fill${ok}" style="width:${pct}%"></div></div>
      </li>`;
    })
    .join("");
  return `<ul class="criteria">${items}</ul>`;
}

function feedbackStatusHtml(evaluation: EvaluationResult): string {
  if (evaluation.isExcellent) {
    return `<span class="feedback__status feedback__status--excellent">💎 Близко к идеалу</span>`;
  }
  if (evaluation.isPassed) {
    return `<span class="feedback__status feedback__status--pass">✓ Зачёт (${PASS_PERCENT}%+)</span>`;
  }
  return `<span class="feedback__status feedback__status--retry">↻ Нужна доработка</span>`;
}

function feedbackHtml(msg: ChatMessage, lastXp?: number): string {
  const ev = msg.evaluation!;
  const strengths =
    ev.strengths.length > 0
      ? `<div class="feedback__section feedback__section--good">
          <p class="feedback__section-title">Что уже хорошо</p>
          <ul class="feedback__list">${ev.strengths.map((s) => `<li>${s}</li>`).join("")}</ul>
        </div>`
      : "";
  const improvements =
    ev.improvements.length > 0
      ? `<div class="feedback__section feedback__section--improve">
          <p class="feedback__section-title">Как усилить</p>
          <ul class="feedback__list">${ev.improvements.map((s) => `<li>${s}</li>`).join("")}</ul>
        </div>`
      : "";

  let cta = "";
  if (ev.isExcellent) {
    cta =
      "<p class=\"feedback__cta\">Промпт на высоком уровне. Можете закрепить результат ещё одной попыткой или перейти к следующему материалу.</p>";
  } else if (ev.isPassed) {
    cta = `<p class="feedback__cta"><strong>Задание выполнено.</strong> Хотите довести промпт до идеала (${EXCELLENT_PERCENT}+)? Отправьте улучшенный вариант — разбор подскажет, что ещё усилить.</p>`;
  } else {
    cta = `<p class="feedback__cta">До зачёта не хватает баллов (нужно <strong>${PASS_PERCENT}</strong>). Доработайте промпт по подсказкам и отправьте новую попытку.</p>`;
  }

  const xpBadge =
    lastXp != null && lastXp > 0
      ? `<span class="feedback__xp">+${lastXp} XP</span>`
      : "";

  return `<div class="feedback">
    <div class="feedback__hero">
      ${scoreRingSvg(ev.percent)}
      <div class="feedback__score-text">
        <h3>Оценка: ${ev.percent} из 100</h3>
        <p>${ev.summary}</p>
        ${feedbackStatusHtml(ev)}${xpBadge}
      </div>
    </div>
    ${strengths}
    ${improvements}
    ${cta}
    ${criteriaHtml(ev.criteria)}
  </div>`;
}

function messageHtml(msg: ChatMessage, lastFeedbackXp?: number): string {
  const isUser = msg.role === "user";
  if (!isUser && msg.evaluation) {
    return `<div class="message message--assistant">
      <div class="message__avatar" aria-hidden="true">AI</div>
      <div class="message__body">${feedbackHtml(msg, lastFeedbackXp)}</div>
    </div>`;
  }

  const meta =
    msg.attempt != null && isUser
      ? `<span class="message__meta">Попытка ${msg.attempt}</span>`
      : "";

  return `<div class="message message--${msg.role}">
    <div class="message__avatar" aria-hidden="true">${isUser ? "Вы" : "AI"}</div>
    <div class="message__body">
      <div class="message__bubble">
        <div class="message__content">${renderMarkdownLite(msg.content)}</div>
        ${meta}
      </div>
    </div>
  </div>`;
}

function questProgressFromEvaluation(evaluation: EvaluationResult | null): Set<string> {
  const done = new Set<string>();
  if (!evaluation) return done;
  for (const c of evaluation.criteria) {
    if (c.found) done.add(c.id);
  }
  return done;
}

function missionBriefHtml(
  assignment: Assignment,
  questDone: Set<string>,
): string {
  const questItems = QUEST_ITEMS.map((q) => {
    const done = questDone.has(q.id) ? " quest__item--done" : "";
    const bonus = q.bonus ? " quest__item--bonus" : "";
    return `<li class="quest__item${done}${bonus}"><span class="quest__check" aria-hidden="true"></span><span>${q.label}${q.bonus ? " (бонус)" : ""}</span></li>`;
  }).join("");

  return `<aside class="mission" aria-label="Описание задания">
    <div class="mission__hero">
      <span class="mission__tag">✦ Миссия 1</span>
      <h2 class="mission__title">${assignment.title}</h2>
      <p class="mission__intro">${assignment.intro}</p>
    </div>
    <div class="mission-card">
      <p class="mission-card__label"><span class="mission-card__icon mission-card__icon--situation">📄</span> Ситуация</p>
      <p>${assignment.situation}</p>
    </div>
    <div class="mission-card">
      <p class="mission-card__label"><span class="mission-card__icon mission-card__icon--goal">🎯</span> Ваша цель</p>
      <p>${assignment.goal}</p>
    </div>
    <div class="quest">
      <p class="quest__title">Чек-лист промпта</p>
      <ul class="quest__list">${questItems}</ul>
    </div>
  </aside>`;
}

function headerHudHtml(
  level: LevelInfo,
  bestScore: number,
  hasPassed: boolean,
  badges: string[],
  newBadgeIds: string[],
): string {
  const chips: string[] = [];
  if (hasPassed) {
    chips.push('<span class="header__chip header__chip--pass">Зачёт ✓</span>');
  }
  if (bestScore > 0) {
    chips.push(
      `<span class="header__chip header__chip--score">Рекорд: <strong>${bestScore}%</strong></span>`,
    );
  }

  const badgeIcons = badges
    .map((id) => {
      const def = BADGE_DEFS[id];
      if (!def) return "";
      const isNew = newBadgeIds.includes(id) ? " badge-icon--new" : "";
      return `<span class="badge-icon${isNew}" title="${escapeAttr(def.title)} — ${escapeAttr(def.description)}">${def.emoji}</span>`;
    })
    .join("");

  return `<div class="header__hud">
    <div class="level-pill" title="Опыт за попытки и качество промптов">
      <span class="level-pill__badge">Lv ${level.level}</span>
      <div class="level-pill__meta">
        <div class="level-pill__row"><strong>${level.title}</strong><span>${level.xpInLevel}/${level.xpForLevel} XP</span></div>
        <div class="level-pill__bar"><div class="level-pill__fill" style="width:${level.progress}%"></div></div>
      </div>
    </div>
    ${badgeIcons ? `<div class="badges-row" aria-label="Достижения">${badgeIcons}</div>` : ""}
    ${chips.join("")}
  </div>`;
}

const LMS_URL = "https://lms.reso.ru/";

const LOGO_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M12 2L4 7v10l8 5 8-5V7l-8-5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  <circle cx="12" cy="12" r="2.5" fill="currentColor"/>
  <path d="M12 9.5V6M12 18v-3.5M9.5 12H6M18 12h-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

export function mountApp(root: HTMLElement): void {
  const assignment = assignments[0];
  const saved = loadState(assignment.id);

  let attempt = saved?.attempt ?? 0;
  let bestScore = saved?.bestScore ?? 0;
  let hasPassed = saved?.hasPassed ?? false;
  let totalXp = saved?.totalXp ?? 0;
  let badges = saved?.badges ?? [];
  let messages: ChatMessage[] = saved?.messages?.length ? saved.messages : [];
  let isEvaluating = false;
  let lastFeedbackXp: number | undefined;
  let lastQuestDone = questProgressFromEvaluation(
    [...messages].reverse().find((m) => m.evaluation)?.evaluation ?? null,
  );
  let newBadgeIds: string[] = [];

  root.innerHTML = `<div class="app">
    <header class="header">
      <div class="header__brand">
        <span class="header__logo" aria-hidden="true">${LOGO_SVG}</span>
        <div>
          <h1 class="header__title">Тренажёр промптов</h1>
          <p class="header__subtitle">Учимся формулировать задачи для ИИ</p>
        </div>
      </div>
      <div id="header-hud"></div>
    </header>
    <div class="main">
      <nav class="pane-switch" id="pane-switch" aria-label="Переключение разделов">
        <button type="button" class="pane-switch__btn pane-switch__btn--active" data-pane="mission">Задание</button>
        <button type="button" class="pane-switch__btn" data-pane="chat">Диалог</button>
      </nav>
      <p class="pane-switch__hint" id="pane-hint">Свайп влево — к диалогу · вправо — к заданию</p>
      <div class="main__track" id="main-track">
        <section class="main__pane main__pane--mission" id="mission-panel" aria-label="Задание"></section>
        <section class="main__pane main__pane--chat" aria-label="Диалог с проверкой">
      <div class="chat-panel">
        <div class="chat-panel__head">
          <h2 class="chat-panel__title">Диалог с проверкой</h2>
          <span class="chat-panel__attempts" id="attempt-label"></span>
        </div>
        <main class="chat" id="chat"><div class="chat__messages" id="messages"></div></main>
        <footer class="footer">
          <div class="composer">
            <p class="composer__label"><span class="composer__label-dot" aria-hidden="true"></span> Ваш промпт для нейросети</p>
            <div class="composer__inner">
              <textarea class="composer__input" id="prompt-input" rows="1" aria-label="Ваш промпт"
                placeholder="Опишите роль, контекст, задачу, тон и ограничения…"></textarea>
              <button type="button" class="composer__send" id="send-btn" aria-label="Отправить промпт">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
              </button>
            </div>
            <p class="composer__hint">Enter — отправить · Shift+Enter — новая строка</p>
          </div>
        </footer>
      </div>
        </section>
      </div>
    </div>
    <div class="toast-xp" id="xp-toast" role="status" aria-live="polite"></div>
    <div class="pass-modal" id="pass-modal" hidden aria-hidden="true">
      <div class="pass-modal__backdrop" id="pass-modal-backdrop"></div>
      <div
        class="pass-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pass-modal-title"
        aria-describedby="pass-modal-desc"
      >
        <div class="pass-modal__badge" aria-hidden="true">✓</div>
        <h2 class="pass-modal__title" id="pass-modal-title">Задание зачтено!</h2>
        <p class="pass-modal__desc" id="pass-modal-desc">
          Вы набрали порог 75% и выполнили миссию. Хотите улучшить результат или вернуться к обучению на платформе?
        </p>
        <p class="pass-modal__score" id="pass-modal-score"></p>
        <div class="pass-modal__actions">
          <button type="button" class="pass-modal__btn pass-modal__btn--primary" id="pass-modal-improve">
            Повысить балл
          </button>
          <button type="button" class="pass-modal__btn pass-modal__btn--secondary" id="pass-modal-lms">
            Вернуться к обучению
          </button>
        </div>
      </div>
    </div>
    <div class="mobile-onboard" id="mobile-onboard" hidden aria-hidden="true">
      <div class="mobile-onboard__backdrop" aria-hidden="true"></div>
      <div
        class="mobile-onboard__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-onboard-title"
      >
        <span class="mobile-onboard__emoji" aria-hidden="true">👋</span>
        <h2 class="mobile-onboard__title" id="mobile-onboard-title">Как пользоваться</h2>
        <ol class="mobile-onboard__steps">
          <li class="mobile-onboard__step">
            <span class="mobile-onboard__step-num">1</span>
            <span>На вкладке <strong>«Задание»</strong> прочитайте ситуацию, цель и чек-лист — от них зависит ваш промпт.</span>
          </li>
          <li class="mobile-onboard__step">
            <span class="mobile-onboard__step-num">2</span>
            <span>Переключитесь в <strong>«Диалог»</strong>: свайп влево или кнопка сверху. Напишите промпт и отправьте.</span>
          </li>
          <li class="mobile-onboard__step">
            <span class="mobile-onboard__step-num">3</span>
            <span>Нужно освежить условие? <strong>Свайп вправо</strong> или снова нажмите «Задание».</span>
          </li>
        </ol>
        <button type="button" class="mobile-onboard__btn" id="mobile-onboard-ok">
          Понятно, к заданию
        </button>
      </div>
    </div>
  </div>`;

  const messagesEl = root.querySelector("#messages") as HTMLElement;
  const chatEl = root.querySelector("#chat") as HTMLElement;
  const headerHud = root.querySelector("#header-hud") as HTMLElement;
  const missionPanel = root.querySelector("#mission-panel") as HTMLElement;
  const attemptLabel = root.querySelector("#attempt-label") as HTMLElement;
  const input = root.querySelector("#prompt-input") as HTMLTextAreaElement;
  const sendBtn = root.querySelector("#send-btn") as HTMLButtonElement;
  const xpToast = root.querySelector("#xp-toast") as HTMLElement;
  const mainTrack = root.querySelector("#main-track") as HTMLElement;
  const paneSwitch = root.querySelector("#pane-switch") as HTMLElement;
  const paneButtons = paneSwitch.querySelectorAll<HTMLButtonElement>(".pane-switch__btn");
  const passModal = root.querySelector("#pass-modal") as HTMLElement;
  const passModalScore = root.querySelector("#pass-modal-score") as HTMLElement;
  const passModalImprove = root.querySelector("#pass-modal-improve") as HTMLButtonElement;
  const passModalLms = root.querySelector("#pass-modal-lms") as HTMLButtonElement;
  const mobileOnboard = root.querySelector("#mobile-onboard") as HTMLElement;
  const mobileOnboardOk = root.querySelector("#mobile-onboard-ok") as HTMLButtonElement;

  function openMobileOnboard(): void {
    mobileOnboard.hidden = false;
    mobileOnboard.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    scrollToPane("mission", false);
    mobileOnboardOk.focus();
  }

  function closeMobileOnboard(): void {
    mobileOnboard.hidden = true;
    mobileOnboard.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    markMobileNavHintSeen();
  }

  mobileOnboardOk.addEventListener("click", () => closeMobileOnboard());

  function maybeShowMobileOnboard(): void {
    if (!isMobileLayout() || hasSeenMobileNavHint()) return;
    window.setTimeout(() => openMobileOnboard(), 350);
  }

  function openPassModal(score: number): void {
    passModalScore.textContent = `Ваш результат: ${score}% · рекорд сохранён в тренажёре`;
    passModal.hidden = false;
    passModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    passModalImprove.focus();
  }

  function closePassModal(): void {
    passModal.hidden = true;
    passModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    input.focus();
  }

  passModalImprove.addEventListener("click", () => closePassModal());
  passModalLms.addEventListener("click", () => {
    window.location.href = LMS_URL;
  });

  function persist(): void {
    const state: PersistedState = {
      version: 2,
      assignmentId: assignment.id,
      attempt,
      bestScore,
      hasPassed,
      messages,
      totalXp,
      badges,
    };
    saveState(state);
  }

  function isMobileLayout(): boolean {
    return window.matchMedia("(max-width: 860px)").matches;
  }

  function scrollToPane(pane: "mission" | "chat", smooth = true): void {
    if (!isMobileLayout()) return;
    const index = pane === "mission" ? 0 : 1;
    mainTrack.scrollTo({
      left: index * mainTrack.clientWidth,
      behavior: smooth ? "smooth" : "auto",
    });
  }

  function updatePaneSwitchFromScroll(): void {
    if (!isMobileLayout()) return;
    const index = Math.round(mainTrack.scrollLeft / Math.max(mainTrack.clientWidth, 1));
    paneButtons.forEach((btn, i) => {
      const active = i === index;
      btn.classList.toggle("pane-switch__btn--active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function initMobilePanePosition(): void {
    if (!isMobileLayout()) return;
    const pane = attempt > 0 || messages.length > 0 ? "chat" : "mission";
    requestAnimationFrame(() => scrollToPane(pane, false));
  }

  paneSwitch.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-pane]");
    if (!btn) return;
    scrollToPane(btn.dataset.pane as "mission" | "chat");
  });

  mainTrack.addEventListener("scroll", () => updatePaneSwitchFromScroll(), {
    passive: true,
  });

  window.addEventListener("resize", () => {
    updatePaneSwitchFromScroll();
    if (isMobileLayout()) initMobilePanePosition();
  });

  function renderMission(): void {
    missionPanel.innerHTML = missionBriefHtml(assignment, lastQuestDone);
  }

  function renderHeader(): void {
    headerHud.innerHTML = headerHudHtml(
      levelFromXp(totalXp),
      bestScore,
      hasPassed,
      badges,
      newBadgeIds,
    );
    attemptLabel.textContent =
      attempt > 0 ? `Попыток: ${attempt}` : "Первая попытка — вперёд";
  }

  function scrollChat(): void {
    requestAnimationFrame(() => {
      chatEl.scrollTop = chatEl.scrollHeight;
    });
  }

  function renderMessages(): void {
    if (!messages.length && !isEvaluating) {
      messagesEl.innerHTML = `<div class="chat-empty">
        <div class="chat-empty__icon">💬</div>
        <p>Напишите промпт в поле ниже — как будто отправляете его в <strong>чат с нейросетью</strong> вместе с текстом документа.</p>
      </div>`;
    } else {
      messagesEl.innerHTML = messages
        .map((m, i) => {
          const isLastFeedback =
            i === messages.length - 1 && m.role === "assistant" && m.evaluation;
          return messageHtml(m, isLastFeedback ? lastFeedbackXp : undefined);
        })
        .join("");
    }
    if (isEvaluating) {
      messagesEl.insertAdjacentHTML(
        "beforeend",
        `<div class="message message--assistant">
          <div class="message__avatar">AI</div>
          <div class="message__body"><div class="message__bubble"><div class="typing"><span></span><span></span><span></span></div></div></div>
        </div>`,
      );
    }
    scrollChat();
  }

  function showXpToast(amount: number, extra?: string): void {
    xpToast.textContent = extra ? `+${amount} XP · ${extra}` : `+${amount} XP`;
    xpToast.classList.add("toast-xp--show");
    window.setTimeout(() => xpToast.classList.remove("toast-xp--show"), 2400);
  }

  function triggerCelebrate(): void {
    document.body.classList.add("celebrate");
    window.setTimeout(() => document.body.classList.remove("celebrate"), 900);
  }

  function resizeInput(): void {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  }

  function setComposerEnabled(on: boolean): void {
    input.disabled = !on;
    sendBtn.disabled = !on || !input.value.trim();
  }

  function submit(): void {
    const text = input.value.trim();
    if (!text || isEvaluating) return;

    const prevPassed = hasPassed;
    const prevBest = bestScore;
    const prevBadges = [...badges];

    attempt += 1;
    isEvaluating = true;
    lastFeedbackXp = undefined;
    newBadgeIds = [];
    input.value = "";
    resizeInput();
    setComposerEnabled(false);

    messages.push({
      id: uid(),
      role: "user",
      content: text,
      attempt,
    });
    renderMessages();
    renderHeader();
    persist();
    scrollToPane("chat");

    const delay = 600 + Math.min(text.length * 8, 1200);
    window.setTimeout(() => {
      const evaluation = evaluatePrompt(text, assignment);
      const isNewBest = evaluation.percent > prevBest;
      bestScore = Math.max(bestScore, evaluation.percent);
      const justPassed = evaluation.isPassed && !prevPassed;
      if (evaluation.isPassed) hasPassed = true;

      const gainedXp = xpFromAttempt(evaluation.percent, {
        isNewBest,
        justPassed,
        isExcellent: evaluation.isExcellent,
      });
      totalXp += gainedXp;
      lastFeedbackXp = gainedXp;

      badges = computeNewBadges({
        badges,
        attempt,
        percent: evaluation.percent,
        isPassed: evaluation.isPassed,
        isExcellent: evaluation.isExcellent,
        justPassed,
      });
      newBadgeIds = badgesEarned(prevBadges, badges);

      lastQuestDone = questProgressFromEvaluation(evaluation);

      messages.push({
        id: uid(),
        role: "assistant",
        content: formatEvaluationMessage(evaluation),
        evaluation,
      });
      isEvaluating = false;
      renderMission();
      renderHeader();
      renderMessages();
      setComposerEnabled(true);
      persist();

      showXpToast(
        gainedXp,
        newBadgeIds.length
          ? BADGE_DEFS[newBadgeIds[0]]?.title
          : justPassed
            ? "Зачёт!"
            : undefined,
      );
      if (justPassed || evaluation.isExcellent) {
        triggerCelebrate();
      }
      if (justPassed) {
        window.setTimeout(() => openPassModal(bestScore), 400);
      } else {
        input.focus();
      }
    }, delay);
  }

  sendBtn.addEventListener("click", submit);
  input.addEventListener("input", () => {
    resizeInput();
    sendBtn.disabled = isEvaluating || !input.value.trim();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  renderMission();
  renderHeader();
  renderMessages();
  setComposerEnabled(true);
  initMobilePanePosition();
  updatePaneSwitchFromScroll();
  maybeShowMobileOnboard();
}
