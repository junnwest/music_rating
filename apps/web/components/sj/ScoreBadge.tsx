'use client';

import {
  spectrumFill,
  spectrumNumber,
  spectrumRing,
} from '../../lib/sj/display';

/**
 * The approved score badge — web mirror of iOS `Components/ScoreBadge.swift`:
 * a glassy circle (flower watermark + score number) wrapped in a progress
 * ring. Ring arc = score / 5.0; badge/ring color follows the score-adaptive
 * spectrum (red at 0.5 → sjBlue hue at 5.0).
 */
export default function ScoreBadge({
  score,
  size = 48,
  ringStroke = 3,
  ringGap = 2,
}: {
  score: number;
  size?: number;
  ringStroke?: number;
  ringGap?: number;
}) {
  const ringDiameter = size + 2 * (ringGap + ringStroke);
  const r = (ringDiameter - ringStroke) / 2;
  const c = 2 * Math.PI * r;
  const fraction = Math.min(Math.max(score / 5, 0), 1);
  const flowerSize = size * 0.66;
  const numberSize = size * 0.37;

  return (
    <div
      className="relative shrink-0"
      style={{ width: ringDiameter, height: ringDiameter }}
      aria-label={`Score ${score.toFixed(1)} out of 5`}
    >
      <svg width={ringDiameter} height={ringDiameter} className="-rotate-90">
        <circle
          cx={ringDiameter / 2}
          cy={ringDiameter / 2}
          r={r}
          fill="none"
          className="stroke-divider"
          strokeWidth={ringStroke}
        />
        <circle
          cx={ringDiameter / 2}
          cy={ringDiameter / 2}
          r={r}
          fill="none"
          stroke={spectrumRing(score)}
          strokeWidth={ringStroke}
          strokeLinecap="round"
          strokeDasharray={`${c * fraction} ${c}`}
        />
      </svg>
      <div
        className="absolute rounded-full flex items-center justify-center"
        style={{
          inset: ringGap + ringStroke,
          background: spectrumFill(score),
          boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.6), 0 1px 3px rgba(0,0,0,0.12)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-flower.svg"
          alt=""
          className="absolute opacity-60"
          style={{
            width: flowerSize,
            height: flowerSize,
            filter: 'brightness(0) invert(1) drop-shadow(0 1px 1px rgba(0,0,0,0.3))',
          }}
        />
        <span
          className="relative font-extrabold leading-none"
          style={{
            fontSize: numberSize,
            color: spectrumNumber(score),
            textShadow: '0 0 3px rgba(255,255,255,0.55)',
            transform: 'scaleY(1.14)',
            letterSpacing: '-0.02em',
          }}
        >
          {score.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
