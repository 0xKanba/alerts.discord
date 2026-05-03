const HL = "https://api.hyperliquid.xyz/info";
const API = "https://discord.com/api/v10";
const QC = "https://quickchart.io/chart";

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

const ALIAS = {
  btc:"BTC", bitcoin:"BTC", بيتكوين:"BTC",
  eth:"ETH", ethereum:"ETH", إيثريوم:"ETH",
  sol:"SOL", سولانا:"SOL",
  gold:"GOLD", xau:"GOLD", ذهب:"GOLD", gc:"GOLD",
  silver:"SILVER", xag:"SILVER", فضة:"SILVER", si:"SILVER",
  oil:"OIL", cl:"OIL", wti:"OIL", نفط:"OIL",
  us100:"US100", nasdaq:"US100", nq:"US100", ناسداك:"US100",
  sp500:"SP500", es:"SP500", us500:"SP500", sp:"SP500",
};

function resolveAsset(r) { if (!r) return null; const k = ALIAS[r.toLowerCase().trim()] || r.toUpperCase().trim(); return ASSETS[k] ? k : null; }
function botH(env) { return { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" }; }
function jH() { return { "Content-Type": "application/json" }; }
function wh(a, t) { return `${API}/webhooks/${a}/${t}`; }
const ASSET_CHOICES = Object.entries(ASSETS).map(([k, A]) => ({ name: `${A.icon} ${A.ar}`, value: k.toLowerCase() }));

/* ═══════════════════════════════════════════════════════════ */
export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);

    /* ─── Debug ─── */
    if (u.searchParams.get("debug") === "1") {
      const c = { PK: !!env.DISCORD_PUBLIC_KEY, BT: !!env.DISCORD_BOT_TOKEN, AI: !!env.DISCORD_APP_ID, KV: !!env.DISCORD_KV };
      try { await env.DISCORD_KV.put("_t","1"); await env.DISCORD_KV.delete("_t"); c.KV_OK = true; } catch(e) { c.KV_OK = false; c.ERR = e.message; }
      return new Response(JSON.stringify(c,null,2), { headers:{"Content-Type":"application/json"} });
    }

    /* ─── Debug Alerts ─── */
    if (u.searchParams.get("alerts") === "1") {
      try {
        const users = await getUsers(env);
        const out = { users_count: users.length, users: [] };
        for (const uid of users) {
          const alerts = await getAlerts(env, uid);
          out.users.push({ id: uid, alerts: alerts.length, items: alerts });
        }
        return new Response(JSON.stringify(out, null, 2), { headers:{"Content-Type":"application/json"} });
      } catch(e) { return new Response(JSON.stringify({ error: e.message }), { headers:{"Content-Type":"application/json"} }); }
    }

    /* ─── Test Alert ─── */
    if (u.searchParams.get("testdm") === "1") {
      try {
        const uid = u.searchParams.get("uid");
        if (!uid) return new Response("أضف ?uid=YOUR_DISCORD_ID", { headers:{"Content-Type":"text/plain"} });
        await sendDM(env, uid, { title: "🔔 اختبار تنبيه", color: 0x00D278, description: "البوت يعمل بشكل صحيح!\nستصلك التنبيهات فور وصول السعر.", footer: { text: fmtTs() }, timestamp: new Date().toISOString() });
        return new Response("✅ تم إرسال رسالة اختبار", { headers:{"Content-Type":"text/plain"} });
      } catch(e) { return new Response(`❌ ${e.message}`, { headers:{"Content-Type":"text/plain"} }); }
    }

    if (u.searchParams.get("register") === "1") return registerCmds(env);
    if (request.method !== "POST") return new Response("Alerts Bot");

    try {
      const buf = await request.arrayBuffer();
      const txt = new TextDecoder().decode(buf);
      if (!(await verify(request, buf, env))) return new Response("Invalid", { status: 401 });
      const i = JSON.parse(txt);
      if (i.type === 1) return Response.json({ type: 1 });
      const uid = i.member?.user?.id || i.user?.id;
      if (uid) await regUser(env, uid);
      if (i.type === 2) return await onCmd(i, env);
      if (i.type === 3) {
        const d = i.data.custom_id;
        if (d === "back") return Response.json({ type: 7, data: { content: "📊 **اختر الأصل:**", embeds: [], components: mainKB() } });
        if (d.startsWith("al|")) {
          const key = d.split("|")[1], A = ASSETS[key];
          if (!A) return new Response(null, { status: 204 });
          return Response.json({ type: 9, data: {
            custom_id: `al|${key}`, title: `تنبيه — ${A.icon} ${A.ar}`,
            components: [{ type: 1, components: [{ type: 4, custom_id: "price", label: "السعر المستهدف", style: 1, placeholder: "مثال: 95000", required: true, min_length: 1, max_length: 20 }] }]
          }});
        }
        ctx.waitUntil(onBtnAsync(i, env, wh(i.application_id, i.token)));
        return Response.json({ type: 6 });
      }
      if (i.type === 5) return await onModal(i, env);
      return new Response(null, { status: 204 });
    } catch (e) {
      console.error("ERR:", e.message);
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers:{"Content-Type":"application/json"} });
    }
  },

  /* ═══════════════════ CRON — كل دقيقة ════════════════════ */
  async scheduled(event, env) {
    console.log("=== CRON START ===");

    if (!env.DISCORD_BOT_TOKEN) {
      console.error("BOT_TOKEN missing — alerts cannot send DMs");
      return;
    }
    if (!env.DISCORD_KV) {
      console.error("DISCORD_KV not bound");
      return;
    }

    try {
      const data = await fetchAll();
      const users = await getUsers(env);
      console.log(`Users: ${users.length}`);

      for (const uid of users) {
        const alerts = await getAlerts(env, uid);
        if (!alerts.length) continue;
        console.log(`User ${uid}: ${alerts.length} alerts`);

        const fired = [];
        for (const a of alerts) {
          const cur = data[a.key]?.price;
          if (!cur) { console.log(`  ${a.key}: no price`); continue; }

          const hit = (a.cond === ">" && cur >= a.price) || (a.cond === "<" && cur <= a.price);
          console.log(`  ${a.key} ${a.cond} ${a.price} | now ${cur.toFixed(2)} | ${hit ? "🔥 HIT" : "—"}`);

          if (hit) {
            try {
              await sendDM(env, uid, alertEmbed(ASSETS[a.key], a, cur));
              fired.push(a.id);
              console.log(`  ✅ DM sent to ${uid}`);
            } catch (e) {
              console.error(`  ❌ DM failed for ${uid}: ${e.message}`);
            }
          }
        }

        if (fired.length) {
          const remaining = alerts.filter(a => !fired.includes(a.id));
          await setAlerts(env, uid, remaining);
          console.log(`  Removed ${fired.length}, left ${remaining.length}`);
        }
        await sleep(400);
      }

      console.log("=== CRON END ===");
    } catch (e) {
      console.error("CRON ERROR:", e.message);
    }
  },
};

/* ═════════════════ VERIFY ═══════════════════════════════ */
async function verify(req, buf, env) {
  const sig = req.headers.get("x-signature-ed25519");
  const ts  = req.headers.get("x-signature-timestamp");
  if (!sig || !ts) return false;
  const key = await crypto.subtle.importKey("raw", h2b(env.DISCORD_PUBLIC_KEY), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", key, h2b(sig), new TextEncoder().encode(ts + new TextDecoder().decode(buf)));
}
function h2b(h) { const b = new Uint8Array(h.length / 2); for (let i = 0; i < h.length; i += 2) b[i / 2] = parseInt(h.substring(i, i + 2), 16); return b; }

/* ═════════════════ SLASH COMMANDS ═════════════════════════ */
async function onCmd(i, env) {
  const n = i.data.name;
  if (n === "s" || n === "start")
    return Response.json({ type: 4, data: { content: "📊 **اختر الأصل:**", components: mainKB() } });
  if (n === "p") return await cmdP(i, env);
  if (n === "a") return await addAlert(i, env);
  if (n === "d") return await delAlert(i, env);
  if (n === "t")
    return Response.json({ type: 4, data: { content: "https://discord.com/channels/1364304054356017162/1378444097093636176" } });
  if (n === "myalerts") return await myAlerts(i, env);
  return Response.json({ type: 4, data: { content: "❌", flags: 64 } });
}

/* ═══════════════════ /p ═════════════════════════════════ */
async function cmdP(i, env) {
  const opts = i.data.options || [];
  const rawAsset = opts.find(o => o.name === "asset")?.value;
  if (rawAsset) {
    const key = resolveAsset(rawAsset);
    if (!key) return Response.json({ type: 4, data: { content: "❌ أصل غير معروف", flags: 64 } });
    const A = ASSETS[key];
    const det = await fetchDetail(key);
    if (!det.price) return Response.json({ type: 4, data: { content: `⚠️ تعذّر جلب سعر ${A.ar}`, flags: 64 } });
    return Response.json({ type: 4, data: { embeds: [priceEmbed(key, det)] } });
  }
  return await allPrices(env);
}

/* ═══════════════════ /a ═════════════════════════════════ */
async function addAlert(i, env) {
  const opts = i.data.options || [];
  const rawAsset = opts.find(o => o.name === "asset")?.value;
  const tgt = opts.find(o => o.name === "price")?.value;
  const key = resolveAsset(rawAsset);
  if (!key) return Response.json({ type: 4, data: { content: "❌ أصل غير معروف", flags: 64 } });
  const A = ASSETS[key];
  if (isNaN(tgt) || tgt <= 0) return Response.json({ type: 4, data: { content: "❌ سعر غير صحيح", flags: 64 } });
  const data = await fetchAll();
  const cur = data[key]?.price;
  if (!cur) return Response.json({ type: 4, data: { content: `⚠️ تعذّر جلب سعر ${A.ar}`, flags: 64 } });
  const cond = tgt > cur ? ">" : "<";
  const dist = Math.abs((tgt - cur) / cur * 100).toFixed(2);
  const dir = cond === ">" ? "🔼 عند الصعود إلى" : "🔽 عند النزول إلى";
  const uid = i.member?.user?.id || i.user?.id;
  const alerts = await getAlerts(env, uid);
  alerts.push({ id: Date.now(), key, cond, price: tgt });
  await setAlerts(env, uid, alerts);
  return Response.json({ type: 4, data: { embeds: [{
    title: "✅ تنبيه مُضاف", color: 0x00D278,
    description: `${A.icon} **${A.ar}** — ${dir} **${fmtPrice(tgt)}**\n\nالسعر الحالي: ${fmtPrice(cur)}\nالبُعد عن الهدف: ${dist}%\n\n⏱ سيصلك التنبيه فور الوصول كرسالة خاصة`,
    footer: { text: fmtTs() }, timestamp: new Date().toISOString(),
  }]}});
}

/* ═══════════════════ /d ═════════════════════════════════ */
async function delAlert(i, env) {
  const opts = i.data.options || [];
  const rawAsset = opts.find(o => o.name === "asset")?.value;
  const tgt = opts.find(o => o.name === "price")?.value;
  const uid = i.member?.user?.id || i.user?.id;
  if (!rawAsset && tgt === undefined) {
    const alerts = await getAlerts(env, uid);
    if (!alerts.length) return Response.json({ type: 4, data: { content: "📭 لا توجد تنبيهات", flags: 64 } });
    await setAlerts(env, uid, []);
    return Response.json({ type: 4, data: { content: `🗑️ تم حذف **${alerts.length}** تنبيه`, flags: 64 } });
  }
  const key = resolveAsset(rawAsset);
  if (!key) return Response.json({ type: 4, data: { content: "❌ أصل غير معروف", flags: 64 } });
  const alerts = await getAlerts(env, uid);
  if (tgt === undefined) {
    const before = alerts.length;
    const filtered = alerts.filter(a => a.key !== key);
    if (before === filtered.length) return Response.json({ type: 4, data: { content: `📭 لا توجد تنبيهات لـ ${ASSETS[key].ar}`, flags: 64 } });
    await setAlerts(env, uid, filtered);
    return Response.json({ type: 4, data: { content: `🗑️ تم حذف **${before - filtered.length}** تنبيه لـ ${ASSETS[key].icon} ${ASSETS[key].ar}`, flags: 64 } });
  }
  const before = alerts.length;
  const filtered = alerts.filter(a => !(a.key === key && Math.abs(a.price - tgt) < 0.01));
  if (before === filtered.length) return Response.json({ type: 4, data: { content: "📭 لا يوجد تنبيه مطابق", flags: 64 } });
  await setAlerts(env, uid, filtered);
  return Response.json({ type: 4, data: { content: `🗑️ تم حذف تنبيه ${ASSETS[key].icon} ${ASSETS[key].ar} عند ${fmtPrice(tgt)}`, flags: 64 } });
}

/* ═══════════════════ /p كل الأسعار ══════════════════════ */
async function allPrices(env) {
  const data = await fetchAll();
  const fields = Object.entries(ASSETS).map(([k, A]) => {
    const d = data[k];
    return { name: `${A.icon} ${A.ar}`, value: d ? `**${fmtPrice(d.price)}** ${fmtChg(d.chg)}` : "⚠️", inline: true };
  });
  return Response.json({ type: 4, data: { flags: 64, embeds: [{ title: "💰 جميع الأسعار", color: 0x00D278, fields, footer: { text: `Hyperliquid · ${fmtTs()}` }, timestamp: new Date().toISOString() }]}});
}

/* ═══════════════════ /myalerts ══════════════════════════ */
async function myAlerts(i, env) {
  const uid = i.member?.user?.id || i.user?.id;
  const alerts = await getAlerts(env, uid);
  if (!alerts.length) return Response.json({ type: 4, data: { content: "📭 لا توجد تنبيهات نشطة\n\n`/a btc 95000` لإضافة\n`/d` لحذف الكل", flags: 64 } });
  const rows = alerts.slice(0, 10).map(a => ({ type: 1, components: [{ type: 2, style: 4, label: `🗑️ ${ASSETS[a.key]?.icon||""} ${ASSETS[a.key]?.ar||a.key} ${a.cond===">"?"🔼":"🔽"} ${fmtPrice(a.price)}`, custom_id: `del|${a.id}` }] }));
  return Response.json({ type: 4, data: { content: `🔔 **تنبيهاتك (${alerts.length}):**\n\n\`/d\` → حذف الكل\n\`/d btc\` → حذف كل BTC\n\`/d btc 95000\` → حذف محدد`, components: rows, flags: 64 } });
}

/* ═══════════════════ ASYNC BUTTONS ═══════════════════════ */
async function onBtnAsync(i, env, w) {
  const d = i.data.custom_id;
  const H = jH();
  const uid = i.member?.user?.id || i.user?.id;
  const patch = (body) => fetch(`${w}/messages/@original`, { method: "PATCH", headers: H, body: JSON.stringify(body) });
  const follow = (body) => fetch(w, { method: "POST", headers: H, body: JSON.stringify(body) });
  try {
    if (d === "all") {
      const data = await fetchAll();
      const fields = Object.entries(ASSETS).map(([k, A]) => { const det = data[k]; return { name: `${A.icon} ${A.ar}`, value: det ? `**${fmtPrice(det.price)}** ${fmtChg(det.chg)}` : "⚠️", inline: true }; });
      await patch({ content: null, embeds: [{ title: "💰 جميع الأسعار", color: 0x00D278, fields, footer: { text: `Hyperliquid · ${fmtTs()}` }, timestamp: new Date().toISOString() }], components: mainKB() });
      return;
    }
    if (d.startsWith("p|")) {
      const key = d.split("|")[1], A = ASSETS[key];
      if (!A) { await patch({ content: "❌", embeds: [], components: mainKB() }); return; }
      const det = await fetchDetail(key);
      if (!det.price) { await patch({ content: `⚠️ تعذّر جلب سعر ${A.ar}`, embeds: [], components: mainKB() }); return; }
      await patch({ content: null, embeds: [priceEmbed(key, det)], components: detailKB(key) });
      return;
    }
    if (d.startsWith("rpa|")) {
      const key = d.split("|")[1];
      const det = await fetchDetail(key);
      if (det.price) await patch({ embeds: [priceEmbed(key, det)], components: detailKB(key) });
      return;
    }
    if (d.startsWith("c|")) {
      const key = d.split("|")[1], A = ASSETS[key];
      await patch({ content: `⏳ جاري إنشاء رسم ${A.ar}...`, embeds: [], components: mainKB() });
      await sendChartMsg(w, key);
      return;
    }
    if (d.startsWith("rc|")) {
      await sendChartMsg(w, d.split("|")[1]);
      return;
    }
    if (d.startsWith("del|")) {
      const aid = parseInt(d.split("|")[1]);
      const al = await getAlerts(env, uid);
      await setAlerts(env, uid, al.filter(a => a.id !== aid));
      await patch({ content: "🗑️ تم حذف التنبيه", embeds: [], components: mainKB() });
      return;
    }
  } catch (e) {
    console.error("BTN:", e.message);
    try { await follow({ content: `❌ خطأ: ${e.message}`, flags: 64 }); } catch {}
  }
}

/* ═══════════════════ CHART ════════════════════════════════ */
async function sendChartMsg(w, key) {
  const A = ASSETS[key];
  if (!A) return;
  const now = Date.now();
  const candleResp = await fetch(HL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin: A.sym, interval: "15m", startTime: now - 86400000, endTime: now } }),
  });
  const candles = await candleResp.json();
  if (!Array.isArray(candles) || !candles.length) {
    await fetch(w, { method: "POST", headers: jH(), body: JSON.stringify({ content: `⚠️ لا توجد بيانات لرسم ${A.ar}`, flags: 64 }) });
    return;
  }
  const prices = candles.map(c => parseFloat(c.c));
  const highs  = candles.map(c => parseFloat(c.h));
  const lows   = candles.map(c => parseFloat(c.l));
  const minP = Math.min(...lows), maxP = Math.max(...highs);
  const firstP = prices[0], lastP = prices[prices.length - 1];
  const chg = (lastP - firstP) / firstP * 100;
  const up = lastP >= firstP;
  const clr  = up ? "rgb(0,210,120)" : "rgb(255,70,110)";
  const fill = up ? "rgba(0,210,120,0.12)" : "rgba(255,70,110,0.12)";
  const step = 4;
  const dP = prices.filter((_, i) => i % step === 0);
  const dL = candles.filter((_, i) => i % step === 0).map(c => { const dt = new Date(c.t + 10800000); return `${String(dt.getUTCHours()).padStart(2,"0")}:${String(dt.getUTCMinutes()).padStart(2,"0")}`; });
  const chartCfg = {
    type: "line",
    data: { labels: dL, datasets: [{ data: dP, borderColor: clr, backgroundColor: fill, borderWidth: 2, pointRadius: 0, fill: true, tension: 0.3 }] },
    options: {
      plugins: { legend: { display: false }, title: { display: true, text: `${A.ar}  ${up?"▲":"▼"} ${chg>=0?"+":""}${chg.toFixed(2)}%`, color: "#e0e0e0", font: { size: 15, weight: "bold" } } },
      scales: {
        x: { ticks: { color: "#888", maxTicksLimit: 8, maxRotation: 0 }, grid: { color: "rgba(255,255,255,0.04)" } },
        y: { position: "right", ticks: { color: "#888", callback: v => "$"+Number(v).toLocaleString("en-US",{minimumFractionDigits:0}) }, grid: { color: "rgba(255,255,255,0.06)" }, min: +(minP*0.9997).toFixed(2), max: +(maxP*1.0003).toFixed(2) },
      },
      layout: { padding: { left: 8, right: 8, top: 4, bottom: 4 } },
    },
  };
  let imgBuf;
  try {
    const imgResp = await fetch(QC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chart: chartCfg, width: 800, height: 380, backgroundColor: "#0d1117", format: "png" }) });
    if (!imgResp.ok) throw new Error(`QC ${imgResp.status}`);
    imgBuf = await imgResp.arrayBuffer();
    if (imgBuf.byteLength < 1000) throw new Error("صورة صغيرة جداً");
  } catch (e) {
    console.error("QC:", e.message);
    await fetch(w, { method: "POST", headers: jH(), body: JSON.stringify({ content: `⚠️ تعذّر إنشاء رسم ${A.ar}`, flags: 64 }) });
    return;
  }
  const boundary = "----Chart" + Date.now();
  const payloadJson = JSON.stringify({
    embeds: [{
      title: `${A.icon} ${A.ar} — آخر 24 ساعة`, color: up ? 0x00D278 : 0xFF466E,
      image: { url: "attachment://chart.png" },
      fields: [
        { name: "السعر الآن", value: `**${fmtPrice(lastP)}** ${fmtChg(chg)}`, inline: true },
        { name: "الأعلى", value: fmtPrice(maxP), inline: true },
        { name: "الأدنى", value: fmtPrice(minP), inline: true },
      ],
      footer: { text: "شموع 15 دقيقة · Hyperliquid" }, timestamp: new Date().toISOString(),
    }],
    components: chartKB(key),
  });
  const enc = new TextEncoder();
  const p1 = enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n`);
  const p2 = enc.encode(payloadJson);
  const p3 = enc.encode(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="files[0]"; filename="chart.png"\r\nContent-Type: image/png\r\n\r\n`);
  const p4 = enc.encode(`\r\n--${boundary}--\r\n`);
  const total = p1.length + p2.length + p3.length + imgBuf.byteLength + p4.length;
  const body = new Uint8Array(total);
  let off = 0;
  body.set(p1, off); off += p1.length;
  body.set(p2, off); off += p2.length;
  body.set(p3, off); off += p3.length;
  body.set(new Uint8Array(imgBuf), off); off += imgBuf.byteLength;
  body.set(p4, off);
  try {
    const resp = await fetch(w, { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body });
    if (!resp.ok) { console.error("DISC:", resp.status, await resp.text()); await fetch(w, { method: "POST", headers: jH(), body: JSON.stringify({ content: `⚠️ تعذّر إرسال رسم ${A.ar}`, flags: 64 }) }); }
  } catch (e) {
    console.error("SEND:", e.message);
    await fetch(w, { method: "POST", headers: jH(), body: JSON.stringify({ content: `⚠️ خطأ في إرسال رسم ${A.ar}`, flags: 64 }) });
  }
}

/* ═══════════════════ MODAL ═══════════════════════════════ */
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

/* ═══════════════════ UI ══════════════════════════════════ */
function mainKB() {
  return [
    { type: 1, components: [
      { type: 2, style: 2, label: "₿ BTC", custom_id: "p|BTC" },
      { type: 2, style: 2, label: "🔷 ETH", custom_id: "p|ETH" },
      { type: 2, style: 2, label: "🟣 SOL", custom_id: "p|SOL" },
    ]},
    { type: 1, components: [
      { type: 2, style: 2, label: "📊 S&P 500", custom_id: "p|SP500" },
      { type: 2, style: 2, label: "📈 ناسداك", custom_id: "p|US100" },
    ]},
    { type: 1, components: [
      { type: 2, style: 2, label: "🟡 ذهب", custom_id: "p|GOLD" },
      { type: 2, style: 2, label: "⚪ فضة", custom_id: "p|SILVER" },
      { type: 2, style: 2, label: "🛢 نفط", custom_id: "p|OIL" },
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
  if (!ch.id) throw new Error(`DM open failed: ${JSON.stringify(ch)}`);
  const mResp = await fetch(`${API}/channels/${ch.id}/messages`, { method: "POST", headers: h, body: JSON.stringify({ embeds: [embed] }) });
  if (!mResp.ok) { const err = await mResp.text(); throw new Error(`DM send failed: ${mResp.status} ${err}`); }
}

/* ═══════════════════ REGISTER ════════════════════════════ */
async function registerCmds(env) {
  const h = botH(env);
  const cmds = [
    { name: "s", description: "قائمة أزرار الأسعار", type: 1 },
    { name: "start", description: "قائمة أزرار الأسعار", type: 1 },
    { name: "p", description: "كل الأسعار أو سعر أصل محدد", type: 1, options: [
      { name: "asset", description: "الأصل (اختياري)", type: 3, required: false, choices: ASSET_CHOICES },
    ]},
    { name: "a", description: "إضافة تنبيه", type: 1, options: [
      { name: "asset", description: "الأصل", type: 3, required: true, choices: ASSET_CHOICES },
      { name: "price", description: "السعر المستهدف", type: 10, required: true, min_value: 0.01 },
    ]},
    { name: "d", description: "حذف تنبيه", type: 1, options: [
      { name: "asset", description: "الأصل", type: 3, required: false, choices: ASSET_CHOICES },
      { name: "price", description: "السعر", type: 10, required: false, min_value: 0.01 },
    ]},
    { name: "t", description: "رابط القناة", type: 1 },
    { name: "myalerts", description: "تنبيهاتك النشطة", type: 1 },
  ];
  const r = await fetch(`${API}/applications/${env.DISCORD_APP_ID}/commands`, { method: "PUT", headers: h, body: JSON.stringify(cmds) });
  return new Response(JSON.stringify(await r.json(), null, 2), { headers:{"Content-Type":"application/json"} });
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

/* ═══════════════════ KV ══════════════════════════════════ */
async function getAlerts(env, id) { try { const r = await env.DISCORD_KV.get(`c:${id}`); return r ? JSON.parse(r) : []; } catch { return []; } }
async function setAlerts(env, id, l) { await env.DISCORD_KV.put(`c:${id}`, JSON.stringify(l)); }
async function getUsers(env) { try { const r = await env.DISCORD_KV.get("users"); return r ? JSON.parse(r) : []; } catch { return []; } }
async function regUser(env, id) { const u = await getUsers(env); if (!u.includes(id)) { u.push(id); await env.DISCORD_KV.put("users", JSON.stringify(u)); } }

/* ═══════════════════ FORMAT ══════════════════════════════ */
function fmtPrice(v) { if (!v) return "—"; if (v >= 1000) return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); if (v >= 100) return "$" + v.toFixed(2); if (v >= 1) return "$" + v.toFixed(3); return "$" + v.toFixed(5); }
function fmtChg(c) { if (c == null) return "—"; return `${c >= 0 ? "🟢" : "🔴"} ${c >= 0 ? "+" : ""}${c.toFixed(2)}%`; }
function fmtTs() { const d = new Date(Date.now() + 10800000); const dd = String(d.getUTCDate()).padStart(2,"0"); const mm = String(d.getUTCMonth() + 1).padStart(2,"0"); const yyyy = d.getUTCFullYear(); let hh = d.getUTCHours(); const min = String(d.getUTCMinutes()).padStart(2,"0"); const ss = String(d.getUTCSeconds()).padStart(2,"0"); const ap = hh >= 12 ? "م" : "ص"; hh = hh % 12 || 12; return `${dd}/${mm}/${yyyy}، ${String(hh).padStart(2,"0")}:${min}:${ss} ${ap}`; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
