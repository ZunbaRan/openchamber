/** Module-level height cache for WidgetRenderer remounts. */
const heightCache = new Map<string, number>();

export const getWidgetHeightCacheKey = (code: string): string => code.slice(0, 200);

export const getCachedWidgetHeight = (code: string): number =>
  heightCache.get(getWidgetHeightCacheKey(code)) ?? 0;

export const setCachedWidgetHeight = (code: string, height: number): void => {
  heightCache.set(getWidgetHeightCacheKey(code), height);
};
