# Claude instructions

> **REMINDER (for Jun):** This project is worked on across two devices. After adding any new environment variable to `.env.local`, manually copy it to the other device's `.env.local` as well. Check `.env.example` to see the full list of required variables.

## Keeping the docs current

Update `README.md` and `SESSIONS.md` after every meaningful change — not just at the end of a session. This means:
- After fixing a bug: update README Known Issues if it was listed there; add a line to the current SESSIONS entry.
- After running a script: update the status table or checklist in README (e.g., mark a pipeline step as ✅ done).
- After adding a feature or migration: update the roadmap and the SESSIONS entry.
- At the end of every session: update the START HERE checklist so the next session knows exactly where to pick up.

The README is the source of truth for project state. SESSIONS.md is the historical record. Both rot fast — keep them accurate in real time, not retroactively.

## Pipeline health checks (auto-run when due)

At the start of a session, read [`PIPELINE_CHECKS.md`](PIPELINE_CHECKS.md). If today's date is on or past the `next due` date in its Check log **and** the catalog pipeline is running, run the checks it lists (`pipeline:status` / `pipeline:verify` from `apps/web/`), report a short summary, and prepend a new dated row to its Check log with the next due date. If it isn't due yet, don't bring it up. Always run the checks right after a pipeline restart, a migration, or a pipeline code change. Follow that file's "Reading the results" guide — don't auto-fix data, just report and propose.

## Scope of changes

Only make changes to pages, components, or files that the user has explicitly mentioned or assigned. Do not proactively fix, clean up, or modify anything outside the current task scope — even if an issue is noticed while working on something else. If something looks wrong in an unrelated file, point it out in text but do not touch it without being asked.

## Never hardcode secrets

Never write passwords, API keys, tokens, or any credentials directly in source files — including scripts, seed files, test helpers, and one-off utilities. All secrets must come from environment variables. If a script needs a credential, read it from `process.env.SOMETHING` and exit with a clear error if it is missing. Add the variable name (with a placeholder value) to `.env.example`.

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills:
`/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`
