# Energy poverty dashboards

Two dashboards on access to electricity in Africa, built from public data, with the code that produces every figure.

**Live site: https://dibimaiga.github.io/energy-poverty-dashboards/**

| Dashboard | What it shows |
|---|---|
| [Sénégal : énergie en chiffres](https://dibimaiga.github.io/energy-poverty-dashboards/senegal/) (in French) | Access to electricity in cities and rural areas since 2000, the power mix, prices and outages, and the move to domestic gas. |
| [Energy poverty scorecard: sub-Saharan Africa](https://dibimaiga.github.io/energy-poverty-dashboards/scorecard/) | The region's 48 countries ranked on seven criteria, with weights you can adjust. |

A few figures from the 2024 data:

- In Senegal, 82.9% of people had electricity in 2024, against 37.7% in 2000, but only 67.1% in rural areas. Oil still produced 78.6% of the country's electricity.
- Across sub-Saharan Africa, about 580 million people had no electricity and nearly a billion did not cook with clean fuels.

Every figure on the pages can be traced to its source: each dashboard ends with a list of its datasets, their sources and a link to download the data.

## Data sources

| Data | Source | Licence |
|---|---|---|
| Access to electricity (national, urban, rural), clean cooking, population, firms facing power outages, network losses | World Bank, World Development Indicators and Enterprise Surveys, through the World Bank API at api.worldbank.org (update of 8 October 2026) | CC BY 4.0 |
| Electricity generation, demand, per-person figures and power mix | [Our World in Data energy dataset](https://github.com/owid/energy-data) (Energy Institute, Ember), pinned to commit `f8de88a` | CC BY 4.0 |
| Senelec tariffs from 1 January 2026 | [CRSE, Senegal's electricity regulator](https://www.crse.sn/wp-content/uploads/2025/12/Grilles-tarifaires-Senelec-et-CER-applicables-a-compter-du-1er-janvier-2026.pdf) (decision n°2025-140) | Public document |
| Average household electricity price (June 2025) | [GlobalPetrolPrices](https://www.globalpetrolprices.com/Senegal/electricity_prices/) | Cited figure |
| Gas milestones | [Woodside](https://www.businesswire.com/news/home/20240610557422/en/Woodside-Achieves-First-Oil-at-Sangomar-in-Senegal), [Ecofin Agency](https://www.ecofinagency.com/news-industry/2908-48257-senegal-to-end-gas-imports-in-2026-raising-questions-over-power-tariffs), [MSGBC Oil, Gas & Power](https://msgbcoilgasandpower.com/news/senegal-greenlights-gta-gandon-pipeline-domestic-gas-power-drive-accelerates) | Press reports |

## How the scorecard works

Seven criteria describe energy poverty in each country: people without electricity, the rural gap, people without clean cooking, low electricity use, the number of people affected, unreliable supply and costly oil-fired power.

1. Each criterion is rescaled from 0 (least acute in the region) to 100 (most acute). Electricity use and the number of people affected are compared on a log scale, so the largest countries don't flatten all the others.
2. A country's score is the weighted average of the criteria it has data for. The default weights are 3 for access, 2 for clean cooking, electricity use and people affected, and 1 for the others; the page lets you change them.
3. Two data points are left out: Chad's 2024 rural access rate (reported as 100%, above its urban rate of 51% and against values below 2% in earlier years), and outage surveys older than 2020 (Eritrea, Sudan).

The score measures need, not opportunity. Oil and gas resources and electricity prices are not included yet, for lack of a current, comparable cross-country source.

## Repository layout

```
docs/                    the website, served by GitHub Pages
  senegal/  scorecard/   the two dashboards
  data/                  the CSV files the pages read
  assets/                theme, a small runtime (dash-lite.js) and d3
pipeline/
  fetch.py               downloads the raw data (World Bank API, OWID at a pinned commit)
  build.py               builds docs/data/*.csv from the raw snapshot
  score_reference.py     recomputes the scorecard independently, as a check
  raw/                   the snapshot behind the published figures
  manual/                figures entered by hand from documents (tariffs, price, gas milestones)
tests/check_pages.js     browser test: every figure against its data, scores against the reference, layout
```

## Reproducing the figures

```bash
pip install -r pipeline/requirements.txt
python pipeline/build.py            # rebuilds docs/data/ from the snapshot (identical files)
python pipeline/score_reference.py  # recomputes every score and total independently
python pipeline/fetch.py            # optional: refreshes the snapshot from the live sources
```

To view the site locally: `python -m http.server -d docs 8000`, then open http://localhost:8000.

To run the browser checks: `npm install && npx playwright install chromium && npm test`.

## Licence and independence

The code is under the MIT licence. The data keep their original licences: please cite the World Bank and Our World in Data (CC BY 4.0) and the other sources above when you reuse them. d3 is included under its ISC licence in `docs/assets/vendor/`.

This is an independent analysis of public data. It is not affiliated with or endorsed by Prosperity, Not Poverty or any other organization it mentions.
