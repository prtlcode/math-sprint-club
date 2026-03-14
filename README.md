# Math Sprint Club

Math Sprint Club is a browser app for a child to practice multiplication and division with:

- voice-first answering in English or Japanese when the browser supports speech recognition
- text input fallback
- mixed problem types: direct equations, word problems, visual groups, and missing-number equations
- adaptive repetition that shows weak facts more often and mastered facts less often
- a countdown timer that resets the streak when time runs out

## Run locally

Because this app uses only static files, you can open `index.html` directly in a browser or deploy the folder to Netlify.

## Deploy to Netlify

1. Push this folder to a GitHub repo.
2. In Netlify, create a new site from that GitHub repo.
3. Keep the publish directory as the repo root.
4. Redeploy whenever you update the files here.

## Updating without switching apps

The app polls `version.json` every 5 minutes. When you make improvements, also update the version string in `version.json`. The child can stay on the same page, and the app will refresh itself after the current round when it detects the new version.

## Browser note

Speech recognition support is best in Chrome and Edge. If voice input is unavailable, the app still works with typed answers and spoken prompts.
