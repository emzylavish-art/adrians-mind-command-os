# Defensive Security Review

An offline, heuristic static review tool for source repositories owned by you or
that you are authorized to assess.

## Usage

```bash
python tools/security_review/security_review.py . --json
python tools/security_review/security_review.py ./src --out security-report.json
python -m unittest discover -s tools/security_review -p 'test_*.py'
```

The scanner checks source text for common risk patterns such as likely hardcoded
secrets, shell-enabled subprocess calls, dynamic evaluation, disabled TLS
verification, wildcard CORS, and unsafe pickle deserialization. It redacts likely
secret assignment values in excerpts.

## Limitations and safe use

- Offline only; it does not execute scanned code, exploit findings, or connect to hosts.
- Pattern matching is not a full parser. False positives and missed issues are possible.
- Use only on code you own or have permission to review.
- Do not treat its output as a security certification or penetration test.
