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
cp index.html privacy.html terms.html app.js api.js grammar.js grammar.json practice.js reading.js reading.json reading.css placement.js placement.css coach.js coach.css promptpay.js styles.css word-meta-styles.css app-styles.css \
   sw.js manifest.webmanifest icon.svg icon-maskable.svg dist/

# single page: anything unknown falls back to the app shell
printf '/*    /index.html   200\n' > dist/_redirects

VERSION=$(date +%Y%m%d%H%M%S)
sed -i "s/?v=dev/?v=${VERSION}/g" dist/index.html dist/privacy.html dist/terms.html dist/app.js dist/grammar.js dist/reading.js dist/placement.js dist/coach.js dist/promptpay.js
sed -i "s/^const VERSION = .*/const VERSION = 'oxford3000-${VERSION}';/" dist/sw.js

# Visible version, bottom right: the release number from APP_VERSION plus the
# commit, so a screenshot says exactly which build someone is looking at.
COMMIT=${COMMIT_REF:-$(git rev-parse HEAD 2>/dev/null || echo local)}
sed -i "s/__APP_VERSION__/$(cat APP_VERSION) · ${COMMIT:0:7}/" dist/index.html

# The zip is only for hand-deploying by drag and drop. On a CI builder (Netlify,
# GitHub Actions) dist/ is published directly, so skip it rather than failing
# the build over an artefact nobody will download.
PY=$(command -v python || command -v python3 || true)
if [ -n "${NETLIFY:-}${CI:-}" ] || [ -z "$PY" ]; then
    echo "built dist/ · asset version ${VERSION}"
else
    "$PY" -c "import shutil; shutil.make_archive('flashcard-site', 'zip', 'dist')"
    echo "built flashcard-site.zip ($(du -h flashcard-site.zip | cut -f1)) · asset version ${VERSION}"
fi
