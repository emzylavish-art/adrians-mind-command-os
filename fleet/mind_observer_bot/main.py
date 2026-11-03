"""Mind Observer entrypoint. Config root is this directory."""

from __future__ import annotations

import sys
from pathlib import Path

FLEET_ROOT = Path(__file__).resolve().parents[1]
if str(FLEET_ROOT) not in sys.path:
    sys.path.insert(0, str(FLEET_ROOT))

from harness.main import run


def main() -> int:
    return run(Path(__file__).resolve().parent)


if __name__ == "__main__":
    raise SystemExit(main())
