# Habla

Face to face voice translator between Spanish and English. Put the phone flat on the table between two people. The top half faces her (Spanish), the bottom half faces you (English).

- She taps her mic and speaks Spanish. The app says it out loud in English and shows the English caption on your half.
- You tap your mic and speak English. The app says it in Spanish and shows the Spanish caption on her half.
- Tap any caption to hear it again. Tap a failed one to retry.
- "Face to face" flips her half upside down so she can read it from across the table. Turn it off if you're side by side.

Built with Next.js. Speech recognition and voices come from the browser (Web Speech API), so use **Chrome on Android** or desktop Chrome. Firefox has no speech recognition.

## Deploy on Vercel

1. Go to vercel.com, then Add New, then Project.
2. Import this repository. No settings need changing.
3. Deploy and open the link in Chrome. Allow the microphone the first time.

Tip: in Chrome, use "Add to Home screen" so it opens full screen like an app.

## Translation

The `/api/translate` route works without any key. It tries providers in this order:

1. **DeepL**, only if `DEEPL_API_KEY` is set. Best quality. The free plan covers 500,000 characters a month.
2. **MyMemory**, free with no key. About 5,000 characters a day, or about 50,000 if `MYMEMORY_EMAIL` is set.
3. **Google Translate's public endpoint**, used as a fallback if MyMemory is over its limit or down.

Add environment variables in Vercel under Project, Settings, Environment Variables, then redeploy.

| Variable | Required | What it does |
| --- | --- | --- |
| `DEEPL_API_KEY` | No | Uses DeepL first for better translations |
| `MYMEMORY_EMAIL` | No | Raises MyMemory's free daily limit |

## Run locally

```bash
npm install
npm run dev
```

Speech recognition needs HTTPS or `localhost`.
