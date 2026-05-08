# Claude instructions

## Scope of changes

Only make changes to pages, components, or files that the user has explicitly mentioned or assigned. Do not proactively fix, clean up, or modify anything outside the current task scope — even if an issue is noticed while working on something else. If something looks wrong in an unrelated file, point it out in text but do not touch it without being asked.

## Never hardcode secrets

Never write passwords, API keys, tokens, or any credentials directly in source files — including scripts, seed files, test helpers, and one-off utilities. All secrets must come from environment variables. If a script needs a credential, read it from `process.env.SOMETHING` and exit with a clear error if it is missing. Add the variable name (with a placeholder value) to `.env.example`.
