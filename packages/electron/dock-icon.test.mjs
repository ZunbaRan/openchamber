import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_DESKTOP_DOCK_ICON_VARIANT,
  createDockIconController,
  normalizeDesktopDockIconVariant,
} from "./dock-icon.mjs";

const createHarness = ({
  platform = "darwin",
  initialVariant,
  missingVariants = [],
  persistError = null,
} = {}) => {
  const settings = initialVariant
    ? { desktopDockIconVariant: initialVariant }
    : {};
  const applied = [];
  const controller = createDockIconController({
    platform,
    dock: { setIcon: (iconPath) => applied.push(iconPath) },
    resourceRoot: () => "/app/resources",
    readSettingsRoot: () => settings,
    mutateSettingsRoot: async (mutator) => {
      if (persistError) throw persistError;
      mutator(settings);
    },
    fileExists: (iconPath) => !missingVariants.some((variant) => iconPath.endsWith(`dock-icon-${variant}.png`)),
  });
  return { applied, controller, settings };
};

describe("desktop Dock icon controller", () => {
  test("defaults missing and malformed settings to the black icon", () => {
    assert.equal(normalizeDesktopDockIconVariant(undefined), DEFAULT_DESKTOP_DOCK_ICON_VARIANT);
    assert.equal(normalizeDesktopDockIconVariant("unknown"), DEFAULT_DESKTOP_DOCK_ICON_VARIANT);

    const harness = createHarness();
    assert.deepEqual(harness.controller.initialize(), { supported: true, variant: "black" });
    assert.deepEqual(harness.applied, ["/app/resources/icons/dock-icon-black.png"]);
  });

  test("applies and persists the selected ice icon", async () => {
    const harness = createHarness();
    const status = await harness.controller.setVariant("ice");

    assert.deepEqual(status, { supported: true, variant: "ice" });
    assert.equal(harness.settings.desktopDockIconVariant, "ice");
    assert.deepEqual(harness.applied, ["/app/resources/icons/dock-icon-ice.png"]);
  });

  test("rejects unsupported variants without changing the icon or settings", async () => {
    const harness = createHarness();
    await assert.rejects(() => harness.controller.setVariant("red"), /Unsupported Dock icon variant/);
    assert.deepEqual(harness.settings, {});
    assert.deepEqual(harness.applied, []);
  });

  test("rolls the visible icon back when persistence fails", async () => {
    const harness = createHarness({ initialVariant: "ice", persistError: new Error("disk full") });
    await assert.rejects(() => harness.controller.setVariant("black"), /disk full/);
    assert.equal(harness.settings.desktopDockIconVariant, "ice");
    assert.deepEqual(harness.applied, [
      "/app/resources/icons/dock-icon-black.png",
      "/app/resources/icons/dock-icon-ice.png",
    ]);
  });

  test("reports unsupported platforms without mutating settings", async () => {
    const harness = createHarness({ platform: "linux" });
    assert.deepEqual(await harness.controller.setVariant("black"), { supported: false, variant: "black" });
    assert.deepEqual(harness.settings, {});
    assert.deepEqual(harness.applied, []);
  });

  test("fails before persistence when the requested asset is missing", async () => {
    const harness = createHarness({ missingVariants: ["black"] });
    await assert.rejects(() => harness.controller.setVariant("black"), /Dock icon asset is missing/);
    assert.deepEqual(harness.settings, {});
    assert.deepEqual(harness.applied, []);
  });
});
