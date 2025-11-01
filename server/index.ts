import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

// ==== Typy (zsynchronizowane z useSocket.ts) ====
export type Zone =
  | "hand"
  | "library"
  | "battlefield"
  | "graveyard"
  | "exile"
  | "commanderZone"
  | "sideboard";
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
  hasSecondFace?: boolean;
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
  initialSideboard: CardType[];
  library: CardType[];
  hand: CardType[];
  battlefield: CardOnField[];
  graveyard: CardType[];
  exile: CardType[];
  commanderZone: CardType[];
  commander?: CardType;
  sideboard: CardType[];
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

// ==== Serwer Express + Socket.IO ====
const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ==== Stałe sesje ====
const sessions: Record<string, Session> = {};
const initialSessions: { code: string; sessionType: SessionType }[] = [
  { code: "STND1", sessionType: "standard" },
  { code: "STND2", sessionType: "standard" },
  { code: "CMDR1", sessionType: "commander" },
  { code: "CMDR2", sessionType: "commander" },
];

initialSessions.forEach(({ code, sessionType }) => {
  sessions[code] = { code, players: [], turn: 0, activePlayer: "", sessionType };
  console.log(`Zainicjowano sesję: ${code} (${sessionType})`);
});

// ==== Funkcje pomocnicze ====
function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function getRandomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sortCards(hand: CardType[], criteria: SortCriteria): CardType[] {
  const sortedHand = [...hand];
  sortedHand.sort((a, b) => {
    let valA: string | number | undefined;
    let valB: string | number | undefined;
    switch (criteria) {
      case "mana_cost":
        valA = a.mana_value || 0;
        valB = b.mana_value || 0;
        return (valA as number) - (valB as number);
      case "name":
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
        if (valA < valB) return -1;
        if (valA > valB) return 1;
        return 0;
      case "type_line":
        valA = a.type_line?.toLowerCase() || "";
        valB = b.type_line?.toLowerCase() || "";
        if (valA < valB) return -1;
        if (valA > valB) return 1;
        return 0;
      default:
        return 0;
    }
  });
  return sortedHand;
}

function getSessionStats() {
  const stats: Record<string, number> = {};
  for (const code in sessions) {
    stats[code] = sessions[code].players.length;
  }
  return stats;
}

function emitSessionStats() {
  io.emit("updateSessionStats", getSessionStats());
}

function isCardOnField(card: CardType | CardOnField): card is CardOnField {
  return (card as CardOnField).card !== undefined;
}

const deepClone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));
// ==== Socket.IO ====
io.on("connection", (socket) => {
 console.log("Użytkownik połączony:", socket.id);

 // WYSYŁAMY STATYSTYKI NATYCHMIAST PO POŁĄCZENIU
 emitSessionStats(); 

 socket.on(
  "joinSession",
  ({
    code,
    playerName,
    deck, // PEŁNA talia (w tym Dowódca na pierwszej pozycji w trybie Commander)
    sideboardCards,
    commanderCard,
  }: {
    code: string;
    playerName: string;
    deck: CardType[];
    sideboardCards: CardType[];
    commanderCard?: CardType[] | null;
  }) => {
    console.log(
      `[JOIN-REQ] Gracz ${playerName} (${socket.id}) chce dołączyć do sesji ${code}. Talia: ${deck.length}`
    );

    const session = sessions[code];
    if (!session) {
      console.log(`[JOIN-FAIL] ${playerName}: Sesja ${code} nie istnieje.`);
      socket.emit(
        "error",
        "Sesja o podanym kodzie nie istnieje. Możesz dołączyć tylko do STND1, STND2, CMDR1 lub CMDR2."
      );
      return;
    }

    if (session.players.some((p) => p.id === socket.id)) {
      console.log(`[JOIN-FAIL] ${playerName}: Już jest w sesji.`);
      socket.emit("error", "Jesteś już w tej sesji.");
      return;
    }

    if (deck.length === 0) {
      console.log(`[JOIN-FAIL] ${playerName}: Talia jest pusta.`);
      socket.emit(
        "error",
        "Talia jest pusta! Zbuduj talię w Deck Managerze."
      );
      return;
    }

    let life = session.sessionType === "commander" ? 40 : 20;
    
// ⚠️ ZMODYFIKOWANA LOGIKA INICJALIZACJI TALII/COMMANDERA
      let libraryForShuffle: CardType[] = [...deck];
      let commanders: CardType[] = commanderCard || []; 
      let commanderZone: CardType[] = [];

if (session.sessionType === "commander") {
      if (commanders.length > 0) {
        let cardsRemoved = 0;
        
        // Przechodzimy przez KAŻDEGO dowódcę
        commanders.forEach((commander) => {
          const commanderIndex = libraryForShuffle.findIndex(
            (card) => card.id === commander.id
          );

          if (commanderIndex > -1) {
            libraryForShuffle.splice(commanderIndex, 1); // Usuń Dowódcę z biblioteki
            cardsRemoved++;
          }
        });
        
        commanderZone = [...commanders]; // Wszyscy dowódcy idą do strefy
        
        console.log(
          `[JOIN] Tryb Commander. Wybrano ${commanders.length} Dowódców. Usunięto z talii do tasowania: ${cardsRemoved}. Karty w bibliotece do tasowania: ${libraryForShuffle.length}`
        );

      } else {
        console.log(`[JOIN-FAIL] ${playerName}: Tryb Commander wymaga co najmniej jednego dowódcy.`);
        socket.emit(
          "error",
          "W trybie Commander talia musi zawierać co najmniej jedną kartę dowódcy."
        );
        return;
      }
    } else {
      commanders = []; // Upewnij się, że commanders jest puste w trybie Standard
      commanderZone = [];
    }
      // ----------------------------------------------------
    
const player: Player = {
      id: socket.id,
      name: playerName,
      life,
      initialDeck: [...deck], // ZAWSZE PEŁNA TALIA
      initialSideboard: [...sideboardCards],
      library: shuffle(libraryForShuffle), // Biblioteka potasowana i bez dowódców
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      commanderZone, // Lista dowódców lub pusta
      // 🟢 ZMIANA: Zapisujemy listę dowódców (jeśli typ Player został zmieniony na 'commanders: CardType[]')
      // Jeśli typ Player MUSI zostać 'commander: CardType | undefined', to poniżej jest problem z logiką
      // Zakładam, że zmienisz Player na:
      // commanders: CardType[];
      // Aby kod poniżej działał:
      // commanders: commanders, // <-- Zastępuje pole 'commander'
      // 
      // Jeśli TYM RAZEM musimy ZACHOWAĆ pole 'commander' dla pojedynczego dowódcy, użyjemy pierwszego elementu:
      commander: commanders.length > 0 ? commanders[0] : undefined, // Zachowanie starego pola dla kompatybilności, jeśli to możliwe
      sideboard: [...sideboardCards],
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
    }; 
    
    // Dobieranie 7 kart
    // for (let i = 0; i < 7 && player.library.length > 0; i++) {
    //   const card = player.library.shift();
    //   if (card) player.hand.push(card);
    // }

    session.players.push(player);
    socket.join(code); 

    if (session.players.length === 1) {
      session.activePlayer = player.id;
      session.turn = 1;
    }
    
    // WYSŁANIE ZAKTUALIZOWANEGO STANU
    io.to(code).emit("updateState", session);
    console.log(
      `[JOIN-SUCCESS] Gracz ${playerName} dołączył do sesji ${code} (${session.sessionType}). Gracze w sesji: ${session.players.length}`
    );

    // WYSYŁAMY ZAKTUALIZOWANE STATYSTYKI PO DOŁĄCZENIU
    emitSessionStats();
  }
);
 
 
 // --- Akcje gry ---
socket.on(
    "startGame",
    ({ code, sessionType }: { code: string; sessionType?: SessionType }) => {
      const session = sessions[code];
      if (session) {
        const currentSessionType = session.sessionType;

        session.players.forEach((player) => {
          if (!player.initialDeck || player.initialDeck.length === 0) {
            socket.emit(
              "error",
              `Deck is empty for a player ${player.name}! Cannot start game.`
            );
            return;
          }
          
          // KROK 1: Resetuj strefy i życie
          player.life = currentSessionType === "commander" ? 40 : 20;
          player.hand = [];
          player.battlefield = [];
          player.graveyard = [];
          player.exile = [];
          player.sideboard = [...player.initialSideboard];
          player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }; // Uzupełnienie: reset puli many

          // KROK 2: Przygotuj PEŁNĄ talię do tasowania
          let deckToShuffle = [...player.initialDeck];
          
          // KROK 3: Obsługa Dowódców (usuwamy Dowódców z talii do tasowania)
          if (currentSessionType === "commander") {
            
            // Lista Dowódców, którzy mają być w strefie
            const commandersToZone = player.commanderZone.length > 0 
              ? player.commanderZone 
              : []; // Jeśli z jakiegoś powodu pusta (błąd klienta)

            if (commandersToZone.length === 0) {
              socket.emit(
                "error",
                `W trybie Commander musisz mieć dowódcę ustawionego dla gracza ${player.name}.`
              );
              return; 
            }
            
            // Usuń Dowódców z talii do tasowania (sprawdzamy po ID)
            commandersToZone.forEach(commander => {
                const commanderIndex = deckToShuffle.findIndex(
                    (card) => card.id === commander.id
                );
                if (commanderIndex > -1) {
                    deckToShuffle.splice(commanderIndex, 1);
                }
            });

            // Ustaw Dowódców w strefie dowódcy (z powrotem tam, gdzie byli)
            player.commanderZone = commandersToZone;

          } else {
            // Tryb Standard: strefa Dowódcy pusta
            player.commanderZone = [];
          }
          
          // KROK 4: Tasowanie i dociąganie
          player.library = shuffle(deckToShuffle);
          
          for (let i = 0; i < 7 && player.library.length > 0; i++) {
            const card = player.library.shift();
            if (card) player.hand.push(card);
          }
          
          // Uzupełnienie: Reset liczników gracza
          player.counters = {
            Poison: 0, Energy: 0, Experience: 0, Rad: 0, Tickets: 0,
            "Commander 1": 0, "Commander 2": 0, "Commander 3": 0, 
          };
        });
        
        const randomPlayerIndex = Math.floor(
          Math.random() * session.players.length
        );
        session.turn = 1;
        session.activePlayer = session.players[randomPlayerIndex].id;
        session.sessionType = currentSessionType;
        io.to(code).emit("updateState", session);
        console.log(
          `Gra w sesji ${code} została rozpoczęta. Tryb: ${currentSessionType}`
        );
      }
    }
);

socket.on(
  "resetPlayer",
  async ({ code, playerId }: { code: string; playerId: string }) => {
    const session = sessions[code];
    if (!session) return;

    const player = session.players.find((p) => p.id === playerId);
    if (!player) return;

    await delay(1); // Symulacja dostępu I/O

    // KROK 1: Użyj bazowej talii (PEŁNEJ) do resetu.
    let fullDeckForShuffle = [...player.initialDeck];
    const currentSessionType = session.sessionType;

    // KROK 2: Reset życia i pozostałych stref
    player.life = currentSessionType === "commander" ? 40 : 20;
    player.hand = [];
    player.graveyard = [];
    player.exile = [];
    player.battlefield = [];
    player.sideboard = [...player.initialSideboard];
    player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    player.counters = { 
        Poison: 0, Energy: 0, Experience: 0, Rad: 0, Tickets: 0,
        "Commander 1": 0, "Commander 2": 0, "Commander 3": 0,
    };

    // KROK 3: Obsługa Dowódcy (usuwamy Dowódców z talii do tasowania)
    if (currentSessionType === "commander" && player.commanderZone.length > 0) {
        
        // Lista Dowódców, którzy mają być w strefie
        const commandersToZone = player.commanderZone; 
        
        // Usuń Dowódców z talii PRZED tasowaniem
        commandersToZone.forEach(commander => {
            const commanderIndex = fullDeckForShuffle.findIndex(
                (card) => card.id === commander.id
            );
            
            if (commanderIndex > -1) {
                fullDeckForShuffle.splice(commanderIndex, 1);
                console.log(`[RESET] Usunięto dowódcę ${commander.name} z talii do tasowania.`);
            }
        });
        
        // Ustaw Dowódców w strefie dowódcy
        player.commanderZone = commandersToZone;

    } else {
        player.commanderZone = [];
    }

    // KROK 4: Wypełnij bibliotekę i przetasuj.
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

  // Fragment z server/index.ts (zakładając, że typy CardType, CardOnField, Zone są dostępne)
  function isCardOnField(card: CardType | CardOnField): card is CardOnField {
    // CardOnField ma pole 'x' i 'y', CardType nie.
    // Najbezpieczniej jest jednak sprawdzać pole 'card'
    return (card as CardOnField).card !== undefined;
  }
socket.on(
    "moveCard",
    ({
        code,
        playerId,
        from,
        to,
        cardId,
        x,
        y,
        position, // obecnie nieużywany, zachowany na przyszłość
        toBottom, // opcjonalny parametr dla biblioteki
    }: {
        code: string;
        playerId: string;
        from: Zone;
        to: Zone;
        cardId: string;
        x?: number;
        y?: number;
        position?: number;
        toBottom?: boolean;
    }) => {
        const session = sessions[code];
        if (!session) return;

        const player = session.players.find((p) => p.id === playerId);
        if (!player) return;

        // 🧩 Walidacja stref
        if (!from || typeof from !== "string" || !(from in player)) {
            console.error(`[MOVE-FAIL] Nieprawidłowa strefa źródłowa: ${from}`);
            socket.emit(
                "error",
                `Nie można przenieść karty: nieprawidłowa strefa źródłowa (${from}).`
            );
            return;
        }

        if (!to || typeof to !== "string" || !(to in player)) {
            console.error(`[MOVE-FAIL] Nieprawidłowa strefa docelowa: ${to}`);
            socket.emit(
                "error",
                `Nie można przenieść karty: nieprawidłowa strefa docelowa (${to}).`
            );
            return;
        }

        // 🪶 Tokeny — jeśli schodzą z pola bitwy, są usuwane
        if (from === "battlefield" && to !== "battlefield") {
            const battlefieldCardIndex = player.battlefield.findIndex(
                (c) => c.id === cardId
            );

            if (battlefieldCardIndex !== -1) {
                const cardOnField = player.battlefield[battlefieldCardIndex];
                if (cardOnField.isToken) {
                    player.battlefield.splice(battlefieldCardIndex, 1);
                    console.log(
                        `[MOVE] Token ${cardId} usunięty z pola bitwy (do ${to}).`
                    );
                    io.to(code).emit("updateState", session);
                    return;
                }
            }
        }

        // 🔎 Pobierz źródło
        const sourceZone = player[from as keyof Player] as
            | CardType[]
            | CardOnField[];
        if (!Array.isArray(sourceZone)) {
            console.error(`[MOVE] Strefa źródłowa ${from} nie jest tablicą.`);
            return;
        }

        const cardIndex = sourceZone.findIndex((c: any) => c.id === cardId);

        if (cardIndex === -1) {
            const msg = `[MOVE] Karta ${cardId} nie znaleziona w strefie ${from}.`;
            console.error(msg);
            socket.emit("error", msg);
            socket.emit("updateState", session);
            return;
        }

        const [removedCard] = sourceZone.splice(cardIndex, 1);

        // 🧠 Zachowaj dane karty
        let pureCard: CardType;
        let originalOnField: CardOnField | null = null;

        if (isCardOnField(removedCard)) {
            pureCard = removedCard.card;
            originalOnField = removedCard;
        } else {
            pureCard = removedCard;
        }

        // 🎯 Przeniesienie do pola bitwy
        if (to === "battlefield") {
            const newCardOnField: CardOnField = {
                id: cardId,
                card: pureCard,
                x: x ?? originalOnField?.x ?? 50,
                y: y ?? originalOnField?.y ?? 50,
                rotation: originalOnField?.rotation ?? 0,
                isFlipped: originalOnField?.isFlipped ?? false,
                isToken: originalOnField?.isToken ?? false,
                stats:
                    from === "battlefield"
                        ? originalOnField!.stats
                        : { power: 0, toughness: 0 },
                counters:
                    from === "battlefield"
                        ? originalOnField!.counters
                        : 0,
            };
            player.battlefield.push(newCardOnField);
        } else {
            // 🎯 Przeniesienie do innej strefy
            const destinationZone = player[to as keyof Player] as CardType[];
            if (!Array.isArray(destinationZone)) {
                console.error(`[MOVE] Nieprawidłowa strefa docelowa: ${to}`);
                sourceZone.push(pureCard as any); // zwróć kartę, aby nie zginęła
                return;
            }

            switch (to) {
                case "library":
                    if (toBottom) {
                        destinationZone.push(pureCard);
                        console.log(
                            `[MOVE] Karta ${cardId} dodana na dół biblioteki.`
                        );
                    } else {
                        destinationZone.unshift(pureCard);
                        console.log(
                            `[MOVE] Karta ${cardId} dodana na górę biblioteki.`
                        );
                    }
                    break;

                case "hand":
                case "graveyard":
                case "exile":
                case "sideboard":
                    destinationZone.push(pureCard);
                    break;

                case "commanderZone":
                    destinationZone.unshift(pureCard);
                    break;

                default:
                    console.warn(`[MOVE] Nieobsługiwana strefa docelowa: ${to}`);
                    destinationZone.push(pureCard);
            }
        }

        // 🔄 Synchronizacja z klientami
        io.to(code).emit("updateState", session);
        console.log(
            `[MOVE] ${cardId} (${playerId}): ${from} ➜ ${to}`
        );
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
  //-----------------------------------------------------------------------------------------------------------------------------
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
        cardOnField.isFlipped = false;
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

      // 1. Znajdź oryginalną kartę na polu bitwy (tę, którą kliknięto)

      const originalCardOnField = player.battlefield.find(
        (c) => c.id === cardId
      );

      if (!originalCardOnField) {
        console.error(`Nie znaleziono karty do sklonowania o ID: ${cardId}`);

        return;
      }

      // Stała bazowa ID dla wszystkich klonów tej karty

      const baseCardLibraryId = originalCardOnField.card.id;

      // 2. Zlicz istniejące klony (tokeny) na polu bitwy

      // Liczymy wszystkie tokeny i oryginalną kartę (jeśli to klon, liczymy ją jako 1)

      let cloneCount = 0;

      player.battlefield.forEach((c) => {
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

      player.battlefield.forEach((c) => {
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

      const newCardId = `token-clone-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 9)}`;

      clonedCardOnField.id = newCardId;
      // 5. Oznacz kartę jako Token (nawet jeśli oryginał był już tokenem)
      clonedCardOnField.isToken = true;
      // 6. Ustaw klon na nowej, przesuniętej pozycji.
      // Zawsze przesuwaj względem bazowej pozycji oryginalnej karty (tej, którą kliknięto)
      clonedCardOnField.x = originalCardOnField.x + displacement;
      clonedCardOnField.y = originalCardOnField.y + displacement;
      // 7. Dodaj klon do pola bitwy
      player.battlefield.push(clonedCardOnField);
      console.log(
        `Klon tokenu utworzony dla karty ID: ${originalCardOnField.id} (Nowe ID: ${newCardId}). Przesunięcie: ${displacement}`
      );

      // 8. Wyślij aktualizację stanu
      io.to(code).emit("updateState", session);
    }
  );

  // 🌟 NOWY HANDLER: Move Card to Battlefield Flipped
  socket.on(
    "moveCardToBattlefieldFlipped",
    (data: { code: string; playerId: string; cardId: string; from: Zone }) => {
      const { code, playerId, cardId, from } = data;
      const session = sessions[code];

      if (!session) {
        console.warn(
          `moveCardToBattlefieldFlipped: Session ${code} not found.`
        );
        return;
      }

      const player = session.players.find((p) => p.id === playerId);
      if (!player) {
        console.warn(
          `moveCardToBattlefieldFlipped: Player ${playerId} not found in session ${code}.`
        );
        return;
      }

      // Typujemy strefę źródłową jako CardType[], ponieważ karty w Hand, Library, Sideboard, etc. to CardType
      const fromZone = player[from as keyof Player] as CardType[];
      const cardIndex = fromZone.findIndex((card) => card.id === cardId);
      if (cardIndex === -1) {
        console.warn(
          `moveCardToBattlefieldFlipped: Card ${cardId} not found in ${from} for player ${playerId}.`
        );
        return;
      }

      // 1. Znajdź i usuń kartę z zony źródłowej
      const cardTypeToMove: CardType = fromZone.splice(cardIndex, 1)[0];

      // 2. Konwersja CardType na CardOnField i inicjalizacja stanu
      const cardOnField: CardOnField = {
        id: cardId,
        card: cardTypeToMove,
        x: 50, // Domyślne współrzędne
        y: 50,
        rotation: 0,
        isFlipped: true, // Ustawienie na Flipped/Strona B/Facedown
        isToken: false,
        stats: {
          // Modyfikatory P/T powinny być zerowane przy wejściu na pole
          power: 0,
          toughness: 0,
        },
        counters: 0,
      };

      // 🌟 KLUCZOWA LOGIKA: Obsługa DFC (Double-Faced Cards) 🌟
      if (cardTypeToMove.hasSecondFace) {
        // Jeśli karta jest DFC, "Flipped" oznacza przejście na drugą stronę (Stronę B).

        const card = cardOnField.card;

        // --- Zapisujemy wartości Strony A w temp ---
        const tempName = card.name;
        const tempImage = card.image;
        const tempManaCost = card.mana_cost;
        const tempTypeLine = card.type_line;
        const tempBasePower = card.basePower; // Wartość Strony A
        const tempBaseToughness = card.baseToughness; // Wartość Strony A
        const tempLoyalty = card.loyalty;

        // --- Ustawiamy Wartości Bazowe na Stronę B ---
        card.name = card.secondFaceName!;
        card.image = card.secondFaceImage;
        card.mana_cost = card.secondFaceManaCost;
        card.type_line = card.secondFaceTypeLine;
        card.basePower = card.secondFaceBasePower; // ✅ POPRAWKA: Ustawiamy Siłę Strony B
        card.baseToughness = card.secondFaceBaseToughness; // ✅ POPRAWKA: Ustawiamy Wytrzymałość Strony B
        card.loyalty = card.secondFaceLoyalty;

        // --- Ustawiamy Wartości SecondFace na Stronę A (która teraz jest "drugą") ---
        card.secondFaceName = tempName;
        card.secondFaceImage = tempImage;
        card.secondFaceManaCost = tempManaCost;
        card.secondFaceTypeLine = tempTypeLine;
        card.secondFaceBasePower = tempBasePower; // ✅ POPRAWKA: Ustawiamy Siłę Strony A (w "drugiej")
        card.secondFaceBaseToughness = tempBaseToughness; // ✅ POPRAWKA: Ustawiamy Wytrzymałość Strony A (w "drugiej")
        card.secondFaceLoyalty = tempLoyalty;

        // isFlipped jest ustawione na true (co w tym scenariuszu oznacza Stronę B)
        console.log(
          `DFC ${card.name} (${cardId}) została automatycznie odwrócona na Stronę B podczas ruchu na Battlefield.`
        );
      } else {
        // Dla kart jednostronnych 'isFlipped: true' oznacza Facedown (rewers).
        console.log(
          `Karta jednostronna ${cardTypeToMove.name} (${cardId}) została przeniesiona na Battlefield jako Zakryta (Facedown).`
        );
      }

      // 3. Przenieś kartę na "battlefield"
      player.battlefield.push(cardOnField);

      // 4. Emituj zaktualizowany stan do wszystkich klientów w sesji
      io.to(code).emit("updateState", session);
    }
  );
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Serwer działa na http://localhost:${PORT}`);
});
