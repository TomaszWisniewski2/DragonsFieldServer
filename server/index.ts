// index.ts

import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

// ==== Typy (powinny być zsynchronizowane z useSocket.ts) ====
// Zaktualizowano Zone, aby zawierała commanderZone
export type Zone = "hand" | "library" | "battlefield" | "graveyard" | "exile" | "commanderZone";
export type SessionType = "standard" | "commander";

export interface CardType {
    id: string;
    name: string;
    image?: string;
    mana_cost?: string;
    type_line?: string;
    basePower?: string | null;
    baseToughness?: string | null;
    loyalty?: number | null;
}

export interface CardOnField {
    id: string;
    card: CardType;
    x: number;
    y: number;
    rotation: number;
    stats: {
        power: number;
        toughness: number;
    }
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

// ==== Setup serwera ====
const app = express();
// Użycie CORS dla połączeń HTTP/Express
app.use(cors());

// Dodanie prostego endpointu na sprawdzenie statusu serwera
app.get("/", (req, res) => {
    res.send("DragonsField Server is running! 🐉");
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        // Użycie "*" dla testów, w produkcji zmień na domenę Netlify!
        origin: "*", 
        methods: ["GET", "POST"],
    },
});

const sessions: Record<string, Session> = {};

function shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function removeFromZone<T extends { id: string }>(zoneArr: T[], id: string): T | null {
    const idx = zoneArr.findIndex((c) => c.id === id);
    if (idx >= 0) return zoneArr.splice(idx, 1)[0];
    return null;
}

// ==== Socket.IO ====
io.on("connection", (socket) => {
    console.log("Użytkownik połączony:", socket.id);

    // --- Akcje zarządzania sesją ---
    socket.on("createSession", ({ code, playerName, deck, sessionType = "standard" }: { code: string; playerName: string; deck: CardType[]; sessionType?: SessionType }) => {
        console.log(`[CREATE] Otrzymano żądanie utworzenia sesji od gracza ${playerName}`);
        console.log(`[CREATE] Długość talii z klienta: ${deck.length}`);

        if (sessions[code]) {
            socket.emit("error", "Sesja o podanym kodzie już istnieje!");
            return;
        }

        if (!deck || deck.length === 0) {
            socket.emit("error", "Talia jest pusta! Zbuduj talię w Deck Managerze.");
            return;
        }

        socket.join(code);
        
        let life = 20;
        const initialDeck = [...deck];
        let commander: CardType | undefined;
        let commanderZone: CardType[] = [];
        
        if (sessionType === "commander") {
            life = 40;
            // Zakładamy, że pierwsza karta w talii z klienta jest dowódcą
            const commanderCard = initialDeck.shift(); 
            if (commanderCard) {
                commander = commanderCard;
                commanderZone = [commanderCard];
                console.log(`[CREATE] Tryb Commander. Dowódca wybrany: ${commanderCard.name}`);
            } else {
                socket.emit("error", "W trybie Commander talia musi zawierać co najmniej jedną kartę dowódcy.");
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
                'Commander 1': 0,
                'Commander 2': 0,
                'Commander 3': 0,
            },
        };

        for (let i = 0; i < 7 && player.library.length > 0; i++) {
            const card = player.library.shift();
            if (card) player.hand.push(card);
        }

        console.log(`[CREATE] Długość talii gracza po inicjalizacji: ${player.library.length}`);
        console.log(`[CREATE] Długość ręki gracza po inicjalizacji: ${player.hand.length}`);
        
        sessions[code] = {
            code,
            players: [player],
            turn: 1,
            activePlayer: socket.id,
            sessionType,
        };

        io.to(code).emit("updateState", sessions[code]);
        console.log(`Utworzono sesję ${code} przez gracza ${playerName} w trybie ${sessionType}`);
    });

    socket.on("joinSession", ({ code, playerName, deck, sessionType = "standard" }: { code: string; playerName: string; deck: CardType[]; sessionType?: SessionType }) => {
        console.log(`[JOIN] Otrzymano żądanie dołączenia do sesji od gracza ${playerName}`);
        console.log(`[JOIN] Długość talii z klienta: ${deck.length}`);

        const session = sessions[code];
        if (!session) {
            socket.emit("error", "Sesja o podanym kodzie nie istnieje!");
            return;
        }
        
        let life = 20;
        const initialDeck = [...deck];
        let commander: CardType | undefined;
        let commanderZone: CardType[] = [];

        if (sessionType === "commander") {
            life = 40;
            const commanderCard = initialDeck.shift(); 
            if (commanderCard) {
                commander = commanderCard;
                commanderZone = [commanderCard];
                console.log(`[JOIN] Tryb Commander. Dowódca wybrany: ${commanderCard.name}`);
            } else {
                socket.emit("error", "W trybie Commander talia musi zawierać co najmniej jedną kartę dowódcy.");
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
                'Commander 1': 0,
                'Commander 2': 0,
                'Commander 3': 0,
            },
        };

        for (let i = 0; i < 7 && player.library.length > 0; i++) {
            const card = player.library.shift();
            if (card) player.hand.push(card);
        }

        console.log(`[JOIN] Długość talii gracza po inicjalizacji: ${player.library.length}`);
        console.log(`[JOIN] Długość ręki gracza po inicjalizacji: ${player.hand.length}`);

        session.players.push(player);
        socket.join(code);
        io.to(code).emit("updateState", session);
        console.log(`Gracz ${playerName} dołączył do sesji ${code}`);
    });
    
    // --- Akcje gry ---
    socket.on("startGame", ({ code, sessionType = "standard" }: { code: string; sessionType?: SessionType }) => {
        const session = sessions[code];
        if (session) {
            session.players.forEach(player => {
                if (!player.initialDeck || player.initialDeck.length === 0) {
                    socket.emit("error", `Deck is empty for a player ${player.name}! Cannot start game.`);
                    return;
                }
                
                player.life = sessionType === "commander" ? 40 : 20;
                
                const deckToShuffle = [...player.initialDeck];
                let commanderCard: CardType | undefined;

                if (sessionType === "commander") {
                    // Zakładamy, że klient ustawił pierwszą kartę jako dowódcę
                    commanderCard = deckToShuffle.shift();
                    if (commanderCard) {
                        player.commander = commanderCard;
                        player.commanderZone = [commanderCard];
                    } else {
                        socket.emit("error", `Commander card not found for player ${player.name}.`);
                        return;
                    }
                } else {
                    player.commander = undefined;
                    player.commanderZone = [];
                }
                
                player.library = shuffle(deckToShuffle);
                player.hand = [];
                player.battlefield = [];
                player.graveyard = [];

                for (let i = 0; i < 7 && player.library.length > 0; i++) {
                    const card = player.library.shift();
                    if (card) player.hand.push(card);
                }
            });
            const randomPlayerIndex = Math.floor(Math.random() * session.players.length);
            session.turn = 1;
            session.activePlayer = session.players[randomPlayerIndex].id;
            session.sessionType = sessionType; // Ustaw typ sesji na serwerze
            io.to(code).emit("updateState", session);
            console.log(`Gra w sesji ${code} została rozpoczęta.`);
        }
    });

    socket.on("resetPlayer", ({ code, playerId }: { code: string; playerId: string }) => {
        const session = sessions[code];
        if (!session) return;

        const player = session.players.find((p) => p.id === playerId);
        if (!player) return;

        // Przenieś wszystkie karty z ręki, pola walki, cmentarza, Exile i strefy dowódcy do biblioteki do tasowania
        const allCards = [
            ...player.hand,
            ...player.graveyard,
            ...player.exile,
            ...player.battlefield.map(cardOnField => cardOnField.card)
        ];
        
        let deckToShuffle = [...player.initialDeck];

        if (session.sessionType === "commander" && player.commander) {
            // W trybie commander, dowódca wraca do commanderZone, a nie do biblioteki
            player.commanderZone = [player.commander]; 
            // Usuń kartę dowódcy z talii do tasowania
            deckToShuffle = deckToShuffle.filter(c => c.id !== player.commander?.id);
        } else {
            player.commanderZone = [];
        }

        player.hand = [];
        player.graveyard = [];
        player.exile = [];
        player.battlefield = [];
        
        // Tasowanie wszystkich kart z powrotem do biblioteki
        player.library = shuffle([...deckToShuffle, ...allCards]);

        // Dobranie 7 kart
        for (let i = 0; i < 7 && player.library.length > 0; i++) {
            const card = player.library.shift();
            if (card) player.hand.push(card);
        }
        
        io.to(code).emit("updateState", session);
        console.log(`Ręka gracza ${player.name} w sesji ${code} została zresetowana.`);
    });

    socket.on("draw", ({ code, playerId, count = 1 }: { code: string; playerId: string; count?: number }) => {
        const session = sessions[code];
        const player = session?.players.find((p) => p.id === playerId);
        if (player) {
            for (let i = 0; i < count; i++) {
                const card = player.library.shift();
                if (card) player.hand.push(card);
            }
            io.to(code).emit("updateState", session);
        }
    });

    socket.on("shuffle", ({ code, playerId }: { code: string; playerId: string }) => {
        const session = sessions[code];
        const player = session?.players.find((p) => p.id === playerId);
        if (player) {
            player.library = shuffle(player.library);
            io.to(code).emit("updateState", session);
        }
    });
    
    socket.on("changeLife", ({ code, playerId, newLife }: { code: string; playerId: string; newLife: number }) => {
        const session = sessions[code];
        const player = session?.players.find((p) => p.id === playerId);
        if (player) {
            player.life = newLife;
            io.to(code).emit("updateState", session);
        }
    });

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
        }) => {
            const { code, playerId, from, to, cardId, x, y } = payload;
            const session = sessions[code];
            if (!session) return;
            
            const player = session.players.find((p) => p.id === playerId);
            if (!player) return;

            if (from === "battlefield" && to === "battlefield") {
                const c = player.battlefield.find((b) => b.id === cardId);
                if (c) {
                    c.x = typeof x === "number" ? x : c.x;
                    c.y = typeof y === "number" ? y : c.y;
                }
            } else {
                let card: CardType | CardOnField | null;
                
                switch (from) {
                    case "hand":
                        card = removeFromZone(player.hand, cardId);
                        break;
                    case "library":
                        card = removeFromZone(player.library, cardId);
                        break;
                    case "graveyard":
                        card = removeFromZone(player.graveyard, cardId);
                        break;
                    case "battlefield":
                        card = removeFromZone(player.battlefield, cardId);
                        break;
                    case "exile":
                        card = removeFromZone(player.exile, cardId);
                        break;
                    case "commanderZone":
                        card = removeFromZone(player.commanderZone, cardId);
                        break;
                    default:
                        return;
                }
    
                if (!card) return;
    
                if (to === "battlefield") {
                    const cardToPlace = (card as CardOnField).card || card;
                    const cardOnField: CardOnField = {
                        id: cardToPlace.id,
                        card: cardToPlace,
                        x: x ?? 50,
                        y: y ?? 50,
                        rotation: 0,
                        stats: {
                            power: 0,
                            toughness: 0
                        }
                    };
                    player.battlefield.push(cardOnField);
                } else {
                    const cardToMove = (card as CardOnField).card || card;
                    // Użyj 'as CardType' do pewności, że typ jest poprawny
                    // W TypeScript, musimy jawnie rzutować na poprawną strefę tablicy.
                    (player[to] as CardType[]).push(cardToMove as CardType);
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
                session.players.splice(idx, 1);
                io.to(code).emit("updateState", session);
            }
        }
    });


    socket.on('rotateCard', ({ code, playerId, cardId }) => {
        const session = sessions[code];
        if (!session) return;

        const player = session.players.find(p => p.id === playerId);
        if (!player) return;

        const card = player.battlefield.find(c => c.id === cardId);
        if (card) {
            card.rotation = card.rotation === 0 ? 90 : 0;
            
            io.to(code).emit('updateState', session); 
            console.log(`Karta ${cardId} gracza ${playerId} w sesji ${code} została obrócona.`);
        }
    });

    socket.on("nextTurn", ({ code, playerId }) => {
        const session = sessions[code];
        if (!session) return;

        const player = session.players.find((p) => p.id === playerId);
        if (!player) return;

        // Dobranie karty na początku tury
        const card = player.library.shift();
        if (card) {
            player.hand.push(card);
        }
        
        // Odwrócenie wszystkich kart, aby były gotowe do użycia
        player.battlefield.forEach((cardOnField) => {
            cardOnField.rotation = 0;
        });

        session.turn += 1;

        // Przejście do następnego gracza
        const currentPlayerIndex = session.players.findIndex((p) => p.id === playerId);
        // Użyj modulo dla bezpiecznego przejścia
        const nextPlayerIndex = (currentPlayerIndex + 1) % session.players.length; 
        const nextPlayer = session.players[nextPlayerIndex];
        session.activePlayer = nextPlayer.id;

        io.to(code).emit("updateState", session);
        console.log(`Tura gracza ${player.name} w sesji ${code} zakończona. Karty odwrócone, dobrano nową kartę.`);
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
                        console.log(`Mana dla gracza ${player.name} (${color}) zmieniona na ${newValue}.`);
                    }
                }
            );


    socket.on(
        "changeCounters",
        ({ code, playerId, type, newValue }: { code: string; playerId: string; type: string; newValue: number }) => {
            const session = sessions[code];
            const player = session?.players.find((p) => p.id === playerId);
            if (player) {
                player.counters[type] = newValue;
                io.to(code).emit("updateState", session);
                console.log(`Zaktualizowano licznik '${type}' dla gracza ${player.name} na: ${newValue}`);
            }
        }
    );

    socket.on("increment_card_stats", ({ code, playerId, cardId }) => {
        const session = sessions[code];
        if (!session) return;

        const player = session.players.find(p => p.id === playerId);
        if (!player) return;

        const cardOnField = player.battlefield.find(c => c.id === cardId);
        if (cardOnField) {
            cardOnField.stats.power += 1;
            cardOnField.stats.toughness += 1;

            io.to(code).emit("updateState", session);
            console.log(`Zwiększono statystyki karty ${cardId} dla gracza ${playerId}.`);
        }
    });

});

// Użycie PORT z zmiennych środowiskowych Railway/systemu, z fallbackiem na 3001
const PORT = process.env.PORT || 3001; 
server.listen(PORT, () => {
    console.log(`Serwer działa na http://localhost:${PORT}`);
});