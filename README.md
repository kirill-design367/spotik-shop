# Spotik Shop

Лендинг сервиса оформления доступа к Spotify Premium из России.
Первая итерация: каркас сайта и главный визуальный приём.

Подробности проекта, законы, принятые решения и открытые вопросы —
в [CLAUDE.md](./CLAUDE.md).

## Запуск

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # статический экспорт в out/
```

## Публикация

GitHub Pages через Actions. Чтобы она заработала, в настройках
репозитория нужно один раз включить:

1. **Settings → Actions → General → Allow all actions and reusable workflows**
2. **Settings → Pages → Source → GitHub Actions**

После этого `.github/workflows/deploy.yml` запускается на каждый push
в рабочую ветку. Адрес выдачи: `https://<owner>.github.io/spotik-shop/`.

## Проверки

```bash
node scripts/verify-export.mjs    выдача по боевому пути в настоящем браузере
node scripts/measure-fps.mjs      фактический fps на трёх размерах
node scripts/pagespeed.mjs        Lighthouse по собранной выдаче
node scripts/verify-strokes.mjs   сверка приёма с замерами референса
node scripts/check-bundle.mjs     three.js не попал в первый экран
npm run audit:fonts               cmap и fvar напрямую из бинарников
```
