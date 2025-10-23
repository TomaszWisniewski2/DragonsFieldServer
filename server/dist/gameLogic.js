// Helper do porównywania kosztów many
// Ta funkcja jest kluczowa dla właściwego sortowania kosztów many w MTG
const parseManaCost = (cost) => {
    if (!cost)
        return 999; // Karty bez kosztu many (np. Lands) na koniec
    let total = 0;
    // Usuń symbole kolorów i specjalne (jak {T}, {Q}, {X})
    const numericCost = cost.replace(/[^0-9]/g, '');
    // Sumowanie numerycznych kosztów
    if (numericCost) {
        total = parseInt(numericCost);
    }
    // Dalsza logika parsowania bardziej złożonych kosztów może być potrzebna
    return total;
};
export const sortPlayerHand = (player, criteria) => {
    player.hand.sort((a, b) => {
        switch (criteria) {
            case 'mana_cost':
                // Sortowanie po numerycznej wartości kosztu many
                const costA = parseManaCost(a.mana_cost);
                const costB = parseManaCost(b.mana_cost);
                if (costA !== costB) {
                    return costA - costB;
                }
                // Dalsze sortowanie po nazwie jako tie-breaker
                return a.name.localeCompare(b.name);
            case 'name':
                return a.name.localeCompare(b.name);
            case 'type_line':
                // Sortowanie po typie (np. Creature, Sorcery, Land)
                const typeA = a.type_line || '';
                const typeB = b.type_line || '';
                if (typeA.localeCompare(typeB) !== 0) {
                    return typeA.localeCompare(typeB);
                }
                // Dalsze sortowanie po koszcie many jako tie-breaker
                const subCostA = parseManaCost(a.mana_cost);
                const subCostB = parseManaCost(b.mana_cost);
                return subCostA - subCostB;
            default:
                return 0; // Brak sortowania
        }
    });
    return player;
};
