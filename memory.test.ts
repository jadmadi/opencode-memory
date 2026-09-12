import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin, { buildInjection, filePath, memoryDir, readOrEmpty, searchLines, writeFile } from "./memory.ts"

const tempDirs: string[] = []

afterEach(() => {
  delete process.env.MEMORY_ROOT
  delete process.env.MEMORY_BUDGET
  while (tempDirs.length) rmSync(tempDirs.pop() as string, { recursive: true, force: true })
})

function makeCtx() {
  const tools: any[] = []
  const commands: any[] = []
  const hooks: Record<string, any> = {}
  const store = new Map<string, unknown>()
  const prompts: any[] = []
  const ctx: any = {
    location: { directory: "/tmp/project", project: { id: "proj" } },
    tool: { transform: (callback: any) => callback({ add: (definition: any) => tools.push(definition) }) },
    command: { transform: (callback: any) => callback({ add: (definition: any) => commands.push(definition) }) },
    session: {
      hook: async (name: string, callback: any) => void (hooks[name] = callback),
      prompt: async (input: any) => void prompts.push(input),
      context: async () => [{ role: "user" }],
      get: async () => ({ model: { providerID: "test", id: "model" } }),
    },
    storage: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => void store.set(key, value),
    },
    generate: { text: async () => ({ text: "CHECKPOINT SUMMARY" }) },
  }
  return { ctx, tools, commands, hooks, prompts }
}

async function boot() {
  const root = mkdtempSync(join(tmpdir(), "memory-test-"))
  tempDirs.push(root)
  process.env.MEMORY_ROOT = root
  const harness = makeCtx()
  await (plugin as any).setup(harness.ctx)
  return harness
}

const tool = (tools: any[], name: string) => tools.find((entry) => entry.name === name)
const command = (commands: any[], name: string) => commands.find((entry) => entry.name === name)

describe("searchLines", () => {
  test("numbers matching lines", () => {
    expect(searchLines("alpha\nbeta\ngamma", "beta")).toEqual(["2: beta"])
  })

  test("is case-insensitive and empty-safe", () => {
    expect(searchLines("Alpha", "alpha")).toEqual(["1: Alpha"])
    expect(searchLines("Alpha", "")).toEqual([])
  })
})

describe("buildInjection", () => {
  test("wraps non-empty files", () => {
    const result = buildInjection([{ file: "MEMORY.md", text: "hello" }], 1000)
    expect(result).toBe("<project_memory>\n## MEMORY.md\nhello\n</project_memory>")
  })

  test("returns nothing when every file is empty", () => {
    expect(buildInjection([{ file: "MEMORY.md", text: "  " }], 1000)).toBe("")
  })

  test("truncates at the budget", () => {
    const result = buildInjection([{ file: "MEMORY.md", text: "x".repeat(100) }], 80)
    expect(result.length).toBeLessThanOrEqual(80)
    expect(result).toContain("<project_memory>")
    expect(result).not.toContain("x".repeat(100))
  })

  test("returns nothing when the budget cannot fit the wrapper", () => {
    expect(buildInjection([{ file: "MEMORY.md", text: "hello" }], 20)).toBe("")
  })

  test("keeps a three-file injection within the budget", () => {
    const parts = [
      { file: "MEMORY.md", text: "a".repeat(40) },
      { file: "checkpoint.md", text: "b".repeat(40) },
      { file: "notes.md", text: "c".repeat(40) },
    ]
    expect(buildInjection(parts, 60).length).toBeLessThanOrEqual(60)
  })
})

describe("memoryDir", () => {
  test("keys the directory by project id", () => {
    process.env.MEMORY_ROOT = "/tmp/root"
    expect(memoryDir({ location: { project: { id: "abc" } } })).toBe("/tmp/root/abc")
  })
})

describe("tools", () => {
  test("append then read round-trips and creates the directory", async () => {
    const { ctx, tools } = await boot()
    await tool(tools, "memory_append").execute({ file: "notes.md", text: "first note" }, { sessionID: "ses_1" })
    expect(existsSync(memoryDir(ctx))).toBe(true)
    const read = await tool(tools, "memory_read").execute({ file: "notes.md" }, { sessionID: "ses_1" })
    expect(read.content).toBe("first note")
  })

  test("read reports an empty file", async () => {
    const { tools } = await boot()
    const read = await tool(tools, "memory_read").execute({ file: "MEMORY.md" }, { sessionID: "ses_1" })
    expect(read.content).toBe("(MEMORY.md is empty)")
  })

  test("read rejects an unknown file", async () => {
    const { tools } = await boot()
    await expect(tool(tools, "memory_read").execute({ file: "nope.md" }, { sessionID: "ses_1" })).rejects.toThrow(
      /unknown memory file/,
    )
  })

  test("reports a corrupt path without overwriting it", async () => {
    const { ctx, tools } = await boot()
    mkdirSync(filePath(ctx, "notes.md"), { recursive: true })
    await expect(tool(tools, "memory_read").execute({ file: "notes.md" }, { sessionID: "ses_1" })).rejects.toThrow(
      /could not read/,
    )
    expect(existsSync(filePath(ctx, "notes.md"))).toBe(true)
  })

  test("read reports a range with no lines", async () => {
    const { tools } = await boot()
    await tool(tools, "memory_append").execute({ file: "notes.md", text: "one line" }, { sessionID: "ses_1" })
    const read = await tool(tools, "memory_read").execute({ file: "notes.md", offset: 9 }, { sessionID: "ses_1" })
    expect(read.content).toBe("(no lines in range)")
  })

  test("search finds matches across files with file names", async () => {
    const { tools } = await boot()
    await tool(tools, "memory_append").execute({ file: "MEMORY.md", text: "deploy on friday" }, { sessionID: "ses_1" })
    await tool(tools, "memory_append").execute({ file: "notes.md", text: "not this" }, { sessionID: "ses_1" })
    const found = await tool(tools, "memory_search").execute({ query: "friday" }, { sessionID: "ses_1" })
    expect(found.content).toBe("MEMORY.md:1: deploy on friday")
  })

  test("append rejects empty text", async () => {
    const { tools } = await boot()
    await expect(
      tool(tools, "memory_append").execute({ file: "notes.md", text: " " }, { sessionID: "ses_1" }),
    ).rejects.toThrow(/non-empty/)
  })
})

describe("commands", () => {
  test("registers remember, memory, and checkpoint", async () => {
    const { commands } = await boot()
    expect(commands.map((entry) => entry.name)).toEqual(["remember", "memory", "checkpoint"])
  })

  test("remember appends a bullet", async () => {
    const { ctx, commands } = await boot()
    await command(commands, "remember").execute({ sessionID: "ses_1", prompt: { text: "use tabs" } })
    expect(await readOrEmpty(ctx, "MEMORY.md")).toBe("- use tabs")
  })

  test("remember rejects empty input", async () => {
    const { commands } = await boot()
    await expect(command(commands, "remember").execute({ sessionID: "ses_1", prompt: { text: "" } })).rejects.toThrow(
      /use \/remember/,
    )
  })

  test("memory posts the three files", async () => {
    const { commands, prompts } = await boot()
    await command(commands, "remember").execute({ sessionID: "ses_1", prompt: { text: "rule" } })
    await command(commands, "memory").execute({ sessionID: "ses_1" })
    expect(prompts).toHaveLength(1)
    expect(prompts[0].text).toContain("## MEMORY.md")
    expect(prompts[0].text).toContain("- rule")
  })

  test("checkpoint writes the model summary", async () => {
    const { ctx, commands } = await boot()
    await command(commands, "checkpoint").execute({ sessionID: "ses_1" })
    expect(await readOrEmpty(ctx, "checkpoint.md")).toBe("CHECKPOINT SUMMARY")
  })
})

describe("hooks", () => {
  test("injects memory once on the first prompt", async () => {
    const { ctx, hooks } = await boot()
    await writeFile(ctx, "MEMORY.md", "remember this")
    const first = { sessionID: "ses_1", prompt: { text: "hello" } }
    await hooks.prompt(first)
    expect(first.prompt.text).toContain("<project_memory>")
    expect(first.prompt.text).toContain("remember this")
    const second = { sessionID: "ses_1", prompt: { text: "again" } }
    await hooks.prompt(second)
    expect(second.prompt.text).toBe("again")
  })

  test("does not inject when memory is empty", async () => {
    const { hooks } = await boot()
    const event = { sessionID: "ses_2", prompt: { text: "hello" } }
    await hooks.prompt(event)
    expect(event.prompt.text).toBe("hello")
  })

  test("ignores an event without a prompt", async () => {
    const { hooks } = await boot()
    await hooks.prompt({ sessionID: "ses_3" })
  })

  test("falls back when the model call fails and messages are missing", async () => {
    const { ctx, hooks } = await boot()
    ctx.generate.text = async () => {
      throw new Error("boom")
    }
    const event = { sessionID: "ses_1", model: { providerID: "test", id: "model" } }
    await hooks.compaction(event)
    expect(event.result.summary).toContain("Checkpoint")
  })

  test("compaction writes a checkpoint and sets the summary", async () => {
    const { ctx, hooks } = await boot()
    const event = { sessionID: "ses_1", model: { providerID: "test", id: "model" }, messages: [{ role: "user" }] }
    await hooks.compaction(event)
    expect(event.result).toEqual({ summary: "CHECKPOINT SUMMARY" })
    expect(await readOrEmpty(ctx, "checkpoint.md")).toBe("CHECKPOINT SUMMARY")
  })
})
