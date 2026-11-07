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
    # Astra/Sol/Luna deliberately have no default URL or model. The external
    # API proxy owns those identifiers; configuration must provide them.
    "astra": {"base_url_env": "ASTRA_API_BASE_URL", "key_env": "ASTRA_API_KEY", "model_env": "ASTRA_MODEL", "fallback_base_url_env": "OPENAI_API_BASE_URL", "fallback_key_env": "OPENAI_API_KEY", "default_model": None, "auth": True},
    "sol": {"base_url_env": "SOL_API_BASE_URL", "key_env": "SOL_API_KEY", "model_env": "SOL_MODEL", "fallback_base_url_env": "OPENAI_API_BASE_URL", "fallback_key_env": "OPENAI_API_KEY", "default_model": None, "auth": True},
    "luna": {"base_url_env": "LUNA_API_BASE_URL", "key_env": "LUNA_API_KEY", "model_env": "LUNA_MODEL", "fallback_base_url_env": "OPENAI_API_BASE_URL", "fallback_key_env": "OPENAI_API_KEY", "default_model": None, "auth": True},
    "openai": {"base_url_env": "OPENAI_API_BASE_URL", "key_env": "OPENAI_API_KEY", "model_env": "OPENAI_MODEL", "default_model": None, "auth": True},
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
        endpoint = config.get("base_url") or os.environ.get(config.get("base_url_env", "")) or os.environ.get(config.get("fallback_base_url_env", ""), "")
        key_env = config.get("key_env") or ""
        fallback_key_env = config.get("fallback_key_env") or ""
        key = (os.environ.get(key_env) if key_env else None) or (os.environ.get(fallback_key_env) if fallback_key_env else None)
        result[name] = {
            "configured": bool(key) and bool(endpoint) if config["key_env"] else True,
            "model": os.environ.get(config["model_env"], config["default_model"]),
            "endpoint": endpoint,
            "requires_local_service": name == "ollama",
        }
    return result


def _extract_streamed_content(body):
    """Parse common OpenAI-compatible and Ollama SSE frames without logging them."""
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        raise ProviderError("Provider returned an invalid streaming response.") from None
    chunks = []
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        raw = line[5:].strip()
        if not raw or raw == "[DONE]":
            continue
        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            continue
        delta = event.get("choices", [{}])[0].get("delta", {}).get("content") if isinstance(event.get("choices"), list) else None
        if delta is None and isinstance(event.get("message"), dict):
            delta = event["message"].get("content")
        if delta is None and event.get("type") == "response.output_text.delta":
            delta = event.get("delta")
        if isinstance(delta, str):
            chunks.append(delta)
    if not chunks:
        raise ProviderError("Provider returned no streamed assistant text.")
    return "".join(chunks), len(chunks)


def generate(provider, messages, *, model=None, timeout=60, stream=False):
    if provider not in PROVIDERS:
        raise ProviderError("Provider must be one of: astra, sol, luna, openai, grok, openrouter, ollama.")
    if not isinstance(messages, list) or not messages:
        raise ProviderError("messages must be a non-empty list.")
    config = PROVIDERS[provider]
    base_url = config.get("base_url") or os.environ.get(config.get("base_url_env", "")) or os.environ.get(config.get("fallback_base_url_env", ""))
    key = (os.environ.get(config["key_env"]) or os.environ.get(config.get("fallback_key_env", ""))) if config["key_env"] else None
    if not base_url:
        raise ProviderError(f"Required environment variable is unset: {config.get('base_url_env', 'provider endpoint')}")
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
    selected_model = model or os.environ.get(config["model_env"], config["default_model"] or "")
    if not isinstance(selected_model, str) or not selected_model.strip():
        raise ProviderError("A non-empty model name is required.")

    if provider == "ollama":
        payload = {"model": selected_model, "messages": messages, "stream": bool(stream)}
    else:
        payload = {"model": selected_model, "messages": messages, "stream": bool(stream)}

    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    if provider == "openrouter":
        headers["HTTP-Referer"] = "https://github.com/emzylavish-art/adrians-mind-command-os"
        headers["X-Title"] = "Adrian's Mind Command OS"

    request = urllib.request.Request(
        base_url, data=json.dumps(payload).encode("utf-8"),
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
        if stream:
            answer, chunk_count = _extract_streamed_content(body)
            return {"provider": provider, "model": selected_model, "content": answer, "streamed": True, "chunk_count": chunk_count}
        data = json.loads(body.decode("utf-8"))
        if provider == "ollama":
            answer = data["message"]["content"]
        else:
            answer = data["choices"][0]["message"]["content"]
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, IndexError, TypeError):
        raise ProviderError("Provider returned an unexpected response format.") from None
    return {"provider": provider, "model": selected_model, "content": answer}


def route_order():
    """Configured primary/secondary/fallback order, without claiming readiness."""
    configured = []
    for name in ("astra", "sol", "luna"):
        status = provider_status()[name]
        if status["configured"] and status["endpoint"] and status["model"]:
            configured.append(name)
    return configured


def generate_routed(messages, *, timeout=60, model=None, stream=False):
    """Try Astra, then Sol, then Luna and return auditable route evidence."""
    errors = []
    attempted = []
    for provider in route_order():
        attempted.append(provider)
        try:
            result = generate(provider, messages, model=model, timeout=timeout, stream=stream)
            result["route"] = {"attempted": attempted, "selected": provider, "errors": errors}
            return result
        except ProviderError as exc:
            errors.append({"provider": provider, "error": str(exc)})
    raise ProviderError("No configured Astra, Sol, or Luna route succeeded.")


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--provider", choices=sorted(PROVIDERS))
    parser.add_argument("--route", action="store_true", help="Route Astra -> Sol -> Luna using configured endpoints.")
    parser.add_argument("--model")
    parser.add_argument("--prompt")
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--stream", action="store_true")
    args = parser.parse_args()
    if args.status:
        print(json.dumps(provider_status(), indent=2))
        return
    if (not args.provider and not args.route) or not args.prompt:
        parser.error("provide --status or --route/--provider with --prompt")
    try:
        parsed_prompt = json.loads(args.prompt)
        messages = parsed_prompt if isinstance(parsed_prompt, list) else [{"role": "user", "content": args.prompt}]
    except json.JSONDecodeError:
        messages = [{"role": "user", "content": args.prompt}]
    try:
        result = generate_routed(messages, model=args.model, timeout=args.timeout, stream=args.stream) if args.route else generate(args.provider, messages, model=args.model, timeout=args.timeout, stream=args.stream)
        print(json.dumps(result, ensure_ascii=False))
    except ProviderError as exc:
        print(json.dumps({"error": str(exc)}), file=__import__("sys").stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
