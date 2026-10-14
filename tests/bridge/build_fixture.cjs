/* Exercise the real TS projection without starting Electron or touching any account. */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const process = require("node:process");
const console = require("node:console");
const ts = require(process.env.TYPESCRIPT_PATH || "typescript");
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
  });
  module._compile(compiled.outputText, filename);
};
const { buildAccountSnapshot } = require("../../services/accountSnapshot.ts");
const { buildAccountBridge, accountGuide } = require("../../services/accountBridge.ts");
const { bridgeExportZip } = require("../../services/bridgeExport.ts");
const now = Date.now() - 10000;
const payload = {
  PlayerLevel: 14,
  RegularCredits: 12000,
  PremiumCredits: 0,
  FusionPoints: 50,
  AccountId: { $oid: "DO_NOT_EXPORT_ACCOUNT_ID" },
  authToken: "DO_NOT_EXPORT_TOKEN",
  MiscItems: Array.from({ length: 70 }, (_, i) => ({
    ItemType: `/Lotus/Test/Resource${i}`,
    ItemCount: i,
  })),
  Suits: [
    {
      ItemType: "/Lotus/Test/Frame",
      ItemId: { $oid: "a".repeat(24) },
      XP: 0,
      Configs: [{ Name: "Config A", Upgrades: ["b".repeat(24)], auth: "DO_NOT_EXPORT_NESTED" }],
    },
  ],
  Upgrades: [
    {
      ItemType: "/Lotus/Test/Mod",
      ItemId: { $oid: "b".repeat(24) },
      UpgradeFingerprint: '{"lvl":8,"sessionToken":"DO_NOT_EXPORT_FINGERPRINT"}',
    },
  ],
  XPInfo: [{ ItemType: "/Lotus/Test/SoldWeapon", XP: 450000 }],
  PendingRecipes: [
    {
      ItemType: "/Lotus/Test/Recipe",
      CompletionDate: { $date: { $numberLong: String(now + 5000) } },
    },
  ],
  PlayerSkills: { LPS_GUNNERY: 3, authToken: "DO_NOT_EXPORT_SKILLS" },
  Missions: [{ Tag: "SolNode1", Completes: 3 }],
  PeriodicMissionCompletions: [
    { tag: "WeeklyFixture", date: { $date: { $numberLong: String(now - 5000) } } },
    { Tag: "LegacyWeeklyFixture", Date: now - 5000, Count: 1 },
  ],
  Consumables: [
    { ItemType: "/Lotus/Test/Consumable", ItemCount: 4, token: "DO_NOT_EXPORT_CONSUMABLE" },
  ],
  Affiliations: [
    { Tag: "TestSyndicate", Standing: -100, Title: -1, privateMessage: "DO_NOT_EXPORT_REPUTATION" },
  ],
  DailyFocus: 0,
  QuestKeys: [],
  FutureGameplayCollection: [{ secret: "DO_NOT_EXPORT_UNKNOWN" }],
  LoadOutPresets: {
    NORMAL: [{ n: "build", s: { ItemId: { $oid: "a".repeat(24) }, mod: 0, cus: 1 } }],
  },
};
const snapshot = buildAccountSnapshot(payload, {
  source: "file",
  inventoryUpdatedAt: now,
  now,
  appVersion: "test",
  lookup: (type) => ({
    name: type.split("/").pop(),
    nameRu: type.includes("Resource") ? `Ресурс ${type.match(/\d+$/)?.[0]}` : null,
  }),
});
const doc = buildAccountBridge(payload, snapshot, {
  now: now + 1000,
  bindingId: "1".repeat(64),
  gameItems: {
    "/Lotus/Test/Recipe": {
      name: "Test Recipe",
      description: "A fixture",
      secret: "DO_NOT_EXPORT_CATALOG",
      recipe: {
        buildPrice: 100,
        buildTime: 60,
        num: 1,
        ingredients: [{ uniqueName: "/Lotus/Test/Resource2", count: 4 }],
      },
    },
  },
  mastery: {
    items: [
      {
        uniqueName: "/Lotus/Test/SoldWeapon",
        name: "Sold Weapon",
        status: "mastered",
        currentlyOwned: false,
        rank: 30,
      },
    ],
    stats: { profileMastery: { rank: 14, totalXp: 50000, testReady: false } },
  },
});
const encoded = JSON.stringify(doc);
const transferred = JSON.parse(encoded);
assert(!encoded.includes("DO_NOT_EXPORT_"));
assert.equal(doc.sections.find((s) => s.id === "account").rows[0].platinum, 0);
assert.equal(doc.sections.find((s) => s.id === "account").rows[0].masteryXp, null);
assert.equal(doc.sections.find((s) => s.id === "progress.Affiliations").rows[0].Standing, -100);
assert.equal(doc.sections.find((s) => s.id === "inventory.LongGuns").status, "missing");
assert.equal(doc.sections.find((s) => s.id === "extra.QuestKeys").status, "available");
assert(doc.unmappedCollections.includes("FutureGameplayCollection"));
assert.deepEqual(
  {
    sectionCount: doc.sections.length,
    periodic: transferred.sections.find((s) => s.id === "progress.PeriodicMissionCompletions").rows,
    consumables: transferred.sections.find((s) => s.id === "extra.Consumables").rows,
    consumablesUnmapped: doc.unmappedCollections.includes("Consumables"),
    gearStatus: doc.sections.find((s) => s.id === "inventory.Gear").status,
  },
  {
    sectionCount: Object.keys(require("../../integrations/wantedframe_mcp/schema.json").sections)
      .length,
    periodic: payload.PeriodicMissionCompletions,
    consumables: [{ ItemType: "/Lotus/Test/Consumable", ItemCount: 4 }],
    consumablesUnmapped: false,
    gearStatus: "missing",
  },
);
assert.equal(
  doc.sections.find((s) => s.id === "inventory.Suits").rows[0].configs[0].mods[0].rank,
  8,
);
assert(accountGuide(doc).includes("null/отсутствие поля"));
const destination = process.argv[2] || "test-results/bridge";
fs.mkdirSync(destination, { recursive: true });
fs.writeFileSync(path.join(destination, "account.json"), encoded);
fs.writeFileSync(path.join(destination, "account.zip"), bridgeExportZip(doc));
console.log(
  `Projection exercised: ${doc.sections.length} sections; secrets excluded; real ZIP written using synthetic data.`,
);
