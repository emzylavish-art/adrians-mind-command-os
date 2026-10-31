# Browser workspace

## Driver

`scripts/mind-browser.mjs` launches Playwright Chromium. It accepts http(s) URLs and refuses `file:` URLs and URLs with credentials. A `data:` HTML document is allowed only when `MIND_BROWSER_ALLOW_DATA=1`, which the unit test sets. The product server does not set that flag.

The test opened `data:text/html` with title Pier and body text "Water is low." That is a real Chromium launch, not a screenshot fixture.

## Product button

Tools → Open page calls `inspectWebPage`, which requires a signed-in owner, respects emergency stop, rate-limits to 6 per minute, and spawns the script. The button was not clicked during smoke. No public website was fetched during tests.

## Agent tool

The browser tool on an agent does not call the script by itself. The worker opens a page only when a driver function is passed in, after approval. The Runs screen does not pass a driver, so an agent browser step waits instead of faking a screenshot.

There is no live video of a remote browser.
