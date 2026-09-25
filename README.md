# opencode-memory

An OpenCode V2 plugin for project memory and session checkpoints. It keeps a
small set of files per project, injects a budgeted slice of them when a session
starts, and writes a checkpoint when the conversation compacts.

## Files

| File            | Purpose                                              |
| --------------- | ---------------------------------------------------- |
| `MEMORY.md`     | Durable project knowledge, rules, decisions          |
| `checkpoint.md` | Structured state snapshot, written on compaction     |
| `notes.md`      | Scratch notes                                        |

Files live under the OpenCode data directory, keyed by project id, so no
repository is dirtied:

```text
~/.local/share/opencode/memory/<projectID>/
```

Set `MEMORY_ROOT` to override the parent directory, and `MEMORY_BUDGET`
(characters, default 4000) to change the size of the injected slice.

## OpenCode

This plugin runs on OpenCode. New accounts through my referral link get $5 in
usage credits, and I get $5 too:

https://opencode.ai/go?ref=N9H3ZEP22A

## Install

```sh
mkdir -p ~/.config/opencode/plugins
curl -fsSL \
  https://raw.githubusercontent.com/jadmadi/opencode-memory/main/memory.ts \
  -o ~/.config/opencode/plugins/memory.ts
```

For one project, put it in `.opencode/plugins/`. Tested against OpenCode v2.0.3.

To pin a release, replace `main` in the URL with a tag such as `v0.1.0`.

## Tools and commands

| Name           | Kind    | Use                                                |
| -------------- | ------- | -------------------------------------------------- |
| `memory_read`  | tool    | Read one file, with optional offset and limit      |
| `memory_append`| tool    | Append text to one file                            |
| `memory_search`| tool    | Keyword search across the three files              |
| `/remember`    | command | Append text to `MEMORY.md`                         |
| `/memory`      | command | Show the three files                               |
| `/checkpoint`  | command | Write a checkpoint now                             |

The plugin also injects a budgeted memory slice on the first prompt of a
session, and writes a checkpoint when the conversation compacts.

## Tests

```sh
bun test
```

## Attribution

Inspired by MiMoCode's persistent memory. See `NOTICE`.

## License

AGPL-3.0-only. Copyright (C) 2026 Jad Madi.