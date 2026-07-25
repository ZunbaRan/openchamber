export interface ArtifactRunnerRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ArtifactRunnerClipRegion {
  rect: ArtifactRunnerRect;
  clipX: boolean;
  clipY: boolean;
}

export interface ArtifactRunnerGeometry {
  bounds: { x: number; y: number; width: number; height: number };
  clipBounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

export interface ArtifactRunnerVisibilityInput {
  documentVisible: boolean;
  baseDialogOpen: boolean;
  blockingNativeDialogOpen: boolean;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export const resolveArtifactRunnerVisibility = ({
  documentVisible,
  baseDialogOpen,
  blockingNativeDialogOpen,
}: ArtifactRunnerVisibilityInput): boolean => (
  documentVisible && !baseDialogOpen && !blockingNativeDialogOpen
);

export const resolveArtifactRunnerGeometry = (
  surface: ArtifactRunnerRect,
  clipRegions: readonly ArtifactRunnerClipRegion[],
): ArtifactRunnerGeometry => {
  const surfaceLeft = Math.floor(finite(surface.left));
  const surfaceTop = Math.floor(finite(surface.top));
  const surfaceRight = Math.max(surfaceLeft, Math.ceil(finite(surface.right, surfaceLeft)));
  const surfaceBottom = Math.max(surfaceTop, Math.ceil(finite(surface.bottom, surfaceTop)));
  let clipLeft = surfaceLeft;
  let clipTop = surfaceTop;
  let clipRight = surfaceRight;
  let clipBottom = surfaceBottom;

  for (const region of clipRegions) {
    if (region.clipX) {
      clipLeft = Math.max(clipLeft, Math.ceil(finite(region.rect.left)));
      clipRight = Math.min(clipRight, Math.floor(finite(region.rect.right, clipRight)));
    }
    if (region.clipY) {
      clipTop = Math.max(clipTop, Math.ceil(finite(region.rect.top)));
      clipBottom = Math.min(clipBottom, Math.floor(finite(region.rect.bottom, clipBottom)));
    }
  }

  const clipWidth = Math.max(0, clipRight - clipLeft);
  const clipHeight = Math.max(0, clipBottom - clipTop);
  return {
    bounds: {
      x: surfaceLeft,
      y: surfaceTop,
      width: Math.max(1, surfaceRight - surfaceLeft),
      height: Math.max(1, surfaceBottom - surfaceTop),
    },
    clipBounds: {
      x: clipLeft,
      y: clipTop,
      width: clipWidth,
      height: clipHeight,
    },
    visible: clipWidth > 0 && clipHeight > 0,
  };
};
