# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Ground rules

- **Open an issue first** for anything bigger than a bug fix, so we can agree
  on the shape before you write code.
- **This repo is a thin client.** Tools, their descriptions and all business
  logic live on the LOLA server; the CLI and `lola-mcp` only handle login and
  forward requests. Requests for new tools belong in an issue, not a PR here.
- **No secrets, no real user data** in code, tests or fixtures.

## Workflow

```sh
npm install
npm run check   # build + tests; CI runs the same
```

- Add or update tests for behaviour changes (vitest).
- Use Conventional Commit style titles (`feat:`, `fix:`, `docs:`, …).

By contributing you agree that your contribution is licensed under the MIT
license of this repository.
