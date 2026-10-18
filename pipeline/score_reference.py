"""Independent re-implementation of the scorecard maths, used to check the page.

Reads the scorecard data files, recomputes every country's criteria, score and rank with
the default weights, prints the regional totals and writes tests/expected_scores.json,
which tests/check_pages.js compares with what the page itself computes.

Usage:
    python pipeline/score_reference.py
"""
import json
import math
import pathlib

import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data" / "scorecard"

# Default weights, as in the page.
CRITERIA = [
    ("s_access", lambda r: None if r["access_pct"] is None else 100 - r["access_pct"], 3),
    ("s_rural", lambda r: None if r["rural_access_pct"] is None else 100 - r["rural_access_pct"], 1),
    ("s_cooking", lambda r: None if r["clean_cooking_pct"] is None else 100 - r["clean_cooking_pct"], 2),
    ("s_kwh", lambda r: -math.log10(r["kwh_per_person"]) if r["kwh_per_person"] else None, 2),
    ("s_people", lambda r: math.log10(r["people_without_m"] + 0.1) if r["people_without_m"] is not None else None, 2),
    ("s_outages", lambda r: r["firms_outages_pct"], 1),
    ("s_oil", lambda r: r["oil_share_pct"], 1),
]


def num(v):
    return None if pd.isna(v) else float(v)


def main():
    wb = pd.read_csv(DATA / "ssa_world_bank_indicators.csv")
    owid = pd.read_csv(DATA / "ssa_owid_electricity.csv")
    d = wb.merge(owid, on="iso3", how="left")

    rows = []
    for _, r in d.iterrows():
        access, rural, urban = num(r.access_pct), num(r.rural_access_pct), num(r.urban_access_pct)
        if rural is not None and urban is not None and rural > urban:
            rural = None  # implausible: rural above urban (Chad 2024)
        pop, cooking, survey = num(r.population_2024), num(r.clean_cooking_pct), num(r.outages_survey_year)
        rows.append({
            "iso3": r.iso3, "country": r.country,
            "access_pct": access, "rural_access_pct": rural, "clean_cooking_pct": cooking,
            "kwh_per_person": round(r.electricity_demand_twh * 1e9 / r.population) if num(r.population) else None,
            "people_without_m": round(pop * (100 - access) / 1e7) / 10 if pop is not None and access is not None else None,
            "people_without_cooking_m": round(pop * (100 - cooking) / 1e7) / 10 if pop is not None and cooking is not None else None,
            "firms_outages_pct": num(r.firms_outages_pct) if survey is not None and survey >= 2020 else None,
            "oil_share_pct": num(r.oil_share_pct),
        })

    for key, value, _ in CRITERIA:
        vals = [value(r) for r in rows]
        present = [v for v in vals if v is not None]
        lo, hi = min(present), max(present)
        for r, v in zip(rows, vals):
            r[key] = None if v is None else round((v - lo) / (hi - lo) * 100, 1)

    for r in rows:
        have = [(k, w) for k, _, w in CRITERIA if r[k] is not None]
        r["score"] = round(sum(w * r[k] for k, w in have) / sum(w for _, w in have), 1)
    rows.sort(key=lambda r: (-r["score"], r["country"]))
    for i, r in enumerate(rows):
        r["rank"] = i + 1

    df = pd.DataFrame(rows)
    totals = {
        "people_without_m": float(round(df.people_without_m.sum(), 1)),
        "people_without_cooking_m": float(round(df.people_without_cooking_m.sum(), 1)),
        "countries_majority_without": int((df.access_pct < 50).sum()),
    }
    print("Top 5:", ", ".join(f"{r['rank']}. {r['country']} {r['score']}" for r in rows[:5]))
    print("Senegal:", next(f"rank {r['rank']}, score {r['score']}" for r in rows if r["iso3"] == "SEN"))
    print("Totals:", totals)

    out = ROOT / "tests" / "expected_scores.json"
    out.parent.mkdir(exist_ok=True)
    expected = {
        "totals": totals,
        "scores": [{k: r[k] for k in ("iso3", "rank", "score", *[c[0] for c in CRITERIA])} for r in rows],
    }
    out.write_text(json.dumps(expected, ensure_ascii=False, indent=1) + "\n")
    print(f"Wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
