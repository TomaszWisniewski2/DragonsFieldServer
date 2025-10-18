import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

// ==== Typy (powinny być zsynchronizowane z useSocket.ts) ====
// Zaktualizowano Zone, aby zawierała commanderZone
export type Zone =
  | "hand"
  | "library"
  | "battlefield"
  | "graveyard"
  | "exile"
  | "commanderZone";
export type SessionType = "standard" | "commander";
export type SortCriteria = "mana_cost" | "name" | "type_line";

export interface CardType {
  id: string;
  name: string;
  image?: string;
  mana_cost?: string;
  mana_value: number;
  type_line?: string;
  basePower?: string | null;
  baseToughness?: string | null;
  loyalty?: number | null;

  hasSecondFace?: boolean; // Flaga ułatwiająca sprawdzenie, czy karta ma drugą stronę
  secondFaceName?: string;
  secondFaceImage?: string;
  secondFaceManaCost?: string;
  secondFaceManaValue?: number;
  secondFaceTypeLine?: string;
  secondFaceBasePower?: string | null;
  secondFaceBaseToughness?: string | null;
  secondFaceLoyalty?: number | null;

  tokens?: TokenData[];
}

export interface TokenData {
  name: string;
  type_line: string;
  basePower?: string | null;
  baseToughness?: string | null;
  image?: string;
  mana_value: number;
  mana_cost?: string;
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
  };
  counters: number;
  isToken: boolean;
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
  commanderZone: CardType[]; //  strefa
  commander?: CardType; // opcjonalny atrybut dla karty dowódcy
  manaPool: {
    W: number;
    U: number;
    B: number;
    R: number;
    G: number;
    C: number;
  };
  counters: { [key: string]: number };
}

export interface Session {
  code: string;
  players: Player[];
  turn: number;
  activePlayer: string;
  sessionType: SessionType;
}

// ==== Setup serwera ====
const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// ==== Stałe sesje i ich inicjalizacja ====
const sessions: Record<string, Session> = {};

const initialSessions: { code: string; sessionType: SessionType }[] = [
  { code: "STND1", sessionType: "standard" },
  { code: "STND2", sessionType: "standard" },
  { code: "CMDR1", sessionType: "commander" },
  { code: "CMDR2", sessionType: "commander" },
];

initialSessions.forEach(({ code, sessionType }) => {
  sessions[code] = {
    code,
    players: [],
    turn: 0,
    activePlayer: "",
    sessionType,
  };
  console.log(`Zainicjowano stałą sesję: ${code} (${sessionType})`);
});

// ==== LOGIKA SORTOWANIA (NOWA FUNKCJA POMOCNICZA) ====
// --------------------------------------------------------------------------------------------------
function sortCards(hand: CardType[], criteria: SortCriteria): CardType[] {
  // Kopia tablicy, aby nie modyfikować jej bezpośrednio w trakcie sortowania
  const sortedHand = [...hand];

  sortedHand.sort((a, b) => {
    let valA: string | number | undefined;
    let valB: string | number | undefined;

    switch (criteria) {
      case "mana_cost":
        // Dla mana_cost używamy długości stringa jako prostej metryki sortowania
        // Można to ulepszyć, używając biblioteki do parsowania kosztu many (np. manacost-to-cmc)
        // lub sortując alfabetycznie, co daje przyzwoity efekt.
        valA = a.mana_value || "";
        valB = b.mana_value || "";

        // Sortowanie alfabetyczne po stringu (dla efektu 'zwykłego' sortowania po cenie)
        if (valA < valB) return -1;
        if (valA > valB) return 1;
        return 0;

      case "name":
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
        if (valA < valB) return -1;
        if (valA > valB) return 1;
        return 0;

      case "type_line":
        // W Magic The Gathering zazwyczaj sortuje się po typie w kolejności:
        // Landy, Kreatury, Sorcery, Instants, Artefakty, Enchantmenty.
        // Tutaj używamy prostego sortowania alfabetycznego po Type Line.
        valA = a.type_line?.toLowerCase() || "";
        valB = b.type_line?.toLowerCase() || "";
        if (valA < valB) return -1;
        if (valA > valB) return 1;
        return 0;

      default:
        return 0; // Brak sortowania
    }
  });

  return sortedHand;
}
// ----------------------
// ===========================================

// --------------------------------------------------------------------------------------------------
// ==== LOGIKA STATYSTYK SESJI (NOWA SEKCJA) ====
// --------------------------------------------------------------------------------------------------
function getSessionStats() {
  const stats: Record<string, number> = {};
  for (const code in sessions) {
    stats[code] = sessions[code].players.length;
  }
  return stats;
}

function emitSessionStats() {
  const stats = getSessionStats();
  // Wysyłamy statystyki do WSZYSTKICH podłączonych klientów
  io.emit("updateSessionStats", stats);
  // console.log("[STATS] Wysłano statystyki sesji:", stats); // Odkomentuj do debugowania
}
// --------------------------------------------------------------------------------------------------

function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function removeFromZone<T extends { id: string }>(
  zoneArr: T[],
  id: string
): T | null {
  const idx = zoneArr.findIndex((c) => c.id === id);
  if (idx >= 0) return zoneArr.splice(idx, 1)[0];
  return null;
}

function getRandomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

// ==== Socket.IO ====
io.on("connection", (socket) => {
  console.log("Użytkownik połączony:", socket.id);

  // WYSYŁAMY STATYSTYKI NATYCHMIAST PO POŁĄCZENIU
  emitSessionStats(); // --- ZDARZENIE createSession ZOSTAŁO USUNIĘTE ---

  socket.on(
    "joinSession",
    ({
      code,
      playerName,
      deck,
    }: {
      code: string;
      playerName: string;
      deck: CardType[];
    }) => {
      console.log(
        `[JOIN] Otrzymano żądanie dołączenia do sesji od gracza ${playerName}`
      );

      const session = sessions[code];
      if (!session) {
        socket.emit(
          "error",
          "Sesja o podanym kodzie nie istnieje. Możesz dołączyć tylko do STND1, STND2, CMDR1 lub CMDR2."
        );
        return;
      }

      if (session.players.some((p) => p.id === socket.id)) {
        socket.emit("error", "Jesteś już w tej sesji.");
        return;
      }

      if (deck.length === 0) {
        socket.emit(
          "error",
          "Talia jest pusta! Zbuduj talię w Deck Managerze."
        );
        return;
      }

      let life = session.sessionType === "commander" ? 40 : 20;
      let initialDeck = [...deck];
      let commander: CardType | undefined;
      let commanderZone: CardType[] = []; // Logika Commandera bazująca na TYPIE SESJI (pobranym ze stałej sesji)

      if (session.sessionType === "commander") {
        const commanderCard = initialDeck.shift();
        if (commanderCard) {
          commander = commanderCard;
          commanderZone = [commanderCard];
          console.log(
            `[JOIN] Tryb Commander. Dowódca wybrany: ${commanderCard.name}`
          );
        } else {
          socket.emit(
            "error",
            "W trybie Commander talia musi zawierać co najmniej jedną kartę dowódcy (pierwsza karta w talii)."
          );
          return;
        }
      }
      const player: Player = {
        id: socket.id,
        name: playerName,
        life,
        initialDeck,
        library: shuffle([...initialDeck]),
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        commanderZone,
        commander,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        counters: {
          Poison: 0,
          Energy: 0,
          Experience: 0,
          Rad: 0,
          Tickets: 0,
          "Commander 1": 0,
          "Commander 2": 0,
          "Commander 3": 0,
        },
      }; // Dobierz 7 kart

      for (let i = 0; i < 7 && player.library.length > 0; i++) {
        const card = player.library.shift();
        if (card) player.hand.push(card);
      }

      session.players.push(player);
      socket.join(code); // Ustawienie aktywnego gracza, jeśli to pierwszy gracz w sesji

      if (session.players.length === 1) {
        session.activePlayer = player.id;
        session.turn = 1;
      }
      io.to(code).emit("updateState", session);
      console.log(
        `Gracz ${playerName} dołączył do stałej sesji ${code} (${session.sessionType})`
      );

      // WYSYŁAMY ZAKTUALIZOWANE STATYSTYKI PO DOŁĄCZENIU
      emitSessionStats();
    }
  ); // --- Akcje gry ---
  socket.on(
    "startGame",
    ({ code, sessionType }: { code: string; sessionType?: SessionType }) => {
      const session = sessions[code];
      if (session) {
        // Używamy typu sesji ustawionego przy inicjalizacji, a nie przekazanego z klienta
        const currentSessionType = session.sessionType;

        session.players.forEach((player) => {
          if (!player.initialDeck || player.initialDeck.length === 0) {
            socket.emit(
              "error",
              `Deck is empty for a player ${player.name}! Cannot start game.`
            );
            return;
          }
          player.life = currentSessionType === "commander" ? 40 : 20;
          let deckToShuffle = [...player.initialDeck];
          let commanderCard: CardType | undefined = player.commander; // Zacznij od obecnego dowódcy

          if (currentSessionType === "commander") {
            if (!player.commander) {
              // JEŚLI DOWÓDCA NIE BYŁ JESZCZE USTAWIONY
              // Ustawienie dowódcy po raz pierwszy (jak w oryginalnym kodzie)
              commanderCard = deckToShuffle.shift();

              if (commanderCard) {
                player.commander = commanderCard;
                player.commanderZone = [commanderCard];
              } else {
                socket.emit(
                  "error",
                  `Commander card not found for player ${player.name}.`
                );
                return; // Zakończenie inicjalizacji gracza
              }
            } else {
              // Dowódca już jest, upewnij się, że nie jest w talii do potasowania
              // Usuń kartę dowódcy z talii do potasowania (może być potrzebne, jeśli initialDeck zawiera dowódcę)
              const commanderIndex = deckToShuffle.findIndex(
                (card) => card.id === player.commander!.id
              );
              if (commanderIndex > -1) {
                deckToShuffle.splice(commanderIndex, 1);
              }
              player.commanderZone = [player.commander!]; // Ustaw go w strefie
            }
          } else {
            // Tryb inny niż Commander
            player.commander = undefined;
            player.commanderZone = [];
          }
          player.library = shuffle(deckToShuffle);
          player.hand = [];
          player.battlefield = [];
          player.graveyard = [];
          player.exile = []; // Resetuj exile

          for (let i = 0; i < 7 && player.library.length > 0; i++) {
            const card = player.library.shift();
            if (card) player.hand.push(card);
          }
        });
        const randomPlayerIndex = Math.floor(
          Math.random() * session.players.length
        );
        session.turn = 1;
        session.activePlayer = session.players[randomPlayerIndex].id;
        session.sessionType = currentSessionType; // Wymuś typ stałej sesji
        io.to(code).emit("updateState", session);
        console.log(
          `Gra w sesji ${code} została rozpoczęta. Tryb: ${currentSessionType}`
        );
      }
    }
  );

  socket.on(
    "resetPlayer",
    ({ code, playerId }: { code: string; playerId: string }) => {
      const session = sessions[code];
      if (!session) return;

      const player = session.players.find((p) => p.id === playerId);
      if (!player) return;

      // KROK 1: Użyj bazowej talii do resetu. Ta talia ZAWSZE zawiera prawidłową liczbę kart.
      let fullDeckForShuffle = [...player.initialDeck];

      // KROK 2: Obsługa dowódcy w formacie Commander
      if (session.sessionType === "commander" && player.commander) {
        // Ustaw dowódcę w strefie dowódcy
        player.commanderZone = [player.commander];
        // Usuń kartę dowódcy z talii do tasowania (ponieważ zaczyna w commanderZone)
        fullDeckForShuffle = fullDeckForShuffle.filter(
          (c) => c.id !== player.commander?.id
        );
      } else {
        player.commanderZone = [];
      }

      // KROK 3: Reset życia i pozostałych stref.
      player.life = session.sessionType === "commander" ? 40 : 20;

      player.hand = [];
      player.graveyard = [];
      player.exile = [];
      player.battlefield = [];

      // KROK 4: Wypełnij bibliotekę i przetasuj.
      // Zauważ: Nie dodajemy już kart z bieżących stref (hand, graveyard, etc.)
      // Ponieważ initialDeck jest źródłem prawdy o tym, co powinno być w talii.
      player.library = shuffle(fullDeckForShuffle);

      // KROK 5: Dociągnij rękę startową (7 kart)
      for (let i = 0; i < 7 && player.library.length > 0; i++) {
        const card = player.library.shift();
        if (card) player.hand.push(card);
      }

      io.to(code).emit("updateState", session);
      console.log(`Gracz ${player.name} w sesji ${code} został zresetowany.`);
    }
  );
  socket.on(
    "draw",
    ({
      code,
      playerId,
      count = 1,
    }: {
      code: string;
      playerId: string;
      count?: number;
    }) => {
      const session = sessions[code];
      const player = session?.players.find((p) => p.id === playerId);
      if (player) {
        for (let i = 0; i < count; i++) {
          const card = player.library.shift();
          if (card) player.hand.push(card);
        }
        io.to(code).emit("updateState", session);
      }
    }
  );

  socket.on(
    "shuffle",
    ({ code, playerId }: { code: string; playerId: string }) => {
      const session = sessions[code];
      const player = session?.players.find((p) => p.id === playerId);
      if (player) {
        player.library = shuffle(player.library);
        io.to(code).emit("updateState", session);
      }
    }
  );
  socket.on(
    "changeLife",
    ({
      code,
      playerId,
      newLife,
    }: {
      code: string;
      playerId: string;
      newLife: number;
    }) => {
      const session = sessions[code];
      const player = session?.players.find((p) => p.id === playerId);
      if (player) {
        player.life = newLife;
        io.to(code).emit("updateState", session);
      }
    }
  );

socket.on(
 "moveCard",
 (payload: {
 code: string;
 playerId: string;
 from: Zone;
 to: Zone;
 cardId: string;
 x?: number;
 y?: number;
 position?: number; // pozycja w ręce
 toBottom?: boolean; // NOWE: flaga oznaczająca wstawienie na dół biblioteki/commanderZone
 }) => {
 const { code, playerId, from, to, cardId, x, y, position, toBottom } = payload; // Dodano toBottom
 const session = sessions[code];
 if (!session) return;

 const player = session.players.find((p) => p.id === playerId);
 if (!player) return;

 // 1. OBSŁUGA PRZENO-SZENIA W OBRĘBIE POLA BITWY (DLA Z-INDEX I POZYCJI)
 if (from === "battlefield" && to === "battlefield") {
  const cardIndex = player.battlefield.findIndex((b) => b.id === cardId);

  if (cardIndex !== -1) {
  // Usuwamy i przechowujemy referencję do karty
  const [c] = player.battlefield.splice(cardIndex, 1);

  // Aktualizacja współrzędnych
  c.x = typeof x === "number" ? x : c.x;
  c.y = typeof y === "number" ? y : c.y;

  // Dodajemy kartę z powrotem na koniec tablicy (najwyższy z-index)
  player.battlefield.push(c);
  io.to(code).emit("updateState", session);
  }
  return; // Zakończ, jeśli było to tylko przeniesienie na polu bitwy
 }

 // --- Obsługa Przenoszenia między strefami (w tym tokeny) ---

 // 2. Zlokalizuj kartę w strefie źródłowej i usuń ją
 // DODANA WALIDACJA TYPU
 const sourceZone = player[from as keyof Player];

 // Sprawdzenie, czy strefa istnieje i jest tablicą
 if (!Array.isArray(sourceZone)) {
  console.error(`[MOVE] Nieprawidłowa strefa źródłowa: ${from}. Otrzymano: ${sourceZone}`);
  return;
 }

 // Używamy GLOBALNEJ funkcji removeFromZone
 const card = removeFromZone(
  sourceZone as (CardType | CardOnField)[], // Rzutowanie typu
  cardId
 );
 
 if (!card) return;

 // 3. LOGIKA USUWANIA TOKENÓW 🌟
 // Sprawdzamy, czy karta jest tokenem (tylko CardOnField może być tokenem)
 const isTokenBeingMoved =
  from === "battlefield" && (card as CardOnField).isToken;

 if (isTokenBeingMoved && to !== "battlefield") {
  // Token został przeniesiony do innej strefy i powinien zostać usunięty
  console.log(`Token usunięty: ${cardId} (z ${from} do ${to})`);
  io.to(code).emit("updateState", session);
  return; // Zakończ, token zniknął
 }
 // KONIEC LOGIKI USUWANIA TOKENÓW

 // 4. Przeniesienie do strefy docelowej (dla kart, które przetrwały lub nie były tokenami)

 // Zwykła karta (CardType) niezależnie od tego, czy przyszła z CardOnField (card.card) czy CardType
 const cardToMove = (card as CardOnField).card || card;

 if (to === "battlefield") {
  // Konwersja CardType na CardOnField
  const cardToPlace = cardToMove as CardType;

  const cardOnField: CardOnField = {
  id: cardId, // Używamy oryginalnego ID (dla karty z decku będzie to ID CardType)
  card: cardToPlace,
  x: x ?? 50,
  y: y ?? 50,
  rotation: 0,
  isFlipped: false,
  isToken: false, // Normalna karta nie jest tokenem
  stats: {
   // Początkowe statystyki oparte na karcie (jeśli dostępne)
   power: 0,
   toughness: 0
  },
  counters: 0,
  };
  player.battlefield.push(cardOnField);
 } else {
  // Przeniesienie do innej strefy (Hand, Library, Graveyard, Exile, CommanderZone)
  const targetZone = player[to as keyof Player] as CardType[];

  if (to === "hand" && typeof position === "number") {
  // Wstawiamy w konkretne miejsce w ręce
  targetZone.splice(position, 0, cardToMove as CardType);
  } else if (to === "library" || to === "commanderZone") {
  // Obsługa Góra/Dół stosu
  if (toBottom) {
   // Dodaj kartę na dół stosu (koniec tablicy)
   targetZone.push(cardToMove as CardType);
  } else {
   // Domyślne: Dodaj kartę na górę stosu (początek tablicy)
   targetZone.unshift(cardToMove as CardType);
  }
  } else {
  // Standardowe zachowanie (Graveyard, Exile): dodanie na końcu
  targetZone.push(cardToMove as CardType);
  }
 }

 io.to(code).emit("updateState", session);
 }
);

  socket.on("disconnect", () => {
    console.log("Użytkownik rozłączył się:", socket.id);

    for (const code in sessions) {
      const session = sessions[code];
      const idx = session.players.findIndex((p) => p.id === socket.id);
      if (idx >= 0) {
        session.players.splice(idx, 1); // Ustaw aktywnego gracza na 1. w kolejce, jeśli się rozłączył
        if (session.activePlayer === socket.id && session.players.length > 0) {
          session.activePlayer = session.players[0].id;
        } // Jeśli sesja jest pusta, zachowaj ją, ale zresetuj stan tury
        if (session.players.length === 0) {
          session.turn = 0;
          session.activePlayer = "";
        }

        io.to(code).emit("updateState", session);
        console.log(
          `Gracz rozłączony. Pozostało graczy w sesji ${code}: ${session.players.length}`
        );

        // WYSYŁAMY ZAKTUALIZOWANE STATYSTYKI PO ROZŁĄCZENIU
        emitSessionStats();
      }
    }
  });

  socket.on("rotateCard", ({ code, playerId, cardId }) => {
    const session = sessions[code];
    if (!session) return;

    const player = session.players.find((p) => p.id === playerId);
    if (!player) return;

    const card = player.battlefield.find((c) => c.id === cardId);
    if (card) {
      card.rotation = card.rotation === 0 ? 90 : 0;
      io.to(code).emit("updateState", session);
      console.log(
        `Karta ${cardId} gracza ${playerId} w sesji ${code} została obrócona.`
      );
    }
  });

  socket.on("rotateCard180", ({ code, playerId, cardId }) => {
    const session = sessions[code];
    if (!session) return;

    const player = session.players.find((p) => p.id === playerId);
    if (!player) return;

    const card = player.battlefield.find((c) => c.id === cardId);
    if (card) {
      card.rotation = card.rotation === 0 ? 180 : 0;
      io.to(code).emit("updateState", session);
      console.log(
        `Karta ${cardId} gracza ${playerId} w sesji ${code} została obrócona.`
      );
    }
  });

  socket.on("nextTurn", ({ code, playerId }) => {
    const session = sessions[code];
    if (!session) return;

    const player = session.players.find((p) => p.id === playerId);
    if (!player) return; //if (session.activePlayer !== playerId) return; // Tylko aktywny gracz może zakończyć turę
    player.battlefield.forEach((cardOnField) => {
      cardOnField.rotation = 0;
    });

    const card = player.library.shift();
    if (card) {
      player.hand.push(card);
    }

    session.turn += 1;

    const currentPlayerIndex = session.players.findIndex(
      (p) => p.id === playerId
    );
    const nextPlayerIndex = currentPlayerIndex % session.players.length; // Zmieniono na +1

    const nextPlayer = session.players[nextPlayerIndex];
    session.activePlayer = nextPlayer.id;

    io.to(code).emit("updateState", session);
    console.log(
      `Tura gracza ${player.name} w sesji ${code} zakończona. Nowa tura dla ${nextPlayer.name}.`
    );
  });

  socket.on(
    "changeMana",
    ({
      code,
      playerId,
      color,
      newValue,
    }: {
      code: string;
      playerId: string;
      color: keyof Player["manaPool"];
      newValue: number;
    }) => {
      const session = sessions[code];
      if (!session) return;

      const player = session.players.find((p) => p.id === playerId);
      if (!player) return;

      if (Object.prototype.hasOwnProperty.call(player.manaPool, color)) {
        player.manaPool[color] = newValue;
        io.to(code).emit("updateState", session);
        console.log(
          `Mana dla gracza ${player.name} (${color}) zmieniona na ${newValue}.`
        );
      }
    }
  );

  socket.on(
    "changeCounters",
    ({
      code,
      playerId,
      type,
      newValue,
    }: {
      code: string;
      playerId: string;
      type: string;
      newValue: number;
    }) => {
      const session = sessions[code];
      const player = session?.players.find((p) => p.id === playerId);
      if (player) {
        player.counters[type] = newValue;
        io.to(code).emit("updateState", session);
        console.log(
          `Zaktualizowano licznik '${type}' dla gracza ${player.name} na: ${newValue}`
        );
      }
    }
  );

  socket.on("increment_card_stats", ({ code, playerId, cardId }) => {
    const session = sessions[code];
    if (!session) return;

    const player = session.players.find((p) => p.id === playerId);
    if (!player) return;

    const cardOnField = player.battlefield.find((c) => c.id === cardId);
    if (cardOnField) {
      cardOnField.stats.power += 1;
      cardOnField.stats.toughness += 1;

      io.to(code).emit("updateState", session);
      console.log(
        `Zwiększono statystyki karty ${cardId} dla gracza ${playerId}.`
      );
    }
  });

  socket.on(
    "moveAllCards",
    ({
      code,
      playerId,
      from,
      to,
    }: {
      code: string;
      playerId: string;
      from: Zone;
      to: Zone;
    }) => {
      const session = sessions[code];
      if (!session) return;

      const player = session.players.find((p) => p.id === playerId);
      if (!player) return;

      // Używamy typu Player jako klucza, by dostać się do tablic stref
      const playerState = player as Player &
        Record<Zone, CardType[] | CardOnField[]>;

      // Walidacja stref: Tę funkcję zaprojektowano dla przenoszenia stref *kart* (nie CardOnField).
      // Można przenosić tylko: library, hand, graveyard, exile, commanderZone.
      const movableZones: Zone[] = [
        "library",
        "hand",
        "graveyard",
        "exile",
        "commanderZone",
      ];

      if (from === "battlefield" || to === "battlefield") {
        socket.emit(
          "error",
          "Przenoszenie wszystkich kart z/do strefy 'battlefield' nie jest obsługiwane przez to zdarzenie."
        );
        return;
      }

      if (!movableZones.includes(from) || !movableZones.includes(to)) {
        socket.emit(
          "error",
          `Nieprawidłowa strefa: 'from' = ${from}, 'to' = ${to}.`
        );
        return;
      }
      // Przenoszenie kart ze strefy źródłowej do strefy docelowej
      // @ts-ignore: Wiemy, że to będą CardType[] na podstawie walidacji 'movableZones'
      const sourceArray: CardType[] = playerState[from] as CardType[];
      // @ts-ignore
      const destinationArray: CardType[] = playerState[to] as CardType[];
      // Przeniesienie wszystkich elementów
      destinationArray.push(...sourceArray);
      // Wyczyść strefę źródłową
      sourceArray.length = 0;
      // Jeśli przeniesiono do Biblioteki, przetasuj ją
      if (to === "library") {
        //player.library = shuffle(player.library);
        console.log(
          `[MOVEALL] Wszystkie karty z ${from} przeniesione do Biblioteki i przetasowane.`
        );
      } else {
        console.log(
          `[MOVEALL] Wszystkie karty z ${from} przeniesione do ${to}.`
        );
      }
      io.to(code).emit("updateState", session);
    }
  ); 
  // NOWY HANDLER: Zwiększenie licznika karty (+1)
  socket.on("increment_card_counters", ({ code, playerId, cardId }) => {
    const session = sessions[code];
    if (!session) return;
    const player = session.players.find((p) => p.id === playerId);
    if (!player) return;

    const cardOnField = player.battlefield.find((c) => c.id === cardId);
    if (cardOnField) {
      // 1. Zwiększenie samego licznika
      cardOnField.counters += 1;
      io.to(code).emit("updateState", session);
      console.log(
        `Zwiększono licznik karty ${cardId} dla gracza ${playerId}. Nowy licznik: ${cardOnField.counters}`
      );
    }
  }); // NOWY HANDLER: Zmniejszenia licznika karty (-1)
  socket.on("decrease_card_counters", ({ code, playerId, cardId }) => {
    const session = sessions[code];
    if (!session) return;
    const player = session.players.find((p) => p.id === playerId);
    if (!player) return;
    const cardOnField = player.battlefield.find((c) => c.id === cardId);
    if (cardOnField) {
      // 1. Zmniejszono samego licznika
      cardOnField.counters -= 1;
      io.to(code).emit("updateState", session);
      console.log(
        `Zmniejszono licznik karty ${cardId} dla gracza ${playerId}. Nowy licznik: ${cardOnField.counters}`
      );
    }
  });
  // NOWA OBSŁUGA USTAWIANIA WARTOŚCI POWER I TOUGHNESS
  socket.on(
    "set_card_stats",
    ({ code, playerId, cardId, powerValue, toughnessValue }) => {
      const session = sessions[code];
      if (!session) return;
      const player = session.players.find((p) => p.id === playerId);
      if (!player) return;
      const cardOnField = player.battlefield.find((c) => c.id === cardId);
      if (cardOnField) {
        // Ustawienie statystyk na podane wartości
        cardOnField.stats.power = powerValue;
        cardOnField.stats.toughness = toughnessValue;
        io.to(code).emit("updateState", session);
        console.log(
          `Ustawiono statystyki karty ${cardId} na P:${powerValue}, T:${toughnessValue} dla gracza ${playerId}.`
        );
      }
    }
  );
  socket.on(
    "flipCard",
    ({
      code,
      playerId,
      cardId,
    }: {
      code: string;
      playerId: string;
      cardId: string;
    }) => {
      const session = sessions[code];
      if (!session) return;
      const player = session.players.find((p) => p.id === playerId);
      if (!player) return;
      const cardOnField = player.battlefield.find((c) => c.id === cardId);
      if (cardOnField && cardOnField.card.hasSecondFace) {
        // Zamień wartości między kartą bazową a drugą stroną
        const card = cardOnField.card;
        const isFlipped = cardOnField.isFlipped;
        // --- Logika zamiany pól ---
        // Używamy tymczasowych zmiennych do bezpiecznej zamiany,
        // zakładając, że pola 'secondFace' są puste (null/undefined) w stanie bazowym,
        // więc ich wartość po zamianie powinna trafić do pola bazowego.
        const tempName = card.name;
        const tempImage = card.image;
        const tempManaCost = card.mana_cost;
        const tempTypeLine = card.type_line;
        const tempBasePower = card.basePower;
        const tempBaseToughness = card.baseToughness;
        const tempLoyalty = card.loyalty;
        // Ustaw nowe wartości bazowe (dane z drugiej strony)
        card.name = card.secondFaceName!;
        card.image = card.secondFaceImage;
        card.mana_cost = card.secondFaceManaCost;
        card.type_line = card.secondFaceTypeLine;
        card.basePower = card.secondFaceBasePower;
        card.baseToughness = card.secondFaceBaseToughness;
        card.loyalty = card.secondFaceLoyalty;
        // Ustaw nowe wartości drugiej strony (dane z poprzedniej strony bazowej)
        card.secondFaceName = tempName;
        card.secondFaceImage = tempImage;
        card.secondFaceManaCost = tempManaCost;
        card.secondFaceTypeLine = tempTypeLine;
        card.secondFaceBasePower = tempBasePower;
        card.secondFaceBaseToughness = tempBaseToughness;
        card.secondFaceLoyalty = tempLoyalty;
        // Zmień status odwrócenia
        cardOnField.isFlipped = !isFlipped;
        io.to(code).emit("updateState", session);
        console.log(
          `Odwrócono kartę ${
            card.name
          } (ID: ${cardId}) dla gracza ${playerId}. Nowa strona: ${
            cardOnField.isFlipped ? "Druga" : "Pierwsza"
          }`
        );
      } else if (cardOnField) {
        socket.emit(
          "error",
          `Karta ${cardOnField.card.name} nie jest kartą dwustronną (DFC).`
        );
      }
    }
  );
  socket.on(
    "sortHand",
    ({
      code,
      playerId,
      criteria,
    }: {
      code: string;
      playerId: string;
      criteria: SortCriteria;
    }) => {
      const session = sessions[code];
      if (!session) return;
      const player = session.players.find((p) => p.id === playerId);
      if (!player) return;
      // Wywołanie nowej logiki sortującej
      player.hand = sortCards(player.hand, criteria);
      io.to(code).emit("updateState", session);
      console.log(
        `[SORT] Ręka gracza ${player.name} w sesji ${code} posortowana wg: ${criteria}.`
      );
    }
  );
  // -------------------------------------------------------------------------------------
  // ==== NOWY HANDLER: moveAllToBottom (Przeniesienie na Dół Biblioteki) ====
  // ------------------------------------------------------------------------------------
  socket.on(
    "moveAllToBottom",
    ({
      code,
      playerId,
      from,
      to,
    }: {
      code: string;
      playerId: string;
      from: Zone;
      to: Zone;
    }) => {
      const session = sessions[code];
      if (!session) return;
      const player = session.players.find((p) => p.id === playerId);
      if (!player) return;
      // Używamy typu Player jako klucza, by dostać się do tablic stref
      const playerState = player as Player &
        Record<Zone, CardType[] | CardOnField[]>;
      // Walidacja: MUSI być do biblioteki i NIE MOŻE być z/do battlefield
      if (to !== "library" || from === "battlefield") {
        socket.emit(
          "error",
          "Akcja 'moveAllToBottom' jest dozwolona tylko DO biblioteki i NIE Z pola bitwy."
        );
        return;
      }
      // @ts-ignore
      const sourceArray: CardType[] = playerState[from] as CardType[];
      const destinationArray: CardType[] = playerState["library"]; // KROK 1: Kopiowanie kart do tymczasowej tablicy
      const cardsToMove = [...sourceArray]; // KROK 2: Wyczyść strefę źródłową
      sourceArray.length = 0; // KROK 3: ZAMIANA: Używamy push, aby wstawić na koniec tablicy, // ponieważ w Twoim systemie, jeśli unshift (początek) to góra, // to push (koniec) musi być DOŁEM.
      destinationArray.push(...cardsToMove);
      io.to(code).emit("updateState", session);
      console.log(
        `[MOVEBOTTOM] Wszystkie karty z ${from} przeniesione na DÓŁ Biblioteki.`
      );
    }
  );
  // -------------------------------------------------------------------------------------
  // ==== NOWY HANDLER: discardRandomCard (Wyrzucenie losowej karty z ręki do grobu) ====
  // -------------------------------------------------------------------------------------
  socket.on(
    "discardRandomCard",
    ({ code, playerId }: { code: string; playerId: string }) => {
      const session = sessions[code];
      if (!session) return;
      const player = session.players.find((p) => p.id === playerId);
      if (!player) return;
      const hand = player.hand;
      const graveyard = player.graveyard;
      if (hand.length === 0) {
        socket.emit("error", "Nie masz żadnych kart w ręce, aby coś odrzucić.");
        return;
      }
      // 1. Wylosowanie indeksu karty
      const randomIndex = getRandomInt(hand.length);
      // 2. Usunięcie karty z ręki za pomocą splice
      // splice zwraca tablicę usuniętych elementów, więc bierzemy [0]
      const [discardedCard] = hand.splice(randomIndex, 1);
      // 3. Dodanie usuniętej karty do cmentarza
      if (discardedCard) {
        graveyard.push(discardedCard);
        console.log(
          `[DISCARD] Gracz ${player.name} odrzucił losowo kartę: ${discardedCard.name} do Grobu.`
        );
      }
      io.to(code).emit("updateState", session);
    }
  );
  // --- NOWA LOGIKA: TWORZENIE TOKENÓW ---
  socket.on(
    "createToken",
    ({
      code,
      playerId,
      tokenData,
    }: {
      code: string;
      playerId: string;
      tokenData: TokenData;
    }) => {
      const session = sessions[code];
      if (!session) return;
      const player = session.players.find((p) => p.id === playerId);
      if (!player) return; // Generowanie unikalnego ID dla tokenu
      const tokenId = `token-${tokenData.name}-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 9)}`; // Ustawienie domyślnych statystyk na podstawie TokenData (wartości domyślne to 0)
      const basePower = parseInt(tokenData.basePower || "0", 10);
      const baseToughness = parseInt(tokenData.baseToughness || "0", 10);
      const tokenOnField: CardOnField = {
        id: tokenId,
        card: {
          // Mapowanie TokenData na CardType
          id: tokenId,
          name: tokenData.name,
          image: tokenData.image,
          mana_cost: tokenData.mana_cost,
          mana_value: tokenData.mana_value,
          type_line: tokenData.type_line,
          basePower: tokenData.basePower,
          baseToughness: tokenData.baseToughness,
          loyalty: null,
          hasSecondFace: false,
        }, // Domyślna pozycja na polu bitwy (np. górny lewy róg lub środek)
        x: 100,
        y: 100,
        rotation: 0,
        isFlipped: false,
        stats: {
          power: 0, // Tokeny zaczynają z bazowymi statystykami
          toughness: 0,
        },
        counters: 0,
        isToken: true,
      }; // Dodanie tokenu do pola bitwy gracza
      player.battlefield.push(tokenOnField);
      io.to(code).emit("updateState", session);
      console.log(
        `Gracz ${player.name} stworzył token: ${tokenData.name} z powerem ${tokenData.basePower}`
      );
    }
  );
  // ------------------------------------------------------------------------------
  const deepClone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));
socket.on(
 "cloneCard",
 ({ code, playerId, cardId }: { code: string, playerId: string, cardId: string }) => {
  const session = sessions[code];
  if (!session) return;
  const player = session.players.find((p) => p.id === playerId);
  if (!player) return;
  // 1. Znajdź oryginalną kartę na polu bitwy (tę, którą kliknięto)
  const originalCardOnField = player.battlefield.find((c) => c.id === cardId);
  if (!originalCardOnField) {
   console.error(`Nie znaleziono karty do sklonowania o ID: ${cardId}`);
   return;
  }
  // Stała bazowa ID dla wszystkich klonów tej karty
  const baseCardLibraryId = originalCardOnField.card.id; 
  // 2. Zlicz istniejące klony (tokeny) na polu bitwy
  // Liczymy wszystkie tokeny i oryginalną kartę (jeśli to klon, liczymy ją jako 1)
  let cloneCount = 0;
  player.battlefield.forEach(c => {
   // Sprawdzamy, czy karta jest tokenem i ma to samo bazowe ID co oryginał
   if (c.isToken === true && c.card.id === baseCardLibraryId) {
    cloneCount++;
   }
  });
    
    // Dodajemy 1 do zliczonych klonów, ponieważ token, który chcemy sklonować, również się liczy.
    // Jeśli zliczasz tokeny, które są klonami.

    // 🌟 ALTERNATYWNE LICZENIE (bardziej logiczne):
    // Zliczamy wszystkie tokeny BĘDĄCE klonami tej konkretnej karty bazowej.
    // Oryginalna karta (jeśli nie jest tokenem) ma być bazą.
    // Liczba przesunięć = liczba tokenów o tym samym baseCardLibraryId.
    
    // W obecnym scenariuszu, oryginalna karta (nie token) jest bazą, a klon (token) jest przesuwany.
    // 
    // Sprawdzamy, czy oryginalnaCardOnField to klon (isToken=true).
    const isOriginalAToken = originalCardOnField.isToken === true;

    // Zliczamy, ile tokenów (w tym potencjalnie samego originalCardOnField, jeśli jest tokenem)
    // ma to samo bazowe ID (card.id).
    let existingTokenClonesCount = 1;
    player.battlefield.forEach(c => {
        // Liczymy tylko te, które SĄ tokenami
        if (c.isToken === true && c.card.id === baseCardLibraryId) {
            existingTokenClonesCount++;
        }
    });

    // Wartość przesunięcia (liczba przesunięć * stała odległość)
  const OFFSET_INCREMENT = 20;
  const displacement = existingTokenClonesCount * OFFSET_INCREMENT;
    
  // 3. Utwórz głęboką kopię obiektu CardOnField
  const clonedCardOnField: CardOnField = deepClone(originalCardOnField);

  // 4. Nadaj klonowi NOWE, unikalne ID
  const newCardId = `token-clone-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  clonedCardOnField.id = newCardId;
  
  // 5. Oznacz kartę jako Token (nawet jeśli oryginał był już tokenem)
  clonedCardOnField.isToken = true;

  // 6. Ustaw klon na nowej, przesuniętej pozycji.
  // Zawsze przesuwaj względem bazowej pozycji oryginalnej karty (tej, którą kliknięto)
  clonedCardOnField.x = originalCardOnField.x + displacement;
  clonedCardOnField.y = originalCardOnField.y + displacement;

  // 7. Dodaj klon do pola bitwy
  player.battlefield.push(clonedCardOnField);

  console.log(`Klon tokenu utworzony dla karty ID: ${originalCardOnField.id} (Nowe ID: ${newCardId}). Przesunięcie: ${displacement}`);
  
  // 8. Wyślij aktualizację stanu
  io.to(code).emit("updateState", session);
 }
);

});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Serwer działa na http://localhost:${PORT}`);
});
