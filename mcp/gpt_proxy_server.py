#!/usr/bin/env python3
"""
GPT MCP Proxy Server
Exposes OpenAI API tools so Claude, Grok, ChatGPT, or Astra can call your GPT models.
Uses OPENAI_API_KEY from environment.
"""

import os
import json
import asyncio
import sys
from typing import Any

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("Install: pip install mcp openai")
    raise

import openai

server = Server("gpt-proxy")

openai.api_key = os.getenv("OPENAI_API_KEY")
if not openai.api_key:
    # MCP stdio is a JSON-RPC byte stream; diagnostics must never corrupt it.
    print("Warning: OPENAI_API_KEY not set", file=sys.stderr)

@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="ask_gpt",
            description="Send a prompt to GPT (gpt-4o, o1, etc.). Uses your OpenAI API key.",
            inputSchema={
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "The user prompt"},
                    "model": {"type": "string", "description": "Model name", "default": "gpt-4o"},
                    "system": {"type": "string", "description": "Optional system message"},
                    "temperature": {"type": "number", "default": 0.7},
                    "max_tokens": {"type": "integer", "default": 4096}
                },
                "required": ["prompt"]
            }
        ),
        Tool(
            name="generate_image",
            description="Generate an image with DALL-E / GPT Image using your OpenAI key.",
            inputSchema={
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "size": {"type": "string", "default": "1024x1024"},
                    "model": {"type": "string", "default": "dall-e-3"}
                },
                "required": ["prompt"]
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    if name == "ask_gpt":
        messages = []
        if arguments.get("system"):
            messages.append({"role": "system", "content": arguments["system"]})
        messages.append({"role": "user", "content": arguments["prompt"]})

        response = openai.chat.completions.create(
            model=arguments.get("model", "gpt-4o"),
            messages=messages,
            temperature=arguments.get("temperature", 0.7),
            max_tokens=arguments.get("max_tokens", 4096)
        )
        text = response.choices[0].message.content or ""
        return [TextContent(type="text", text=text)]

    elif name == "generate_image":
        response = openai.images.generate(
            model=arguments.get("model", "dall-e-3"),
            prompt=arguments["prompt"],
            size=arguments.get("size", "1024x1024"),
            n=1
        )
        url = response.data[0].url if response.data else "No image"
        return [TextContent(type="text", text=f"Image URL: {url}")]

    return [TextContent(type="text", text=f"Unknown tool: {name}")]

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
