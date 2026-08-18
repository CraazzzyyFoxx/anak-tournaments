from shared.domain.player_sub_roles import normalize_sub_role


def test_normalize_sub_role_keeps_dynamic_values_but_clears_empty_strings() -> None:
    assert normalize_sub_role("  Flex Support  ") == "flex_support"
    assert normalize_sub_role("anchor-tank") == "anchor-tank"
    assert normalize_sub_role("   ") is None
    assert normalize_sub_role(None) is None
