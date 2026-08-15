import path from "node:path";

export const DEFAULT_DESKTOP_DOCK_ICON_VARIANT = "ice";
const DESKTOP_DOCK_ICON_VARIANTS = ["ice", "black"];

export const normalizeDesktopDockIconVariant = (value) =>
  value === "black" ? "black" : DEFAULT_DESKTOP_DOCK_ICON_VARIANT;

const isDesktopDockIconVariant = (value) =>
  DESKTOP_DOCK_ICON_VARIANTS.includes(value);

export const createDockIconController = ({
  platform,
  dock,
  resourceRoot,
  readSettingsRoot,
  mutateSettingsRoot,
  fileExists,
}) => {
  const supported = platform === "darwin" && typeof dock?.setIcon === "function";

  const readVariant = () =>
    normalizeDesktopDockIconVariant(readSettingsRoot()?.desktopDockIconVariant);

  const resolveIconPath = (variant) =>
    path.join(resourceRoot(), "icons", `dock-icon-${variant}.png`);

  const applyVariant = (variant) => {
    if (!supported) return;
    const iconPath = resolveIconPath(variant);
    if (!fileExists(iconPath)) {
      throw new Error(`Dock icon asset is missing: ${iconPath}`);
    }
    dock.setIcon(iconPath);
  };

  const getStatus = () => ({ supported, variant: readVariant() });

  return {
    getStatus,
    initialize() {
      const status = getStatus();
      if (status.supported) applyVariant(status.variant);
      return status;
    },
    async setVariant(value) {
      if (!isDesktopDockIconVariant(value)) {
        throw new Error("Unsupported Dock icon variant");
      }

      const previousVariant = readVariant();
      if (!supported) return { supported: false, variant: previousVariant };

      applyVariant(value);
      try {
        await mutateSettingsRoot((root) => {
          root.desktopDockIconVariant = value;
        });
      } catch (error) {
        try {
          applyVariant(previousVariant);
        } catch {
          // Preserve the original persistence error. The next launch will
          // restore the persisted variant even if visual rollback failed.
        }
        throw error;
      }

      return { supported: true, variant: value };
    },
  };
};
