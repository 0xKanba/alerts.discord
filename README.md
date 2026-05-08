# 🤖 Hyperliquid Alerts Bot

A Discord bot that delivers **live market prices** and **price alerts** for crypto and commodity perpetuals via [Hyperliquid](https://hyperliquid.xyz) — running entirely on **Cloudflare Workers** with zero server cost.

---

## 📦 Supported Assets

| Symbol | Asset | Source |
|--------|-------|--------|
| BTC | Bitcoin | Hyperliquid |
| ETH | Ethereum | Hyperliquid |
| SOL | Solana | Hyperliquid |
| GOLD | Gold (XAU) | HIP-3 xyz DEX |
| SILVER | Silver (XAG) | HIP-3 xyz DEX |
| OIL | Crude Oil (WTI) | HIP-3 xyz DEX |
| US100 | NASDAQ 100 | HIP-3 xyz DEX |
| SP500 | S&P 500 | HIP-3 xyz DEX |

---

## 💬 Commands

| Command | Description |
|---------|-------------|
| `/s` or `/start` | Open the interactive price menu with buttons |
| `/p` | Show all asset prices at once |
| `/p <asset>` | Show detailed price for one asset (24h/7d/30d change, high/low) |
| `/a <asset> <price>` | Set a price alert in this channel |
| `/d` | Clear **all** alerts in this channel |
| `/d <asset>` | Clear all alerts for a specific asset |
| `/d <asset> <price>` | Remove one specific alert |
| `/myalerts` | List active alerts (with delete buttons) |
| `/help` | Show all commands |

---

## 🏗️ Project Structure

```
alerts-discord/
├── src/
│   └── index.js        # All bot logic (single Worker file)
├── wrangler.toml       # Cloudflare Workers config
├── package.json
├── .gitignore
└── README.md
```

---

## 🚀 Setup & Deployment

### 1. Discord Developer Portal

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Create a new application
3. Under **Bot** → enable **Message Content Intent**
4. Under **OAuth2 → URL Generator** → select `bot` + `applications.commands` → invite bot to your server
5. Note down:
   - `APPLICATION ID` → `DISCORD_APP_ID`
   - `PUBLIC KEY` → `DISCORD_PUBLIC_KEY`
   - Bot Token → `DISCORD_BOT_TOKEN`

### 2. Cloudflare Workers

1. Create a Worker at [dash.cloudflare.com](https://dash.cloudflare.com)
2. Create a **KV Namespace** named `DISCORD_KV` and copy its ID into `wrangler.toml`
3. Add the following **Secrets** under Worker → Settings → Variables:

| Secret | Value |
|--------|-------|
| `DISCORD_BOT_TOKEN` | Your bot token |
| `DISCORD_PUBLIC_KEY` | Your app public key |
| `DISCORD_APP_ID` | Your application ID |

### 3. Deploy

```bash
npm install
npm run deploy
```

### 4. Register Slash Commands (one-time)

Visit in your browser:
```
https://<your-worker>.workers.dev/?register=1
```

### 5. Set Interaction Endpoint in Discord

In the Developer Portal → your app → **General Information**:
```
Interactions Endpoint URL: https://<your-worker>.workers.dev/
```

---

## 🔧 Admin Endpoints

| URL | Description |
|-----|-------------|
| `/?debug=1` | Check all secrets and KV are connected |
| `/?register=1` | Register slash commands with Discord |
| `/?alerts=1` | View all stored alerts across all channels |
| `/?testalert=1&ch=CHANNEL_ID` | Send a test message to a channel |

---

## ⚙️ How It Works

- **Prices** — fetched live from Hyperliquid's public API (`l2Book` mid-price)
- **Changes** — calculated from candle snapshots (1h for 24h, 1d for 7d/30d)
- **Charts** — generated via [QuickChart.io](https://quickchart.io) (15m candles, last 24h)
- **Alerts** — stored in Cloudflare KV, checked every minute via cron trigger
- **Alert limit** — 25 alerts per channel maximum

---

## 🛠️ Local Development

```bash
npm install
npm run dev
```

> Requires a `.dev.vars` file with your secrets for local testing:
> ```
> DISCORD_BOT_TOKEN=...
> DISCORD_PUBLIC_KEY=...
> DISCORD_APP_ID=...
> ```

---

## 📝 Notes

- Cron fires every minute — alert delivery may be delayed up to ~60 seconds
- Alerts fire **once** and are automatically removed after triggering
- The bot tracks all channels it receives commands in automatically
