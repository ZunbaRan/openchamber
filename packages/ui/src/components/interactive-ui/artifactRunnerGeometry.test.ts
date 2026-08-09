import { describe, expect, test } from 'bun:test';
import {
  resolveArtifactRunnerGeometry,
  resolveArtifactRunnerVisibility,
} from './artifactRunnerGeometry';

describe('resolveArtifactRunnerGeometry', () => {
  test('keeps the full surface while clipping the visible child to its scroll viewport', () => {
    expect(resolveArtifactRunnerGeometry(
      { left: 240, top: -120, right: 1_240, bottom: 780 },
      [{
        rect: { left: 200, top: 64, right: 1_300, bottom: 700 },
        clipX: true,
        clipY: true,
      }],
    )).toEqual({
      bounds: { x: 240, y: -120, width: 1_000, height: 900 },
      clipBounds: { x: 240, y: 64, width: 1_000, height: 636 },
      visible: true,
    });
  });

  test('clips each axis only when the owning overflow axis requires it', () => {
    const result = resolveArtifactRunnerGeometry(
      { left: 100, top: 100, right: 900, bottom: 700 },
      [
        { rect: { left: 200, top: 0, right: 800, bottom: 1_000 }, clipX: true, clipY: false },
        { rect: { left: 0, top: 180, right: 1_000, bottom: 620 }, clipX: false, clipY: true },
      ],
    );
    expect(result.clipBounds).toEqual({ x: 200, y: 180, width: 600, height: 440 });
    expect(result.visible).toBe(true);
  });

  test('marks a surface hidden after it leaves every visible clipping region', () => {
    const result = resolveArtifactRunnerGeometry(
      { left: 100, top: 900, right: 900, bottom: 1_500 },
      [{ rect: { left: 0, top: 0, right: 1_000, bottom: 800 }, clipX: true, clipY: true }],
    );
    expect(result.clipBounds.width).toBe(800);
    expect(result.clipBounds.height).toBe(0);
    expect(result.visible).toBe(false);
  });
});

describe('resolveArtifactRunnerVisibility', () => {
  test('hides a native runner behind Base UI and native modal dialogs', () => {
    expect(resolveArtifactRunnerVisibility({
      documentVisible: true,
      baseDialogOpen: true,
      blockingNativeDialogOpen: false,
      blockingNativeSurfaceOccluder: false,
    })).toBe(false);
    expect(resolveArtifactRunnerVisibility({
      documentVisible: true,
      baseDialogOpen: false,
      blockingNativeDialogOpen: true,
      blockingNativeSurfaceOccluder: false,
    })).toBe(false);
    expect(resolveArtifactRunnerVisibility({
      documentVisible: true,
      baseDialogOpen: false,
      blockingNativeDialogOpen: false,
      blockingNativeSurfaceOccluder: true,
    })).toBe(false);
  });

  test('restores the runner after the blocking dialog closes', () => {
    expect(resolveArtifactRunnerVisibility({
      documentVisible: true,
      baseDialogOpen: false,
      blockingNativeDialogOpen: false,
      blockingNativeSurfaceOccluder: false,
    })).toBe(true);
  });
});
