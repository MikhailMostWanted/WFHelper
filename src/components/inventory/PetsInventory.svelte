<script lang="ts">
  import ItemImage from "../ItemImage.svelte";
  import ThemedPanel from "../ThemedPanel.svelte";
  import PetGenetics from "./PetGenetics.svelte";
  import { locale, tr } from "../../lib/i18n.js";
  import { resolveItem } from "../../lib/inventory/itemClassification.js";
  import type { parsePetGenetics } from "../../lib/inventory/petGenetics.js";
  import type { ItemDbEntry } from "../../types/inventory.js";

  interface Props {
    genetics: ReturnType<typeof parsePetGenetics>;
    database: Record<string, ItemDbEntry>;
  }

  let { genetics, database }: Props = $props();
  let search = $state("");
  const query = $derived(search.trim().toLocaleLowerCase($locale));
  const cards = $derived(
    [...genetics.bySpecies]
      .flatMap(([species, pets]) => {
        const item = resolveItem(species, database);
        const speciesName = item.displayName ?? item.name;
        return pets.map((pet, index) => ({
          key: `${species}:${index}`,
          pet,
          speciesName,
          name: pet.name || speciesName,
          imageUrl: item?.imageUrl ?? null,
        }));
      })
      .sort((a, b) => a.name.localeCompare(b.name, $locale)),
  );
  const visiblePets = $derived(
    cards.filter((card) =>
      `${card.name} ${card.speciesName}`.toLocaleLowerCase($locale).includes(query),
    ),
  );
  const prints = $derived(
    [...genetics.printsBySpecies]
      .map(([species, imprints]) => {
        const item = resolveItem(species, database);
        return { species, name: item.displayName ?? item.name, imprints };
      })
      .sort((a, b) => a.name.localeCompare(b.name, $locale)),
  );
  const visiblePrints = $derived(
    prints
      .map((group) => ({
        ...group,
        imprints: group.imprints.filter((imprint) =>
          `${group.name} ${imprint.name}`.toLocaleLowerCase($locale).includes(query),
        ),
      }))
      .filter((group) => group.imprints.length > 0),
  );
</script>

<div data-pets-inventory>
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <p class="m-0 text-sm text-text-secondary">
      {$tr("pet.inventorySummary", { pets: genetics.totalPets, imprints: genetics.totalPrints })}
    </p>
    <input
      class="min-w-0 w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent sm:w-72"
      type="search"
      bind:value={search}
      placeholder={$tr("common.searchPlaceholder")}
      aria-label={$tr("common.searchPlaceholder")}
      data-search-focus
      data-pets-search
    />
  </div>
  {#if visiblePets.length || visiblePrints.length}
    <div
      class="grid items-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,24rem),1fr))]"
    >
      {#each visiblePets as card (card.key)}
        <div class="min-w-0" data-pet-card={card.pet.instanceId ?? card.key}>
          <ThemedPanel className="p-4">
            <div class="mb-3 flex items-center gap-3">
              <div class="h-16 w-16 shrink-0">
                <ItemImage src={card.imageUrl} alt={card.speciesName} cls="h-full! w-full!" />
              </div>
              <div class="min-w-0 flex-1">
                <h3 class="m-0 break-words font-body text-lg font-semibold text-text-primary">
                  {card.name}
                </h3>
                <p class="m-0 text-xs text-text-muted">{card.speciesName}</p>
              </div>
            </div>
            <PetGenetics pets={[card.pet]} prints={[]} locale={$locale} showName={false} />
          </ThemedPanel>
        </div>
      {/each}
    </div>
    {#if visiblePrints.length}
      <h3 class="mt-6 mb-3 font-display text-xl font-semibold text-text-primary">
        {$tr("pet.imprints")}
      </h3>
      <div
        class="grid items-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,24rem),1fr))]"
      >
        {#each visiblePrints as group (group.species)}
          <ThemedPanel className="min-w-0 p-4">
            <h4 class="mt-0 mb-3 font-body text-base font-semibold text-text-primary">
              {group.name}
            </h4>
            <PetGenetics pets={[]} prints={group.imprints} locale={$locale} />
          </ThemedPanel>
        {/each}
      </div>
    {/if}
  {:else}
    <p class="py-8 text-center text-text-muted" data-pets-empty>
      {$tr(genetics.totalPets || genetics.totalPrints ? "pet.noMatches" : "pet.inventoryEmpty")}
    </p>
  {/if}
</div>
