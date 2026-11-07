# REA — Reverse Engineer Anything

Runnable offline repository reconnaissance tool. It inventories source files, language counts, dependency manifests, likely entrypoints, and review markers. It does **not** run target code, make network requests, or print matched credential-like values.

## Run
```bash
python3 tools/rea/rea.py . --json --out rea-report.json
python3 tools/rea/rea.py /path/to/authorized/source
python3 -m unittest discover -s tools/rea -p 'test_*.py'
```

Use only on source/code you own or are authorized to inspect. Treat marker output as leads for manual review, not proof of a vulnerability.