import { test, expect } from "@playwright/test";
import {
  launchElectronTestHarness,
  closeElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

test("Wanted workspace: keyboard launcher, same-view settings and reversible appearance", async () => {
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wanted-workspace-", {
      storage: { "app-language": "ru" },
      inventory: { Suits: [] },
    });
    const page = harness.page;
    await expect(page.locator("[data-workspace-header]")).toBeVisible();
    await page.keyboard.press("Control+k");
    const search = page.getByRole("textbox", { name: "Поиск раздела" });
    await expect(search).toBeFocused();
    await search.fill("ресурс");
    await page.keyboard.press("Enter");
    await expect(page.locator('#content[data-view="inventory"]')).toBeVisible();
    await expect(page.locator("[data-command-launcher]")).toHaveCount(0);
    await page.locator('#sidebar [data-view="settings"]').click();
    await page.evaluate(() => document.querySelector("#content")?.scrollTo({ top: 1000 }));
    await page.keyboard.press("Control+k");
    await search.fill("chatgpt");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-chatgpt-panel]")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.querySelector("#content")?.scrollTop))
      .toBe(0);
    await page.keyboard.press("Control+k");
    await search.fill("шрифт");
    await page.keyboard.press("Enter");
    const apply = page.locator("[data-apply-wanted-appearance]");
    await expect(apply).toBeVisible();
    const previous = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wf_theme_settings") ?? "{}"),
    );
    await apply.click();
    await expect(apply).toBeDisabled();
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem("wf_theme_settings") ?? "{}").activePreset,
        ),
      )
      .toBe("wantedMikhail");
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wf_theme_settings") ?? "{}"),
    );
    expect(
      saved.customThemes.some(
        (theme: { label: string; colors: unknown }) =>
          theme.label === "До Wanted · Михаил" &&
          JSON.stringify(theme.colors) === JSON.stringify(previous.colors),
      ),
    ).toBe(true);
    expect(
      await page.evaluate(async () => {
        await document.fonts.load("500 16px Onest", "Михаил");
        return document.fonts.check("500 16px Onest", "Михаил");
      }),
    ).toBe(true);
    await page.keyboard.press("Control+k");
    await search.fill("несуществующий раздел");
    await expect(page.locator(".command-empty")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-command-launcher]")).toHaveCount(0);
  } finally {
    await closeElectronTestHarness(harness);
  }
});
