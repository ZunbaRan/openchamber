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
  blockingNativeSurfaceOccluder: boolean;
}

export interface ArtifactBoundaryScrollCandidate {
  scrollLeft: number;
  scrollTop: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
}

export interface ArtifactBoundaryWheel {
  deltaX: number;
  deltaY: number;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export const resolveArtifactRunnerVisibility = ({
  documentVisible,
  baseDialogOpen,
  blockingNativeDialogOpen,
  blockingNativeSurfaceOccluder,
}: ArtifactRunnerVisibilityInput): boolean => (
  documentVisible
  && !baseDialogOpen
  && !blockingNativeDialogOpen
  && !blockingNativeSurfaceOccluder
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

const canScrollBy = (position: number, viewport: number, extent: number, delta: number): boolean => {
  if (!Number.isFinite(delta) || delta === 0 || extent <= viewport) return false;
  return delta < 0 ? position > 0 : position < extent - viewport;
};

export const scrollArtifactBoundaryCandidates = (
  candidates: readonly ArtifactBoundaryScrollCandidate[],
  wheel: ArtifactBoundaryWheel,
): boolean => {
  const deltaX = Number(wheel.deltaX);
  const deltaY = Number(wheel.deltaY);
  if ((!Number.isFinite(deltaX) || deltaX === 0) && (!Number.isFinite(deltaY) || deltaY === 0)) return false;

  for (const candidate of candidates) {
    const moveX = canScrollBy(
      candidate.scrollLeft,
      candidate.clientWidth,
      candidate.scrollWidth,
      deltaX,
    ) ? deltaX : 0;
    const moveY = canScrollBy(
      candidate.scrollTop,
      candidate.clientHeight,
      candidate.scrollHeight,
      deltaY,
    ) ? deltaY : 0;
    if (moveX === 0 && moveY === 0) continue;
    candidate.scrollLeft = Math.max(0, Math.min(candidate.scrollWidth - candidate.clientWidth, candidate.scrollLeft + moveX));
    candidate.scrollTop = Math.max(0, Math.min(candidate.scrollHeight - candidate.clientHeight, candidate.scrollTop + moveY));
    return true;
  }
  return false;
};
