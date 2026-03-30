"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import type { OverlayVisualCue } from "./overlayFeedbackCue";

type RelativeBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type CardPlacement = {
  cardLeftPx: number;
  caretLeftPx: number;
};

export function computeDisplayedMediaBox(params: {
  stageWidth: number;
  stageHeight: number;
  mediaLeft: number;
  mediaTop: number;
  mediaWidth: number;
  mediaHeight: number;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
  objectFit?: string;
}): RelativeBox {
  const {
    stageWidth,
    stageHeight,
    mediaLeft,
    mediaTop,
    mediaWidth,
    mediaHeight,
    intrinsicWidth,
    intrinsicHeight,
    objectFit,
  } = params;

  if (stageWidth <= 0 || stageHeight <= 0 || mediaWidth <= 0 || mediaHeight <= 0) {
    return { left: 0, top: 0, width: 1, height: 1 };
  }

  const normalized = {
    left: mediaLeft / stageWidth,
    top: mediaTop / stageHeight,
    width: mediaWidth / stageWidth,
    height: mediaHeight / stageHeight,
  };

  if (
    objectFit !== "contain" ||
    !intrinsicWidth ||
    !intrinsicHeight ||
    intrinsicWidth <= 0 ||
    intrinsicHeight <= 0
  ) {
    return normalized;
  }

  const mediaAspect = mediaWidth / mediaHeight;
  const intrinsicAspect = intrinsicWidth / intrinsicHeight;
  let contentWidth = mediaWidth;
  let contentHeight = mediaHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (mediaAspect > intrinsicAspect) {
    contentHeight = mediaHeight;
    contentWidth = contentHeight * intrinsicAspect;
    offsetX = (mediaWidth - contentWidth) / 2;
  } else if (mediaAspect < intrinsicAspect) {
    contentWidth = mediaWidth;
    contentHeight = contentWidth / intrinsicAspect;
    offsetY = (mediaHeight - contentHeight) / 2;
  }

  return {
    left: (mediaLeft + offsetX) / stageWidth,
    top: (mediaTop + offsetY) / stageHeight,
    width: contentWidth / stageWidth,
    height: contentHeight / stageHeight,
  };
}

export function computeOverlayCardPlacement(params: {
  stageWidth: number;
  anchorXPx: number;
  cardWidth: number;
  edgePadding?: number;
  caretPadding?: number;
}): CardPlacement {
  const {
    stageWidth,
    anchorXPx,
    cardWidth,
    edgePadding = 16,
    caretPadding = 24,
  } = params;

  if (stageWidth <= 0 || cardWidth <= 0) {
    return {
      cardLeftPx: 0,
      caretLeftPx: 0,
    };
  }

  const minLeft = edgePadding;
  const maxLeft = Math.max(edgePadding, stageWidth - edgePadding - cardWidth);
  const idealLeft = anchorXPx - cardWidth / 2;
  const cardLeftPx = Math.min(maxLeft, Math.max(minLeft, idealLeft));
  const caretLeftPx = Math.min(
    cardWidth - caretPadding,
    Math.max(caretPadding, anchorXPx - cardLeftPx),
  );

  return {
    cardLeftPx,
    caretLeftPx,
  };
}

export function OverlayVisualFeedback(props: {
  cue: OverlayVisualCue;
  mediaRef?: RefObject<HTMLVideoElement | null>;
}) {
  const { cue, mediaRef } = props;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [mediaBox, setMediaBox] = useState<RelativeBox>({
    left: 0,
    top: 0,
    width: 1,
    height: 1,
  });
  const [cardPlacement, setCardPlacement] = useState<CardPlacement>({
    cardLeftPx: 0,
    caretLeftPx: 0,
  });

  useEffect(() => {
    const stage = stageRef.current;
    const media = mediaRef?.current ?? null;
    if (!stage || !media) {
      setMediaBox({ left: 0, top: 0, width: 1, height: 1 });
      return;
    }

    const update = () => {
      const stageRect = stage.getBoundingClientRect();
      const mediaRect = media.getBoundingClientRect();
      const objectFit = window.getComputedStyle(media).objectFit;
      setMediaBox(
        computeDisplayedMediaBox({
          stageWidth: stageRect.width,
          stageHeight: stageRect.height,
          mediaLeft: mediaRect.left - stageRect.left,
          mediaTop: mediaRect.top - stageRect.top,
          mediaWidth: mediaRect.width,
          mediaHeight: mediaRect.height,
          intrinsicWidth: media.videoWidth,
          intrinsicHeight: media.videoHeight,
          objectFit,
        }),
      );
    };

    update();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    resizeObserver?.observe(stage);
    resizeObserver?.observe(media);
    media.addEventListener("loadedmetadata", update);
    window.addEventListener("resize", update);

    return () => {
      resizeObserver?.disconnect();
      media.removeEventListener("loadedmetadata", update);
      window.removeEventListener("resize", update);
    };
  }, [mediaRef, cue.id]);

  const styleVars = {
    ["--overlay-feedback-tone" as string]: cue.color,
  } as CSSProperties;

  const focusLeft = mediaBox.left + cue.xPct * mediaBox.width;
  const focusTop = mediaBox.top + cue.yPct * mediaBox.height;
  const focusWidth = cue.focusSizePct * mediaBox.width;
  const focusRadius = focusWidth / 2;
  const cardTop =
    cue.verticalAlign === "above"
      ? focusTop - focusRadius
      : focusTop + focusRadius;

  const focusStyle = {
    left: `${(focusLeft * 100).toFixed(2)}%`,
    top: `${(focusTop * 100).toFixed(2)}%`,
    width: `${(focusWidth * 100).toFixed(2)}%`,
    ...styleVars,
  } as CSSProperties;

  const cardStyle = {
    left: `${cardPlacement.cardLeftPx.toFixed(2)}px`,
    top: `${(cardTop * 100).toFixed(2)}%`,
    ["--overlay-feedback-caret-left" as string]: `${cardPlacement.caretLeftPx.toFixed(2)}px`,
    ...styleVars,
  } as CSSProperties;

  useEffect(() => {
    const stage = stageRef.current;
    const card = cardRef.current;
    if (!stage || !card) {
      return;
    }

    const update = () => {
      const stageRect = stage.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const anchorX = focusLeft * stageRect.width;
      const nextPlacement = computeOverlayCardPlacement({
        stageWidth: stageRect.width,
        anchorXPx: anchorX,
        cardWidth: cardRect.width,
      });
      setCardPlacement((current) =>
        current.cardLeftPx === nextPlacement.cardLeftPx &&
        current.caretLeftPx === nextPlacement.caretLeftPx
          ? current
          : nextPlacement,
      );
    };

    update();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    resizeObserver?.observe(stage);
    resizeObserver?.observe(card);
    window.addEventListener("resize", update);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [cue.horizontalAlign, cue.id, focusLeft]);

  return (
    <div ref={stageRef} className="overlay-feedback-stage" data-testid="overlay-feedback-stage">
      <div className="overlay-feedback-focus" style={focusStyle}>
        <div className="overlay-feedback-focus-core" />
      </div>
      <div
        ref={cardRef}
        className={[
          "overlay-feedback-card",
          `overlay-feedback-card-${cue.verticalAlign}`,
        ].join(" ")}
        style={cardStyle}
        data-testid="overlay-feedback-card"
      >
        <div className="overlay-feedback-card-row">
          <span className="overlay-feedback-chip">{cue.title}</span>
          <span className="overlay-feedback-severity">{cue.severityLabel}</span>
        </div>
        <div className="overlay-feedback-copy">{cue.message}</div>
      </div>
    </div>
  );
}
