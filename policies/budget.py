"""Deterministic budget policy for model execution.

This module performs no provider calls and does not infer that a local model exists.
Callers provide spend totals and explicit local-route availability.
"""
from dataclasses import dataclass
from enum import Enum


class BudgetState(str, Enum):
    NORMAL = "normal"
    WARNING = "warning"
    EXHAUSTED = "exhausted"


class BudgetAction(str, Enum):
    ALLOW = "allow"
    LOCAL_FALLBACK = "local_fallback"
    PAUSE = "pause"
    OWNER_OVERRIDE = "owner_override"


@dataclass(frozen=True)
class BudgetDecision:
    state: BudgetState
    action: BudgetAction
    spent: float
    limit: float
    utilization: float
    reason: str


def evaluate_budget(
    spent: float,
    limit: float,
    *,
    warning_fraction: float = 0.80,
    local_route_available: bool = False,
    owner_override: bool = False,
) -> BudgetDecision:
    """Evaluate budget usage without spending money or invoking a provider.

    At >= 80% the state becomes WARNING. At >= 100%, use an explicitly
    configured local route or pause. An owner override is explicit and
    does not erase the budget state.
    """
    if isinstance(spent, bool) or isinstance(limit, bool):
        raise ValueError("spent and limit must be numeric values")
    if spent < 0 or limit <= 0:
        raise ValueError("spent must be >= 0 and limit must be > 0")
    if not 0 < warning_fraction < 1:
        raise ValueError("warning_fraction must be between 0 and 1")

    utilization = spent / limit
    if utilization >= 1:
        state = BudgetState.EXHAUSTED
        if owner_override:
            action = BudgetAction.OWNER_OVERRIDE
            reason = "Budget exhausted; explicit owner override permits continuation."
        elif local_route_available:
            action = BudgetAction.LOCAL_FALLBACK
            reason = "Budget exhausted; route to configured local execution."
        else:
            action = BudgetAction.PAUSE
            reason = "Budget exhausted and no local route is configured; pause execution."
    elif utilization >= warning_fraction:
        state = BudgetState.WARNING
        action = BudgetAction.ALLOW
        reason = "Budget warning threshold reached; execution remains allowed."
    else:
        state = BudgetState.NORMAL
        action = BudgetAction.ALLOW
        reason = "Budget is below the warning threshold."

    return BudgetDecision(state, action, float(spent), float(limit), utilization, reason)
