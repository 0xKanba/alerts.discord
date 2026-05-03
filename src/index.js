const HL = "https://api.hyperliquid.xyz/info";
const API = "https://discord.com/api/v10";

const ASSETS = {
  BTC:    { sym: "BTC",        ar: "بيتكوين",   icon: "₿"  },
  ETH:    { sym: "ETH",        ar: "إيثريوم",   icon: "🔷"  },
  SOL:    { sym: "SOL",        ar: "سولانا",    icon: "🟣"  },
  GOLD:   { sym: "xyz:GOLD",   ar: "الذهب",     icon: "🟡"  },
  SILVER: { sym: "xyz:SILVER", ar: "الفضة",     icon: "⚪"  },
  OIL:    { sym: "xyz:CL",     ar: "النفط",     icon: "🛢"  },
  US100:  { sym: "xyz:XYZ100", ar: "ناسداك",    icon: "📈"  },
  SP500:  { sym: "xyz:SP500",  ar: "S&P 500",   icon: "📊"  },
};

function botH(env) { return { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" }; }
function jH()      { return { "Content-Type": "application/json" }; }
function wURL(a, t) { return `${API}/webhooks/${a}/${t}`; }

/* ═══════════════════════════════════════════════════════════ *

export default {
  async fetch(request, env) {
    const u = new URL(request.url);

    /* ─── Debug ─── */
    if (u.searchParams.get("debug") === "1") {
      const c = {
        PUBLIC_KEY: !!env.DISCORD_PUBLIC_KEY,
        BOT_TOKEN: !!env.DISCORD_BOT_TOKEN,
        APP_ID: !!env.DISCORD_APP_ID,
        KV: !!env.DISCORD_KV,
      };
      try { await env.DISCORD_KV.put("_t", "1"); await env.DISCORD_KV.delete("_t"); c.KV_RW = true; }
      catch (e) { c.KV_RW = false; c.KV_ERR = e.message; }
      return new Response(JSON.stringify(c, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    if (u.searchParams.get("register") === "1") return registerCmds(env);
    if (request.method !== "POST") return new Response("Alerts Bot");

    try {
      const buf = await request.arrayBuffer();
      const txt = new TextDecoder().decode(buf);
      if (!(await verify(request, buf, env))) return new Response("Invalid", { status: 401 });
      return await route(JSON.parse(txt), env);
    } catch (e) {
      console.error("ERR:", e.message);
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  },

  async scheduled(_, env) {
    const data = await fetchAll();
    for (const uid of await getUsers(env)) {
      const alerts = await getAlerts(env, uid);
      if (!alerts.length) continue;
      const fired = [];
      for (const a of alerts) {
        const cur = data[a.key]?.price;
        if (!cur) continue;
        if ((a.cond === ">" && cur >= a.price) || (a.cond === "<" && cur <= a.price)) {
          try { await sendDM(env, uid, alertEmbed(ASSETS[a.key], a, cur)); fired.push(a.id); }
          catch (e) { console.error("alert:", e.message); }
        }
      }
      if (fired.length) await setAlerts(env, uid, alerts.filter(a => !fired.includes(a.id)));
      await sleep(500);
    }
  },
};

/* ═══════════════════════════════════════════════════════════ */
async function verify(req, buf, env) {
  const sig = req.headers.get("x-signature-ed25519");
  const ts  = req.headers.get("x-signature-timestamp");
  if (!sig || !ts) return false;
  const key = await crypto.subtle.importKey("raw", h2b(env.DISCORD_PUBLIC_KEY), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", key, h2b(sig), new TextEncoder().encode(ts + new TextDecoder().decode(buf)));
}
function h2b(h) { const b = new Uint8Array(h.length / 2); for (let i = 0; i < h.length; i += 2) b[i / 2] = parseInt(h.substring(i, i + 2), 16); return b; }

/* ═══════════════════════════════════════════════════════════ */

async function route(i, env) {
  try {
    if (i.type === 1) return Response.json({ type: 1 });
    const uid = i.member?.user?.id || i.user?.id;
    if (uid) await regUser(env, uid);
    const w = wURL(i.application_id, i.token);
    if (i.type === 2) return onCmd(i, env);
    if (i.type === 3) return onBtn(i, env, w);
    if (i.type === 5) return onModal(i, env, w);
    return new Response(null, { status: 204 });
  } catch (e) {
    console.error("ROUTE:", e.message);
    try {
      await fetch(wURL(i.application_id, i.token), {
        method: "POST", headers: jH(),
        body: JSON.stringify({ content: `❌ خطأ: ${e.message}` }),
      });
    } catch {}
    return new Response(null, { status: 500 });
  }
}
/* ═══════════════════ SLASH COMMANDS ═════════════════════════ */
function onCmd(i, env) {
  const n = i.data.name;
  if (n === "s" || n === "start")
    return Response.json({ type: 4, data: { content: "📊 **اختر الأصل:**", components: mainKB() } });
  if (n === "p") return allPrices(i, env);
  if (n === "t")
    return Response.json({ type: 4, data: { content: "https://discord.com/channels/1364304054356017162/1378444097093636176" } });
  if (n === "myalerts") return myAlerts(i, env);
  return Response.json({ type: 4, data: { content: "❌", flags: 64 } });
}

/* ═══════════════════ ALL PRICES ═══════════════════════════ */
async function allPrices(i, env) {
  const data = await fetchAll();
  const fields = [];
  for (const [k, A] of Object.entries(ASSETS)) {
    const d = data[k];
    fields.push({
      name: `${A.icon} ${A.ar}`,
      value: d ? `**${fmtPrice(d.price)}** ${fmtChg(d.chg)}` : "⚠️",
      inline: true,
    });
  }
  return Response.json({ type: 4, data: { flags: 64, embeds: [{
    title: "💰 جميع الأسعار", color: 0x00D278,
    fields,
    footer: { text: `Hyperliquid · ${fmtTs()}` }, timestamp: new Date().toISOString(),
  }]}});
}

/* ═══════════════════ BUTTONS ══════════════════════════════ */
async function onBtn(i, env, w) {
  const d = i.data.custom_id;
  const H = jH();
  const uid = i.member?.user?.id || i.user?.id;
  const patch = (body) => fetch(`${w}/messages/@original`, { method: "PATCH", headers: H, body: JSON.stringify(body) }).catch(e => console.error(e.message));
  const follow = (body) => fetch(w, { method: "POST", headers: H, body: JSON.stringify(body) }).catch(e => console.error(e.message));

  if (d === "back")
    return Response.json({ type: 7, data: { content: "📊 **اختر الأصل:**", embeds: [], components: mainKB() } });

  if (d === "all") {
    const r = Response.json({ type: 6 });
    fetchAll().then(data => {
      const fields = [];
      for (const [k, A] of Object.entries(ASSETS)) {
        const det = data[k];
        fields.push({ name: `${A.icon} ${A.ar}`, value: det ? `**${fmtPrice(det.price)}** ${fmtChg(det.chg)}` : "⚠️", inline: true });
      }
      patch({ content: null, embeds: [{ title: "💰 جميع الأسعار", color: 0x00D278, fields, footer: { text: `Hyperliquid · ${fmtTs()}` }, timestamp: new Date().toISOString() }], components: mainKB() });
    });
    return r;
  }

  if (d.startsWith("p|")) {
    const key = d.split("|")[1], A = ASSETS[key];
    if (!A) return Response.json({ type: 7, data: { content: "❌", embeds: [], components: mainKB() } });
    const r = Response.json({ type: 6 });
    fetchDetail(key).then(det => {
      if (!det.price) return patch({ content: `⚠️ تعذّر جلب سعر ${A.ar}`, embeds: [], components: mainKB() });
      patch({ content: null, embeds: [priceEmbed(key, det)], components: detailKB(key) });
    });
    return r;
  }

  if (d.startsWith("rpa|")) {
    const key = d.split("|")[1];
    const r = Response.json({ type: 6 });
    fetchDetail(key).then(det => { if (det.price) patch({ embeds: [priceEmbed(key, det)], components: detailKB(key) }); });
    return r;
  }

  if (d.startsWith("c|")) {
    const key = d.split("|")[1];
    const r = Response.json({ type: 6 });
    patch({ content: "📊 **اختر الأصل:**", embeds: [], components: mainKB() });
    buildChart(key).then(cd => {
      if (!cd) return follow({ content: "⚠️ لا توجد بيانات", flags: 64 });
      follow({ embeds: [chartEmbed(key, cd)], components: chartKB(key) });
    });
    return r;
  }

  if (d.startsWith("rc|")) {
    const key = d.split("|")[1];
    const r = Response.json({ type: 6 });
    buildChart(key).then(cd => { if (cd) patch({ embeds: [chartEmbed(key, cd)], components: chartKB(key) }); });
    return r;
  }

  if (d.startsWith("al|")) {
    const key = d.split("|")[1], A = ASSETS[key];
    if (!A) return new Response(null, { status: 204 });
    return Response.json({ type: 9, data: {
      custom_id: `al|${key}`, title: `تنبيه — ${A.icon} ${A.ar}`,
      components: [{ type: 1, components: [{ type: 4, custom_id: "price", label: "السعر المستهدف", style: 1, placeholder: "مثال: 95000", required: true, min_length: 1, max_length: 20 }] }]
    }});
  }

  if (d.startsWith("del|")) {
    const aid = parseInt(d.split("|")[1]);
    const r = Response.json({ type: 6 });
    (async () => {
      const al = await getAlerts(env, uid);
      await setAlerts(env, uid, al.filter(a => a.id !== aid));
      patch({ content: "🗑️ تم حذف التنبيه", embeds: [], components: mainKB() });
    })();
    return r;
  }

  return new Response(null, { status: 204 });
}

/* ═══════════════════ MODAL SUBMIT ════════════════════════ */
async function onModal(i, env) {
  const d = i.data.custom_id, uid = i.member?.user?.id || i.user?.id;
  if (!d.startsWith("al|")) return new Response(null, { status: 204 });
  const key = d.split("|")[1], A = ASSETS[key];
  if (!A) return Response.json({ type: 4, data: { content: "❌", flags: 64 } });

  const raw = i.data.components[0].components[0].value;
  const tgt = parseFloat(raw.replace(/,/g, "").replace(/\$/g, ""));
  if (isNaN(tgt) || tgt <= 0) return Response.json({ type: 4, data: { content: "❌ سعر غير صحيح", flags: 64 } });

  const data = await fetchAll();
  const cur = data[key]?.price;
  if (!cur) return Response.json({ type: 4, data: { content: `⚠️ تعذّر جلب سعر ${A.ar}`, flags: 64 } });

  const cond = tgt > cur ? ">" : "<";
  const dist = Math.abs((tgt - cur) / cur * 100).toFixed(2);
  const dir = cond === ">" ? "🔼 عند الصعود إلى" : "🔽 عند النزول إلى";

  const alerts = await getAlerts(env, uid);
  alerts.push({ id: Date.now(), key, cond, price: tgt });
  await setAlerts(env, uid, alerts);

  return Response.json({ type: 4, data: { embeds: [{
    title: "✅ تنبيه مُضاف", color: 0x00D278,
    description: `${A.icon} **${A.ar}** — ${dir} **${fmtPrice(tgt)}**\n\nالسعر الحالي: ${fmtPrice(cur)}\nالبُعد عن الهدف: ${dist}%\n\n⏱ سيصلك التنبيه فور الوصول كرسالة خاصة`,
    footer: { text: fmtTs() }, timestamp: new Date().toISOString(),
  }]}});
}

/* ═══════════════════ MY ALERTS ════════════════════════════ */
async function myAlerts(i, env) {
  const uid = i.member?.user?.id || i.user?.id;
  const alerts = await getAlerts(env, uid);
  if (!alerts.length) return Response.json({ type: 4, data: { content: "📭 لا توجد تنبيهات نشطة\n\nاستخدم `/s` ثم اضغط 🔔", flags: 64 } });
  const rows = alerts.slice(0, 5).map(a => ({ type: 1, components: [{ type: 2, style: 4, label: `🗑️ ${ASSETS[a.key]?.icon || ""} ${ASSETS[a.key]?.ar || a.key} ${a.cond === ">" ? "🔼" : "🔽"} ${fmtPrice(a.price)}`, custom_id: `del|${a.id}` }] }));
  return Response.json({ type: 4, data: { content: `🔔 **تنبيهاتك النشطة (${alerts.length}):**`, components: rows, flags: 64 } });
}

/* ═══════════════════ UI COMPONENTS ══════════════════════ */
function mainKB() {
  return [
    { type: 1, components: [
      { type: 2, style: 2, label: "₿ BTC",   custom_id: "p|BTC"   },
      { type: 2, style: 2, label: "🔷 ETH",   custom_id: "p|ETH"   },
      { type: 2, style: 2, label: "🟣 SOL",   custom_id: "p|SOL"   },
    ]},
    { type: 1, components: [
      { type: 2, style: 2, label: "📊 S&P 500", custom_id: "p|SP500" },
      { type: 2, style: 2, label: "📈 ناسداك",  custom_id: "p|US100"  },
    ]},
    { type: 1, components: [
      { type: 2, style: 2, label: "🟡 ذهب",   custom_id: "p|GOLD"   },
      { type: 2, style: 2, label: "⚪ فضة",   custom_id: "p|SILVER" },
      { type: 2, style: 2, label: "🛢 نفط",   custom_id: "p|OIL"    },
    ]},
    { type: 1, components: [
      { type: 2, style: 1, label: "💰 كل الأسعار", custom_id: "all" },
    ]},
  ];
}
function detailKB(k) { return [
  { type: 1, components: [
    { type: 2, style: 2, label: "🔄 تحديث", custom_id: `rpa|${k}` },
    { type: 2, style: 2, label: "📊 رسم بياني", custom_id: `c|${k}` },
    { type: 2, style: 3, label: "🔔 تنبيه", custom_id: `al|${k}` },
  ]},
  { type: 1, components: [{ type: 2, style: 2, label: "◀️ رجوع", custom_id: "back" }] }
];}
function chartKB(k) { return [{ type: 1, components: [{ type: 2, style: 2, label: "🔄 تحديث الرسم", custom_id: `rc|${k}` }] }]; }

/* ═══════════════════ EMBEDS ══════════════════════════════ */
function priceEmbed(key, d) {
  const A = ASSETS[key], up = (d.chg24 ?? 0) >= 0;
  const rng = (d.high != null && d.low != null) ? (d.high - d.low) : null;
  const rngP = (rng && d.low) ? (rng / d.low * 100).toFixed(2) : null;
  return {
    title: `${A.icon} ${A.ar}`, color: up ? 0x00D278 : 0xFF466E,
    fields: [
      { name: "💰 السعر", value: fmtPrice(d.price), inline: true },
      { name: "📅 24 ساعة", value: fmtChg(d.chg24), inline: true },
      { name: "📅 7 أيام", value: fmtChg(d.chg7), inline: true },
      { name: "📅 30 يوم", value: fmtChg(d.chg30), inline: true },
      { name: "↑ أعلى اليوم", value: fmtPrice(d.high), inline: true },
      { name: "↓ أدنى اليوم", value: fmtPrice(d.low), inline: true },
      ...(rng && rngP ? [{ name: "↔ المدى", value: `${fmtPrice(rng)} (${rngP}%)`, inline: true }] : []),
    ],
    footer: { text: `Hyperliquid · ${fmtTs()}` }, timestamp: new Date().toISOString(),
  };
}
function chartEmbed(key, cd) {
  const A = ASSETS[key];
  return {
    title: `${A.icon} ${A.ar} — آخر 24 ساعة`, color: cd.chg >= 0 ? 0x00D278 : 0xFF466E,
    image: { url: cd.url },
    fields: [
      { name: "السعر الآن", value: `**${fmtPrice(cd.lastP)}** ${fmtChg(cd.chg)}`, inline: true },
      { name: "الأعلى", value: fmtPrice(cd.maxP), inline: true },
      { name: "الأدنى", value: fmtPrice(cd.minP), inline: true },
    ],
    footer: { text: "شموع 15 دقيقة · Hyperliquid" }, timestamp: new Date().toISOString(),
  };
}
function alertEmbed(A, a, cur) {
  return {
    title: "🔔 تنبيه سعري", color: 0xF59E0B,
    description: `${A.icon} **${A.ar}** — ${a.cond === ">" ? "🔼 وصل الهدف الأعلى" : "🔽 وصل الهدف الأدنى"}\n\nالسعر الآن: **${fmtPrice(cur)}**\nالهدف كان: **${fmtPrice(a.price)}**`,
    footer: { text: fmtTs() }, timestamp: new Date().toISOString(),
  };
}

/* ═══════════════════ DM ═════════════════════════════════ */
async function sendDM(env, uid, embed) {
  const h = botH(env);
  const r = await fetch(`${API}/users/@me/channels`, { method: "POST", headers: h, body: JSON.stringify({ recipient_id: uid }) });
  const ch = await r.json();
  if (!ch.id) throw new Error("DM failed");
  await fetch(`${API}/channels/${ch.id}/messages`, { method: "POST", headers: h, body: JSON.stringify({ embeds: [embed] }) });
}

/* ═══════════════════ REGISTER ════════════════════════════ */
async function registerCmds(env) {
  const h = botH(env);
  const cmds = [
    { name: "s", description: "قائمة أزرار الأسعار", type: 1 },
    { name: "start", description: "قائمة أزرار الأسعار", type: 1 },
    { name: "p", description: "كل الأسعار دفعة واحدة", type: 1 },
    { name: "t", description: "رابط القناة", type: 1 },
    { name: "myalerts", description: "تنبيهاتك النشطة", type: 1 },
  ];
  const r = await fetch(`${API}/applications/${env.DISCORD_APP_ID}/commands`, { method: "PUT", headers: h, body: JSON.stringify(cmds) });
  return new Response(JSON.stringify(await r.json(), null, 2), { headers: { "Content-Type": "application/json" } });
}

/* ═══════════════════ DATA ════════════════════════════════ */
async function fetchAll() {
  const out = {};
  await Promise.all(Object.entries(ASSETS).map(async ([k, A]) => {
    try {
      const now = Date.now();
      const [lbR, cdR] = await Promise.all([
        fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "l2Book", coin: A.sym }) }),
        fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin: A.sym, interval: "1h", startTime: now - 86400000, endTime: now } }) }),
      ]);
      const lb = await lbR.json(), candles = await cdR.json();
      if (lb.levels?.[0]?.[0] && lb.levels?.[1]?.[0]) {
        const bid = parseFloat(lb.levels[0][0].px), ask = parseFloat(lb.levels[1][0].px);
        const price = (bid + ask) / 2;
        let chg = null;
        if (Array.isArray(candles) && candles.length >= 2) { const o = parseFloat(candles[0].o), c = parseFloat(candles[candles.length - 1].c); if (o > 0) chg = (c - o) / o * 100; }
        out[k] = { price, chg };
      }
    } catch (e) { console.error(k, e.message); }
  }));
  return out;
}

async function fetchDetail(key) {
  const A = ASSETS[key], now = Date.now();
  const [allData, r1d, r15m] = await Promise.all([
    fetchAll(),
    fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin: A.sym, interval: "1d", startTime: now - 32 * 86400000, endTime: now } }) }).then(r => r.json()).catch(() => []),
    fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin: A.sym, interval: "15m", startTime: now - 86400000, endTime: now } }) }).then(r => r.json()).catch(() => []),
  ]);
  const d = allData[key], price = d?.price ?? null, chg24 = d?.chg ?? null;
  let chg7 = null, chg30 = null;
  if (Array.isArray(r1d) && r1d.length >= 7 && price) { const o = parseFloat(r1d[r1d.length - 7].o); if (o > 0) chg7 = (price - o) / o * 100; }
  if (Array.isArray(r1d) && r1d.length >= 1 && price) { const o = parseFloat(r1d[0].o); if (o > 0) chg30 = (price - o) / o * 100; }
  let high = null, low = null;
  if (Array.isArray(r15m) && r15m.length) { high = Math.max(...r15m.map(c => parseFloat(c.h))); low = Math.min(...r15m.map(c => parseFloat(c.l))); }
  return { price, chg24, chg7, chg30, high, low };
}

async function buildChart(key) {
  const A = ASSETS[key], now = Date.now();
  const r = await fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin: A.sym, interval: "15m", startTime: now - 86400000, endTime: now } }) });
  const candles = await r.json();
  if (!Array.isArray(candles) || !candles.length) return null;
  const labels = candles.map(c => { const d = new Date(c.t + 10800000); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; });
  const prices = candles.map(c => parseFloat(c.c)), highs = candles.map(c => parseFloat(c.h)), lows = candles.map(c => parseFloat(c.l));
  const minP = Math.min(...lows), maxP = Math.max(...highs), firstP = prices[0], lastP = prices[prices.length - 1];
  const chg = (lastP - firstP) / firstP * 100, up = lastP >= firstP;
  const clr = up ? "rgb(0,210,120)" : "rgb(255,70,110)", fill = up ? "rgba(0,210,120,0.12)" : "rgba(255,70,110,0.12)";
  const step = 2, dP = prices.filter((_, i) => i % step === 0), dL = labels.filter((_, i) => i % step === 0);
  const cfg = {
    type: "line",
    data: { labels: dL, datasets: [{ data: dP, borderColor: clr, backgroundColor: fill, borderWidth: 2, pointRadius: 0, fill: true, tension: 0.3 }] },
    options: {
      plugins: { legend: { display: false }, title: { display: true, text: `${A.ar}  ${up ? "▲" : "▼"} ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`, color: "#e0e0e0", font: { size: 15, weight: "bold" } } },
      scales: {
        x: { ticks: { color: "#888", maxTicksLimit: 8, maxRotation: 0 }, grid: { color: "rgba(255,255,255,0.04)" } },
        y: { position: "right", ticks: { color: "#888", callback: v => "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 0 }) }, grid: { color: "rgba(255,255,255,0.06)" }, min: +(minP * 0.9997).toFixed(2), max: +(maxP * 1.0003).toFixed(2) },
      },
      layout: { padding: { left: 8, right: 8, top: 4, bottom: 4 } },
    },
  };
  return { url: `https://quickchart.io/chart?w=800&h=380&bkg=%230d1117&c=` + encodeURIComponent(JSON.stringify(cfg)), lastP, maxP, minP, chg };
}

/* ═══════════════════ KV ══════════════════════════════════ */
async function getAlerts(env, id) { try { const r = await env.DISCORD_KV.get(`c:${id}`); return r ? JSON.parse(r) : []; } catch { return []; } }
async function setAlerts(env, id, l) { await env.DISCORD_KV.put(`c:${id}`, JSON.stringify(l)); }
async function getUsers(env) { try { const r = await env.DISCORD_KV.get("users"); return r ? JSON.parse(r) : []; } catch { return []; } }
async function regUser(env, id) { const u = await getUsers(env); if (!u.includes(id)) { u.push(id); await env.DISCORD_KV.put("users", JSON.stringify(u)); } }

/* ═══════════════════ FORMAT ══════════════════════════════ */
function fmtPrice(v) { if (!v) return "—"; if (v >= 1000) return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); if (v >= 100) return "$" + v.toFixed(2); if (v >= 1) return "$" + v.toFixed(3); return "$" + v.toFixed(5); }
function fmtChg(c) { if (c == null) return "—"; return `${c >= 0 ? "🟢" : "🔴"} ${c >= 0 ? "+" : ""}${c.toFixed(2)}%`; }
function fmtTs() { const d = new Date(Date.now() + 10800000); const dd = String(d.getUTCDate()).padStart(2, "0"); const mm = String(d.getUTCMonth() + 1).padStart(2, "0"); const yyyy = d.getUTCFullYear(); let hh = d.getUTCHours(); const min = String(d.getUTCMinutes()).padStart(2, "0"); const ss = String(d.getUTCSeconds()).padStart(2, "0"); const ap = hh >= 12 ? "م" : "ص"; hh = hh % 12 || 12; return `${dd}/${mm}/${yyyy}، ${String(hh).padStart(2, "0")}:${min}:${ss} ${ap}`; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
