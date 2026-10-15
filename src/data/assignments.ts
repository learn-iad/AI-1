import type { Assignment } from "../types";

export const assignments: Assignment[] = [
  {
    id: "explain-long-document",
    title: "Задание 1. Объяснение длинного документа",
    intro:
      "Вы тренируетесь писать промпты, которые можно сразу отправить в любой текстовый ИИ (ЯндексGPT, GigaChat, DeepSeek и т.п.). Тренажёр проверит структуру вашего промпта — без подключения к нейросети.",
    situation:
      "У вас есть длинный документ (договор, регламент, внутреннее положение). Нужно получить короткое понятное объяснение для неспециалиста — коллеги из другого отдела или клиента.",
    goal:
      "Составьте свой промпт: опишите роль ИИ, контекст (документ и аудитория), задачу, тон, ограничения и при необходимости формат ответа.",
    requiredCriteria: ["role", "context", "task", "tone", "constraints"],
    optionalCriteria: ["outputFormat"],
  },
];

export function getAssignment(id: string): Assignment | undefined {
  return assignments.find((a) => a.id === id);
}
