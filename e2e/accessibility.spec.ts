import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("menu, settings and manual have no serious WCAG 2 AA violations", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "blackline.settings.v1",
      JSON.stringify({ quality: "low", volume: 0, reducedMotion: true }),
    ),
  );
  await page.goto("/");
  await expect(page.locator("#boot")).toBeHidden({ timeout: 30000 });
  for (const target of ["menu", "settings", "manual"]) {
    if (target === "settings") await page.locator("#open-settings").click();
    if (target === "manual") {
      await page.locator("#settings-done").click();
      await page.locator("#open-controls").click();
    }
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const severe = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(
      severe.map((v) => ({
        id: v.id,
        description: v.description,
        nodes: v.nodes.map((n) => n.target),
      })),
      target,
    ).toEqual([]);
  }
});
