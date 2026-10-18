"""Build the CSV files the dashboards read (docs/data/) from the raw snapshot (pipeline/raw/).

Usage:
    python pipeline/build.py
"""
import csv
import json
import pathlib
import shutil

import pandas as pd

HERE = pathlib.Path(__file__).resolve().parent
RAW = HERE / "raw"
WB_DIR = RAW / "worldbank"
MANUAL = HERE / "manual"
DATA = HERE.parent / "docs" / "data"


def wb_records(name):
    """Non-empty records of a saved World Bank response, as (iso3, year, value)."""
    j = json.loads((WB_DIR / name).read_text())
    return [(r["countryiso3code"], int(r["date"]), r["value"]) for r in j[1] if r["value"] is not None]


def write_rows(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


# ---------------------------------------------------------------- Senegal dashboard

def build_senegal(owid):
    out = DATA / "senegal"
    out.mkdir(parents=True, exist_ok=True)

    # Electricity generation and mix, 2000-2024 (OWID)
    s = owid[(owid.country == "Senegal") & (owid.year.between(2000, 2024))].copy()
    m = pd.DataFrame({
        "year": s.year.astype(int),
        "generation_twh": s.electricity_generation,
        "demand_twh": s.electricity_demand,
        "net_imports_twh": s.net_elec_imports,
        "per_capita_kwh": s.per_capita_electricity.round(1),
        "oil_twh": s.oil_electricity,
        "gas_twh": s.gas_electricity,
        "coal_twh": s.coal_electricity,
        "solar_twh": s.solar_electricity,
        "wind_twh": s.wind_electricity,
        "hydro_twh": s.hydro_electricity,
        "bio_other_twh": (s.biofuel_electricity.fillna(0) + s.other_renewable_electricity.fillna(0)).round(3),
        "fossil_share_pct": s.fossil_share_elec.round(1),
        "renewables_share_pct": s.renewables_share_elec.round(1),
        "oil_share_pct": s.oil_share_elec.round(1),
    }).fillna(0)
    m.to_csv(out / "senegal_electricite_owid.csv", index=False)

    # Access to electricity: national, urban, rural (World Bank)
    def by_year(ind):
        return {y: v for _, y, v in wb_records(f"SEN_{ind}.json")}
    nat, urb, rur = by_year("EG.ELC.ACCS.ZS"), by_year("EG.ELC.ACCS.UR.ZS"), by_year("EG.ELC.ACCS.RU.ZS")
    write_rows(out / "senegal_acces_electricite_banque_mondiale.csv", [
        {"year": y, "access_pct": round(nat[y], 1),
         "urban_pct": round(urb[y], 1) if y in urb else "", "rural_pct": round(rur[y], 1) if y in rur else ""}
        for y in sorted(nat)
    ])

    # Electricity generated per person in 2024, comparison (OWID)
    names = {"Senegal": "Sénégal", "Cote d'Ivoire": "Côte d'Ivoire", "Ghana": "Ghana", "Nigeria": "Nigeria",
             "Morocco": "Maroc", "Africa": "Afrique", "World": "Monde", "France": "France"}
    c = owid[(owid.country.isin(names)) & (owid.year == 2024)][["country", "per_capita_electricity"]].copy()
    c["pays"] = c.country.map(names)
    c = c[["pays", "per_capita_electricity"]].rename(columns={"per_capita_electricity": "kwh_par_habitant"})
    c["kwh_par_habitant"] = c.kwh_par_habitant.round(0).astype(int)
    c.sort_values("kwh_par_habitant").to_csv(out / "comparaison_kwh_hab_2024.csv", index=False)

    # Outages and network losses: Senegal and peers (World Bank)
    peers = {"SEN": "Sénégal", "CIV": "Côte d'Ivoire", "GHA": "Ghana", "NGA": "Nigeria", "MAR": "Maroc",
             "SSF": "Afrique subsaharienne"}
    outages = wb_records("SEN-peers_IC.ELC.OUTG.ZS.json")
    latest = {code: max(y for cc, y, _ in outages if cc == code) for code, _, _ in outages}
    rows = [{"code": c_, "pays": peers[c_], "annee": y, "pct_entreprises": round(v, 1),
             "derniere": 1 if y == latest[c_] else 0, "libelle": f"{peers[c_]} ({y})"} for c_, y, v in outages]
    write_rows(out / "coupures_entreprises_banque_mondiale.csv", sorted(rows, key=lambda r: (r["code"], r["annee"])))
    losses = [{"code": c_, "pays": peers[c_], "year": y, "pertes_pct": round(v, 1)}
              for c_, y, v in wb_records("SEN-peers_EG.ELC.LOSS.ZS.json") if c_ in ("SEN", "SSF")]
    write_rows(out / "pertes_reseau_banque_mondiale.csv", sorted(losses, key=lambda r: (r["code"], r["year"])))

    # Hand-entered from documents: tariffs (CRSE), average price (GlobalPetrolPrices), gas milestones (press)
    for name in ("tarifs_senelec_2026.csv", "prix_menages_globalpetrolprices.csv", "jalons_gaz.csv"):
        shutil.copyfile(MANUAL / name, out / name)


# ---------------------------------------------------------------- Sub-Saharan Africa scorecard

COUNTRY_NAMES = {
    "Congo, Dem. Rep.": "DR Congo",
    "Congo, Rep.": "Republic of the Congo",
    "Gambia, The": "The Gambia",
    "Somalia, Fed. Rep.": "Somalia",
    "Cote d'Ivoire": "Côte d'Ivoire",
    "Sao Tome and Principe": "São Tomé and Príncipe",
}


def latest_values(name, year=None):
    """Latest non-empty value per country, as {iso3: (year, value)}; or the given year only."""
    out = {}
    for c, y, v in wb_records(name):
        if year is not None and y != year:
            continue
        if c not in out or y > out[c][0]:
            out[c] = (y, v)
    return out


def build_scorecard(owid):
    out = DATA / "scorecard"
    out.mkdir(parents=True, exist_ok=True)
    countries = json.loads((WB_DIR / "SSF_countries.json").read_text())[1]

    acc = latest_values("SSF-48_EG.ELC.ACCS.ZS.json")
    rur = latest_values("SSF-48_EG.ELC.ACCS.RU.ZS.json")
    urb = latest_values("SSF-48_EG.ELC.ACCS.UR.ZS.json")
    pop = latest_values("SSF-48_SP.POP.TOTL.json", year=2024)
    outg = latest_values("SSF-48_IC.ELC.OUTG.ZS.json")
    gdp = latest_values("SSF-48_NY.GDP.PCAP.CD.json")
    cft = latest_values("SSF-48_EG.CFT.ACCS.ZS.json")

    rows = []
    for c in countries:
        iso = c["id"]

        def val(d):
            return round(d[iso][1], 1) if iso in d else ""

        def yr(d):
            return d[iso][0] if iso in d else ""

        rows.append({
            "iso3": iso,
            "country": COUNTRY_NAMES.get(c["name"], c["name"]),
            "income_group": c["incomeLevel"]["value"],
            "access_pct": val(acc), "access_year": yr(acc),
            "rural_access_pct": val(rur),
            "urban_access_pct": val(urb),
            "clean_cooking_pct": val(cft), "clean_cooking_year": yr(cft),
            "population_2024": int(pop[iso][1]) if iso in pop else "",
            "firms_outages_pct": val(outg), "outages_survey_year": yr(outg),
            "gdp_per_capita_usd": round(gdp[iso][1]) if iso in gdp else "",
        })
    write_rows(out / "ssa_world_bank_indicators.csv", rows)

    codes = [c["id"] for c in countries]
    s = owid[owid.iso_code.isin(codes) & (owid.year <= 2024)]
    rows = []
    for iso in codes:
        t = s[s.iso_code == iso]
        dm = t.dropna(subset=["electricity_demand", "population"]).sort_values("year").tail(1)
        sh = t.dropna(subset=["oil_share_elec"]).sort_values("year").tail(1)
        rows.append({
            "iso3": iso,
            "electricity_demand_twh": float(dm.electricity_demand.iloc[0]) if len(dm) else "",
            "population": int(dm.population.iloc[0]) if len(dm) else "",
            "demand_year": int(dm.year.iloc[0]) if len(dm) else "",
            "oil_share_pct": round(float(sh.oil_share_elec.iloc[0]), 1) if len(sh) else "",
            "gas_share_pct": round(float(sh.gas_share_elec.iloc[0]), 1) if len(sh) else "",
            "renewables_share_pct": round(float(sh.renewables_share_elec.iloc[0]), 1) if len(sh) else "",
            "mix_year": int(sh.year.iloc[0]) if len(sh) else "",
        })
    write_rows(out / "ssa_owid_electricity.csv", rows)


def main():
    owid = pd.read_csv(RAW / "owid_subset.csv")
    build_senegal(owid)
    build_scorecard(owid)
    for p in sorted(DATA.rglob("*.csv")):
        print(f"  wrote {p.relative_to(DATA.parent.parent)}")


if __name__ == "__main__":
    main()
