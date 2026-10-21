// Picks one of the 6 --project-N colours for a project name. Same name, same colour, on every device.
export const PROJECT_TONE_COUNT = 6;

// CSS class for a project's colour. Personal always gets its own fixed colour; every other project
// gets one of the 6 palette colours by name (so a name always has the same colour).
export function toneClass(name: string, isPersonal = false) {
  return isPersonal ? "tone-personal" : `tone-${projectTone(name)}`;
}

export function projectTone(name: string) {
  let hash = 5381; // djb2
  for (const ch of name) hash = ((hash << 5) + hash + ch.codePointAt(0)!) >>> 0;
  return (hash % PROJECT_TONE_COUNT) + 1;
}
