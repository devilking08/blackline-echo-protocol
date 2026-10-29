import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (e) => errors.push(e.message));
});
test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) ?? [], "uncaught browser exceptions").toEqual(
    [],
  );
});
import { newRun, encodeSave, type Stage, type Ending } from "../src/core";
// Tests exercise the production build. Checkpoint fixtures use the public, validated save format.
type Snapshot = {
  mode: string;
  stage: string;
  health: number;
  ammo: number;
  energy: number;
  kills: number;
  alive: number;
  position: { x: number; z: number };
  pitch: number;
  yaw: number;
  fps: number;
  target: { hp: number; stunned: number } | null;
};
const snap = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { blackline: { snapshot: () => Snapshot } }
    ).blackline.snapshot(),
  );
async function boot(
  page: Page,
  fixture?: {
    stage: Stage;
    x: number;
    z: number;
    ending?: Ending;
    yaw?: number;
  },
) {
  await page.addInitScript(
    ({ save }) => {
      if (!sessionStorage.getItem("qa-initialized")) {
        localStorage.setItem(
          "blackline.settings.v1",
          JSON.stringify({
            quality: "low",
            sensitivity: 1,
            volume: 0,
            reducedMotion: true,
            assist: true,
          }),
        );
        if (save) localStorage.setItem("blackline.save.v1", save);
        sessionStorage.setItem("qa-initialized", "yes");
      }
    },
    {
      save: fixture
        ? encodeSave(
            {
              ...newRun(),
              stage: fixture.stage,
              ending: fixture.ending ?? null,
            },
            { x: fixture.x, z: fixture.z },
            fixture.yaw ?? 0,
          )
        : null,
    },
  );
  await page.goto("/");
  await expect(page.locator("#boot")).toBeHidden({ timeout: 30000 });
  await page.waitForFunction(
    () => !!(window as unknown as { blackline: unknown }).blackline,
  );
}
async function play(page: Page, continued = false) {
  await page.locator(continued ? "#continue" : "#start").click();
  await expect.poll(async () => (await snap(page)).mode).toBe("playing");
  await page.waitForTimeout(400);
}
async function walk(page: Page, key: string, check: (s: Snapshot) => boolean) {
  await page.keyboard.down(key);
  try {
    await expect
      .poll(async () => check(await snap(page)), {
        timeout: 120000,
        intervals: [50, 100],
      })
      .toBe(true);
  } finally {
    await page.keyboard.up(key);
  }
}

test("boots offline-ready assets, renders city, and has no browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:4173") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await boot(page);
  await expect(page.locator(".game-title")).toHaveText("BLACKLINEBLACKLINE");
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  await expect(page.locator("#fatal")).toBeHidden();
  const info = await snap(page);
  expect(info.alive).toBe(7);
  expect(info.fps).toBeGreaterThan(0);
});

test("start preserves level aim, movement works, and pause freezes simulation", async ({
  page,
}) => {
  await boot(page);
  await play(page);
  expect(Math.abs((await snap(page)).pitch)).toBeLessThan(0.02);
  await walk(page, "KeyW", (s) => s.position.z < 46);
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause")).toBeVisible();
  const before = await snap(page);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(350);
  await page.keyboard.up("KeyW");
  expect((await snap(page)).position).toEqual(before.position);
  await page.locator("#resume").click();
  await expect.poll(async () => (await snap(page)).mode).toBe("playing");
});

test("fires, reloads, scanner toggles, journal and map are accessible", async ({
  page,
}) => {
  await boot(page);
  await play(page);
  await page.keyboard.press("KeyF");
  await expect.poll(async () => (await snap(page)).ammo).toBe(11);
  await page.keyboard.press("KeyR");
  await expect
    .poll(async () => (await snap(page)).ammo, { timeout: 15000 })
    .toBe(12);
  await page.keyboard.press("KeyV");
  await expect(page.locator("#scanner-overlay")).toBeVisible();
  await page.keyboard.press("KeyJ");
  await expect(page.locator("#journal")).toBeVisible();
  await page.locator('[data-close="journal"]').click();
  await page.keyboard.press("KeyM");
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#fullmap")).toBeVisible();
});

test("contact dialogue advances and persists its checkpoint", async ({
  page,
}) => {
  await boot(page, { stage: "contact", x: 4, z: 34 });
  await play(page, true);
  await page.keyboard.press("KeyE");
  await expect(page.locator("#dialogue")).toBeVisible();
  await page.locator("#dialogue-choices button").first().click();
  await expect.poll(async () => (await snap(page)).stage).toBe("relay");
  const raw = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("blackline.save.v1")!),
  );
  expect(raw.run.stage).toBe("relay");
});

test("relay puzzle rejects a wrong node and unlocks archive", async ({
  page,
}) => {
  await boot(page, { stage: "relay", x: -5, z: 3 });
  await play(page, true);
  await page.keyboard.press("KeyE");
  await expect(page.locator("#hack")).toBeVisible();
  const sequence = await page.locator("#hack-sequence span").allTextContents();
  const wrong = Array.from({ length: 16 }, (_, i) =>
    i.toString(16).toUpperCase().padStart(2, "0"),
  ).find((n) => n !== sequence[0])!;
  await page
    .getByRole("button", { name: `Node ${wrong}`, exact: true })
    .click();
  await expect(page.locator("#hack-status")).toHaveText("BUFFER RESET");
  for (const node of sequence)
    await page
      .getByRole("button", { name: `Node ${node}`, exact: true })
      .click();
  await expect.poll(async () => (await snap(page)).stage).toBe("archive");
  await expect(page.locator("#hack")).toBeHidden();
});

for (const ending of ["broadcast", "sell"] as const)
  test(`archive offers ${ending} ending and extraction pays once`, async ({
    page,
  }) => {
    await boot(page, { stage: "archive", x: 0, z: -57 });
    await play(page, true);
    await page.keyboard.press("KeyE");
    await expect(page.locator("#dialogue")).toBeVisible();
    await page
      .locator("#dialogue-choices button")
      .nth(ending === "broadcast" ? 0 : 1)
      .click();
    await expect.poll(async () => (await snap(page)).stage).toBe("escape");
    const raw = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("blackline.save.v1")!),
    );
    expect(raw.run.ending).toBe(ending);
    await page.keyboard.press("Escape");
    await page.locator("#save-quit").click();
    raw.position = { x: 0, z: 61 };
    await page.evaluate(
      (v) => localStorage.setItem("blackline.save.v1", JSON.stringify(v)),
      raw,
    );
    await page.reload();
    await expect(page.locator("#boot")).toBeHidden();
    await play(page, true);
    await page.keyboard.press("KeyE");
    await expect(page.locator("#ending")).toBeVisible();
    await expect(page.locator("#ending-title")).toHaveText(
      ending === "broadcast" ? "The city heard you." : "Silence has a price.",
    );
    await expect(page.locator("#stat-credits")).toHaveText(
      ending === "broadcast" ? "2,400" : "12,000",
    );
    expect(
      await page.evaluate(() => localStorage.getItem("blackline.save.v1")),
    ).toBe("");
  });

test("quickhack stuns a target and headshots neutralize real geometry", async ({
  page,
}) => {
  await boot(page, { stage: "archive", x: 4, z: -5 });
  await play(page, true);
  await expect
    .poll(async () => !!(await snap(page)).target, { timeout: 10000 })
    .toBe(true);
  await page.keyboard.press("KeyQ");
  await expect
    .poll(async () => (await snap(page)).target?.stunned ?? 0)
    .toBeGreaterThan(1);
  expect((await snap(page)).energy).toBeLessThan(80);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("KeyF");
    await page.waitForTimeout(250);
  }
  await expect.poll(async () => (await snap(page)).kills).toBeGreaterThan(0);
  expect((await snap(page)).alive).toBeLessThan(7);
});

test("settings persist, keyboard focus is trapped, and saves survive reload", async ({
  page,
}) => {
  await boot(page);
  await page.locator("#open-settings").click();
  await expect(page.locator("#settings")).toBeVisible();
  await page.locator("#sensitivity").fill("1.5");
  await page.locator("#settings-done").click();
  await play(page);
  await walk(page, "KeyW", (s) => s.position.z < 46);
  await page.keyboard.press("Escape");
  await page.locator("#save-quit").click();
  const p = await snap(page);
  await page.reload();
  await expect(page.locator("#boot")).toBeHidden();
  await play(page, true);
  expect((await snap(page)).position.z).toBeCloseTo(p.position.z, 0);
  await page.keyboard.press("Escape");
  await page.locator("#pause-settings").click();
  await expect(page.locator("#sensitivity")).toHaveValue("1.5");
  await page.locator("#settings-done").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator('[data-close="settings"]')).toBeFocused();
});

test("corrupt save is ignored and disabled storage is survivable", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "blackline.save.v1",
      '{"version":1,"run":{"stage":"hacked"}}',
    ),
  );
  await boot(page);
  await expect(page.locator("#continue")).toBeHidden();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
  });
  await play(page);
  await expect(page.locator("#hud")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("#save-quit").click();
  await expect(page.locator("#menu")).toBeVisible();
});

test("complete mission is reachable with actual locomotion, no teleports", async ({
  page,
}) => {
  test.setTimeout(300000);
  await boot(page, { stage: "contact", x: 4, z: 34 });
  await play(page, true);
  await page.keyboard.press("KeyE");
  await page.locator("#dialogue-choices button").first().click();
  await page.waitForTimeout(400);
  await walk(page, "KeyA", (s) => s.position.x < -4.8);
  await walk(page, "KeyW", (s) => s.position.z < 3);
  await page.keyboard.press("KeyE");
  await expect(page.locator("#hack")).toBeVisible();
  for (const node of await page
    .locator("#hack-sequence span")
    .allTextContents())
    await page
      .getByRole("button", { name: `Node ${node}`, exact: true })
      .click();
  await page.waitForTimeout(400);
  await walk(page, "KeyD", (s) => s.position.x > -0.3);
  await page.keyboard.down("ShiftLeft");
  await walk(page, "KeyW", (s) => s.position.z < -56);
  await page.keyboard.up("ShiftLeft");
  await page.keyboard.press("KeyE");
  await expect(page.locator("#dialogue")).toBeVisible();
  await page.locator("#dialogue-choices button").first().click();
  await page.waitForTimeout(400);
  await page.keyboard.press("KeyH");
  await page.keyboard.down("ShiftLeft");
  await walk(page, "KeyS", (s) => s.position.z > 60);
  await page.keyboard.up("ShiftLeft");
  await page.keyboard.press("KeyE");
  await expect(page.locator("#ending")).toBeVisible();
  expect((await snap(page)).stage).toBe("complete");
});

test("portrait touch layout has usable controls without horizontal overflow", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await boot(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await play(page);
  await expect(page.locator("#touch-controls")).toBeVisible();
  await page
    .locator('[data-touch="fire"]')
    .dispatchEvent("pointerdown", { pointerType: "touch" });
  await expect.poll(async () => (await snap(page)).ammo).toBe(11);
  await page.locator("#touch-pause").click();
  await expect(page.locator("#pause")).toBeVisible();
  await context.close();
});
