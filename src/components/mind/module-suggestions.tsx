import { suggestionCategories, suggestModules, type ModuleSuggestion } from "@/lib/intent/module-suggestions";

export function ModuleSuggestions({
  draft,
  onPick,
}: {
  draft: string;
  onPick: (item: ModuleSuggestion) => void;
}) {
  const items = suggestModules(draft);
  const categories = suggestionCategories(items);
  if (categories.length === 0) return null;
  return (
    <div className="mb-2 space-y-2" data-testid="module-suggestions">
      {categories.map((category) => (
        <div key={category}>
          <p className="mb-1 text-xs uppercase tracking-wide text-muted">{category}</p>
          <div className="flex flex-wrap gap-2">
            {items.filter((item) => item.category === category).map((item) => (
              <button
                key={item.id}
                type="button"
                className="inline-flex min-h-11 max-w-full items-center truncate rounded-full border border-line px-3 text-sm"
                data-testid="module-suggestion"
                data-module={item.id}
                onClick={() => onPick(item)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
