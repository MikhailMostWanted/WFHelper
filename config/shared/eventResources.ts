/** Names are metadata, never extraction rules. New event paths work without an entry here. */
const CATALOG: Readonly<Record<string, { name: string; nameRu: string; eventName: string }>> = {
  "/Lotus/Types/Gameplay/Events/RoadToTauEvent/RoadToTauEventResource": {
    name: "Moonflesh",
    nameRu: "Лунная плоть",
    eventName: "Epoch Operation: Taubound",
  },
};

export function eventResourceInfo(type: string) {
  return CATALOG[type] ?? null;
}

/** A path hint identifies event material, not event dates, live availability or loot. */
export function isEventResource(type: string): boolean {
  return (
    eventResourceInfo(type) !== null ||
    /\/Events?\//i.test(type) ||
    /\/(?:[^/]*Event[^/]*|Nora[^/]*Creds|ScarletSpearCredits|Operation[^/]*)$/i.test(type)
  );
}
