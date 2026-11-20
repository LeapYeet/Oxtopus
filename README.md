# Oxtopus

Live Octopus Energy prices, every tariff side by side, and a comparison against your own smart meter readings.

**Live site:** https://leapyeet.github.io/Oxtopus/

Unofficial. Not affiliated with or endorsed by Octopus Energy.

## What it does

| Tab | What you get |
| --- | --- |
| **Now** | The current Agile price, the next two days of half-hourly prices (import and export), the cheapest windows to run things, today's Tracker electricity and gas prices with 30 days of history, what every tariff charges this half hour, and the GB generation mix. |
| **Tariffs** | Every Octopus product from the live API: unit rates, standing charge, gas rates, exit fees, and a 24-hour strip showing when each tariff is cheap. Filter by smart, EV, heating, solar and battery, fixed, export and more. |
| **Compare** | What each tariff would cost for a typical home (pick annual usage and EV charging) or for your own readings, plus a chart of each tariff's rate through the day. |
| **My usage** | Add your Octopus API key to see an overview across electricity, export and gas (net bill, what export paid for, where the bill goes), then per meter: what it cost on the tariff you were actually on, highlights such as your always-on load and busiest day, a weekday-by-hour heatmap, the share of your usage bought in each price band, and what every other tariff would have charged. |
| **Settings** (cog icon) | Choose which page opens first, which tariff leads the Now page (including your own), which Now sections show and in what order, your region (with a postcode lookup) and the theme. |

There is a "Try with sample data" button if you want to see My usage without a key.

Oxtopus can be installed as an app from the browser. A tip under the header offers an Install button where the browser supports one, or the steps for that browser otherwise, and Settings lists the steps for every device.

## Your API key

- The key is stored only in your browser and is sent only to `api.octopus.energy`, straight from your device.
- The site is static files on GitHub Pages. There is no server, no analytics and no third-party script.
- A Content Security Policy in `index.html` limits scripts to this site and network requests to the three APIs listed below.
- The service worker caches only the site's own files. It never touches API requests.
- Untick "Remember on this device" to keep the key for the current tab only. "Disconnect" removes it.

Get a key from your Octopus account under Personal details → API access. The account number is optional: the site looks it up from the key.

## How the comparison is priced

- **Agile and Tracker** use the real published rate for every half hour (or day) in the period.
- **Every other tariff** uses today's prices and time windows, because that is what you would get by switching now.
- **Your own tariff** is priced at the real historic rate of each agreement on your account, so a mid-period switch is handled.
- **Intelligent Go** publishes a day and a night rate but no times, so 23:30–05:30 is assumed. Extra smart-charging slots outside that window are not counted.
- Gas meters that report m³ are converted at 11.19 kWh per m³ (toggle on the gas tab).
- The "a battery could move" figure on the export overview is an upper limit: per day, the smaller of what was sold and what was bought, valued at the gap between the two prices.
- Everything includes VAT and uses direct debit prices.

## Run locally

No build step. Serve the folder with any static server:

```sh
python3 -m http.server 8765
# then open http://localhost:8765
```

It needs to be served over HTTP rather than opened as a file, because it uses ES modules.

## Maintenance

Products are read from the Octopus API at runtime, so new tariffs and new versions of Agile, Go, Cosy and the rest appear automatically.

The one exception is **Tracker**. Octopus leaves it out of the public product list, so its product codes are listed in `TRACKER_VERSIONS` at the top of `js/tariffs.js`. When Octopus releases a new Tracker version, add its code to the top of that list.

## Layout

```
index.html            page shell and Content Security Policy
styles.css            all styling, light and dark themes
js/tariffs.js         London time, product classification, rate lookups, costing (no DOM, no network)
js/api.js             requests, caching, pagination, account lookup
js/core.js            shared state, catalogue, pricing helpers, small UI builders
js/charts.js          dependency-free SVG charts and tooltip
js/view-*.js          the four tabs and the settings page
js/install.js         install-as-an-app tip and per-browser steps
js/app.js             routing, region, theme, connecting an account
service-worker.js     offline shell
```

## Data sources

- [Octopus Energy API](https://developer.octopus.energy/)
- [Carbon Intensity API](https://carbonintensity.org.uk/) (National Energy System Operator)
- [Open-Meteo](https://open-meteo.com/)

## Referral

Not with Octopus yet? [This referral link](https://share.octopus.energy/eager-cliff-143) gives £50 credit.

## License

MIT
