import unittest

from budget import BudgetAction, BudgetState, evaluate_budget


class BudgetPolicyTests(unittest.TestCase):
    def test_below_warning_allows(self):
        result = evaluate_budget(79, 100)
        self.assertEqual(result.state, BudgetState.NORMAL)
        self.assertEqual(result.action, BudgetAction.ALLOW)

    def test_warning_boundary_is_inclusive(self):
        result = evaluate_budget(80, 100)
        self.assertEqual(result.state, BudgetState.WARNING)
        self.assertEqual(result.action, BudgetAction.ALLOW)

    def test_exhaustion_pauses_without_local_route(self):
        result = evaluate_budget(100, 100)
        self.assertEqual(result.state, BudgetState.EXHAUSTED)
        self.assertEqual(result.action, BudgetAction.PAUSE)

    def test_exhaustion_uses_configured_local_route(self):
        result = evaluate_budget(105, 100, local_route_available=True)
        self.assertEqual(result.action, BudgetAction.LOCAL_FALLBACK)

    def test_owner_override_is_explicit(self):
        result = evaluate_budget(100, 100, owner_override=True)
        self.assertEqual(result.action, BudgetAction.OWNER_OVERRIDE)

    def test_invalid_values_rejected(self):
        for args in [(-1, 100), (0, 0), (10, -1)]:
            with self.assertRaises(ValueError):
                evaluate_budget(*args)


if __name__ == "__main__":
    unittest.main()
