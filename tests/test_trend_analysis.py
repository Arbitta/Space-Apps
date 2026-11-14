import pytest

from services.trend_analysis import analyze_trend


def test_analyze_trend_detects_significant_increasing_trend():
    result = analyze_trend(
        [2020, 2021, 2022, 2023, 2024],
        [12.0, 12.3, 12.5, 12.8, 13.1],
    )

    assert result["slope"] == pytest.approx(0.27)
    assert result["change_per_decade"] == pytest.approx(2.7)
    assert result["total_change"] == pytest.approx(1.08)
    assert result["p_value"] < 0.05
    assert result["significant"] is True
    assert result["direction"] == "increasing"


def test_analyze_trend_detects_decreasing_direction():
    result = analyze_trend([2000, 2001, 2002, 2003], [10.0, 9.8, 9.6, 9.4])

    assert result["slope"] < 0
    assert result["direction"] == "decreasing"
    assert result["change_per_decade"] < 0


def test_confidence_interval_contains_estimated_slope():
    result = analyze_trend(
        [2000, 2001, 2002, 2003, 2004, 2005],
        [10.0, 10.2, 9.9, 10.3, 10.1, 10.4],
    )

    lower, upper = result["confidence_interval_95"]
    assert lower < result["slope"] < upper


@pytest.mark.parametrize(
    ("years", "values", "message"),
    [
        ([2020, 2021], [12.0], "misma longitud"),
        ([2020, 2021], [12.0, 12.1], "al menos 3"),
        ([2020, 2021, 2022], [12.0, 12.1, 12.2], "alpha"),
    ],
)
def test_analyze_trend_rejects_invalid_input(years, values, message):
    alpha = 1.5 if message == "alpha" else 0.05

    with pytest.raises(ValueError, match=message):
        analyze_trend(years, values, alpha=alpha)
