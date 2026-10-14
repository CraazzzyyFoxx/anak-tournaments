from shared.catalog_aliases import slugify


def test_slugify_is_the_rule_every_mirrored_map_image_was_named_by() -> None:
    assert slugify("King's Row") == "king-s-row"
    assert slugify("  Watchpoint: Gibraltar ") == "watchpoint-gibraltar"
    assert slugify("Колизей") == "map"
