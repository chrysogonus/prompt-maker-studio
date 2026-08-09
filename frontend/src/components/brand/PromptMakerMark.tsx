type MarkProps = {
  size?: number;
  className?: string;
  /** Set true when adjacent text already names the brand. */
  decorative?: boolean;
};

export function PromptMakerMark({
  size = 32,
  className,
  decorative = false,
}: MarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : 'Prompt Maker Studio'}
    >
      <g transform="translate(-0.7,0.3)">
        <path
          d="M9 8.5L16 16L9 23.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="19" y="21.3" width="7" height="3.4" rx="1.7" fill="currentColor" />
      </g>
    </svg>
  );
}

type TileProps = {
  size?: number;
  className?: string;
};

export function PromptMakerTile({ size = 56, className }: TileProps) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: 'var(--pm-coral)',
        color: 'var(--pm-ink)',
      }}
    >
      <PromptMakerMark size={size * 0.62} decorative />
    </span>
  );
}
