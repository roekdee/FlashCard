#!/usr/bin/env bash
# Bundle just the runtime files into dist/ and a zip for a Netlify drag-and-drop deploy.
# Not needed once the project is connected to the Git repository.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist flashcard-site.zip
mkdir -p dist
cp index.html app.js api.js styles.css word-meta-styles.css app-styles.css \
   sw.js manifest.webmanifest icon.svg icon-maskable.svg dist/

# single page: anything unknown falls back to the app shell
printf '/*    /index.html   200\n' > dist/_redirects

# python instead of `zip`, which Git Bash on Windows does not ship
python -c "import shutil; shutil.make_archive('flashcard-site', 'zip', 'dist')"
echo "built flashcard-site.zip ($(du -h flashcard-site.zip | cut -f1))"
