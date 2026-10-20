// Initial of the owner's name in a neutral circle. Decorative: the full name is always next to it.
export default function Avatar({ name }: { name: string }) {
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase();
  if (!initial) return null;
  return (
    <span className="avatar" aria-hidden="true">
      {initial}
    </span>
  );
}
