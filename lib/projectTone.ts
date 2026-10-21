// Project colours: Personal is always its own green; every other project gets one of 7 muted,
// non-red, non-green hues (red is reserved for urgency and destructive actions).
export const PROJECT_TONE_COUNT = 7;

// The colour a project name starts from. Same name, same starting colour, on every device.
export function projectTone(name: string) {
  let hash = 5381; // djb2
  for (const ch of name) hash = ((hash << 5) + hash + ch.codePointAt(0)!) >>> 0;
  return (hash % PROJECT_TONE_COUNT) + 1;
}

// CSS class for one project, without knowing the viewer's other projects (landing page, fallbacks).
export function toneClass(name: string, isPersonal = false) {
  return isPersonal ? "tone-personal" : `tone-${projectTone(name)}`;
}

// Colours for all of one viewer's projects, so no two of them share a colour (up to 7 projects).
// Projects are taken in name order; each starts at its name's colour and moves to the next free one
// if that is already used. Stable: the same set of projects always gets the same colours.
export function assignTones(projects: { id: string; name: string; isPersonal: boolean }[]) {
  const tones = new Map<string, string>();
  const used = new Set<number>();
  const teams = projects.filter((p) => !p.isPersonal).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const p of projects) if (p.isPersonal) tones.set(p.id, "tone-personal");
  for (const p of teams) {
    let tone = projectTone(p.name);
    if (used.size < PROJECT_TONE_COUNT) {
      while (used.has(tone)) tone = (tone % PROJECT_TONE_COUNT) + 1;
    }
    used.add(tone);
    tones.set(p.id, `tone-${tone}`);
  }
  return tones;
}
