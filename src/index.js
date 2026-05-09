/**
 * Hyperliquid Alerts Bot — Discord
 * ─────────────────────────────────
 * Secrets (Cloudflare Dashboard → Workers → Settings → Variables):
 *   DISCORD_BOT_TOKEN
 *   DISCORD_PUBLIC_KEY
 *   DISCORD_APP_ID
 *
 * KV Namespace binding: DISCORD_KV  (see wrangler.toml)
 *
 * One-time setup: https://<your-worker>.workers.dev/?register=1
 */

// ─── Constants ────────────────────────────────────────────────────────────────
const HL         = "https://api.hyperliquid.xyz/info";
const API        = "https://discord.com/api/v10";
const QC         = "https://quickchart.io/chart";
const MAX_ALERTS = 25;

// ─── Assets ───────────────────────────────────────────────────────────────────
const ASSETS = {
  BTC:    { src:"hl",  sym:"BTC",          name:"Bitcoin",    icon:"₿"  },
  ETH:    { src:"hl",  sym:"ETH",          name:"Ethereum",   icon:"🔷" },
  SOL:    { src:"hl",  sym:"SOL",          name:"Solana",     icon:"🟣" },
  GOLD:   { src:"xyz", sym:"xyz:GOLD",     name:"Gold",       icon:"🟡" },
  SILVER: { src:"xyz", sym:"xyz:SILVER",   name:"Silver",     icon:"⚪" },
  OIL:    { src:"xyz", sym:"xyz:CL",       name:"Crude Oil",  icon:"🛢" },
  US100:  { src:"xyz", sym:"xyz:XYZ100",   name:"NASDAQ 100", icon:"📈" },
  SP500:  { src:"xyz", sym:"xyz:SP500",    name:"S&P 500",    icon:"📊" },
};

// All accepted aliases → canonical key
// Primary aliases (3 per asset) + extras kept for convenience
const ALIAS = {
  // BTC — btc · bitcoin · xbt
  btc:"BTC", bitcoin:"BTC", xbt:"BTC",
  // ETH — eth · ethereum · ether
  eth:"ETH", ethereum:"ETH", ether:"ETH",
  // SOL — sol · solana · slna
  sol:"SOL", solana:"SOL", slna:"SOL",
  // GOLD — gold · xau · gc
  gold:"GOLD", xau:"GOLD", gc:"GOLD",
  // SILVER — silver · xag · si
  silver:"SILVER", xag:"SILVER", si:"SILVER",
  // OIL — oil · wti · cl
  oil:"OIL", wti:"OIL", cl:"OIL", crude:"OIL",
  // NASDAQ 100 — nq · nasdaq · us100
  nq:"US100", nasdaq:"US100", us100:"US100", nasdaq100:"US100",
  // S&P 500 — es · sp500 · spx
  es:"SP500", sp500:"SP500", spx:"SP500", us500:"SP500", "s&p":"SP500", sp:"SP500",
};

// ─── Small Helpers ────────────────────────────────────────────────────────────
function resolveAsset(raw) {
  if (!raw) return null;
  const k = ALIAS[raw.toLowerCase().trim()] ?? raw.toUpperCase().trim();
  return ASSETS[k] ? k : null;
}
function botH(env) { return { Authorization:`Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type":"application/json" }; }
function jH()      { return { "Content-Type":"application/json" }; }
function wh(app, tok) { return `${API}/webhooks/${app}/${tok}`; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtPrice(v) {
  if (v == null || isNaN(v)) return "—";
  if (v >= 1000) return "$" + v.toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 });
  if (v >= 100)  return "$" + v.toFixed(2);
  if (v >= 1)    return "$" + v.toFixed(3);
  return "$" + v.toFixed(5);
}
function fmtChg(pct, price) {
  if (pct == null || isNaN(pct)) return "—";
  const sign  = pct >= 0 ? "+" : "";
  const icon  = pct >= 0 ? "🟢" : "🔴";
  const dollar = (price != null && !isNaN(price))
    ? ` (${sign}${fmtPrice(Math.abs(price * pct / 100)).replace("$", "")}$)`
    : "";
  return `${icon} ${sign}${pct.toFixed(2)}%${dollar}`;
}
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
// Discord embed `timestamp` field renders local time automatically in footer — no need to repeat it here
function fmtTs() { return fmtDate(); }

// ─── Ed25519 Signature Verification ──────────────────────────────────────────
function h2b(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i/2] = parseInt(hex.substring(i, i+2), 16);
  return b;
}
async function verify(req, buf, env) {
  const sig = req.headers.get("x-signature-ed25519");
  const ts  = req.headers.get("x-signature-timestamp");
  if (!sig || !ts) return false;
  const key = await crypto.subtle.importKey(
    "raw", h2b(env.DISCORD_PUBLIC_KEY), { name:"Ed25519" }, false, ["verify"]
  );
  return crypto.subtle.verify(
    "Ed25519", key, h2b(sig), new TextEncoder().encode(ts + new TextDecoder().decode(buf))
  );
}

// ─── KV Helpers ───────────────────────────────────────────────────────────────
async function getChAlerts(env, chId) {
  try { const r = await env.DISCORD_KV.get(`ch:${chId}`); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
async function setChAlerts(env, chId, list) {
  await env.DISCORD_KV.put(`ch:${chId}`, JSON.stringify(list));
}
async function getAllChannels(env) {
  try { const r = await env.DISCORD_KV.get("channels"); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
async function regChannel(env, chId) {
  const chs = await getAllChannels(env);
  if (!chs.includes(chId)) { chs.push(chId); await env.DISCORD_KV.put("channels", JSON.stringify(chs)); }
}

// ─── Hyperliquid Fetchers ─────────────────────────────────────────────────────

/** Fast mid-price for all assets — used by cron & addAlert */
async function fetchPrices() {
  const out = {};
  await Promise.all(Object.entries(ASSETS).map(async ([k, A]) => {
    try {
      const r  = await fetch(HL, { method:"POST", headers:jH(), body:JSON.stringify({ type:"l2Book", coin:A.sym }) });
      const lb = await r.json();
      const bid = parseFloat(lb.levels?.[0]?.[0]?.px);
      const ask = parseFloat(lb.levels?.[1]?.[0]?.px);
      if (!isNaN(bid) && !isNaN(ask)) out[k] = (bid + ask) / 2;
    } catch(e) { console.error("fetchPrices:", k, e.message); }
  }));
  return out;
}

/** Price + 24h change for all assets — used by /p (no arg) and "All Prices" button */
async function fetchSummary() {
  const out = {}, now = Date.now();
  await Promise.all(Object.entries(ASSETS).map(async ([k, A]) => {
    try {
      const [lbR, chR] = await Promise.all([
        fetch(HL, { method:"POST", headers:jH(), body:JSON.stringify({ type:"l2Book", coin:A.sym }) }),
        fetch(HL, { method:"POST", headers:jH(), body:JSON.stringify({ type:"candleSnapshot", req:{ coin:A.sym, interval:"1h", startTime:now-86400000, endTime:now } }) }),
      ]);
      const [lb, r1h] = await Promise.all([lbR.json(), chR.json()]);
      const bid = parseFloat(lb.levels?.[0]?.[0]?.px);
      const ask = parseFloat(lb.levels?.[1]?.[0]?.px);
      if (!isNaN(bid) && !isNaN(ask)) {
        const price = (bid + ask) / 2;
        let chg24 = null;
        if (Array.isArray(r1h) && r1h.length >= 2) {
          const o = parseFloat(r1h[0].o);
          if (o > 0) chg24 = (price - o) / o * 100;
        }
        out[k] = { price, chg24 };
      }
    } catch(e) { console.error("fetchSummary:", k, e.message); }
  }));
  return out;
}

/** Full detail for one asset — used by /p <asset> and price buttons */
async function fetchDetail(key) {
  const A = ASSETS[key], now = Date.now();
  const [lbR, r1hR, r1dR, r15mR] = await Promise.all([
    fetch(HL, { method:"POST", headers:jH(), body:JSON.stringify({ type:"l2Book", coin:A.sym }) }),
    fetch(HL, { method:"POST", headers:jH(), body:JSON.stringify({ type:"candleSnapshot", req:{ coin:A.sym, interval:"1h",  startTime:now-86400000,    endTime:now } }) }),
    fetch(HL, { method:"POST", headers:jH(), body:JSON.stringify({ type:"candleSnapshot", req:{ coin:A.sym, interval:"1d",  startTime:now-32*86400000, endTime:now } }) }),
    fetch(HL, { method:"POST", headers:jH(), body:JSON.stringify({ type:"candleSnapshot", req:{ coin:A.sym, interval:"15m", startTime:now-86400000,    endTime:now } }) }),
  ]);
  const [lb, r1h, r1d, r15m] = await Promise.all([lbR.json(), r1hR.json(), r1dR.json(), r15mR.json()]);

  const bid = parseFloat(lb.levels?.[0]?.[0]?.px);
  const ask = parseFloat(lb.levels?.[1]?.[0]?.px);
  if (isNaN(bid) || isNaN(ask)) return null;
  const price = (bid + ask) / 2;

  let chg24=null, chg7=null, chg30=null, high=null, low=null;
  if (Array.isArray(r1h) && r1h.length>=2) { const o=parseFloat(r1h[0].o);            if(o>0) chg24=(price-o)/o*100; }
  if (Array.isArray(r1d) && r1d.length>=7) { const o=parseFloat(r1d[r1d.length-7].o); if(o>0) chg7 =(price-o)/o*100; }
  if (Array.isArray(r1d) && r1d.length>=1) { const o=parseFloat(r1d[0].o);             if(o>0) chg30=(price-o)/o*100; }
  if (Array.isArray(r15m) && r15m.length) {
    high = Math.max(...r15m.map(c => parseFloat(c.h)));
    low  = Math.min(...r15m.map(c => parseFloat(c.l)));
  }
  return { price, chg24, chg7, chg30, high, low };
}

// ─── Embeds ───────────────────────────────────────────────────────────────────
function priceEmbed(key, d) {
  const A = ASSETS[key], up = (d.chg24 ?? 0) >= 0;
  const rng    = (d.high != null && d.low != null) ? d.high - d.low : null;
  const rngPct = (rng && d.low) ? (rng / d.low * 100).toFixed(2) : null;
  return {
    title: `${A.icon} ${A.name}`,
    color: up ? 0x00D278 : 0xFF466E,
    fields: [
      { name:"💰 Price",      value:fmtPrice(d.price), inline:true },
      { name:"📅 24h Change", value:fmtChg(d.chg24, d.price),  inline:true },
      { name:"📅 7d Change",  value:fmtChg(d.chg7,  d.price),  inline:true },
      { name:"📅 30d Change", value:fmtChg(d.chg30, d.price),  inline:true },
      { name:"↑ 24h High",   value:fmtPrice(d.high),  inline:true },
      { name:"↓ 24h Low",    value:fmtPrice(d.low),   inline:true },
      ...(rng && rngPct ? [{ name:"↔ Range", value:`${fmtPrice(rng)} (${rngPct}%)`, inline:true }] : []),
    ],
    footer:    { text:`Hyperliquid · Last 24H · ${fmtTs()}` },
    timestamp: new Date().toISOString(),
  };
}

function summaryEmbed(data) {
  return {
    title:     "💰 Live Market Prices",
    color:     0x00D278,
    fields:    Object.entries(ASSETS).map(([k, A]) => {
      const d = data[k];
      return { name:`${A.icon} ${A.name}`, value:d ? `**${fmtPrice(d.price)}** ${fmtChg(d.chg24, d.price)}` : "⚠️ N/A", inline:true };
    }),
    footer:    { text:`Hyperliquid · Last 24H · ${fmtTs()}` },
    timestamp: new Date().toISOString(),
  };
}

function alertFiredEmbed(A, a, cur) {
  return {
    title:       "🔔 Price Alert Triggered",
    color:       0xF59E0B,
    description: `${A.icon} **${A.name}** — ${a.cond===">" ? "🔼 Reached upper target" : "🔽 Reached lower target"}\n\nCurrent: **${fmtPrice(cur)}**\nTarget:  **${fmtPrice(a.price)}**`,
    footer:      { text:`Alert fired · ${fmtTs()}` },
    timestamp:   new Date().toISOString(),
  };
}

// ─── Keyboards ────────────────────────────────────────────────────────────────
function mainKB() {
  return [
    { type:1, components:[
      { type:2, style:2, label:"₿ BTC",       custom_id:"p|BTC"    },
      { type:2, style:2, label:"🔷 ETH",      custom_id:"p|ETH"    },
      { type:2, style:2, label:"🟣 SOL",      custom_id:"p|SOL"    },
    ]},
    { type:1, components:[
      { type:2, style:2, label:"🟡 Gold",     custom_id:"p|GOLD"   },
      { type:2, style:2, label:"⚪ Silver",   custom_id:"p|SILVER" },
      { type:2, style:2, label:"🛢 Oil",      custom_id:"p|OIL"    },
    ]},
    { type:1, components:[
      { type:2, style:2, label:"📊 S&P 500",  custom_id:"p|SP500"  },
      { type:2, style:2, label:"📈 NASDAQ",   custom_id:"p|US100"  },
    ]},
    { type:1, components:[
      { type:2, style:1, label:"💰 All Prices", custom_id:"all" },
    ]},
  ];
}

function detailKB(k) {
  return [
    { type:1, components:[
      { type:2, style:2, label:"🔄 Refresh",   custom_id:`rpa|${k}` },
      { type:2, style:2, label:"📊 Chart",     custom_id:`c|${k}`   },
      { type:2, style:3, label:"🔔 Set Alert", custom_id:`al|${k}`  },
    ]},
    { type:1, components:[
      { type:2, style:2, label:"◀️ Back", custom_id:"back" },
    ]},
  ];
}

// ─── Commands ─────────────────────────────────────────────────────────────────
async function onCmd(i, env) {
  const chId = i.channel_id;
  switch (i.data.name) {
    case "s":
    case "start":    return Response.json({ type:4, data:{ content:"📊 **Select an asset:**", components:mainKB() } });
    case "p":        return cmdPrice(i);
    case "a":        return cmdAddAlert(i, env, chId);
    case "d":        return cmdDelAlert(i, env, chId);
    case "myalerts": return cmdMyAlerts(env, chId);
    case "help":     return cmdHelp();
    default:         return Response.json({ type:4, data:{ content:"❌ Unknown command.", flags:64 } });
  }
}

function cmdHelp() {
  return Response.json({ type:4, data:{ flags:64, embeds:[{
    title:       "📖 Bot Commands",
    color:       0x5865F2,
    description: "Aliases accepted — `btc` `eth` `sol` `gold` `silver` `oil` `nq` `sp500` (and more)",
    fields: [
      { name:"`/s`  or  `/start`",   value:"Open the interactive price menu",                                           inline:false },
      { name:"`/p`",                  value:"All assets live prices",                                                    inline:false },
      { name:"`/p <asset>`",          value:"Detailed price — 24h / 7d / 30d, high/low\n`/p btc` · `/p gold` · `/p nq`", inline:false },
      { name:"`/a <asset> <price>`",  value:"Set a price alert — direction auto-detected\n`/a btc 90000` · `/a gold 3200`", inline:false },
      { name:"`/d`",                  value:"Clear **all** alerts in this channel",                                      inline:false },
      { name:"`/d <asset>`",          value:"Clear all alerts for one asset  →  `/d btc`",                               inline:false },
      { name:"`/d <asset> <price>`",  value:"Remove one specific alert  →  `/d btc 90000`",                              inline:false },
      { name:"`/myalerts`",           value:"List active alerts in this channel",                                        inline:false },
    ],
    footer:    { text:`Alerts fire within 60s · Auto-removed after triggering · ${fmtTs()}` },
    timestamp: new Date().toISOString(),
  }]}});
}

async function cmdPrice(i) {
  const raw = i.data.options?.find(o => o.name === "asset")?.value;

  if (raw) {
    const key = resolveAsset(raw);
    if (!key) return Response.json({ type:4, data:{ content:`❌ Unknown asset \`${raw}\`.\nTry: \`btc\` \`eth\` \`gold\` \`nq\` \`sp500\` \`oil\` \`silver\``, flags:64 } });
    const det = await fetchDetail(key);
    if (!det) return Response.json({ type:4, data:{ content:`⚠️ Could not fetch price for **${ASSETS[key].name}**.`, flags:64 } });
    return Response.json({ type:4, data:{ embeds:[priceEmbed(key, det)], components:detailKB(key) } });
  }

  const data = await fetchSummary();
  return Response.json({ type:4, data:{ embeds:[summaryEmbed(data)], components:mainKB() } });
}

async function cmdAddAlert(i, env, chId) {
  const opts = i.data.options ?? [];
  const rawA = opts.find(o => o.name === "asset")?.value;
  const tgt  = opts.find(o => o.name === "price")?.value;
  const key  = resolveAsset(rawA);

  if (!key)                          return Response.json({ type:4, data:{ content:`❌ Unknown asset \`${rawA}\`.\nTry: \`btc\` \`eth\` \`gold\` \`nq\` \`sp500\` \`oil\` \`silver\``, flags:64 } });
  if (!tgt || isNaN(tgt) || tgt<=0) return Response.json({ type:4, data:{ content:"❌ Invalid price. Enter a positive number.", flags:64 } });

  const A      = ASSETS[key];
  const prices = await fetchPrices();
  const cur    = prices[key];
  if (!cur) return Response.json({ type:4, data:{ content:`⚠️ Could not fetch current price for **${A.name}**.`, flags:64 } });

  const alerts = await getChAlerts(env, chId);
  if (alerts.length >= MAX_ALERTS)
    return Response.json({ type:4, data:{ content:`⚠️ Max ${MAX_ALERTS} alerts reached. Remove some with \`/d\`.`, flags:64 } });

  // ── Auto-detect direction ──────────────────────────────────────────────────
  // target > current → alert fires when price rises to target (🔼)
  // target < current → alert fires when price drops to target (🔽)
  const cond = tgt > cur ? ">" : "<";
  const dir  = cond === ">" ? "🔼 Rises to" : "🔽 Drops to";
  const dist = Math.abs((tgt - cur) / cur * 100).toFixed(2);

  alerts.push({ id:Date.now(), key, cond, price:tgt });
  await setChAlerts(env, chId, alerts);

  return Response.json({ type:4, data:{ flags:64, embeds:[{
    title:       "✅ Alert Added",
    color:       0x00D278,
    description: `${A.icon} **${A.name}** — ${dir} **${fmtPrice(tgt)}**\n\nCurrent:  ${fmtPrice(cur)}\nDistance: ${dist}%\n\n📢 Will fire in this channel.`,
    footer:      { text:`Alert fired · ${fmtTs()}` },
    timestamp:   new Date().toISOString(),
  }]}});
}

async function cmdDelAlert(i, env, chId) {
  const opts     = i.data.options ?? [];
  const rawAsset = opts.find(o => o.name === "asset")?.value;
  const tgt      = opts.find(o => o.name === "price")?.value;
  const alerts   = await getChAlerts(env, chId);

  if (!alerts.length)
    return Response.json({ type:4, data:{ content:"📭 No active alerts in this channel.", flags:64 } });

  // /d  → clear all
  if (!rawAsset && tgt === undefined) {
    await setChAlerts(env, chId, []);
    return Response.json({ type:4, data:{ content:`🗑️ Cleared **${alerts.length}** alert(s).`, flags:64 } });
  }

  const key = resolveAsset(rawAsset);
  if (!key) return Response.json({ type:4, data:{ content:"❌ Unknown asset.", flags:64 } });

  // /d btc  → clear all for that asset
  if (tgt === undefined) {
    const next = alerts.filter(a => a.key !== key);
    if (next.length === alerts.length)
      return Response.json({ type:4, data:{ content:`📭 No alerts found for **${ASSETS[key].name}**.`, flags:64 } });
    await setChAlerts(env, chId, next);
    return Response.json({ type:4, data:{ content:`🗑️ Removed **${alerts.length-next.length}** alert(s) for ${ASSETS[key].icon} **${ASSETS[key].name}**.`, flags:64 } });
  }

  // /d btc 90000  → remove specific price
  const next = alerts.filter(a => !(a.key === key && Math.abs(a.price - tgt) < 0.01));
  if (next.length === alerts.length)
    return Response.json({ type:4, data:{ content:"📭 No matching alert found.", flags:64 } });
  await setChAlerts(env, chId, next);
  return Response.json({ type:4, data:{ content:`🗑️ Removed alert for ${ASSETS[key].icon} **${ASSETS[key].name}** at ${fmtPrice(tgt)}.`, flags:64 } });
}

async function cmdMyAlerts(env, chId) {
  const alerts = await getChAlerts(env, chId);
  if (!alerts.length)
    return Response.json({ type:4, data:{ content:"📭 No alerts in this channel.\n\nUse `/a <asset> <price>` to set one.", flags:64 } });

  const lines = alerts.slice(0, 20).map((a, idx) => {
    const A = ASSETS[a.key];
    return `\`${idx+1}.\` ${A?.icon ?? ""} **${A?.name ?? a.key}** ${a.cond===">" ? "🔼" : "🔽"} ${fmtPrice(a.price)}`;
  }).join("\n");

  const rows = alerts.slice(0, 5).map(a => ({
    type:1,
    components:[{
      type:2, style:4,
      label:     `🗑️ ${ASSETS[a.key]?.icon ?? ""} ${ASSETS[a.key]?.name ?? a.key} ${a.cond===">" ? "🔼" : "🔽"} ${fmtPrice(a.price)}`,
      custom_id: `del|${a.id}`,
    }],
  }));

  return Response.json({ type:4, data:{
    flags:      64,
    content:    `🔔 **Active Alerts (${alerts.length}/${MAX_ALERTS})**\n\n${lines}${alerts.length > 20 ? `\n…and ${alerts.length-20} more` : ""}\n\n*\`/d\` → clear all  ·  \`/d <asset>\` → clear by asset*`,
    components: rows,
  }});
}

// ─── Button Handler (async via waitUntil) ────────────────────────────────────
async function onBtnAsync(i, env, w) {
  const d    = i.data.custom_id;
  const chId = i.channel_id;
  const patch  = body => fetch(`${w}/messages/@original`, { method:"PATCH", headers:jH(), body:JSON.stringify(body) });
  const follow = body => fetch(w, { method:"POST", headers:jH(), body:JSON.stringify(body) });

  try {
    if (d === "all") {
      const data = await fetchSummary();
      await patch({ content:null, embeds:[summaryEmbed(data)], components:mainKB() });
      return;
    }
    if (d === "back") {
      await patch({ content:"📊 **Select an asset:**", embeds:[], components:mainKB() });
      return;
    }
    if (d.startsWith("p|")) {
      const key = d.split("|")[1];
      if (!ASSETS[key]) { await patch({ content:"❌ Invalid selection.", embeds:[], components:mainKB() }); return; }
      const det = await fetchDetail(key);
      if (!det) { await patch({ content:`⚠️ Failed to fetch **${ASSETS[key].name}**.`, embeds:[], components:mainKB() }); return; }
      await patch({ content:null, embeds:[priceEmbed(key, det)], components:detailKB(key) });
      return;
    }
    if (d.startsWith("rpa|")) {
      const key = d.split("|")[1];
      const det = await fetchDetail(key);
      if (det) await patch({ content:null, embeds:[priceEmbed(key, det)], components:detailKB(key) });
      return;
    }
    if (d.startsWith("c|")) {
      // Send chart as new followup — original price embed stays untouched
      await sendChartMsg(env, w, d.split("|")[1], null, null);
      return;
    }
    if (d.startsWith("rc|")) {
      // Edit the chart message in-place via PATCH @original
      await sendChartMsg(env, w, d.split("|")[1], "@original", null);
      return;
    }
    if (d.startsWith("delmsg|")) {
      const msgId = d.split("|")[1];
      if (chId) await fetch(`${API}/channels/${chId}/messages/${msgId}`, { method:"DELETE", headers:botH(env) }).catch(()=>{});
      return;
    }
    if (d.startsWith("del|")) {
      const aid = parseInt(d.split("|")[1]);
      const al  = await getChAlerts(env, chId);
      await setChAlerts(env, chId, al.filter(a => a.id !== aid));
      await patch({ content:"🗑️ Alert removed.", embeds:[], components:[] });
      return;
    }
  } catch(e) {
    console.error("BTN_ERR:", e.message);
    try { await follow({ content:`❌ Error: ${e.message}`, flags:64 }); } catch {}
  }
}

// ─── Modal Submit ─────────────────────────────────────────────────────────────
async function onModal(i, env) {
  const d = i.data.custom_id, chId = i.channel_id;
  if (!d.startsWith("al|")) return new Response(null, { status:204 });

  const key = d.split("|")[1], A = ASSETS[key];
  if (!A) return Response.json({ type:4, data:{ content:"❌ Invalid asset.", flags:64 } });

  const raw = i.data.components[0].components[0].value;
  const tgt = parseFloat(raw.replace(/[,$\s]/g, ""));
  if (isNaN(tgt) || tgt <= 0)
    return Response.json({ type:4, data:{ content:"❌ Invalid price. Enter a number like `95000`.", flags:64 } });

  const prices = await fetchPrices();
  const cur    = prices[key];
  if (!cur) return Response.json({ type:4, data:{ content:`⚠️ Could not fetch current price for **${A.name}**.`, flags:64 } });

  const alerts = await getChAlerts(env, chId);
  if (alerts.length >= MAX_ALERTS)
    return Response.json({ type:4, data:{ content:`⚠️ Max ${MAX_ALERTS} alerts reached. Use \`/d\` to remove some.`, flags:64 } });

  const cond = tgt > cur ? ">" : "<";
  const dir  = cond === ">" ? "🔼 Rises to" : "🔽 Drops to";
  const dist = Math.abs((tgt - cur) / cur * 100).toFixed(2);

  alerts.push({ id:Date.now(), key, cond, price:tgt });
  await setChAlerts(env, chId, alerts);

  return Response.json({ type:4, data:{ flags:64, embeds:[{
    title:       "✅ Alert Added",
    color:       0x00D278,
    description: `${A.icon} **${A.name}** — ${dir} **${fmtPrice(tgt)}**\n\nCurrent:  ${fmtPrice(cur)}\nDistance: ${dist}%\n\n📢 Will fire in this channel.`,
    footer:      { text:`Alert fired · ${fmtTs()}` },
    timestamp:   new Date().toISOString(),
  }]}});
}

// ─── Chart ────────────────────────────────────────────────────────────────────
/**
 * sendChartMsg(env, w, key, editTarget, chId)
 *
 * editTarget = null        → POST new followup message (initial chart)
 * editTarget = "@original" → PATCH @original via webhook (refresh button hit on chart message)
 */
async function sendChartMsg(env, w, key, editTarget, chId) {
  const A = ASSETS[key];
  if (!A) return;
  const now = Date.now();
  let candles;
  try {
    const r = await fetch(HL, { method:"POST", headers:jH(), body:JSON.stringify({ type:"candleSnapshot", req:{ coin:A.sym, interval:"15m", startTime:now-86400000, endTime:now } }) });
    candles = await r.json();
    if (!Array.isArray(candles) || !candles.length) throw new Error("empty");
  } catch {
    const errBody = JSON.stringify({ content:`⚠️ No chart data for **${A.name}**.`, flags:64 });
    await fetch(editTarget ? `${w}/messages/${editTarget}` : w, { method: editTarget ? "PATCH" : "POST", headers:jH(), body:errBody });
    return;
  }

  const closes = candles.map(c => parseFloat(c.c));
  const highs  = candles.map(c => parseFloat(c.h));
  const lows   = candles.map(c => parseFloat(c.l));
  const minP   = Math.min(...lows), maxP = Math.max(...highs);
  const firstP = closes[0], lastP = closes[closes.length-1];
  const chg    = (lastP - firstP) / firstP * 100;
  const up     = chg >= 0;

  const step = Math.max(1, Math.floor(candles.length / 60));
  const dP   = closes.filter((_,i) => i%step===0);
  const dL   = candles.filter((_,i) => i%step===0).map(c => {
    const dt = new Date(c.t + 10800000);
    return `${String(dt.getUTCHours()).padStart(2,"0")}:${String(dt.getUTCMinutes()).padStart(2,"0")}`;
  });

  const chartCfg = {
    type:"line",
    data:{ labels:dL, datasets:[{ data:dP,
      borderColor:     up ? "rgb(0,210,120)"       : "rgb(255,70,110)",
      backgroundColor: up ? "rgba(0,210,120,0.12)" : "rgba(255,70,110,0.12)",
      borderWidth:2, pointRadius:0, fill:true, tension:0.3,
    }]},
    options:{
      plugins:{
        legend:{ display:false },
        title:{ display:true, text:`${A.name}  ${up?"▲":"▼"} ${chg>=0?"+":""}${chg.toFixed(2)}%`, color:"#e0e0e0", font:{ size:15, weight:"bold" } },
      },
      scales:{
        x:{ ticks:{ color:"#888", maxTicksLimit:8, maxRotation:0 }, grid:{ color:"rgba(255,255,255,0.04)" } },
        y:{ position:"right", ticks:{ color:"#888", callback:v=>"$"+Number(v).toLocaleString("en-US",{minimumFractionDigits:0}) }, grid:{ color:"rgba(255,255,255,0.06)" }, min:+(minP*0.9997).toFixed(2), max:+(maxP*1.0003).toFixed(2) },
      },
      layout:{ padding:{ left:8, right:8, top:4, bottom:4 } },
    },
  };

  let imgBuf;
  try {
    const r = await fetch(QC, { method:"POST", headers:jH(), body:JSON.stringify({ chart:chartCfg, width:800, height:380, backgroundColor:"#0d1117", format:"png" }) });
    if (!r.ok) throw new Error(`QC ${r.status}`);
    imgBuf = await r.arrayBuffer();
    if (imgBuf.byteLength < 1000) throw new Error("Invalid image");
  } catch(e) {
    console.error("QC:", e.message);
    const errBody = JSON.stringify({ content:`⚠️ Chart failed for **${A.name}**.`, flags:64 });
    await fetch(editTarget ? `${w}/messages/${editTarget}` : w, { method: editTarget ? "PATCH" : "POST", headers:jH(), body:errBody });
    return;
  }

  // Build multipart body
  // When editing (refresh): include "attachments":[] to clear old image so new one replaces it
  const boundary = "----W" + Date.now();
  const embedPayload = {
    embeds:[{
      title:`${A.icon} ${A.name} — Last 24h`, color: up ? 0x00D278 : 0xFF466E,
      image:{ url:"attachment://chart.png" },
      fields:[
        { name:"Price",    value:`**${fmtPrice(lastP)}** ${fmtChg(chg, lastP)}`, inline:true },
        { name:"24h High", value:fmtPrice(maxP), inline:true },
        { name:"24h Low",  value:fmtPrice(minP), inline:true },
      ],
      footer:{ text:`15m Candles · Last 24H · ${fmtTs()}` },
      timestamp: new Date().toISOString(),
    }],
    components:[{ type:1, components:[
      { type:2, style:2, label:"🔄 Refresh", custom_id:`rc|${key}` },
    ]}],
    // Clear old attachments when editing so new image replaces them
    ...(editTarget ? { attachments:[] } : {}),
  };
  const payload = JSON.stringify(embedPayload);

  const enc = new TextEncoder();
  const p1  = enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n`);
  const p2  = enc.encode(payload);
  const p3  = enc.encode(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="files[0]"; filename="chart.png"\r\nContent-Type: image/png\r\n\r\n`);
  const p4  = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(p1.length + p2.length + p3.length + imgBuf.byteLength + p4.length);
  let off = 0;
  body.set(p1,off); off+=p1.length;
  body.set(p2,off); off+=p2.length;
  body.set(p3,off); off+=p3.length;
  body.set(new Uint8Array(imgBuf),off); off+=imgBuf.byteLength;
  body.set(p4,off);

  const url    = editTarget ? `${w}/messages/${editTarget}` : w;
  const method = editTarget ? "PATCH" : "POST";
  try {
    const resp = await fetch(url, { method, headers:{ "Content-Type":`multipart/form-data; boundary=${boundary}` }, body });
    if (!resp.ok) throw new Error(`${method} ${resp.status}: ${await resp.text()}`);
  } catch(e) {
    console.error("CHART_SEND:", e.message);
  }
}

// ─── Command Registration (one-time) ─────────────────────────────────────────
async function registerCmds(env) {
  const cmds = [
    { name:"s",    description:"Open interactive price menu with buttons", type:1 },
    { name:"start",description:"Open interactive price menu with buttons", type:1 },
    {
      // NO choices array → free-text input → no dropdown with Arabic names
      name:"p", description:"Live price — all assets, or one (e.g. btc, gold, nq, sp500)", type:1,
      options:[{
        name:"asset",
        description:"Asset alias: btc · eth · sol · gold · silver · oil · nq · sp500",
        type:3, required:false,
      }],
    },
    {
      name:"a", description:"Set a price alert — direction auto-detected (e.g. /a btc 90000)", type:1,
      options:[
        { name:"asset", description:"Asset alias: btc · eth · sol · gold · silver · oil · nq · sp500", type:3, required:true },
        { name:"price", description:"Target price (e.g. 90000)", type:10, required:true, min_value:0.00001 },
      ],
    },
    {
      name:"d", description:"Delete alerts from this channel", type:1,
      options:[
        { name:"asset", description:"Asset alias (optional — omit to clear all)", type:3,  required:false },
        { name:"price", description:"Specific price to remove (optional)",         type:10, required:false, min_value:0.00001 },
      ],
    },
    { name:"myalerts", description:"List active alerts in this channel", type:1 },
    { name:"help",     description:"Show all commands and usage examples",  type:1 },
  ];
  const r = await fetch(`${API}/applications/${env.DISCORD_APP_ID}/commands`, {
    method:"PUT", headers:botH(env), body:JSON.stringify(cmds),
  });
  return new Response(JSON.stringify(await r.json(), null, 2), { headers:{ "Content-Type":"application/json" } });
}

// ─── Channel Message Helper ───────────────────────────────────────────────────
async function sendMsg(env, chId, embed) {
  const r = await fetch(`${API}/channels/${chId}/messages`, {
    method:"POST", headers:botH(env), body:JSON.stringify({ embeds:[embed] }),
  });
  if (!r.ok) throw new Error(`Discord ${r.status}: ${await r.text()}`);
}

// ─── Main Export ─────────────────────────────────────────────────────────────
export default {

  // ── HTTP: Discord interactions ──────────────────────────────────────────
  async fetch(request, env, ctx) {
    const u = new URL(request.url);

    // Admin/debug endpoints
    if (u.searchParams.get("debug") === "1") {
      const c = { PK:!!env.DISCORD_PUBLIC_KEY, BT:!!env.DISCORD_BOT_TOKEN, AI:!!env.DISCORD_APP_ID, KV:!!env.DISCORD_KV };
      try { await env.DISCORD_KV.put("_t","1"); await env.DISCORD_KV.delete("_t"); c.KV_OK=true; } catch(e) { c.KV_OK=false; c.ERR=e.message; }
      return new Response(JSON.stringify(c,null,2), { headers:{ "Content-Type":"application/json" } });
    }
    if (u.searchParams.get("register")  === "1") return registerCmds(env);
    if (u.searchParams.get("alerts")    === "1") {
      const chs = await getAllChannels(env), out = [];
      for (const chId of chs) { const a = await getChAlerts(env,chId); out.push({ channel:chId, count:a.length, alerts:a }); }
      return new Response(JSON.stringify(out,null,2), { headers:{ "Content-Type":"application/json" } });
    }
    if (u.searchParams.get("testalert") === "1") {
      const chId = u.searchParams.get("ch");
      if (!chId) return new Response("Missing ?ch=CHANNEL_ID", { status:400 });
      try {
        await sendMsg(env, chId, { title:"🔔 Test Alert", color:0x00D278, description:"Bot is online and operational.", footer:{ text:fmtTs() }, timestamp:new Date().toISOString() });
        return new Response("✅ Sent");
      } catch(e) { return new Response(`❌ ${e.message}`, { status:500 }); }
    }

    if (request.method !== "POST") return new Response("Hyperliquid Alerts Bot — OK");

    let buf;
    try { buf = await request.arrayBuffer(); } catch { return new Response("Bad request", { status:400 }); }
    if (!(await verify(request, buf, env))) return new Response("Invalid Signature", { status:401 });

    let i;
    try { i = JSON.parse(new TextDecoder().decode(buf)); } catch { return new Response("Bad JSON", { status:400 }); }

    // PING handshake
    if (i.type === 1) return Response.json({ type:1 });

    // Track channel (non-blocking)
    if (i.channel_id) ctx.waitUntil(regChannel(env, i.channel_id));

    // Slash commands
    if (i.type === 2) {
      try { return await onCmd(i, env); }
      catch(e) { console.error("CMD:", e.message); return Response.json({ type:4, data:{ content:`❌ ${e.message}`, flags:64 } }); }
    }

    // Button / component interactions
    if (i.type === 3) {
      const d = i.data.custom_id;

      // Set Alert button → open modal (must be synchronous)
      if (d.startsWith("al|")) {
        const key = d.split("|")[1], A = ASSETS[key];
        if (!A) return new Response(null, { status:204 });
        return Response.json({ type:9, data:{
          custom_id:  `al|${key}`,
          title:      `🔔 Alert — ${A.icon} ${A.name}`,
          components: [{ type:1, components:[{
            type:4, custom_id:"price", label:"Target Price", style:1,
            placeholder:"e.g. 95000 — direction auto-detected",
            required:true, min_length:1, max_length:20,
          }]}],
        }});
      }

      // Back → synchronous component update (type 7 avoids extra API call)
      if (d === "back") {
        return Response.json({ type:7, data:{ content:"📊 **Select an asset:**", embeds:[], components:mainKB() } });
      }

      // Everything else → async (deferred update)
      ctx.waitUntil(onBtnAsync(i, env, wh(i.application_id, i.token)));
      return Response.json({ type:6 });
    }

    // Modal submit
    if (i.type === 5) {
      try { return await onModal(i, env); }
      catch(e) { console.error("MODAL:", e.message); return Response.json({ type:4, data:{ content:`❌ ${e.message}`, flags:64 } }); }
    }

    return new Response(null, { status:204 });
  },

  // ── Cron: check alerts every minute ────────────────────────────────────
  async scheduled(event, env) {
    if (!env.DISCORD_BOT_TOKEN) { console.error("BOT_TOKEN missing"); return; }
    let prices;
    try { prices = await fetchPrices(); }
    catch(e) { console.error("CRON fetchPrices:", e.message); return; }

    const channels = await getAllChannels(env);
    console.log(`CRON: ${channels.length} channel(s)`);

    for (const chId of channels) {
      try {
        const alerts = await getChAlerts(env, chId);
        if (!alerts.length) continue;
        const fired = [];
        for (const a of alerts) {
          const cur = prices[a.key];
          if (cur == null) continue;
          if ((a.cond === ">" && cur >= a.price) || (a.cond === "<" && cur <= a.price)) {
            try {
              await sendMsg(env, chId, alertFiredEmbed(ASSETS[a.key], a, cur));
              fired.push(a.id);
              console.log(`  FIRED: ${a.key} ${a.cond} ${a.price} cur=${cur}`);
            } catch(e) { console.error(`  MSG_ERR ${chId}: ${e.message}`); }
          }
        }
        if (fired.length) await setChAlerts(env, chId, alerts.filter(a => !fired.includes(a.id)));
      } catch(e) { console.error(`CH_ERR ${chId}: ${e.message}`); }
      await sleep(300);
    }
    console.log("CRON done");
  },
};
