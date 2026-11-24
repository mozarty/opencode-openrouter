# Security

## Reporting a vulnerability

Open a private security advisory on
<https://github.com/mozarty/opencode-openrouter/security/advisories/new>, or
email the maintainer listed in `package.json`. Please do not open a public
issue for a vulnerability.

## What this plugin touches

- **Your OpenRouter API key.** It is read from `OPENROUTER_API_KEY` first, then
  from OpenCode's credential store (`credential` table in `opencode.db`, opened
  read-only), then from the legacy `auth.json`. Only key-shaped credentials are
  accepted: a structured OAuth/session blob is never sent to OpenRouter.
- **OpenRouter's API.** The key is sent as a bearer token to
  `https://openrouter.ai/api/v1/key` and nowhere else. No telemetry, no other
  network calls.
- **Nothing is written.** The plugin never writes to the credential store, the
  auth file or the API; it only reads usage.

If you find a path where a secret other than a key-shaped credential can be sent
to OpenRouter — or sent anywhere else — treat it as a vulnerability.
