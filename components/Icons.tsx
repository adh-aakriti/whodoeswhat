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
export function StatusIcon({ status, ...props }: IconProps & { status: Status | "handoff" }) {
  return (
    <Icon className={`status-icon status-icon-${status}`} {...props}>
      {/* open: dashed ring (no owner yet); declined: ring with a slash; handoff: ring with an arrow */}
      <circle cx="12" cy="12" r="8" strokeDasharray={status === "open" ? "3 2.6" : undefined} />
      {status === "accepted" && <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" />}
      {status === "done" && <path d="M8.5 12.5l2.5 2.5 4.5-5" />}
      {status === "declined" && <path d="M6.5 17.5l11-11" />}
      {status === "handoff" && <path d="M8 12h8M13 9l3 3-3 3" />}
    </Icon>
  );
}

const CHEVRONS = { left: "M15 6l-6 6 6 6", right: "M9 6l6 6-6 6", down: "M6 9l6 6 6-6" } as const;

export function ChevronIcon({ direction, ...props }: IconProps & { direction: keyof typeof CHEVRONS }) {
  return <Icon {...props}><path d={CHEVRONS[direction]} /></Icon>;
}

export function ListIcon(props: IconProps) {
  return <Icon {...props}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></Icon>;
}

export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="1.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Icon>
  );
}
