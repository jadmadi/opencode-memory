// OpenCode V2 memory plugin.
//
// Keeps three files per project under the OpenCode data directory:
// MEMORY.md, checkpoint.md, and notes.md. Injects a budgeted slice of them on
// the first prompt of a session, writes a checkpoint when the conversation
// compacts, and exposes tools and commands to read and write them.
//
// The runtime does not resolve @opencode/plugin, so this file exports a plain
// { id, setup } object and uses Bun globals for file access.

const FILES = ["MEMORY.md", "checkpoint.md", "notes.md"] as const
type FileName = (typeof FILES)[number]

function dataRoot(): string {
  if (process.env.MEMORY_ROOT) return process.env.MEMORY_ROOT
  const base = process.env.XDG_DATA_HOME || (process.env.HOME ? `${process.env.HOME}/.local/share` : undefined)
  return base ? `${base}/opencode/memory` : ".opencode-memory"
}

function memoryDir(ctx: any): string {
  const id = ctx?.location?.project?.id ?? "unknown"
  return `${dataRoot()}/${id}`
}

function filePath(ctx: any, file: string): string {
  return `${memoryDir(ctx)}/${file}`
}

function memoryBudget(): number {
  const value = Number(process.env.MEMORY_BUDGET)
  return Number.isFinite(value) && value > 0 ? value : 4000
}

function assertFile(file: unknown): FileName {
  if (typeof file === "string" && (FILES as readonly string[]).includes(file)) return file as FileName
  throw new Error(`unknown memory file "${String(file)}"; use one of ${FILES.join(", ")}`)
}

async function readFileOr(ctx: any, file: FileName): Promise<string | undefined> {
  const handle = Bun.file(filePath(ctx, file))
  let exists = false
  try {
    exists = await handle.exists()
  } catch (error) {
    throw new Error(`could not read ${file}: ${error}`)
  }
  if (exists) {
    try {
      return await handle.text()
    } catch (error) {
      throw new Error(`could not read ${file}: ${error}`)
    }
  }
  const stats = await handle.stat().catch(() => undefined)
  if (stats) throw new Error(`could not read ${file}: ${file} is not a readable file`)
  return undefined
}

async function readOrEmpty(ctx: any, file: FileName): Promise<string> {
  return (await readFileOr(ctx, file)) ?? ""
}

async function writeFile(ctx: any, file: FileName, text: string): Promise<void> {
  try {
    await Bun.write(filePath(ctx, file), text)
  } catch (error) {
    throw new Error(`could not write ${file}: ${error}`)
  }
}

async function appendFile(ctx: any, file: FileName, text: string): Promise<void> {
  const existing = await readOrEmpty(ctx, file)
  const next = existing.length === 0 ? text : existing.endsWith("\n") ? `${existing}${text}` : `${existing}\n${text}`
  await writeFile(ctx, file, next)
}

function searchLines(text: string, query: string): string[] {
  if (!query) return []
  const needle = query.toLowerCase()
  const results: string[] = []
  text.split("\n").forEach((line, index) => {
    if (line.toLowerCase().includes(needle)) results.push(`${index + 1}: ${line}`)
  })
  return results
}

function buildInjection(parts: Array<{ file: string; text: string }>, budget: number): string {
  const open = "<project_memory>\n"
  const close = "\n</project_memory>"
  const room = budget - open.length - close.length
  if (room <= 0) return ""
  const chunks: string[] = []
  let used = 0
  for (const part of parts) {
    const text = part.text.trim()
    if (!text) continue
    const block = `## ${part.file}\n${text}`
    const separator = chunks.length ? 2 : 0
    if (used + separator + block.length > room) {
      const left = room - used - separator
      if (left > 0) chunks.push(block.slice(0, left))
      break
    }
    chunks.push(block)
    used += separator + block.length
  }
  return chunks.length ? `${open}${chunks.join("\n\n")}${close}` : ""
}

async function memoryInjection(ctx: any): Promise<string> {
  const parts: Array<{ file: string; text: string }> = []
  for (const file of FILES) parts.push({ file, text: await readOrEmpty(ctx, file) })
  return buildInjection(parts, memoryBudget())
}

function buildCheckpointPrompt(messages: unknown): string {
  return [
    "Summarize this conversation as a project checkpoint.",
    "Keep the task, the decisions made, the files touched, the current state, and the next steps.",
    "Be specific and short. Plain text, no preamble.",
    "",
    JSON.stringify(messages ?? null).slice(0, 20000),
  ].join("\n")
}

function fallbackCheckpoint(messages: unknown): string {
  const count = Array.isArray(messages) ? messages.length : 0
  return `Checkpoint\n\nMessages: ${count}\n\nTail:\n${JSON.stringify(messages ?? null).slice(-2000)}`
}

async function makeCheckpoint(ctx: any, model: { providerID: string; id: string } | undefined, messages: unknown): Promise<string> {
  if (model?.providerID && model?.id) {
    try {
      const result = await ctx.generate.text({ model, prompt: buildCheckpointPrompt(messages) })
      const text = typeof result?.text === "string" ? result.text.trim() : ""
      if (text) return text
    } catch (error) {
      console.error(`memory: checkpoint model call failed: ${error}`)
    }
  }
  return fallbackCheckpoint(messages)
}

const plugin = {
  id: "memory",
  async setup(ctx: any) {
    await ctx.tool.transform((editor: any) => {
      editor.add({
        name: "memory_read",
        description: "Read one memory file: MEMORY.md, checkpoint.md, or notes.md.",
        input: {
          type: "object",
          properties: {
            file: { type: "string", enum: FILES, description: "Which memory file to read." },
            offset: { type: "number", description: "First line to return, 1-based." },
            limit: { type: "number", description: "Maximum lines to return." },
          },
          required: ["file"],
          additionalProperties: false,
        },
        execute: async (input: any) => {
          const file = assertFile(input.file)
          const text = await readFileOr(ctx, file)
          if (text === undefined || text.length === 0) return { content: `(${file} is empty)` }
          const lines = text.split("\n")
          const offset = typeof input.offset === "number" && input.offset > 0 ? input.offset - 1 : 0
          const limit = typeof input.limit === "number" && input.limit > 0 ? input.limit : lines.length
          const slice = lines.slice(offset, offset + limit)
          return { content: slice.length ? slice.join("\n") : "(no lines in range)" }
        },
      })

      editor.add({
        name: "memory_append",
        description: "Append text to one memory file: MEMORY.md, checkpoint.md, or notes.md.",
        input: {
          type: "object",
          properties: {
            file: { type: "string", enum: FILES, description: "Which memory file to append to." },
            text: { type: "string", description: "Text to append." },
          },
          required: ["file", "text"],
          additionalProperties: false,
        },
        execute: async (input: any) => {
          const file = assertFile(input.file)
          const text = typeof input.text === "string" ? input.text.trim() : ""
          if (!text) throw new Error("memory_append needs non-empty text")
          await appendFile(ctx, file, text)
          return { content: `appended to ${file}` }
        },
      })

      editor.add({
        name: "memory_search",
        description: "Search MEMORY.md, checkpoint.md, and notes.md for a keyword.",
        input: {
          type: "object",
          properties: { query: { type: "string", description: "Keyword to find." } },
          required: ["query"],
          additionalProperties: false,
        },
        execute: async (input: any) => {
          const query = typeof input.query === "string" ? input.query.trim() : ""
          if (!query) throw new Error("memory_search needs a query")
          const lines: string[] = []
          for (const file of FILES) {
            for (const match of searchLines(await readOrEmpty(ctx, file), query)) lines.push(`${file}:${match}`)
          }
          return { content: lines.length ? lines.join("\n") : `no matches for "${query}"` }
        },
      })
    })

    await ctx.command.transform((editor: any) => {
      editor.add({
        name: "remember",
        description: "Append a line to MEMORY.md",
        execute: async ({ prompt }: any) => {
          const text = typeof prompt?.text === "string" ? prompt.text.trim() : ""
          if (!text) throw new Error("use /remember <text>")
          await appendFile(ctx, "MEMORY.md", `- ${text}`)
        },
      })

      editor.add({
        name: "memory",
        description: "Show the three memory files",
        execute: async ({ sessionID }: any) => {
          const blocks: string[] = []
          for (const file of FILES) blocks.push(`## ${file}\n${(await readOrEmpty(ctx, file)) || "(empty)"}`)
          await ctx.session.prompt({ sessionID, text: blocks.join("\n\n") })
        },
      })

      editor.add({
        name: "checkpoint",
        description: "Write a memory checkpoint now",
        execute: async ({ sessionID }: any) => {
          const messages = await ctx.session.context({ sessionID })
          const info: any = await ctx.session.get({ sessionID })
          const model = info?.model ?? info?.data?.model
          const summary = await makeCheckpoint(ctx, model, messages)
          await writeFile(ctx, "checkpoint.md", summary)
        },
      })
    })

    await ctx.session.hook("prompt", async (event: any) => {
      if (!event?.prompt) return
      const key = `memory/injected/${event.sessionID}`
      if (await ctx.storage.get(key)) return
      let injection = ""
      try {
        injection = await memoryInjection(ctx)
      } catch (error) {
        console.error(`memory: injection failed: ${error}`)
        return
      }
      if (!injection) return
      await ctx.storage.set(key, true)
      event.prompt.text = `${injection}\n\n${event.prompt.text ?? ""}`
    })

    await ctx.session.hook("compaction", async (event: any) => {
      const summary = await makeCheckpoint(ctx, event.model, event.messages)
      await writeFile(ctx, "checkpoint.md", summary)
      event.result = { summary }
    })
  },
}

export { appendFile, buildInjection, filePath, memoryDir, readOrEmpty, searchLines, writeFile }
export default plugin
