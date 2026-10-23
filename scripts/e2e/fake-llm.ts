// Local fake OpenAI-compatible model: logs every request and answers from a script. No real model, no tokens.
import { appendFileSync } from "node:fs"

const LOG = "D:/claude-cache/oc-sandbox/requests.jsonl"
const PORT = Number(process.env.FAKE_LLM_PORT ?? 47123)

type Message = { role: string; content?: unknown; tool_calls?: unknown[] }

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => (typeof part === "string" ? part : (part?.text ?? ""))).join("")
      : ""

function decide(body: any): { text?: string; tool?: { name: string; args: unknown } } {
  const messages: Message[] = body.messages ?? []
  const last = messages.at(-1)
  if (last?.role === "tool") return { text: "done after tool" }
  const user = textOf([...messages].reverse().find((m) => m.role === "user")?.content)
  const tools: string[] = (body.tools ?? []).map((t: any) => t?.function?.name)
  if (user.includes("You are a subagent spawned")) return { text: "subagent reply" }
  if (user.includes("E2E-SUBAGENT-OK") && tools.includes("subagent"))
    return { tool: { name: "subagent", args: { agent: "general", description: "role test", prompt: "--role historian Summarise the Peace of Westphalia in one line." } } }
  if (user.includes("E2E-SUBAGENT-BAD") && tools.includes("subagent"))
    return { tool: { name: "subagent", args: { agent: "general", description: "role test", prompt: "--role historain Summarise it." } } }
  if (user.includes("E2E-ROLES-TOOL") && tools.includes("roles")) return { tool: { name: "roles", args: { action: "list", query: "debug" } } }
  return { text: "ok" }
}

function chunk(delta: object, finish: string | null = null, usage?: object) {
  return `data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", created: 0, model: "fake-model", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname.endsWith("/models"))
      return Response.json({ object: "list", data: [{ id: "fake-model", object: "model" }] })
    if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
    const body = await request.json()
    const reply = decide(body)
    appendFileSync(LOG, `${JSON.stringify({ at: Date.now(), reply, body })}\n`)
    const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
    if (!body.stream) {
      const message = reply.tool
        ? { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) } }] }
        : { role: "assistant", content: reply.text }
      return Response.json({ id: "fake", object: "chat.completion", created: 0, model: "fake-model", choices: [{ index: 0, message, finish_reason: reply.tool ? "tool_calls" : "stop" }], usage })
    }
    const events = reply.tool
      ? [
          chunk({ role: "assistant", tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: "function", function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) } }] }),
          chunk({}, "tool_calls", usage),
        ]
      : [chunk({ role: "assistant", content: reply.text }), chunk({}, "stop", usage)]
    return new Response(`${events.join("")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
  },
})
console.log(`fake llm on ${PORT}`)
