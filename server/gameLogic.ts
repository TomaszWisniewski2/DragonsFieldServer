// server/gameLogic.ts (przykład)
export type Zone = "hand" | "library" | "battlefield" | "graveyard" | "exile" | "commanderZone";
export type SessionType = "standard" | "commander";
export type SortCriteria = "mana_cost" | "name" | "type_line";

export interface CardType {
  id: string;
  name: string;
  image?: string;
  mana_cost?: string;
  type_line?: string;
  basePower?: string | null;
  baseToughness?: string | null;
  loyalty?: number | null;
  
  // NOWE POLA DLA DRUGIEJ STRONY KARTY (DFC)
  hasSecondFace?: boolean; // Flaga ułatwiająca sprawdzenie, czy karta ma drugą stronę
  secondFaceName?: string;
  secondFaceImage?: string;
  secondFaceManaCost?: string;
  secondFaceTypeLine?: string;
  secondFaceBasePower?: string | null;
  secondFaceBaseToughness?: string | null;
  secondFaceLoyalty?: number | null;
}

export interface CardOnField {
  id: string;
  card: CardType;
  x: number;
  y: number;
  rotation: number;
    isFlipped: boolean;
  stats: {
    power: number;
    toughness: number;
  }
counters: number;
}

export interface Player {
  id: string;
  name: string;
  life: number;
  initialDeck: CardType[];
  library: CardType[];
  hand: CardType[];
  battlefield: CardOnField[];
  graveyard: CardType[];
  exile: CardType[];
  commanderZone: CardType[]; // Nowa strefa
  commander?: CardType; // Nowy, opcjonalny atrybut dla karty dowódcy
  manaPool: { W: number; U: number; B: number; R: number; G: number; C: number };
  counters: { [key: string]: number };
}

export interface Session {
  code: string;
  players: Player[];
  turn: number;
  activePlayer: string;
  sessionType: SessionType; // Nowy atrybut
}
// Helper do porównywania kosztów many
// Ta funkcja jest kluczowa dla właściwego sortowania kosztów many w MTG
const parseManaCost = (cost: string | undefined): number => {
    if (!cost) return 999; // Karty bez kosztu many (np. Lands) na koniec
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

export const sortPlayerHand = (player: Player, criteria: SortCriteria): Player => {
    player.hand.sort((a: CardType, b: CardType) => {
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