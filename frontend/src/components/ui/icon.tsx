import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  Bell,
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  GitCommitHorizontal,
  GitCompareArrows,
  Info,
  KeyRound,
  LayoutGrid,
  List,
  Loader2,
  Moon,
  RotateCcw,
  Rows2,
  Rows3,
  SlidersHorizontal,
  Sparkles,
  Sun,
  TriangleAlert,
  User,
  WrapText,
  X,
} from 'lucide-react';
import styles from './Icon.module.css';

const LEGACY_ICON_SIZES = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
} as const;

type SettingsIconSize = 14 | 16 | 18;
type LegacyIconSize = keyof typeof LEGACY_ICON_SIZES;
type IconSize = SettingsIconSize | LegacyIconSize;
type IconTone =
  | 'muted'
  | 'foreground'
  | 'accent'
  | 'info'
  | 'success'
  | 'danger'
  | 'inherit';

interface IconProps
  extends Omit<
    LucideProps,
    | 'aria-label'
    | 'aria-hidden'
    | 'color'
    | 'fill'
    | 'focusable'
    | 'height'
    | 'size'
    | 'strokeLinecap'
    | 'strokeLinejoin'
    | 'strokeWidth'
    | 'style'
    | 'width'
  > {
  size?: IconSize;
  tone?: IconTone;
  label?: string;
}

function semanticIcon(Icon: LucideIcon, { spin = false }: { spin?: boolean } = {}) {
  function SemanticIcon({
    size = 16,
    tone = 'muted',
    label,
    className,
    ...props
  }: IconProps) {
    const classes = [styles.icon, styles[tone], spin && styles.spin, className]
      .filter(Boolean)
      .join(' ');
    const resolvedSize =
      typeof size === 'number' ? size : LEGACY_ICON_SIZES[size];

    return (
      <Icon
        {...props}
        aria-hidden={label ? undefined : 'true'}
        aria-label={label}
        fill="none"
        focusable="false"
        size={resolvedSize}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        className={classes}
      />
    );
  }

  return SemanticIcon;
}

// Action and state metaphors are named here so feature code never chooses
// competing glyphs for the same concept.
export const CopyIcon = semanticIcon(Copy);
export const DownloadIcon = semanticIcon(Download);
export const RevealIcon = semanticIcon(Eye);
export const HideIcon = semanticIcon(EyeOff);
export const ActionCompleteIcon = semanticIcon(Check);
export const WrapLinesIcon = semanticIcon(WrapText);
export const LoadingIcon = semanticIcon(Loader2, { spin: true });
export const VersionNodeIcon = semanticIcon(GitCommitHorizontal);
export const CompareVersionIcon = semanticIcon(GitCompareArrows);
export const RestoreVersionIcon = semanticIcon(RotateCcw);
export const RemoveIcon = semanticIcon(X);
export const RefineIcon = semanticIcon(Sparkles);
export const SuccessStatusIcon = semanticIcon(CircleCheck);
export const ErrorStatusIcon = semanticIcon(CircleAlert);
export const InfoStatusIcon = semanticIcon(Info);

export const ProfileIcon = semanticIcon(User);
export const PreferencesIcon = semanticIcon(SlidersHorizontal);
export const NotificationsIcon = semanticIcon(Bell);
export const ApiAccessIcon = semanticIcon(KeyRound);
export const DataIcon = semanticIcon(Database);
export const DangerIcon = semanticIcon(TriangleAlert);

export const LightThemeIcon = semanticIcon(Sun);
export const DarkThemeIcon = semanticIcon(Moon);
export const ComfortableDensityIcon = semanticIcon(Rows2);
export const CompactDensityIcon = semanticIcon(Rows3);
export const GridViewIcon = semanticIcon(LayoutGrid);
export const ListViewIcon = semanticIcon(List);
