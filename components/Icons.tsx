import type { SVGProps } from "react";
import type { Status } from "@/components/TaskBoard";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

// Line icons on a 24px grid, all with the same 1.5 stroke. Decorative by default:
// pass aria-label (and aria-hidden={false}) only where an icon has no visible text next to it.
function Icon({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>;
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" />
    </Icon>
  );
}

export function ListChecksIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17M11 6h10M11 12h10M11 18h10" />
    </Icon>
  );
}

// Shape carries the meaning; the text label next to it says the same thing.
export function StatusIcon({ status, ...props }: IconProps & { status: Status }) {
  return (
    <Icon className={`status-icon status-icon-${status}`} {...props}>
      <circle cx="12" cy="12" r="8" />
      {status === "accepted" && <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" />}
      {status === "done" && <path d="M8.5 12.5l2.5 2.5 4.5-5" />}
    </Icon>
  );
}

// A person (the dot) standing on the short arm of a checkmark: someone owns it, it gets done.
export function LogoMark({ size = 24, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="logo-mark"
      {...props}
    >
      <circle cx="6.5" cy="6.5" r="3" fill="currentColor" />
      <path
        d="M3 14l5.5 5.5L21 6"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
