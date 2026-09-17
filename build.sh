#!/usr/bin/env bash
# Bundle just the runtime files into dist/ and a zip for a Netlify deploy.
#
# The one thing this does beyond copying: stamp a version onto the asset URLs.
# Browsers cache ES modules by URL, so without it a returning visitor can end up
# running yesterday's app.js against today's index.html, which fails in ways
# that look nothing like a caching problem.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist flashcard-site.zip
mkdir -p dist
cp index.html privacy.html terms.html app.js api.js promptpay.js styles.css word-meta-styles.css app-styles.css \
   sw.js manifest.webmanifest icon.svg icon-maskable.svg dist/

# single page: anything unknown falls back to the app shell
printf '/*    /index.html   200\n' > dist/_redirects

VERSION=$(date +%Y%m%d%H%M%S)
sed -i "s/?v=dev/?v=${VERSION}/g" dist/index.html dist/privacy.html dist/terms.html dist/app.js dist/promptpay.js
sed -i "s/^const VERSION = .*/const VERSION = 'oxford3000-${VERSION}';/" dist/sw.js

# python instead of `zip`, which Git Bash on Windows does not ship
python -c "import shutil; shutil.make_archive('flashcard-site', 'zip', 'dist')"
echo "built flashcard-site.zip ($(du -h flashcard-site.zip | cut -f1)) · asset version ${VERSION}"
