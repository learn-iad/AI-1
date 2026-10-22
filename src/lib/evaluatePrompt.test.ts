import { assignments } from "../data/assignments";
import { evaluatePrompt } from "./evaluatePrompt";

const assignment = assignments[0];

const samples: { name: string; text: string; expectMin: number; expectMax: number }[] = [
  {
    name: "bad baseline",
    text: "Сократи этот документ и объясни по‑простому, о чём он",
    expectMin: 15,
    expectMax: 45,
  },
  {
    name: "Olga-like (no role/constraints — below pass)",
    text:
      "Изучи документ помоги составить кратко пояснение для неспециалиста понятным языком доброжелательно",
    expectMin: 58,
    expectMax: 72,
  },
  {
    name: "short structured",
    text: `ы - аналитик данных
у меня есть документ по страхованию
прочти его и дай краткое содержание
простым языком
в трех предложениях`,
    expectMin: 75,
    expectMax: 92,
  },
  {
    name: "strong",
    text: `Ты — методист, который переводит юридические тексты на язык коллег из других отделов.
Контекст: во вложении регламент компании (длинный документ). Читатель — неспециалист, клиент без юридического образования.
Задача: составь краткое пояснение — суть документа, 3–5 ключевых пунктов, важные сроки и риски. Не пересказывай всё подряд.
Тон: доброжелательный, простым языком, без канцелярита и жаргона.
Ограничения: до 1000 знаков; опирайся только на текст документа, не выдумывай факты.
Формат: маркированный список с блоками «Суть» и «Важно знать».`,
    expectMin: 90,
    expectMax: 100,
  },
];

const passChecks: { name: string; text: string; shouldPass: boolean }[] = [
  {
    name: "pass without constraints blocked",
    text: `Ты — методист. Документ регламент для коллег из другого отдела.
Дай краткое содержание ключевых пунктов. Простым языком, доброжелательно.`,
    shouldPass: false,
  },
  {
    name: "pass with real constraints",
    text: `Ты — методист. Документ регламент для коллег из другого отдела.
Дай краткое содержание ключевых пунктов. Простым языком, доброжелательно.
В трёх предложениях; не выдумывай факты.`,
    shouldPass: true,
  },
];

let failed = 0;
for (const s of samples) {
  const r = evaluatePrompt(s.text, assignment);
  const ok = r.percent >= s.expectMin && r.percent <= s.expectMax;
  console.log(
    `${ok ? "OK" : "FAIL"} ${s.name}: ${r.percent}% (expected ${s.expectMin}-${s.expectMax})`,
  );
  if (!ok) failed++;
}

for (const c of passChecks) {
  const r = evaluatePrompt(c.text, assignment);
  const ok = r.isPassed === c.shouldPass;
  console.log(
    `${ok ? "OK" : "FAIL"} ${c.name}: passed=${r.isPassed} (expected ${c.shouldPass})`,
  );
  if (!ok) failed++;
}

if (failed > 0) process.exit(1);
