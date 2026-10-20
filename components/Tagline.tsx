// The product line, with the quoted excuse marked like a highlighter stroke.
export default function Tagline({ small = false }: { small?: boolean }) {
  return (
    <p className={small ? "tagline tagline-sm" : "tagline"}>
      No more &ldquo;<span className="tagline-mark">I thought you were doing that.</span>&rdquo;
    </p>
  );
}
