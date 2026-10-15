# Тренажёр промптов

Статическое веб-приложение: проверка промптов без бэкенда и без вызовов LLM. Прогресс хранится в **localStorage** браузера.

## GitHub Pages

Сайт: **https://learn-iad.github.io/AI-1/** (после включения Pages и push в `main`).

1. Репозиторий → **Settings** → **Pages** → Source: **GitHub Actions**.
2. Push в ветку `main` — workflow `.github/workflows/deploy-pages.yml` соберёт и выложит папку `dist`.

На Pages попадает только сборка (HTML + JS + CSS). Папка `node_modules` и исходники на хостинг **не** загружаются.

### Размер

Типичная сборка — порядка **15–25 KB** JS (gzip) и **5 KB** CSS. Для GitHub Pages это очень лёгкий проект; лимиты Pages рассчитаны на сайты на мегабайты.

Зависимости в `package.json` — только **dev** (TypeScript и Vite для сборки). В браузере пользователя — чистый JavaScript без React и без CDN.

## Локальная разработка

```bash
npm install
npm run dev
```

Для локального dev базовый путь `/AI-1/` совпадает с Pages. Открывайте URL из терминала Vite.

```bash
npm run build    # результат в dist/
npm run preview  # проверка сборки
```

## Зачёт

Порог **75%** — в шапке появляется «Зачёт ✓». Ниже порога тренажёр просит доработать промпт. При 75%+ всё равно даётся обратная связь и предложение довести до **92+** (идеал).

## Проверка оценщика

```bash
npx tsx src/lib/evaluatePrompt.test.ts
```

## Задания

`src/data/assignments.ts` — тексты заданий.  
`src/lib/evaluatePrompt.ts` — критерии и эвристики для русского языка.
