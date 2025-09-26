import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
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
const sessions = {};
function shuffle(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
function removeFromZone(zoneArr, id) {
    const idx = zoneArr.findIndex((c) => c.id === id);
    if (idx >= 0)
        return zoneArr.splice(idx, 1)[0];
    return null;
}
// ==== Socket.IO ====
io.on("connection", (socket) => {
    console.log("Użytkownik połączony:", socket.id);
    // --- Akcje zarządzania sesją ---
    socket.on("createSession", ({ code, playerName, deck, sessionType = "standard" }) => {
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
        let initialDeck = [...deck];
        let commander;
        let commanderZone = [];
        if (sessionType === "commander") {
            life = 40;
            // Zakładamy, że pierwsza karta w talii z klienta jest dowódcą
            const commanderCard = initialDeck.shift();
            if (commanderCard) {
                commander = commanderCard;
                commanderZone = [commanderCard];
                console.log(`[CREATE] Tryb Commander. Dowódca wybrany: ${commanderCard.name}`);
            }
            else {
                socket.emit("error", "W trybie Commander talia musi zawierać co najmniej jedną kartę dowódcy.");
                return;
            }
        }
        const player = {
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
            if (card)
                player.hand.push(card);
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
    socket.on("joinSession", ({ code, playerName, deck, sessionType = "standard" }) => {
        console.log(`[JOIN] Otrzymano żądanie dołączenia do sesji od gracza ${playerName}`);
        console.log(`[JOIN] Długość talii z klienta: ${deck.length}`);
        const session = sessions[code];
        if (!session) {
            socket.emit("error", "Sesja o podanym kodzie nie istnieje!");
            return;
        }
        let life = 20;
        let initialDeck = [...deck];
        let commander;
        let commanderZone = [];
        if (sessionType === "commander") {
            life = 40;
            const commanderCard = initialDeck.shift();
            if (commanderCard) {
                commander = commanderCard;
                commanderZone = [commanderCard];
                console.log(`[JOIN] Tryb Commander. Dowódca wybrany: ${commanderCard.name}`);
            }
            else {
                socket.emit("error", "W trybie Commander talia musi zawierać co najmniej jedną kartę dowódcy.");
                return;
            }
        }
        const player = {
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
            if (card)
                player.hand.push(card);
        }
        console.log(`[JOIN] Długość talii gracza po inicjalizacji: ${player.library.length}`);
        console.log(`[JOIN] Długość ręki gracza po inicjalizacji: ${player.hand.length}`);
        session.players.push(player);
        socket.join(code);
        io.to(code).emit("updateState", session);
        console.log(`Gracz ${playerName} dołączył do sesji ${code}`);
    });
    // --- Akcje gry ---
    socket.on("startGame", ({ code, sessionType = "standard" }) => {
        const session = sessions[code];
        if (session) {
            session.players.forEach(player => {
                if (!player.initialDeck || player.initialDeck.length === 0) {
                    socket.emit("error", `Deck is empty for a player ${player.name}! Cannot start game.`);
                    return;
                }
                player.life = sessionType === "commander" ? 40 : 20;
                let deckToShuffle = [...player.initialDeck];
                let commanderCard;
                if (sessionType === "commander") {
                    // Zakładamy, że klient ustawił pierwszą kartę jako dowódcę
                    commanderCard = deckToShuffle.shift();
                    if (commanderCard) {
                        player.commander = commanderCard;
                        player.commanderZone = [commanderCard];
                    }
                    else {
                        socket.emit("error", `Commander card not found for player ${player.name}.`);
                        return;
                    }
                }
                else {
                    player.commander = undefined;
                    player.commanderZone = [];
                }
                player.library = shuffle(deckToShuffle);
                player.hand = [];
                player.battlefield = [];
                player.graveyard = [];
                for (let i = 0; i < 7 && player.library.length > 0; i++) {
                    const card = player.library.shift();
                    if (card)
                        player.hand.push(card);
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
    socket.on("resetPlayer", ({ code, playerId }) => {
        const session = sessions[code];
        if (!session)
            return;
        const player = session.players.find((p) => p.id === playerId);
        if (!player)
            return;
        // Przenieś wszystkie karty z ręki, pola walki, cmentarza i stref dowódcy do biblioteki
        const allCards = [
            ...player.hand,
            ...player.graveyard,
            ...player.exile, // Dodano Exile
            ...player.battlefield.map(cardOnField => cardOnField.card)
        ];
        let deckToShuffle = [...player.initialDeck];
        if (session.sessionType === "commander" && player.commander) {
            player.commanderZone = [player.commander];
            // Usuń kartę dowódcy z talii do tasowania
            deckToShuffle = deckToShuffle.filter(c => c.id !== player.commander?.id);
        }
        else {
            player.commanderZone = [];
        }
        player.hand = [];
        player.graveyard = [];
        player.exile = [];
        player.battlefield = [];
        player.library = shuffle([...deckToShuffle, ...allCards]);
        for (let i = 0; i < 7 && player.library.length > 0; i++) {
            const card = player.library.shift();
            if (card)
                player.hand.push(card);
        }
        io.to(code).emit("updateState", session);
        console.log(`Ręka gracza ${player.name} w sesji ${code} została zresetowana.`);
    });
    socket.on("draw", ({ code, playerId, count = 1 }) => {
        const session = sessions[code];
        const player = session?.players.find((p) => p.id === playerId);
        if (player) {
            for (let i = 0; i < count; i++) {
                const card = player.library.shift();
                if (card)
                    player.hand.push(card);
            }
            io.to(code).emit("updateState", session);
        }
    });
    socket.on("shuffle", ({ code, playerId }) => {
        const session = sessions[code];
        const player = session?.players.find((p) => p.id === playerId);
        if (player) {
            player.library = shuffle(player.library);
            io.to(code).emit("updateState", session);
        }
    });
    socket.on("changeLife", ({ code, playerId, newLife }) => {
        const session = sessions[code];
        const player = session?.players.find((p) => p.id === playerId);
        if (player) {
            player.life = newLife;
            io.to(code).emit("updateState", session);
        }
    });
    socket.on("moveCard", (payload) => {
        const { code, playerId, from, to, cardId, x, y } = payload;
        const session = sessions[code];
        if (!session)
            return;
        const player = session.players.find((p) => p.id === playerId);
        if (!player)
            return;
        if (from === "battlefield" && to === "battlefield") {
            const c = player.battlefield.find((b) => b.id === cardId);
            if (c) {
                c.x = typeof x === "number" ? x : c.x;
                c.y = typeof y === "number" ? y : c.y;
            }
        }
        else {
            let card;
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
                // Nowa strefa
                case "commanderZone":
                    card = removeFromZone(player.commanderZone, cardId);
                    break;
                default:
                    return;
            }
            if (!card)
                return;
            if (to === "battlefield") {
                const cardToPlace = card.card || card;
                const cardOnField = {
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
            }
            else {
                const cardToMove = card.card || card;
                // Użyj 'as CardType' do pewności, że typ jest poprawny
                player[to].push(cardToMove);
            }
        }
        io.to(code).emit("updateState", session);
    });
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
        if (!session)
            return;
        const player = session.players.find(p => p.id === playerId);
        if (!player)
            return;
        const card = player.battlefield.find(c => c.id === cardId);
        if (card) {
            card.rotation = card.rotation === 0 ? 90 : 0;
            io.to(code).emit('updateState', session);
            console.log(`Karta ${cardId} gracza ${playerId} w sesji ${code} została obrócona.`);
        }
    });
    socket.on("nextTurn", ({ code, playerId }) => {
        const session = sessions[code];
        if (!session)
            return;
        const player = session.players.find((p) => p.id === playerId);
        if (!player)
            return;
        player.battlefield.forEach((cardOnField) => {
            cardOnField.rotation = 0;
        });
        const card = player.library.shift();
        if (card) {
            player.hand.push(card);
        }
        session.turn += 1;
        const currentPlayerIndex = session.players.findIndex((p) => p.id === playerId);
        const nextPlayerIndex = (currentPlayerIndex) % session.players.length;
        const nextPlayer = session.players[nextPlayerIndex];
        session.activePlayer = nextPlayer.id;
        io.to(code).emit("updateState", session);
        console.log(`Tura gracza ${player.name} w sesji ${code} zakończona. Karty zresetowane, dobrano nową kartę.`);
    });
    socket.on("changeMana", ({ code, playerId, color, newValue, }) => {
        const session = sessions[code];
        if (!session)
            return;
        const player = session.players.find((p) => p.id === playerId);
        if (!player)
            return;
        if (Object.prototype.hasOwnProperty.call(player.manaPool, color)) {
            player.manaPool[color] = newValue;
            io.to(code).emit("updateState", session);
            console.log(`Mana dla gracza ${player.name} (${color}) zmieniona na ${newValue}.`);
        }
    });
    socket.on("changeCounters", ({ code, playerId, type, newValue }) => {
        const session = sessions[code];
        const player = session?.players.find((p) => p.id === playerId);
        if (player) {
            player.counters[type] = newValue;
            io.to(code).emit("updateState", session);
            console.log(`Zaktualizowano licznik '${type}' dla gracza ${player.name} na: ${newValue}`);
        }
    });
    socket.on("increment_card_stats", ({ code, playerId, cardId }) => {
        const session = sessions[code];
        if (!session)
            return;
        const player = session.players.find(p => p.id === playerId);
        if (!player)
            return;
        const cardOnField = player.battlefield.find(c => c.id === cardId);
        if (cardOnField) {
            cardOnField.stats.power += 1;
            cardOnField.stats.toughness += 1;
            io.to(code).emit("updateState", session);
            console.log(`Zwiększono statystyki karty ${cardId} dla gracza ${playerId}.`);
        }
    });
});
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Serwer działa na http://localhost:${PORT}`);
});
