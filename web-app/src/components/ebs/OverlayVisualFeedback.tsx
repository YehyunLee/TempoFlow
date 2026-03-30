"use client";

import type { CSSProperties } from "react";
import type { OverlayVisualCue } from "./overlayFeedbackCue";

export function OverlayVisualFeedback(props: { cue: OverlayVisualCue }) {
  const { cue } = props;
  const styleVars = {
    ["--overlay-feedback-tone" as string]: cue.color,
  } as CSSProperties;

  const focusStyle = {
    left: `${(cue.xPct * 100).toFixed(2)}%`,
    top: `${(cue.yPct * 100).toFixed(2)}%`,
    width: `${(cue.focusSizePct * 100).toFixed(2)}%`,
    ...styleVars,
  } as CSSProperties;

  const cardStyle = {
    left: `${(cue.xPct * 100).toFixed(2)}%`,
    top: `${(cue.yPct * 100).toFixed(2)}%`,
    ...styleVars,
  } as CSSProperties;

  return (
    <div className="overlay-feedback-stage" data-testid="overlay-feedback-stage">
      <div className="overlay-feedback-focus" style={focusStyle}>
        <div className="overlay-feedback-focus-core" />
      </div>
      <div
        className={[
          "overlay-feedback-card",
          `overlay-feedback-card-${cue.verticalAlign}`,
          `overlay-feedback-card-${cue.horizontalAlign}`,
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
