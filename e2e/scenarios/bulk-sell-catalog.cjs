/* global __dirname, process, URL, Response */
const path = require("node:path");
const { app } = require("electron");

const root = path.resolve(__dirname, "../..");
app.getAppPath = () => root;
process.env.VITE_WFM_BACKEND_URL = "https://bulk-sell.invalid";

// Install before startup: an empty first catalog read delays inventory eligibility.
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://bulk-sell.invalid/v1/wfm-items") {
    return new Response(
      JSON.stringify({
        ok: true,
        items: [
          {
            id: "111111111111111111111111",
            slug: "bronco_prime_receiver",
            gameRef: "/Lotus/Types/Recipes/Weapons/WeaponParts/BroncoPrimeReceiver",
            i18n: { en: { name: "Bronco Prime Receiver" } },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response(JSON.stringify({ error: "Bulk sell fixture has no network data" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
};

require(path.join(root, ".electron-build/main.js"));
