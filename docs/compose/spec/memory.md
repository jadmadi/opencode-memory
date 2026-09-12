---
feature: memory
status: in-progress
updated: 2026-09-12
branch: feat/memory
commits:
---

# Memory and Checkpoints

## Report

## [S1] Problem

OpenCode V2 has no cross-session memory. A new session relearns the project from
scratch, and compaction discards structured state. `AGENTS.md` and instructions
hold durable rules, but nothing captures what a session learned. MiMoCode keeps
project memory, a session checkpoint, and scratch notes, and injects a budgeted
slice of them when a session resumes.

## [S2] Design

A plugin keeps memory in the OpenCode data directory, keyed by project, so no
repository is dirtied.

- Layout: `~/.local/share/opencode/memory/<projectID>/` with `MEMORY.md`,
  `checkpoint.md`, and `notes.md`.
- Tools: `memory_read` (file plus optional offset/limit), `memory_append`
  (file plus text), and `memory_search` (keyword search over the three files,
  returning matching lines with file and line number).
- Session start: a prompt hook injects a token-budgeted slice of memory on the
  first prompt of a session. The budget is configurable and defaults to a small
  value. Only the most relevant sections are included when the budget is tight.
- Compaction: the `compaction` hook asks a model, through `ctx.generate.text`,
  for a structured checkpoint of the conversation and writes it to
  `checkpoint.md`. It sets the compaction summary from the same result.
- Commands: `/remember <text>` appends to `MEMORY.md`, `/memory` prints the
  current files, and `/checkpoint` writes a checkpoint on demand.
- Missing files are created on first write. A corrupt file is reported, never
  overwritten silently.

## [S3] Out of Scope

- SQLite FTS5 ranking. Keyword search is enough to start.
- `/dream` and knowledge extraction from traces. That is the distill port.
- Per-task progress files.
- Sharing memory across machines.

## Tasks

- [ ] T1: memory directory layout, plus read, append, and create-on-write -
      acceptance: a fake-context test reads and writes all three files and
      reports a corrupt file without overwriting it (covers: S2)
- [ ] T2: budgeted injection on the first prompt of a session - acceptance: a
      prompt-hook test confirms one injection, within the budget, and none on
      later prompts in the same session (covers: S2; depends: T1)
- [ ] T3: `memory_search` over the three files - acceptance: a query returns
      matching lines with file and line number (covers: S2; depends: T1)
- [ ] T4: the compaction hook writes a structured checkpoint and sets the
      summary - acceptance: a hook test supplies messages and confirms the
      written file and the result summary (covers: S2; depends: T1)
- [ ] T5: the /remember, /memory, and /checkpoint commands - acceptance: each is
      registered and its executor is covered by a test (covers: S2; depends: T1)
- [ ] T6: README and NOTICE, credit MiMoCode memory - acceptance: both files
      exist and name the source (covers: S2; depends: T2)
