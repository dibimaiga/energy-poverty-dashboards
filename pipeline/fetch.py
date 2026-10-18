"""Download the raw data behind the dashboards into pipeline/raw/.

World Bank: one JSON response per request, saved as returned by the API.
Our World in Data: the energy dataset at a pinned commit, reduced to the countries
and columns the dashboards use (pipeline/raw/owid_subset.csv).

Usage:
    python pipeline/fetch.py                  # refresh everything
    python pipeline/fetch.py --only owid      # or: --only worldbank
    python pipeline/fetch.py --only owid --owid-file path/to/owid-energy-data.csv
"""
import argparse
import datetime as dt
import json
import pathlib
import sys
import time
import urllib.request

import pandas as pd

RAW = pathlib.Path(__file__).resolve().parent / "raw"
WB_DIR = RAW / "worldbank"
WB_API = "https://api.worldbank.org/v2"

# Our World in Data energy dataset, pinned to the commit the dashboards were built from.
OWID_COMMIT = "f8de88a4f6f9cab44f1cf606047cbd6c4414042c"
OWID_URL = f"https://raw.githubusercontent.com/owid/energy-data/{OWID_COMMIT}/owid-energy-data.csv"
OWID_ENTITIES = ["Senegal", "Cote d'Ivoire", "Ghana", "Nigeria", "Morocco", "Africa", "World", "France"]
OWID_COLUMNS = [
    "country", "iso_code", "year", "population",
    "electricity_generation", "electricity_demand", "net_elec_imports", "per_capita_electricity",
    "oil_electricity", "gas_electricity", "coal_electricity", "solar_electricity", "wind_electricity",
    "hydro_electricity", "biofuel_electricity", "other_renewable_electricity",
    "fossil_share_elec", "renewables_share_elec", "oil_share_elec", "gas_share_elec",
]

SENEGAL_ACCESS = ["EG.ELC.ACCS.ZS", "EG.ELC.ACCS.UR.ZS", "EG.ELC.ACCS.RU.ZS"]
SENEGAL_PEERS = "SEN;CIV;GHA;NGA;MAR;SSF"
SENEGAL_PEER_INDICATORS = ["IC.ELC.OUTG.ZS", "EG.ELC.LOSS.ZS"]
SSA_INDICATORS = {  # indicator -> years requested
    "EG.ELC.ACCS.ZS": "2014:2025",
    "EG.ELC.ACCS.RU.ZS": "2014:2025",
    "EG.ELC.ACCS.UR.ZS": "2014:2025",
    "EG.CFT.ACCS.ZS": "2014:2025",
    "SP.POP.TOTL": "2022:2025",
    "IC.ELC.OUTG.ZS": "2006:2025",
    "NY.GDP.PCAP.CD": "2020:2025",
}


def get(url, tries=4, timeout=240):
    """GET with retries: the World Bank API is slow and sometimes times out."""
    for attempt in range(1, tries + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - retry on any network error
            if attempt == tries:
                raise
            wait = 5 * attempt
            print(f"  retry {attempt} in {wait}s ({e})", file=sys.stderr)
            time.sleep(wait)


def wb_json(path, params):
    query = "&".join(f"{k}={v}" for k, v in {"format": "json", **params}.items())
    data = json.loads(get(f"{WB_API}/{path}?{query}"))
    if not isinstance(data, list) or len(data) < 2 or data[1] is None:
        raise RuntimeError(f"Unexpected World Bank answer for {path}: {str(data)[:200]}")
    return data


def save(name, data):
    WB_DIR.mkdir(parents=True, exist_ok=True)
    (WB_DIR / name).write_text(json.dumps(data, ensure_ascii=False))
    print(f"  saved {name} ({len(data[1])} records, World Bank update {data[0].get('lastupdated', '?')})")


def fetch_worldbank():
    print("World Bank")
    for ind in SENEGAL_ACCESS:
        save(f"SEN_{ind}.json", wb_json(f"country/SEN/indicator/{ind}", {"per_page": 100, "date": "2000:2025"}))
    for ind in SENEGAL_PEER_INDICATORS:
        save(f"SEN-peers_{ind}.json", wb_json(f"country/{SENEGAL_PEERS}/indicator/{ind}", {"per_page": 500, "date": "2005:2025"}))
    countries = wb_json("country", {"region": "SSF", "per_page": 100})
    save("SSF_countries.json", countries)
    codes = ";".join(c["id"] for c in countries[1])
    for ind, years in SSA_INDICATORS.items():
        save(f"SSF-48_{ind}.json", wb_json(f"country/{codes}/indicator/{ind}", {"per_page": 2000, "date": years}))


def fetch_owid(local_file=None):
    print("Our World in Data")
    source = local_file or OWID_URL
    full = pd.read_csv(source)
    ssa_codes = [c["id"] for c in json.loads((WB_DIR / "SSF_countries.json").read_text())[1]]
    keep = full.country.isin(OWID_ENTITIES) | full.iso_code.isin(ssa_codes)
    subset = full.loc[keep, OWID_COLUMNS]
    subset.to_csv(RAW / "owid_subset.csv", index=False)
    print(f"  saved owid_subset.csv ({len(subset)} rows, commit {OWID_COMMIT[:7]})")


def write_manifest(parts):
    path = RAW / "manifest.json"
    manifest = json.loads(path.read_text()) if path.exists() else {}
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if "worldbank" in parts:
        manifest["worldbank"] = {"fetched_at": now, "api": WB_API}
    if "owid" in parts:
        manifest["owid"] = {"fetched_at": now, "commit": OWID_COMMIT, "url": OWID_URL}
    path.write_text(json.dumps(manifest, indent=2) + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=["worldbank", "owid"])
    ap.add_argument("--owid-file", help="use a local copy of owid-energy-data.csv instead of downloading it")
    args = ap.parse_args()
    parts = [args.only] if args.only else ["worldbank", "owid"]
    if "worldbank" in parts:
        fetch_worldbank()
    if "owid" in parts:
        fetch_owid(args.owid_file)
    write_manifest(parts)


if __name__ == "__main__":
    main()
