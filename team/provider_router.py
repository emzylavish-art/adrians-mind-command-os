#!/usr/bin/env python3
"""Environment-only model routing for xAI/Grok, OpenRouter, and Ollama.

No provider is contacted until generate() is explicitly called. API keys are
read from environment variables and never written to configuration or logs.
"""
import json
import os
import urllib.error
import urllib.request

from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "policies"))
from budget import BudgetAction, evaluate_budget

PROVIDERS = {
    "grok": {
        "base_url": "https://api.x.ai/v1/chat/completions",
        "key_env": "XAI_API_KEY",
        "model_env": "XAI_MODEL",
        "default_model": "grok-3",
        "auth": True,
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1/chat/completions",
        "key_env": "OPENROUTER_API_KEY",
        "model_env": "OPENROUTER_MODEL",
        "default_model": "openai/gpt-4o-mini",
        "auth": True,
    },
    "ollama": {
        "base_url": "http://127.0.0.1:11434/api/chat",
        "key_env": None,
        "model_env": "OLLAMA_MODEL",
        "default_model": "llama3.2",
        "auth": False,
    },
}


class ProviderError(RuntimeError):
    """Safe provider error that does not include secrets or response bodies."""


def provider_status():
    result = {}
    for name, config in PROVIDERS.items():
        result[name] = {
            "configured": bool(os.environ.get(config["key_env"])) if config["key_env"] else True,
            "model": os.environ.get(config["model_env"], config["default_model"]),
            "endpoint": config["base_url"],
            "requires_local_service": name == "ollama",
        }
    return result


def generate(provider, messages, *, model=None, timeout=60):
    if provider not in PROVIDERS:
        raise ProviderError("Provider must be one of: grok, openrouter, ollama.")
    if not isinstance(messages, list) or not messages:
        raise ProviderError("messages must be a non-empty list.")
    config = PROVIDERS[provider]
    key = os.environ.get(config["key_env"]) if config["key_env"] else None
    if config["auth"] and not key:
        raise ProviderError(f"Required environment variable is unset: {config['key_env']}")
    if provider != "ollama":
        limit_raw = os.environ.get("MIND_COMMAND_BUDGET_LIMIT_USD")
        spent_raw = os.environ.get("MIND_COMMAND_BUDGET_SPENT_USD")
        if not limit_raw or not spent_raw:
            raise ProviderError("Paid provider blocked: set MIND_COMMAND_BUDGET_LIMIT_USD and MIND_COMMAND_BUDGET_SPENT_USD for budget preflight.")
        try:
            decision = evaluate_budget(
                float(spent_raw), float(limit_raw),
                owner_override=os.environ.get("MIND_COMMAND_BUDGET_OWNER_OVERRIDE") == "1",
            )
        except (TypeError, ValueError):
            raise ProviderError("Paid provider blocked: budget values must be valid non-negative numbers.") from None
        if decision.action == BudgetAction.PAUSE:
            raise ProviderError("Paid provider paused: configured budget is exhausted.")
    selected_model = model or os.environ.get(config["model_env"], config["default_model"])
    if not isinstance(selected_model, str) or not selected_model.strip():
        raise ProviderError("A non-empty model name is required.")

    if provider == "ollama":
        payload = {"model": selected_model, "messages": messages, "stream": False}
    else:
        payload = {"model": selected_model, "messages": messages}

    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    if provider == "openrouter":
        headers["HTTP-Referer"] = "https://github.com/emzylavish-art/adrians-mind-command-os"
        headers["X-Title"] = "Adrian's Mind Command OS"

    request = urllib.request.Request(
        config["base_url"], data=json.dumps(payload).encode("utf-8"),
        headers=headers, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=int(timeout)) as response:
            body = response.read(2_000_001)
            if len(body) > 2_000_000:
                raise ProviderError("Provider response exceeded the 2 MB limit.")
    except urllib.error.HTTPError as exc:
        raise ProviderError(f"{provider} returned HTTP {exc.code}.") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ProviderError(f"{provider} request failed: {type(exc).__name__}.") from None

    try:
        data = json.loads(body.decode("utf-8"))
        if provider == "ollama":
            answer = data["message"]["content"]
        else:
            answer = data["choices"][0]["message"]["content"]
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, IndexError, TypeError):
        raise ProviderError("Provider returned an unexpected response format.") from None
    return {"provider": provider, "model": selected_model, "content": answer}


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--provider", choices=sorted(PROVIDERS))
    parser.add_argument("--model")
    parser.add_argument("--prompt")
    parser.add_argument("--timeout", type=int, default=60)
    args = parser.parse_args()
    if args.status:
        print(json.dumps(provider_status(), indent=2))
        return
    if not args.provider or not args.prompt:
        parser.error("provide --status or both --provider and --prompt")
    try:
        parsed_prompt = json.loads(args.prompt)
        messages = parsed_prompt if isinstance(parsed_prompt, list) else [{"role": "user", "content": args.prompt}]
    except json.JSONDecodeError:
        messages = [{"role": "user", "content": args.prompt}]
    try:
        result = generate(args.provider, messages, model=args.model, timeout=args.timeout)
        print(json.dumps(result, ensure_ascii=False))
    except ProviderError as exc:
        print(json.dumps({"error": str(exc)}), file=__import__("sys").stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
