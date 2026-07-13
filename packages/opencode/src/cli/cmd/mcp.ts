import { cmd } from "./cmd"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Config } from "../../config/config"

export const McpCommand = cmd({
  command: "mcp",
  builder: (yargs) => yargs.command(McpAddCommand).demandCommand(),
  async handler() {},
})

export const McpAddCommand = cmd({
  command: "add",
  describe: "add an MCP server",
  async handler() {
    UI.empty()
    prompts.intro("Add MCP server")

    const name = await prompts.text({
      message: "Enter MCP server name",
      validate: (x) => (x && x.length > 0 ? undefined : "Required"),
    })
    if (prompts.isCancel(name)) throw new UI.CancelledError()

    const type = await prompts.select({
      message: "Select MCP server type",
      options: [
        {
          label: "Local",
          value: "local",
          hint: "Run a local command",
        },
        {
          label: "Remote",
          value: "remote",
          hint: "Connect to a remote URL",
        },
      ],
    })
    if (prompts.isCancel(type)) throw new UI.CancelledError()

    if (type === "local") {
      const command = await prompts.text({
        message: "Enter command to run",
        placeholder: "e.g., opencode x @modelcontextprotocol/server-filesystem",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (prompts.isCancel(command)) throw new UI.CancelledError()

      await Config.update({
        mcp: {
          [name]: {
            type: "local",
            command: command.trim().split(/\s+/),
          },
        },
      })
      prompts.log.info(`Local MCP server "${name}" configured with command: ${command}`)
      prompts.outro("MCP server added successfully")
      return
    }

    if (type === "remote") {
      const url = await prompts.text({
        message: "Enter MCP server URL",
        placeholder: "e.g., https://example.com/mcp",
        validate: (x) => {
          if (!x) return "Required"
          if (x.length === 0) return "Required"
          const isValid = URL.canParse(x)
          return isValid ? undefined : "Invalid URL"
        },
      })
      if (prompts.isCancel(url)) throw new UI.CancelledError()

      const secret = await prompts.password({
        message: "Enter bearer token (optional)",
      })
      if (prompts.isCancel(secret)) throw new UI.CancelledError()

      const headers = secret ? { Authorization: `Bearer ${secret}` } : undefined
      const client = new Client({
        name: "opencode",
        version: "1.0.0",
      })
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: {
          headers,
        },
      })
      await client.connect(transport)
      await client.listTools()
      await client.transport?.close()
      await client.close()
      await Config.update({
        mcp: {
          [name]: {
            type: "remote",
            url,
            headers,
          },
        },
      })
      prompts.log.info(`Remote MCP server "${name}" configured with URL: ${url}`)
    }

    prompts.outro("MCP server added successfully")
  },
})
