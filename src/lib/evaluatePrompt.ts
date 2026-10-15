import type {
  Assignment,
  CriterionId,
  CriterionResult,
  EvaluationResult,
} from "../types";
import { EXCELLENT_PERCENT, PASS_PERCENT } from "../types";

const CRITERION_META: Record<
  CriterionId,
  { label: string; weight: number; hint: string }
> = {
  role: {
    label: "Роль",
    weight: 12,
    hint: "Коротко достаточно: «Ты — аналитик» или «Действуй как редактор».",
  },
  context: {
    label: "Контекст",
    weight: 18,
    hint: "Укажите, что за документ (договор, полис, регламент) и для кого ответ, если это важно.",
  },
  task: {
    label: "Задача",
    weight: 25,
    hint: "Что сделать с документом: краткое содержание, суть, ключевые пункты — не одно слово «сократи».",
  },
  tone: {
    label: "Тон и язык",
    weight: 15,
    hint: "Достаточно фраз вроде «простым языком», «понятно для неспециалиста».",
  },
  constraints: {
    label: "Ограничения",
    weight: 12,
    hint: "Объём или рамки: «в трёх предложениях», «до 500 слов», «только по тексту документа».",
  },
  outputFormat: {
    label: "Формат вывода",
    weight: 10,
    hint: "По желанию: список, блоки «Суть» / «Важно» — если нужна особая структура ответа.",
  },
};

/** Латиница + кириллица — в JS \\w кириллицу не матчит */
const CY = "a-zа-яё0-9";
const WORD = `[${CY}]+`;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

type Matcher = {
  patterns: RegExp[];
  keywords: string[];
  /** Дополнительные баллы за сильные формулировки */
  strong?: RegExp[];
};

const MATCHERS: Record<CriterionId, Matcher> = {
  role: {
    patterns: [
      new RegExp(`ты\\s*[-—–:]\\s*${WORD}`, "i"),
      new RegExp(`[ятыы]\\s*[-—–:]\\s*${WORD}`, "i"),
      /действуй\s+как/,
      /выступай\s+в\s+роли/,
      /представь\s*,?\s*что\s+ты/,
      /в\s+роли\s+/,
      /как\s+(эксперт|методист|аналитик|юрист|редактор|консультант)/,
      /аналитик\s+(данных|данные)?/,
      /(методист|юрист|редактор|консультант|эксперт)\s+(данных|данные)?/,
    ],
    keywords: [
      "роль",
      "методист",
      "аналитик",
      "юрист",
      "редактор",
      "эксперт",
      "консультант",
      "переводчик",
      "наставник",
      "специалист по",
    ],
    strong: [/ты\s*[-—–]\s*(методист|аналитик|юрист|редактор)/],
  },
  context: {
    patterns: [
      /(договор|регламент|положен|документ|текст|файл|pdf|полис)/,
      /(страхован|по\s+страхован)/,
      /(неспециалист|коллег|клиент|читател|аудитор|сотрудник)/,
      new RegExp(`друг[${CY}]*\\s+отдел`, "i"),
      /(вне\s+юрид|не\s+знаком)/,
      /(приложен|ниже|вставлен|этот\s+текст|у\s+меня\s+есть)/,
      new RegExp(`(документ|полис|договор)\\s+по\\s+${WORD}`, "i"),
    ],
    keywords: [
      "договор",
      "регламент",
      "положение",
      "документ",
      "страхован",
      "полис",
      "неспециалист",
      "коллега",
      "клиент",
      "отдел",
      "аудитория",
      "читатель",
      "внутренн",
    ],
    strong: [
      /для\s+(неспециалист|коллег|клиент)/,
      /(договор|регламент).*(коллег|клиент|неспециалист)/,
    ],
  },
  task: {
    patterns: [
      /(объясн|поясн|излож|расскаж|опиш)/,
      /(кратк|коротк|сжат|суть|резюме|summary|содержан)/,
      new RegExp(`крат[${CY}]*\\s+содержан`, "i"),
      /прочти(ть)?\s+(его|документ|текст|файл)?/,
      new RegExp(`дай\\s+(кратк|резюме|содержан|пояснен|объяснен)`, "i"),
      new RegExp(`ключев[${CY}]*\\s+(пункт|момент|положен|иде)`, "i"),
      /(выдел|структурир|разбери)/,
      new RegExp(`(что\\s+важно|главн[${CY}]*\\s+(мысл|иде))`, "i"),
    ],
    keywords: [
      "объясни",
      "поясни",
      "кратко",
      "суть",
      "ключев",
      "пункт",
      "резюме",
      "изучи",
      "проанализируй",
      "разбор",
      "выдели",
      "структур",
      "прочти",
      "содержан",
    ],
    strong: [
      /(суть|ключев).*(пункт|положен|риск|срок)/,
      new RegExp(`крат[${CY}]*\\s+пояснен`, "i"),
      new RegExp(`крат[${CY}]*\\s+содержан`, "i"),
    ],
  },
  tone: {
    patterns: [
      new RegExp(`(прост[${CY}]*\\s+язык|понятн[${CY}]*\\s+язык|доступн)`, "i"),
      /(доброжелательн|вежлив|дружелюбн)/,
      new RegExp(`без\\s+(жаргон|канцеляр|сложн[${CY}]*\\s+термин)`, "i"),
      /(профессиональн|нейтральн|делов)/,
      /(plain\s+language|простыми\s+словами)/,
      new RegExp(`понятн[${CY}]*\\s+язык`, "i"),
      /доброжелательн/,
    ],
    keywords: [
      "понятн",
      "простым",
      "простой",
      "доброжелатель",
      "без жаргона",
      "канцеляр",
      "доступн",
      "человеческ",
      "нейтральн",
      "вежлив",
    ],
    strong: [new RegExp(`прост[${CY}]*\\s+язык`, "i"), /доброжелательн/],
  },
  constraints: {
    patterns: [
      /(до\s+\d+\s*(знак|слов|абзац|стр|строк|предложен))/,
      new RegExp(
        `(в\\s+)?(одном|двух|трех|трёх|четырех|пяти|\\d+)\\s+предложен`,
        "i",
      ),
      /(\d+\s*[-–]\s*\d+\s*(знак|слов|пункт))/,
      /(не\s+более|не\s+больше|максимум|огранич)/,
      /(только\s+(на\s+основе|из\s+текста|по\s+документ))/,
      /(не\s+(выдумыв|придумыв|додумыв|фантаз))/,
      /(опирайся|используй\s+только|строго\s+по\s+текст)/,
      /(если\s+.*\s+не\s+указан)/,
      /(кратк|коротк|сжат|лаконич|без\s+воды|не\s+больше\s+\d+)/,
    ],
    keywords: [
      "знак",
      "слов",
      "объем",
      "объём",
      "лимит",
      "огранич",
      "не выдумыв",
      "только текст",
      "основе документа",
      "факт",
      "точность",
      "кратко",
      "коротко",
      "предложен",
      "1000",
      "500",
    ],
    strong: [/до\s+\d+\s*знак/, /не\s+выдумыв/],
  },
  outputFormat: {
    patterns: [
      /(маркированн|нумерованн)\s+список/,
      new RegExp(`(формат|структур[${CY}]*\\s+ответ)`, "i"),
      /(блок|раздел|заголовок)\s*[«:"]/,
      /(таблиц|markdown|md)/,
      /(суть\s*[:—]|важно\s+знать|ключевые\s+пункты\s*[:—])/,
      /(\d+\s*[-–]\s*\d+\s+пункт)/,
    ],
    keywords: [
      "список",
      "формат",
      "структура",
      "раздел",
      "блок",
      "таблица",
      "заголовок",
      "маркирован",
      "нумерац",
    ],
    strong: [
      new RegExp(`маркированн[${CY}]*\\s+список`, "i"),
      new RegExp(`структур[${CY}]*\\s+ответ`, "i"),
    ],
  },
};

function scoreCriterion(id: CriterionId, raw: string): Omit<CriterionResult, "id" | "label" | "hint"> {
  const text = normalize(raw);
  const meta = CRITERION_META[id];
  const m = MATCHERS[id];
  const maxScore = meta.weight;

  if (raw.trim().length < 10) {
    return {
      score: 0,
      maxScore,
      found: false,
      feedback: "Промпт слишком короткий — добавьте роль, задачу и контекст.",
    };
  }

  let patternHits = 0;
  for (const p of m.patterns) {
    if (p.test(text)) patternHits++;
  }

  let keywordHits = 0;
  for (const kw of m.keywords) {
    if (text.includes(normalize(kw))) keywordHits++;
  }

  let hasStrong = false;
  if (m.strong) {
    for (const s of m.strong) {
      if (s.test(text)) {
        hasStrong = true;
        break;
      }
    }
  }

  let ratio = 0;
  if (patternHits > 0) ratio += 0.38;
  if (patternHits > 1) ratio += 0.12;
  if (keywordHits > 0) ratio += 0.28;
  if (keywordHits > 1) ratio += 0.1;
  if (hasStrong) ratio = Math.max(ratio, 0.92);

  // Короткая формулировка достаточна — не требуем «простыни»
  if (patternHits >= 1) ratio = Math.max(ratio, 0.55);
  if (patternHits >= 1 && keywordHits >= 1) ratio = Math.max(ratio, 0.78);
  if (patternHits >= 2 && keywordHits >= 1) ratio = Math.max(ratio, 0.88);

  if (id === "task" && /^сократи\b/.test(text) && ratio < 0.55) {
    ratio = Math.min(ratio, 0.32);
  }

  ratio = Math.min(1, ratio);
  const score = Math.round(ratio * maxScore);
  const found = score >= maxScore * 0.42;

  let feedback: string;
  if (score >= maxScore * 0.85) {
    feedback = "Есть, этого достаточно.";
  } else if (found) {
    feedback = "Учтено — можно оставить как есть или чуть уточнить.";
  } else {
    feedback = "Не хватает явной формулировки — см. подсказку.";
  }

  return { score, maxScore, found, feedback };
}

function buildSummary(percent: number, strengths: string[]): string {
  if (percent >= 92) {
    return "Отличный промпт: можно отправлять в ИИ с документом — роль, контекст, задача и рамки на месте.";
  }
  if (percent >= 75) {
    return strengths.length
      ? `Короткий рабочий промпт — основные элементы есть (${strengths.slice(0, 3).join("; ")}).`
      : "Короткий рабочий промпт — основные элементы на месте, можно отправлять в ИИ.";
  }
  if (percent >= 55) {
    return "Промпт частично готов. Добавьте только то, чего не хватает — без длинных простыней.";
  }
  if (percent >= 35) {
    return "Есть зачатки структуры, но несколько блоков не видны явно. Смотрите подсказки ниже.";
  }
  return "Промпт слишком общий (как «сократи и объясни»). Добавьте роль, контекст и задачу отдельными короткими фразами.";
}

export function evaluatePrompt(
  promptText: string,
  assignment: Assignment,
): EvaluationResult {
  const activeIds: CriterionId[] = [
    ...assignment.requiredCriteria,
    ...(assignment.optionalCriteria ?? []),
  ];

  // Для расчёта процента обязательные критерии = 100%, опциональные дают бонус но cap at 100
  const requiredMax = assignment.requiredCriteria.reduce(
    (s, id) => s + CRITERION_META[id].weight,
    0,
  );
  const optionalMax = (assignment.optionalCriteria ?? []).reduce(
    (s, id) => s + CRITERION_META[id].weight,
    0,
  );

  const criteria: CriterionResult[] = activeIds.map((id) => {
    const meta = CRITERION_META[id];
    const partial = scoreCriterion(id, promptText);
    return {
      id,
      label: meta.label,
      hint: meta.hint,
      ...partial,
    };
  });

  const requiredScore = criteria
    .filter((c) => assignment.requiredCriteria.includes(c.id))
    .reduce((s, c) => s + c.score, 0);

  const optionalScore = criteria
    .filter((c) => assignment.optionalCriteria?.includes(c.id))
    .reduce((s, c) => s + c.score, 0);

  // Процент: обязательные на 100%, опциональный формат — до +10% но итог cap 100
  let percent = Math.round((requiredScore / requiredMax) * 100);
  if (optionalMax > 0 && optionalScore > 0) {
    const bonus = Math.round((optionalScore / optionalMax) * 8);
    percent = Math.min(100, percent + bonus);
  }

  const strengths: string[] = [];
  const improvements: string[] = [];

  for (const c of criteria) {
    const isRequired = assignment.requiredCriteria.includes(c.id);
    if (c.found && c.score >= c.maxScore * 0.55) {
      strengths.push(`${c.label.toLowerCase()} (${c.score}/${c.maxScore})`);
    } else if (isRequired && !c.found) {
      improvements.push(`${c.label}: ${c.hint}`);
    } else if (!isRequired && !c.found && c.id === "outputFormat") {
      improvements.push(c.hint);
    }
  }

  const totalScore = requiredScore + optionalScore;
  const maxScore = requiredMax + optionalMax;

  return {
    totalScore,
    maxScore,
    percent,
    criteria,
    strengths,
    improvements,
    summary: buildSummary(percent, strengths),
    isPassed: percent >= PASS_PERCENT,
    isExcellent: percent >= EXCELLENT_PERCENT,
  };
}

export function formatEvaluationMessage(
  evaluation: EvaluationResult,
  userName?: string,
): string {
  const greeting = userName ? `${userName}, ` : "";
  const lines: string[] = [
    `${greeting}**Оценка: ${evaluation.percent} из 100**`,
    "",
    evaluation.summary,
  ];

  if (evaluation.strengths.length) {
    lines.push("", "**Что уже хорошо:**");
    for (const s of evaluation.strengths) {
      lines.push(`• ${s}`);
    }
  }

  const requiredGaps = evaluation.improvements.filter((i) =>
    i.startsWith("По желанию") ? false : true,
  );
  if (requiredGaps.length) {
    lines.push("", "**Как усилить:**");
    for (const imp of evaluation.improvements) {
      lines.push(`• ${imp}`);
    }
  }

  if (evaluation.isExcellent) {
    lines.push(
      "",
      "Промпт близок к **идеалу**. Можете закрепить результат ещё одной попыткой или перейти к другим материалам курса.",
    );
  } else if (evaluation.isPassed) {
    lines.push(
      "",
      "**Зачёт** (порог 75%). Задание можно считать выполненным.",
      "",
      "Хотите **довести промпт до идеала** (92+)? Напишите улучшенный вариант ниже — разбор подскажет, что ещё усилить.",
    );
  } else {
    lines.push(
      "",
      `До **зачёта** не хватает баллов (нужно ${PASS_PERCENT}). Доработайте промпт по подсказкам выше и отправьте новую попытку.`,
    );
  }

  return lines.join("\n");
}
