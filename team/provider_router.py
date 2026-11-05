#!/usr/bin/env python3
"""Environment-only model routing for GPT, xAI/Grok, OpenRouter, and Ollama.

No provider is contacted until generate() is explicitly called. API keys are
read from environment variables and never written to configuration or logs.

Runtime brain switch: read_active_brain() is re-evaluated on every resolve /
generate call (env MIND_ACTIVE_BRAIN, else JSON file MIND_ACTIVE_BRAIN_FILE or
team/runtime/active_brain.json). Role defaults: GPT = execution/testing,
xAI = analysis. Missing keys fail loudly; nothing is faked.

Key policy:
  - OPENAI_API_KEY: execution / testing / routine GPT calls.
  - XAI scoped chat key lookup (call time): /home/box/.secrets/xai/<bot>.key
    (bot from bot= arg or FLEET_BOT_NAME, default provider-router; dir override
    XAI_KEYS_DIR), then env XAI_API_KEY, then /home/box/.secrets/XAI_API_KEY.
  - XAI_MANAGEMENT_API_KEY is for key minting only and is never used here.
"""
import json
import os
import urllib.error
import urllib.request

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "policies"))
from budget import BudgetAction, evaluate_budget

BRAIN_GPT = "gpt"
BRAIN_XAI = "xai"
BRAINS = (BRAIN_GPT, BRAIN_XAI)

ROLE_DEFAULTS = {
    "execution": BRAIN_GPT,
    "testing": BRAIN_GPT,
    "analysis": BRAIN_XAI,
}

DEFAULT_ACTIVE_BRAIN = BRAIN_GPT
DEFAULT_BRAIN_FILE = ROOT / "team" / "runtime" / "active_brain.json"

OPENAI_KEY_ENV = "OPENAI_API_KEY"
XAI_SCOPED_KEY_ENV = "XAI_API_KEY"
# XAI_MANAGEMENT_API_KEY is for key minting only; never read on the call path.
XAI_SCOPED_KEY_FILE = "/home/box/.secrets/XAI_API_KEY"
XAI_KEYS_DIR_DEFAULT = "/home/box/.secrets/xai"
XAI_KEYS_DIR_ENV = "XAI_KEYS_DIR"
FLEET_BOT_NAME_ENV = "FLEET_BOT_NAME"
DEFAULT_FLEET_BOT = "provider-router"

PROVIDERS = {
    "openai": {
        "base_url": "https://api.openai.com/v1/chat/completions",
        "key_env": OPENAI_KEY_ENV,
        "model_env": "OPENAI_MODEL",
        "default_model": "gpt-4o-mini",
        "auth": True,
        "brain": BRAIN_GPT,
        "paid": True,
    },
    "gpt": {
        "base_url": "https://api.openai.com/v1/chat/completions",
        "key_env": OPENAI_KEY_ENV,
        "model_env": "OPENAI_MODEL",
        "default_model": "gpt-4o-mini",
        "auth": True,
        "brain": BRAIN_GPT,
        "paid": True,
    },
    "grok": {
        "base_url": "https://api.x.ai/v1/chat/completions",
        "key_env": XAI_SCOPED_KEY_ENV,
        "model_env": "XAI_MODEL",
        "default_model": "grok-3",
        "auth": True,
        "brain": BRAIN_XAI,
        "paid": True,
    },
    "xai": {
        "base_url": "https://api.x.ai/v1/chat/completions",
        "key_env": XAI_SCOPED_KEY_ENV,
        "model_env": "XAI_MODEL",
        "default_model": "grok-3",
        "auth": True,
        "brain": BRAIN_XAI,
        "paid": True,
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1/chat/completions",
        "key_env": "OPENROUTER_API_KEY",
        "model_env": "OPENROUTER_MODEL",
        "default_model": "openai/gpt-4o-mini",
        "auth": True,
        "brain": None,
        "paid": True,
    },
    "ollama": {
        "base_url": "http://127.0.0.1:11434/api/chat",
        "key_env": None,
        "model_env": "OLLAMA_MODEL",
        "default_model": "llama3.2",
        "auth": False,
        "brain": None,
        "paid": False,
    },
}

LANES = {
    "team.provider_router.generate": {
        "description": "team/provider_router.py generate()",
        "role": "execution",
        "follows_active_brain": True,
    },
    "team.runner.model.generate": {
        "description": "team/runner.py tool model.generate → provider_router",
        "role": "execution",
        "follows_active_brain": True,
    },
    "team.worker.queue_job": {
        "description": "team/worker.py queued model jobs via runner",
        "role": "execution",
        "follows_active_brain": True,
    },
    "app.chat.chosenProvider": {
        "description": "src/lib/mind/providers.ts chosenProvider / chat send",
        "role": "execution",
        "follows_active_brain": True,
    },
    "app.provider_call.selectProvider": {
        "description": "src/lib/mind/provider-call.ts selectProvider",
        "role": "testing",
        "follows_active_brain": True,
    },
    "app.xai_adapter.callXaiChat": {
        "description": "src/lib/mind/xai-adapter.ts callXaiChat (analysis path)",
        "role": "analysis",
        "follows_active_brain": True,
    },
    "app.model_tiers.resolve": {
        "description": "src/lib/mind/model-tiers.ts resolveModelTier (xAI tier picker)",
        "role": "analysis",
        "follows_active_brain": True,
    },
    "app.fleet.model_tool": {
        "description": "src/lib/mind/fleet.ts model tool (currently refuses spend)",
        "role": "execution",
        "follows_active_brain": True,
    },
    "app.agents.bounded_planner": {
        "description": "Agents screen bounded planner (Grok path per architecture doc)",
        "role": "analysis",
        "follows_active_brain": True,
    },
}


class ProviderError(RuntimeError):
    """Safe provider error that does not include secrets or response bodies."""

    def __init__(self, message, *, http_status=None):
        super().__init__(message)
        self.http_status = http_status


def _normalize_brain(value):
    if value is None:
        return None
    text = str(value).strip().lower()
    aliases = {
        "gpt": BRAIN_GPT,
        "openai": BRAIN_GPT,
        "chatgpt": BRAIN_GPT,
        "xai": BRAIN_XAI,
        "grok": BRAIN_XAI,
        "x-ai": BRAIN_XAI,
    }
    return aliases.get(text)


def _normalize_role(role):
    text = (role or "").strip().lower()
    if text in ROLE_DEFAULTS:
        return text
    return "execution"


def _env_nonempty(environ, name):
    value = environ.get(name)
    return bool(value and str(value).strip())


def read_active_brain(*, env=None, brain_file=None):
    """Re-read Adrian's active brain on every call. Never caches across calls."""
    environ = env if env is not None else os.environ
    raw = environ.get("MIND_ACTIVE_BRAIN") or environ.get("ADRIAN_ACTIVE_BRAIN")
    brain = _normalize_brain(raw)
    if brain:
        return brain

    path = brain_file
    if path is None:
        file_env = environ.get("MIND_ACTIVE_BRAIN_FILE")
        path = Path(file_env) if file_env else DEFAULT_BRAIN_FILE
    else:
        path = Path(path)
    try:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                brain = _normalize_brain(data.get("active_brain") or data.get("brain"))
                if brain:
                    return brain
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        pass
    return DEFAULT_ACTIVE_BRAIN


def brain_to_provider(brain):
    normalized = _normalize_brain(brain) or DEFAULT_ACTIVE_BRAIN
    if normalized == BRAIN_GPT:
        return "openai"
    return "grok"


def read_secret_file(path):
    """Read a secrets file and strip whitespace. Never logs the value."""
    try:
        file_path = Path(path)
        if not file_path.is_file():
            return None
        value = file_path.read_text(encoding="utf-8").strip()
        return value or None
    except OSError:
        return None


def read_xai_scoped_key_file(path=None):
    """Read shared scoped chat key from /home/box/.secrets/XAI_API_KEY."""
    return read_secret_file(path if path is not None else XAI_SCOPED_KEY_FILE)


def resolve_fleet_bot(*, bot=None, env=None):
    environ = env if env is not None else os.environ
    if bot is not None and str(bot).strip():
        return str(bot).strip()
    named = environ.get(FLEET_BOT_NAME_ENV)
    if named and str(named).strip():
        return str(named).strip()
    return DEFAULT_FLEET_BOT


def resolve_xai_keys_dir(*, env=None, keys_dir=None):
    if keys_dir is not None:
        return Path(keys_dir)
    environ = env if env is not None else os.environ
    override = environ.get(XAI_KEYS_DIR_ENV)
    if override and str(override).strip():
        return Path(str(override).strip())
    return Path(XAI_KEYS_DIR_DEFAULT)


def per_bot_xai_key_path(*, bot=None, env=None, keys_dir=None):
    name = resolve_fleet_bot(bot=bot, env=env)
    safe = "".join(ch for ch in name if ch.isalnum() or ch in "-_")
    if not safe:
        safe = DEFAULT_FLEET_BOT
    return resolve_xai_keys_dir(env=env, keys_dir=keys_dir) / f"{safe}.key"


def resolve_xai_key(
    *,
    role=None,
    env=None,
    secrets_path=None,
    bot=None,
    keys_dir=None,
):
    """Resolve scoped xAI chat key.

    Order: per-bot file (XAI_KEYS_DIR/<bot>.key), env XAI_API_KEY, shared
    secrets file. Management keys are not consulted. Never logs key values.
    """
    del role  # kept for call-site compat; does not gate key choice
    environ = env if env is not None else os.environ
    bot_name = resolve_fleet_bot(bot=bot, env=environ)
    bot_path = per_bot_xai_key_path(bot=bot_name, env=environ, keys_dir=keys_dir)
    from_bot = read_secret_file(bot_path)
    if from_bot:
        return {
            "key": from_bot,
            "key_env": XAI_SCOPED_KEY_ENV,
            "key_source": "per_bot_file",
            "bot": bot_name,
            "path": str(bot_path),
            "analysis_only": False,
        }
    if _env_nonempty(environ, XAI_SCOPED_KEY_ENV):
        return {
            "key": environ.get(XAI_SCOPED_KEY_ENV).strip(),
            "key_env": XAI_SCOPED_KEY_ENV,
            "key_source": "env",
            "bot": bot_name,
            "path": None,
            "analysis_only": False,
        }
    shared_path = secrets_path if secrets_path is not None else XAI_SCOPED_KEY_FILE
    from_file = read_xai_scoped_key_file(shared_path)
    if from_file:
        return {
            "key": from_file,
            "key_env": XAI_SCOPED_KEY_ENV,
            "key_source": "file",
            "bot": bot_name,
            "path": str(shared_path),
            "analysis_only": False,
        }
    raise ProviderError(
        f"No scoped xAI chat key for bot={bot_name}: missing "
        f"{bot_path}, unset {XAI_SCOPED_KEY_ENV}, and missing/empty "
        f"{XAI_SCOPED_KEY_FILE}."
    )


def resolve_openai_key(*, env=None):
    environ = env if env is not None else os.environ
    if not _env_nonempty(environ, OPENAI_KEY_ENV):
        raise ProviderError(f"Required environment variable is unset: {OPENAI_KEY_ENV}")
    return {
        "key": environ.get(OPENAI_KEY_ENV).strip(),
        "key_env": OPENAI_KEY_ENV,
        "analysis_only": False,
    }


def provider_for_role(role, *, env=None, brain_file=None):
    active = read_active_brain(env=env, brain_file=brain_file)
    return (
        brain_to_provider(active),
        active,
        ROLE_DEFAULTS.get(_normalize_role(role), BRAIN_XAI),
    )


def resolve_provider_for_lane(lane_id, *, env=None, brain_file=None):
    """Return which provider/brain a lane would use after the current switch."""
    lane = LANES.get(lane_id)
    if lane is None:
        raise ProviderError(f"Unknown lane: {lane_id}")
    environ = env if env is not None else os.environ
    active = read_active_brain(env=environ, brain_file=brain_file)
    role = lane["role"]
    role_default = ROLE_DEFAULTS.get(role, BRAIN_XAI)
    brain = active if lane.get("follows_active_brain", True) else role_default
    provider = brain_to_provider(brain)
    config = PROVIDERS[provider]

    key_env = config["key_env"]
    key_configured = False
    key_source = None
    key_blocked = None
    if provider in ("grok", "xai"):
        try:
            resolved = resolve_xai_key(role=role, env=environ, bot=environ.get(FLEET_BOT_NAME_ENV))
            key_env = resolved["key_env"]
            key_configured = True
            key_source = resolved["key_source"]
        except ProviderError as exc:
            key_configured = False
            key_blocked = str(exc)
            key_env = XAI_SCOPED_KEY_ENV
            key_source = "missing"
    elif key_env:
        key_configured = _env_nonempty(environ, key_env)
        key_source = "env" if key_configured else "missing"
    else:
        key_configured = True
        key_source = "none"

    return {
        "lane": lane_id,
        "description": lane["description"],
        "role": role,
        "role_default_brain": role_default,
        "active_brain": active,
        "resolved_brain": brain,
        "provider": provider,
        "key_env": key_env,
        "key_configured": key_configured,
        "key_source": key_source,
        "key_blocked": key_blocked,
        "model": environ.get(config["model_env"], config["default_model"]),
    }


def verify_lanes(*, env=None, brain_file=None):
    active = read_active_brain(env=env, brain_file=brain_file)
    rows = [
        resolve_provider_for_lane(lane_id, env=env, brain_file=brain_file)
        for lane_id in sorted(LANES)
    ]
    return {
        "active_brain": active,
        "lane_count": len(rows),
        "lanes": rows,
        "all_follow_active_brain": all(
            row["resolved_brain"] == active for row in rows
        ),
    }


def require_key(provider, *, role="execution", env=None, bot=None, keys_dir=None):
    """Fail loudly when a required key is missing. Never fabricate a response."""
    if provider not in PROVIDERS:
        raise ProviderError(
            "Provider must be one of: " + ", ".join(sorted(set(PROVIDERS)))
        )
    config = PROVIDERS[provider]
    environ = env if env is not None else os.environ
    if not config["auth"]:
        return None
    if provider in ("openai", "gpt"):
        return resolve_openai_key(env=environ)["key"]
    if provider in ("grok", "xai"):
        return resolve_xai_key(
            role=role, env=environ, bot=bot, keys_dir=keys_dir
        )["key"]
    key = environ.get(config["key_env"])
    if not key or not str(key).strip():
        raise ProviderError(
            f"Required environment variable is unset: {config['key_env']}"
        )
    return key


def provider_status(*, env=None):
    environ = env if env is not None else os.environ
    active = read_active_brain(env=environ)
    result = {
        "active_brain": active,
        "role_defaults": dict(ROLE_DEFAULTS),
        "key_policy": {
            "execution_testing": OPENAI_KEY_ENV,
            "xai_scoped": XAI_SCOPED_KEY_ENV,
            "xai_scoped_file": XAI_SCOPED_KEY_FILE,
            "xai_keys_dir": XAI_KEYS_DIR_DEFAULT,
            "xai_keys_dir_env": XAI_KEYS_DIR_ENV,
            "fleet_bot_env": FLEET_BOT_NAME_ENV,
            "default_bot": DEFAULT_FLEET_BOT,
        },
        "providers": {},
    }
    seen = set()
    for name, config in PROVIDERS.items():
        display = name if name in ("openai", "grok", "openrouter", "ollama") else None
        if display is None or display in seen:
            continue
        seen.add(display)
        if display == "grok":
            try:
                resolved = resolve_xai_key(env=environ)
                configured = True
                key_source = resolved["key_source"]
            except ProviderError:
                configured = False
                key_source = "missing"
        elif config["key_env"]:
            configured = _env_nonempty(environ, config["key_env"])
            key_source = "env" if configured else "missing"
        else:
            configured = True
            key_source = "none"
        result["providers"][display] = {
            "configured": configured,
            "key_source": key_source,
            "model": environ.get(config["model_env"], config["default_model"]),
            "endpoint": config["base_url"],
            "brain": config["brain"],
            "requires_local_service": display == "ollama",
        }
    return result


def generate(
    provider,
    messages,
    *,
    model=None,
    timeout=60,
    env=None,
    role=None,
    max_tokens=None,
    bot=None,
    keys_dir=None,
):
    environ = env if env is not None else os.environ
    mapped = _normalize_brain(provider)
    if mapped:
        provider = brain_to_provider(mapped)
    if provider not in PROVIDERS:
        raise ProviderError(
            "Provider must be one of: "
            + ", ".join(sorted({"openai", "gpt", "grok", "xai", "openrouter", "ollama"}))
        )
    if not isinstance(messages, list) or not messages:
        raise ProviderError("messages must be a non-empty list.")

    config = PROVIDERS[provider]
    role_name = _normalize_role(
        role
        if role is not None
        else ("analysis" if config.get("brain") == BRAIN_XAI else "execution")
    )
    # Explicit provider request still honors analysis-only management guard.
    if provider in ("grok", "xai") and role is None:
        role_name = "analysis"
    elif provider in ("openai", "gpt") and role is None:
        role_name = "execution"

    key = require_key(
        provider, role=role_name, env=environ, bot=bot, keys_dir=keys_dir
    )
    if config.get("paid"):
        limit_raw = environ.get("MIND_COMMAND_BUDGET_LIMIT_USD")
        spent_raw = environ.get("MIND_COMMAND_BUDGET_SPENT_USD")
        if not limit_raw or not spent_raw:
            raise ProviderError(
                "Paid provider blocked: set MIND_COMMAND_BUDGET_LIMIT_USD and "
                "MIND_COMMAND_BUDGET_SPENT_USD for budget preflight."
            )
        try:
            decision = evaluate_budget(
                float(spent_raw),
                float(limit_raw),
                owner_override=environ.get("MIND_COMMAND_BUDGET_OWNER_OVERRIDE") == "1",
            )
        except (TypeError, ValueError):
            raise ProviderError(
                "Paid provider blocked: budget values must be valid non-negative numbers."
            ) from None
        if decision.action == BudgetAction.PAUSE:
            raise ProviderError("Paid provider paused: configured budget is exhausted.")

    selected_model = model or environ.get(config["model_env"], config["default_model"])
    if not isinstance(selected_model, str) or not selected_model.strip():
        raise ProviderError("A non-empty model name is required.")

    if provider == "ollama":
        payload = {"model": selected_model, "messages": messages, "stream": False}
    else:
        payload = {"model": selected_model, "messages": messages}
        if max_tokens is not None:
            payload["max_tokens"] = int(max_tokens)

    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    if provider == "openrouter":
        headers["HTTP-Referer"] = (
            "https://github.com/emzylavish-art/adrians-mind-command-os"
        )
        headers["X-Title"] = "Adrian's Mind Command OS"

    request = urllib.request.Request(
        config["base_url"],
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    http_status = None
    try:
        with urllib.request.urlopen(request, timeout=int(timeout)) as response:
            http_status = getattr(response, "status", None) or response.getcode()
            body = response.read(2_000_001)
            if len(body) > 2_000_000:
                raise ProviderError("Provider response exceeded the 2 MB limit.")
    except urllib.error.HTTPError as exc:
        raise ProviderError(
            f"{provider} returned HTTP {exc.code}.",
            http_status=exc.code,
        ) from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ProviderError(f"{provider} request failed: {type(exc).__name__}.") from None

    try:
        data = json.loads(body.decode("utf-8"))
        if provider == "ollama":
            answer = data["message"]["content"]
        else:
            answer = data["choices"][0]["message"]["content"]
    except (
        UnicodeDecodeError,
        json.JSONDecodeError,
        KeyError,
        IndexError,
        TypeError,
    ):
        raise ProviderError("Provider returned an unexpected response format.") from None
    return {
        "provider": provider,
        "model": selected_model,
        "content": answer,
        "http_status": http_status,
        "role": role_name,
        "active_brain": read_active_brain(env=environ),
    }


def main():
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--verify-lanes", action="store_true")
    parser.add_argument(
        "--provider",
        choices=sorted({"openai", "gpt", "grok", "xai", "openrouter", "ollama"}),
    )
    parser.add_argument("--model")
    parser.add_argument("--prompt")
    parser.add_argument("--role", choices=sorted(ROLE_DEFAULTS))
    parser.add_argument("--bot", default=None)
    parser.add_argument("--max-tokens", type=int, default=None)
    parser.add_argument("--timeout", type=int, default=60)
    args = parser.parse_args()
    if args.status:
        print(json.dumps(provider_status(), indent=2))
        return
    if args.verify_lanes:
        print(json.dumps(verify_lanes(), indent=2))
        return
    if not args.provider or not args.prompt:
        parser.error(
            "provide --status, --verify-lanes, or both --provider and --prompt"
        )
    try:
        parsed_prompt = json.loads(args.prompt)
        messages = (
            parsed_prompt
            if isinstance(parsed_prompt, list)
            else [{"role": "user", "content": args.prompt}]
        )
    except json.JSONDecodeError:
        messages = [{"role": "user", "content": args.prompt}]
    try:
        result = generate(
            args.provider,
            messages,
            model=args.model,
            timeout=args.timeout,
            role=args.role,
            max_tokens=args.max_tokens,
            bot=args.bot,
        )
        print(json.dumps(result, ensure_ascii=False))
    except ProviderError as exc:
        print(json.dumps({"error": str(exc)}), file=__import__("sys").stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
