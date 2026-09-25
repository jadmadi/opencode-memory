# AGENTS.md

Guidance for agents working in this repository.

## What this is

An OpenCode V2 plugin (`memory.ts`) that keeps project memory, a session
checkpoint, and scratch notes; injects a budgeted slice on the first prompt of a
session; and writes a checkpoint on compaction. No build step, no dependencies,
AGPL-3.0-only.

## Local development

```sh
bun test
cp memory.ts ~/.config/opencode/plugins/memory.ts
touch ~/.config/opencode/plugins/memory.ts
```

Check the server log when something is off:

```sh
grep memory ~/.local/share/opencode/log/opencode.log | tail
```

## Hard constraints

- Do not import `@opencode/plugin`. Export a plain `{ id, setup }` object.
- Keep the plugin dependency-free. Use Bun globals for file access.
- Plugin `console` output is not visible to users. Throwing from a tool
  surfaces the message to the session.
- Memory files live under the OpenCode data directory, keyed by project id.
  `MEMORY_ROOT` overrides the parent, `MEMORY_BUDGET` sets the character
  budget, and tests rely on `MEMORY_ROOT`.
- Never overwrite a file silently on a read error.

## API notes

- `ctx.location.project.id` gives the project key. `ctx.location.directory` is
  the session directory.
- `ctx.session.hook("prompt", cb)` can rewrite `event.prompt.text`. Inject at
  most once per session, tracked in `ctx.storage` under `memory/injected/<id>`.
- `ctx.session.hook("compaction", cb)` receives `event.messages` and
  `event.model`, and can set `event.result = { summary }`.
- `ctx.generate.text({ model, prompt })` makes a transient model call for the
  checkpoint.

## Layout

- `files` - the three memory file names.
- `memoryDir`, `readFileOr`, `writeFile` - path and IO helpers.
- `buildInjection`, `searchLines` - pure helpers, exported for tests.
- `setup` - registers tools, commands, and the two hooks.
- `memory.test.ts` - tests for the helpers and the registration.

## Releasing

- Semantic commit messages. Changes through a feature branch and a PR.
- Keep `NOTICE` accurate.
