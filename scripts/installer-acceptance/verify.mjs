import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

if (
  process.env.USERNAME !== "WDAGUtilityAccount" ||
  process.env.WFHELPER_USER_DATA !== path.join(process.env.APPDATA, "WantedFrame")
) {
  throw new Error(
    "This verifier only runs inside the generated Windows Sandbox acceptance session",
  );
}
const [phase, output] = process.argv.slice(2);
assert.ok(["previous", "current"].includes(phase));
const deadline = Date.now() + 90_000;
let target;
while (!target && Date.now() < deadline) {
  try {
    const response = await fetch("http://127.0.0.1:9223/json/list", {
      signal: AbortSignal.timeout(2000),
    });
    target = (await response.json()).find(
      (page) => page.type === "page" && page.url.includes("renderer/dist/index.html"),
    );
  } catch {}
  if (!target) await new Promise((resolve) => setTimeout(resolve, 250));
}
assert.ok(target, "installed renderer never opened its debugging endpoint");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error("Debugging socket did not open"));
  }, 10_000);
  socket.addEventListener(
    "open",
    () => {
      clearTimeout(timer);
      resolve();
    },
    { once: true },
  );
  socket.addEventListener(
    "error",
    (error) => {
      clearTimeout(timer);
      reject(error);
    },
    { once: true },
  );
});
let nextId = 0;
const pending = new Map();
const rendererErrors = [];
socket.addEventListener("message", ({ data }) => {
  const response = JSON.parse(data);
  if (response.method === "Runtime.exceptionThrown")
    rendererErrors.push(response.params.exceptionDetails);
  const request = pending.get(response.id);
  if (!request) return;
  pending.delete(response.id);
  clearTimeout(request.timer);
  if (response.error) request.reject(new Error(JSON.stringify(response.error)));
  else request.resolve(response.result);
});
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 15_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
try {
  await command("Runtime.enable");
  let ready = false;
  while (!ready && Date.now() < deadline) {
    ready = await evaluate(
      "Boolean(window.api && document.querySelector('#app')?.textContent?.trim())",
    );
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "installed renderer did not become ready");
  if (phase === "previous") {
    await evaluate(`(async () => {
      localStorage.setItem('setup-completed-v2', '1');
      localStorage.setItem('feature-tour-done', '1');
      localStorage.setItem('installer-acceptance-marker', 'preserve-me');
      await window.api.setOverlaySettings({ uiScale: 1.15, overlayScale: 1.1 });
      const imported = await window.api.importTradeLog([{
        id: 'installer-acceptance-sale', date: new Date().toISOString(), type: 'sale',
        partner: 'FixtureTenno', platChange: 17,
        items: [{ internalName: '', displayName: 'Forma', count: 1, direction: 'given' }]
      }]);
      if (!imported.ok || imported.count !== 1) throw new Error('Synthetic trade import failed');
    })()`);
  }
  const state = await evaluate(`(async () => ({
    marker: localStorage.getItem('installer-acceptance-marker'),
    settings: await window.api.getOverlaySettings(), trades: await window.api.getTradeLog(),
    contentVisible: Boolean(document.querySelector('#app')?.textContent?.trim())
  }))()`);
  assert.equal(state.marker, "preserve-me");
  assert.equal(state.settings.uiScale, 1.15);
  assert.equal(state.settings.overlayScale, 1.1);
  assert.equal(state.contentVisible, true);
  const trade = state.trades.find((row) => row.id === "installer-acceptance-sale");
  assert.ok(trade, "synthetic trade was lost or not loaded");
  assert.equal(trade.platChange, 17);
  assert.equal(trade.partner, "FixtureTenno");
  assert.equal(trade.items[0].displayName, "Forma");
  assert.equal(trade.items[0].count, 1);
  if (phase === "current") {
    const previous = JSON.parse(fs.readFileSync(path.join(output, "previous-state.json"), "utf8"));
    const persistedTrades = (rows) =>
      rows.map(({ id, date, type, partner, platChange, items }) => ({
        id,
        date,
        type,
        partner,
        platChange,
        items: items.map(({ internalName, displayName, count, direction }) => ({
          internalName,
          displayName,
          count,
          direction,
        })),
      }));
    assert.deepEqual(
      persistedTrades(state.trades),
      persistedTrades(previous.trades),
      "upgrade changed saved trade history",
    );
  }
  assert.deepEqual(rendererErrors, [], "uncaught renderer errors");
  fs.writeFileSync(path.join(output, `${phase}-state.json`), JSON.stringify(state, null, 2));
  const screenshot = await command("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    path.join(output, `${phase}-window.png`),
    Buffer.from(screenshot.data, "base64"),
  );
} finally {
  socket.close();
}
