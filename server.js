const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// Import deck logic (make sure it's compatible with CommonJS)
const { createDeck, COLORS, ROOK_CARD } = require('./src/deck.js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

// --- Game Constants ---
const NUM_PLAYERS = 4;
const CARDS_PER_PLAYER = 9;
const WIDOW_SIZE = 5;
const VALID_NUMBERS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

// --- Game State ---
// Rooms keyed by gameId: { players: WebSocket[], game: Game|null }
const rooms = new Map();

class Game {
    constructor() {
        this.state = 'waiting'; // waiting, bidding, reveal, discard, trump, play, score
        this.deck = this.filterDeck(createDeck());
        this.hands = [];
        this.widow = [];
        this.bids = Array(NUM_PLAYERS).fill(null);
        this.passed = Array(NUM_PLAYERS).fill(false);
        this.currentBidder = 0;
        this.widowOwner = null;
        this.discarded = [];
        this.widowHand = [];
        this.trumpSuit = null;
        this.trick = [];
        this.trickLeader = null;
        this.tricksWon = { 'Team A': [], 'Team B': [] };
        this.teamScores = { 'Team A': 0, 'Team B': 0 };
        this.deal();
        this.state = 'bidding';
    }

    // --- Deck & Dealing Logic ---
    filterDeck(deck) {
        return deck.filter(card => (card.number && VALID_NUMBERS.includes(card.number)) || card === ROOK_CARD);
    }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    deal() {
        this.shuffle(this.deck);
        this.hands = Array.from({ length: NUM_PLAYERS }, () => []);
        let deckIdx = 0;
        for (let i = 0; i < NUM_PLAYERS * CARDS_PER_PLAYER; i++) {
            this.hands[i % NUM_PLAYERS].push(this.deck[deckIdx++]);
        }
        this.widow = this.deck.slice(deckIdx, deckIdx + WIDOW_SIZE);
    }

    // --- Player Actions ---
    handleAction(playerIndex, action) {
        console.log(`Player ${playerIndex} action:`, action);
        switch (action.type) {
            case 'BID':
                if (this.state === 'bidding' && playerIndex === this.currentBidder) {
                    this.bids[playerIndex] = action.amount;
                    this.passed[playerIndex] = action.amount === null; // Pass if amount is null
                    this.nextBidder();
                }
                break;
            case 'CONTINUE_TO_DISCARD':
                if (this.state === 'reveal' && playerIndex === this.widowOwner) {
                    this.startDiscardPhase();
                }
                break;
            case 'DISCARD':
                if (this.state === 'discard' && playerIndex === this.widowOwner) {
                    this.handleDiscard(action.card);
                }
                break;
            case 'CHOOSE_TRUMP':
                if (this.state === 'trump' && playerIndex === this.widowOwner) {
                    this.trumpSuit = action.suit;
                    this.startPlayPhase();
                }
                break;
            case 'CHECK_200':
                // NOTE: sendToPlayer is room-scoped now; the caller should handle notifying the player.
                // This branch will only compute and return a result via a new message type handled outside.
                // We'll attach the result to the action for the outer handler to send.
                if ((this.state === 'discard' || this.state === 'trump') && playerIndex === this.widowOwner) {
                    const zeroOppPts = this.canForceZeroOpponentPoints(action.suit);
                    return { notify: zeroOppPts
                        ? `Opponents can be held to 0 points with trump ${action.suit}.`
                        : `Opponents may be able to score points with trump ${action.suit}.` };
                }
                break;
            case 'CALL_ROOK_COLOR':
                // The leader of the trick (who played the Rook) calls the color
                if (this.state === 'play' && playerIndex === this.trickLeader && this.trick.length === 1 && this.trick[0].card.name === 'Rook') {
                    this.trick[0].calledColor = action.color;
                    // After calling color, it's the next player's turn (player after trickLeader)
                }
                break;
            case 'PLAY_CARD':
                const currentPlayer = this.getCurrentPlayer();
                if (this.state === 'play' && playerIndex === currentPlayer) {
                    this.playCard(playerIndex, action.card);
                }
                break;
            case 'DEAL_AGAIN':
                if (this.state === 'score') {
                    // Start a new hand, preserving total scores
                    const oldScores = { ...this.teamScores };
                    game = new Game();
                    game.teamScores = oldScores;
                }
                break;
        }
    }

    // --- Phase Transitions & Game Flow ---
    nextBidder() {
        let activeBidders = this.passed.map((p, i) => !p ? i : null).filter(i => i !== null);
        if (activeBidders.length <= 1) {
            this.biddingActive = false;
            let highestBid = Math.max(...this.bids.map(b => b || 0));
            if (highestBid === 0) { // Everyone passed
                console.log("Everyone passed, redealing.");
                game = new Game(); // Restart
                return;
            }
            this.widowOwner = this.bids.indexOf(highestBid);
            this.state = 'reveal';
            return;
        }

        let next = (this.currentBidder + 1) % NUM_PLAYERS;
        while (this.passed[next]) {
            next = (next + 1) % NUM_PLAYERS;
        }
        this.currentBidder = next;
    }

    startDiscardPhase() {
        this.state = 'discard';
        this.widowHand = this.hands[this.widowOwner].concat(this.widow);
    }

    handleDiscard(cardToDiscard) {
        const hand = this.widowHand;
        const cardIndex = hand.findIndex(c => c.color === cardToDiscard.color && c.number === cardToDiscard.number);

        if (cardIndex > -1) {
            const [card] = hand.splice(cardIndex, 1);
            this.discarded.push(card);

            if (this.discarded.length === WIDOW_SIZE) {
                this.hands[this.widowOwner] = this.widowHand;
                this.state = 'trump';
            }
        }
    }

    startPlayPhase() {
        this.state = 'play';
        this.trickLeader = this.widowOwner;
    }

    getCurrentPlayer() {
        if (this.state !== 'play') return null;
        // If the first card of the trick is the Rook and no suit has been called yet,
        // it's still effectively the leader's turn to call a color. Do not advance.
        if (this.trick.length === 1 && this.trick[0].card && this.trick[0].card.name === 'Rook' && !this.trick[0].calledColor) {
            return this.trickLeader;
        }
        return (this.trickLeader + this.trick.length) % NUM_PLAYERS;
    }

    playCard(playerIndex, card) {
        const hand = this.hands[playerIndex];
        const cardIndex = hand.findIndex(c => c.color === card.color && c.number === card.number);

        // --- Rule Validation: Follow Suit ---
        if (this.trick.length > 0) {
            const ledCard = this.trick[0].card;
            // If Rook was led and color was called, that's the suit. Otherwise, it's the card's color.
            const ledSuit = this.trick[0].calledColor || ledCard.color;
            const playerHasLedSuit = hand.some(c => c.color === ledSuit);

            // If the player has the led suit, they must play it (or the Rook).
            // The card they chose is not of the led suit, and it's not the Rook.
            if (playerHasLedSuit && card.color !== ledSuit && card.name !== 'Rook') {
                console.log(`Player ${playerIndex} failed to follow suit. Move rejected.`);
                // Do not process the move. The client UI will remain unchanged.
                return;
            }
        }

        if (cardIndex > -1) {
            const [playedCard] = hand.splice(cardIndex, 1);
            this.trick.push({ player: playerIndex, card: playedCard });

            // If the Rook was just played, the turn pauses for the leader to call a color.
            // Don't check for a finished trick yet.
            if (playedCard.name === 'Rook' && this.trick.length === 1) {
                return; // Wait for CALL_ROOK_COLOR action
            }

            if (this.trick.length === NUM_PLAYERS) {
                this.finishTrick();
            }
        }
    }

    finishTrick() {
        let winningIdx = 0;
        let winningCard = this.trick[0].card;
        // The led suit is either the called color for a Rook, or the card's own color.
        const ledSuit = this.trick[0].calledColor || winningCard.color;
    let rookPlayed = this.trick.some(play => play.card === ROOK_CARD);

        if (rookPlayed) {
            winningIdx = this.trick.findIndex(play => play.card === ROOK_CARD);
        } else {
            for (let i = 1; i < this.trick.length; i++) {
                const currentCard = this.trick[i].card;

                // Rule 1: A trump card beats a non-trump card.
                if (currentCard.color === this.trumpSuit && winningCard.color !== this.trumpSuit) {
                    winningIdx = i;
                    winningCard = currentCard;
                } // Rule 2: If the winning card is not trump, a card of the led suit beats an off-suit card.
                else if (winningCard.color !== this.trumpSuit && currentCard.color === ledSuit && winningCard.color !== ledSuit) {
                    winningIdx = i;
                    winningCard = currentCard;
                } // Rule 3: If both cards are of the same suit (either trump or the led suit), the higher number wins.
                else if (currentCard.color === winningCard.color && currentCard.number > (winningCard.number || 0)) {
                    winningIdx = i;
                    winningCard = currentCard;
                }
            }
        }

        const winningPlayer = this.trick[winningIdx].player;
        const winningTeam = this.getTeam(winningPlayer);
        this.tricksWon[winningTeam].push([...this.trick]);
        this.trickLeader = winningPlayer;
        this.trick = [];

        if (this.hands.every(h => h.length === 0)) {
            this.scoreHand();
        }
    }

    scoreHand() {
        this.state = 'score';
        let teamPoints = { 'Team A': 0, 'Team B': 0 };
        for (const team of ['Team A', 'Team B']) {
            for (const trick of this.tricksWon[team]) {
                for (const play of trick) {
                    teamPoints[team] += this.getCardPoints(play.card);
                }
            }
        }

    const biddingTeam = this.getTeam(this.widowOwner);
        for (const card of this.discarded) {
            teamPoints[biddingTeam] += this.getCardPoints(card);
        }

        const otherTeam = biddingTeam === 'Team A' ? 'Team B' : 'Team A';
        const bidAmount = this.bids[this.widowOwner];
        let biddingTeamScore = teamPoints[biddingTeam];
        let otherTeamScore = teamPoints[otherTeam];

        if (biddingTeamScore >= bidAmount) {
            this.teamScores[biddingTeam] += biddingTeamScore;
        } else {
            this.teamScores[biddingTeam] -= bidAmount;
        }
        this.teamScores[otherTeam] += otherTeamScore;

        // We'll send the final scores and let the client render the message
        this.handResult = {
            biddingTeam,
            bidAmount,
            teamPoints,
        };
    }

    // --- Utility Functions ---
    getOwnerHandForCheck() {
        if (this.state === 'discard') return this.widowHand;
        return this.hands[this.widowOwner] || [];
    }

    canDeclare200(trumpSuit) {
        // Perfect-hand sufficient condition:
        // Hand must be exactly 9 cards and consist of either:
        //  - 9 trumps with ranks 6..14 (top 9 trumps), OR
        //  - Rook + 8 trumps with ranks 7..14 (top 8 trumps)
        const hand = this.getOwnerHandForCheck();
        if (!Array.isArray(hand) || hand.length !== 9) return false;

        const rookCount = hand.filter(c => c && c.name === 'Rook').length;
        const trumps = hand.filter(c => c && c.color === trumpSuit && typeof c.number === 'number').map(c => c.number).sort((a,b)=>a-b);

        if (rookCount === 0) {
            if (trumps.length !== 9) return false;
            // Must have exactly 6..14
            for (let n = 6; n <= 14; n++) {
                if (!trumps.includes(n)) return false;
            }
            return true;
        } else if (rookCount === 1) {
            if (trumps.length !== 8) return false;
            for (let n = 7; n <= 14; n++) {
                if (!trumps.includes(n)) return false;
            }
            return true;
        }
        return false;
    }

    canForceZeroOpponentPoints(trumpSuit) {
        // Strong sufficient condition: bidder team holds Rook and the top card (14) of every color,
        // including the 14 of trump. This ensures they can win any led suit and prevent any defender trick.
        const owner = this.widowOwner;
        if (owner == null) return false;
        const partner = (owner + 2) % NUM_PLAYERS;
        const ownerHand = this.state === 'discard' ? this.widowHand : this.hands[owner];
        const partnerHand = this.hands[partner] || [];
        const teamCards = [...(ownerHand || []), ...partnerHand];

        const hasRook = teamCards.some(c => c && c.name === 'Rook');
        if (!hasRook) return false;

        // Check 14s
        const colors = COLORS || ['Black','Red','Green','Yellow'];
        const hasTopInColor = (color) => teamCards.some(c => c && c.color === color && c.number === 14);
        for (const color of colors) {
            if (!hasTopInColor(color)) return false;
        }
        // Ensure trump 14 also present (covered by loop), and at least one trump available
        const hasAnyTrump = teamCards.some(c => c && c.color === trumpSuit);
        if (!hasAnyTrump) return false;

        return true;
    }
    getCardPoints(card) {
    if (card === ROOK_CARD || card.name === 'Rook') return 0; // Rook is worth 0
        if (card.number === 5) return 5;
        if (card.number === 10 || card.number === 14) return 10;
        return 0;
    }

    getTeam(playerIdx) {
        return (playerIdx % 2 === 0) ? 'Team A' : 'Team B';
    }

    // --- State for Clients ---
    getStateForPlayer(playerIndex) {
        // Determine if the widow should be visible to this player
        const isRevealPhase = this.state === 'reveal';
        const isDiscardPhaseForOwner = this.state === 'discard' && playerIndex === this.widowOwner;
        const showWidow = isRevealPhase || isDiscardPhaseForOwner;

        // Deep copy trick array so calledColor is always present for all players
        const trickForClient = this.trick.map(t => {
            return {
                ...t,
                calledColor: t.calledColor || null,
            };
        });

        // Derive the led suit for this trick (null when Rook led and color not called yet)
        let ledSuit = null;
        if (this.trick.length > 0) {
            const first = this.trick[0];
            if (first.card && first.card.name === 'Rook') {
                ledSuit = first.calledColor || null;
            } else if (first.card) {
                ledSuit = first.card.color || null;
            }
        }

        return {
            playerIndex,
            gameState: this.state,
            // Each player only sees their own hand. Others are just counts (card backs).
            allHands: this.hands.map((hand, i) => i === playerIndex ? hand : hand.map(() => ({}))),
            widow: showWidow ? this.widow : this.widow.map(() => ({})),
            bids: this.bids,
            passed: this.passed,
            currentBidder: this.currentBidder,
            widowOwner: this.widowOwner,
            widowHand: (this.state === 'discard' && playerIndex === this.widowOwner) ? this.widowHand : null,
            discarded: this.discarded,
            trumpSuit: this.trumpSuit,
            trick: trickForClient,
            ledSuit,
            trickLeader: this.trickLeader,
            currentPlayer: this.getCurrentPlayer(),
            // Prompt for color only if the first card played in a trick is the Rook, and a color hasn't been called yet.
            promptForRookColor: this.state === 'play' && this.trick.length === 1 && this.trick[0].card && this.trick[0].card.name === 'Rook' && !this.trick[0].calledColor && playerIndex === this.trickLeader,
            teamScores: this.teamScores,
            handResult: this.state === 'score' ? this.handResult : null,
        };
    }
}

// --- WebSocket Server Logic with Rooms ---
wss.on('connection', (ws, req) => {
    // Parse gameId from query string
    const url = new URL(req.url, 'http://localhost');
    const gameId = url.searchParams.get('game') || 'default';

    if (!rooms.has(gameId)) {
        rooms.set(gameId, { players: [], game: null, playerNames: [], botDifficulty: {} });
    }
    const room = rooms.get(gameId);

    if (room.players.length >= NUM_PLAYERS) {
        ws.send(JSON.stringify({ type: 'error', message: 'Game is full.' }));
        ws.close();
        return;
    }

    // Fill seats array up to NUM_PLAYERS for consistent indexing
    while (room.players.length < NUM_PLAYERS) room.players.push(null);
    const playerIndex = room.players.findIndex(p => p === null);
    if (playerIndex === -1) {
        ws.send(JSON.stringify({ type: 'error', message: 'Game is full.' }));
        ws.close();
        return;
    }
    room.players[playerIndex] = ws;
    // Initialize default name for this player index
    if (!room.playerNames[playerIndex]) {
        room.playerNames[playerIndex] = `Player ${playerIndex + 1}`;
    }
    console.log(`[${gameId}] Player ${playerIndex + 1} connected.`);

    ws.send(JSON.stringify({ type: 'welcome', playerIndex }));

    // Show lobby status; game starts when a client sends START_GAME
    broadcastPlayerCount(gameId);

    ws.on('message', (message) => {
        const r = rooms.get(gameId);
        if (!r) return;
        const action = JSON.parse(message);
        // Handle non-game actions (room-level)
        if (action.type === 'SET_NAME') {
            let name = (action.name || '').toString().trim();
            if (name.length > 16) name = name.slice(0, 16);
            if (!name) name = `Player ${playerIndex + 1}`;
            r.playerNames[playerIndex] = name;
            // Update waiting or in-game state so others see the new name
            if (r.game && r.game.state !== 'waiting') {
                broadcastGameState(gameId);
            } else {
                broadcastPlayerCount(gameId);
            }
            return;
        }
        if (action.type === 'ADD_BOT') {
            const difficulty = (action.difficulty || 'medium').toLowerCase();
            addBotToRoom(gameId, difficulty);
            return;
        }
        if (action.type === 'REPLACE_WITH_BOT') {
            const seat = Math.max(0, Math.min(NUM_PLAYERS - 1, parseInt(action.seat, 10)));
            const difficulty = (action.difficulty || 'medium').toLowerCase();
            replaceSeatWithBot(gameId, seat, difficulty);
            return;
        }
        if (action.type === 'ADD_BOT_AT_SEAT') {
            const seat = Math.max(0, Math.min(NUM_PLAYERS - 1, parseInt(action.seat, 10)));
            const difficulty = (action.difficulty || 'medium').toLowerCase();
            addBotAtSeat(gameId, seat, difficulty);
            return;
        }

        if (action.type === 'START_GAME') {
            const r2 = rooms.get(gameId);
            if (!r2) return;
            const occupied = r2.players.filter(Boolean).length;
            if (!r2.game && occupied === NUM_PLAYERS) {
                console.log(`[${gameId}] START_GAME received. Starting game.`);
                r2.game = new Game();
                broadcastGameState(gameId);
            } else {
                // Re-broadcast lobby in case a client needs refresh
                broadcastPlayerCount(gameId);
            }
            return;
        }

        if (!r.game) return;
        const result = r.game.handleAction(playerIndex, action);
        if (result && result.notify) {
            sendToPlayerInRoom(gameId, playerIndex, { type: 'notify', message: result.notify });
        }
        broadcastGameState(gameId);
    });

    ws.on('close', () => {
        console.log(`[${gameId}] Player ${playerIndex + 1} disconnected.`);
        const r = rooms.get(gameId);
        if (!r) return;
        // Mark this seat empty but preserve seating
        if (r.players[playerIndex] === ws) {
            r.players[playerIndex] = null;
        }
        // Reset the game on disconnect for simplicity
        r.game = null;
        broadcastPlayerCount(gameId);
        // Cleanup empty rooms
        if (r.players.filter(Boolean).length === 0) {
            rooms.delete(gameId);
            console.log(`[${gameId}] Room deleted (empty).`);
        }
    });
});

function broadcastGameState(gameId) {
    const room = rooms.get(gameId);
    if (!room || !room.game) return;
    const isBotArr = room.players.map(p => !!(p && p.isBot));
    const botDiffArr = Array.from({length: room.players.length}, (_, i) => room.botDifficulty[i] || null);
    room.players.forEach((ws, i) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'gameState', ...room.game.getStateForPlayer(i), playerNames: room.playerNames, isBot: isBotArr, botDifficulty: botDiffArr }));
        }
    });
    scheduleBotActions(gameId);
}

function sendToPlayerInRoom(gameId, index, payload) {
    const room = rooms.get(gameId);
    if (!room) return;
    const ws = room.players[index];
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

function broadcastPlayerCount(gameId) {
    const room = rooms.get(gameId);
    if (!room) return;
    const playerCount = room.players.filter(Boolean).length;
    const isBotArr = room.players.map(p => !!(p && p.isBot));
    const botDiffArr = Array.from({length: room.players.length}, (_, i) => room.botDifficulty[i] || null);
    room.players.forEach(ws => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'playerCount', count: playerCount, required: NUM_PLAYERS, playerNames: room.playerNames, isBot: isBotArr, botDifficulty: botDiffArr }));
        }
    });
}

// --- Bot Support ---
function addBotToRoom(gameId, difficulty = 'medium') {
    const room = rooms.get(gameId);
    if (!room) return;
    while (room.players.length < NUM_PLAYERS) room.players.push(null);
    const botIndex = room.players.findIndex(p => p === null);
    if (botIndex === -1) return;
    const botSocket = { isBot: true, readyState: WebSocket.OPEN, send: (_msg) => {} };
    room.players[botIndex] = botSocket;
    room.playerNames[botIndex] = `Bot ${botIndex + 1}`;
    room.botDifficulty[botIndex] = ['easy','medium','hard'].includes(difficulty) ? difficulty : 'medium';
    console.log(`[${gameId}] Bot added in slot ${botIndex + 1}.`);
    // Do not auto-start; wait for START_GAME
    broadcastPlayerCount(gameId);
}

function replaceSeatWithBot(gameId, seat, difficulty = 'medium') {
    const room = rooms.get(gameId);
    if (!room) return;
    if (room.game) return; // Only allow before game starts
    if (seat < 0 || seat >= NUM_PLAYERS) return;
    if (!room.players[seat]) return; // can't replace an empty seat that's not yet created
    const existing = room.players[seat];
    if (existing && existing.isBot) {
        // If it's already a bot, just update difficulty
        room.botDifficulty[seat] = ['easy','medium','hard'].includes(difficulty) ? difficulty : 'medium';
        broadcastPlayerCount(gameId);
        return;
    }
    // Replace human socket with a bot at the same index
    const botSocket = { isBot: true, readyState: WebSocket.OPEN, send: (_msg) => {} };
    room.players[seat] = botSocket;
    room.playerNames[seat] = `Bot ${seat + 1}`;
    room.botDifficulty[seat] = ['easy','medium','hard'].includes(difficulty) ? difficulty : 'medium';
    console.log(`[${gameId}] Replaced seat ${seat + 1} with a bot (${room.botDifficulty[seat]}).`);
    // Close the old connection (this should not affect the array as we already replaced it)
    try { existing && typeof existing.close === 'function' && existing.close(1000, 'Replaced by bot'); } catch {}
    // Do not auto-start; wait for START_GAME
    broadcastPlayerCount(gameId);
}

function addBotAtSeat(gameId, seat, difficulty = 'medium') {
    const room = rooms.get(gameId);
    if (!room) return;
    if (room.game) return; // Only allow before game starts
    while (room.players.length < NUM_PLAYERS) room.players.push(null);
    if (seat < 0 || seat >= NUM_PLAYERS) return;
    if (room.players[seat]) return; // seat already occupied
    const botSocket = { isBot: true, readyState: WebSocket.OPEN, send: (_msg) => {} };
    room.players[seat] = botSocket;
    room.playerNames[seat] = `Bot ${seat + 1}`;
    room.botDifficulty[seat] = ['easy','medium','hard'].includes(difficulty) ? difficulty : 'medium';
    console.log(`[${gameId}] Added bot at seat ${seat + 1} (${room.botDifficulty[seat]}).`);
    // Do not auto-start; wait for START_GAME
    broadcastPlayerCount(gameId);
}

function isBotPlayer(gameId, idx) {
    const room = rooms.get(gameId);
    if (!room) return false;
    const ws = room.players[idx];
    return !!(ws && ws.isBot);
}

function getBotDifficulty(gameId, idx) {
    const room = rooms.get(gameId);
    if (!room) return 'medium';
    return room.botDifficulty[idx] || 'medium';
}

function scheduleBotActions(gameId) {
    const room = rooms.get(gameId);
    if (!room || !room.game) return;
    const g = room.game;
    const delay = (ms, fn) => setTimeout(fn, ms);

    if (g.state === 'bidding') {
        const idx = g.currentBidder;
        if (isBotPlayer(gameId, idx)) {
            delay(600, () => {
                const amount = botChooseBid(g, idx, getBotDifficulty(gameId, idx));
                g.handleAction(idx, { type: 'BID', amount });
                broadcastGameState(gameId);
            });
        }
        return;
    }

    if (g.state === 'reveal') {
        const idx = g.widowOwner;
        if (isBotPlayer(gameId, idx)) {
            delay(600, () => {
                g.handleAction(idx, { type: 'CONTINUE_TO_DISCARD' });
                broadcastGameState(gameId);
            });
        }
        return;
    }

    if (g.state === 'discard') {
        const idx = g.widowOwner;
        if (isBotPlayer(gameId, idx)) {
            const need = 5 - g.discarded.length;
            if (need > 0) {
                delay(500, () => {
                    const card = botChooseDiscard(g, getBotDifficulty(gameId, idx));
                    if (card) {
                        g.handleAction(idx, { type: 'DISCARD', card });
                        broadcastGameState(gameId);
                    }
                });
            }
        }
        return;
    }

    if (g.state === 'trump') {
        const idx = g.widowOwner;
        if (isBotPlayer(gameId, idx)) {
            delay(600, () => {
                const suit = botChooseTrump(g, getBotDifficulty(gameId, idx));
                g.handleAction(idx, { type: 'CHOOSE_TRUMP', suit });
                broadcastGameState(gameId);
            });
        }
        return;
    }

    if (g.state === 'play') {
        // If leader played Rook and needs to call a color
        if (g.trick.length === 1 && g.trick[0].card && g.trick[0].card.name === 'Rook' && !g.trick[0].calledColor) {
            const idx = g.trickLeader;
            if (isBotPlayer(gameId, idx)) {
                delay(500, () => {
                    const color = botChooseColor(g, idx, getBotDifficulty(gameId, idx));
                    g.handleAction(idx, { type: 'CALL_ROOK_COLOR', color });
                    broadcastGameState(gameId);
                });
            }
            return;
        }
        const idx = g.getCurrentPlayer();
        if (idx != null && isBotPlayer(gameId, idx)) {
            delay(700, () => {
                const card = botChoosePlay(g, idx, getBotDifficulty(gameId, idx));
                if (card) {
                    g.handleAction(idx, { type: 'PLAY_CARD', card });
                    broadcastGameState(gameId);
                }
            });
        }
        return;
    }
}

// --- Bot Strategy Helpers (basic) ---
function botChooseBid(g, idx, difficulty = 'medium') {
    const hand = g.hands[idx];
    const pts = hand.reduce((sum, c) => sum + g.getCardPoints(c), 0);
    const rookBonus = hand.some(c => c.name === 'Rook') ? 15 : 0;
    const suitStrength = estimateBestSuitStrength(hand);
    let offset = 30;
    if (difficulty === 'easy') offset = 10;
    if (difficulty === 'hard') offset = 45;
    let target = pts + rookBonus + offset + Math.round(suitStrength * (difficulty === 'hard' ? 1.5 : difficulty === 'easy' ? 0.5 : 1));
    target = Math.max(70, Math.min(200, Math.round(target / 5) * 5));
    if (difficulty === 'easy') {
        if (pts < 60 || Math.random() < 0.4) return null;
    } else if (difficulty === 'medium') {
        if (pts < 40 && Math.random() < 0.6) return null;
    } else { // hard
        if (pts < 30 && Math.random() < 0.4) return null;
    }
    return target;
}

function botChooseTrump(g, difficulty = 'medium') {
    const idx = g.widowOwner;
    const hand = g.hands[idx] || [];
    const colors = ['Black','Red','Green','Yellow'];
    let best = 'Black', bestScore = -1;
    for (const color of colors) {
        const nums = hand.filter(c => c.color === color).map(c => c.number || 0);
        const scoreBase = nums.length * 2 + nums.filter(n => n >= 10).length * 2 + (nums.includes(14) ? 3 : 0);
        const score = scoreBase + (difficulty === 'hard' ? (nums.includes(13) ? 1 : 0) + (nums.includes(12) ? 1 : 0) : 0);
        if (score > bestScore) { bestScore = score; best = color; }
    }
    if (difficulty === 'easy') {
        // sometimes pick second-best
        if (Math.random() < 0.3) {
            const sorted = colors.map(c => {
                const nums = hand.filter(x => x.color === c).map(x => x.number || 0);
                return { c, s: nums.length * 2 + nums.filter(n => n >= 10).length * 2 + (nums.includes(14) ? 3 : 0) };
            }).sort((a,b)=>b.s-a.s);
            return sorted[1]?.c || best;
        }
    }
    return best;
}

function botChooseDiscard(g, difficulty = 'medium') {
    // Choose lowest-point cards, avoid Rook and likely trump (guess by majority color)
    const idx = g.widowOwner;
    const hand = g.widowHand.slice();
    const counts = countColors(hand);
    const probableTrump = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0] || null;
    hand.sort((a,b)=> (g.getCardPoints(a)-g.getCardPoints(b)) || ((a.number||0)-(b.number||0)) );
    for (const c of hand) {
        if (c.name === 'Rook') continue;
        if (difficulty !== 'easy') {
            if (probableTrump && c.color === probableTrump && (g.discarded.length < 4)) continue;
            // Avoid discarding high point cards if possible
            if (g.getCardPoints(c) >= 10 && hand.length > 6) continue;
        } else {
            if (probableTrump && c.color === probableTrump && (g.discarded.length < 3)) continue;
        }
        return c;
    }
    // fallback: first non-rook
    return hand.find(c => c.name !== 'Rook') || hand[0];
}

function botChooseColor(g, idx, difficulty = 'medium') {
    const hand = g.hands[idx] || [];
    const counts = countColors(hand);
    const best = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'Black';
    if (difficulty === 'easy' && Math.random() < 0.2) {
        // occasionally pick second best
        const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
        return sorted[1]?.[0] || best;
    }
    return best;
}

function botChoosePlay(g, idx, difficulty = 'medium') {
    const hand = g.hands[idx];
    if (!hand || hand.length === 0) return null;
    const trick = g.trick;
    if (trick.length === 0) {
        // Lead lowest non-trump if possible, avoid Rook early
        const nonRook = hand.filter(c => c.name !== 'Rook');
        nonRook.sort((a,b)=> (a.number||0)-(b.number||0));
        if (difficulty === 'hard') {
            // try to lead a strong suit (>=12) if available
            const strong = nonRook.filter(c => (c.number||0) >= 12);
            if (strong.length) return strong[0];
        }
        if (difficulty === 'easy' && Math.random() < 0.3) {
            // random legal card
            return nonRook[Math.floor(Math.random()*nonRook.length)] || hand[0];
        }
        return nonRook[0] || hand[0];
    }
    const ledSuit = trick[0].calledColor || trick[0].card.color;
    const inSuit = hand.filter(c => c.color === ledSuit && c.name !== 'Rook');
    if (inSuit.length > 0) {
        if (difficulty === 'hard') {
            // try to win cheaply: play lowest that still beats current winning
            const currentWinning = getCurrentWinningCard(g, ledSuit);
            const beaters = inSuit.filter(c => c.number > (currentWinning?.number || 0)).sort((a,b)=> (a.number||0)-(b.number||0));
            if (beaters.length) return beaters[0];
        }
        inSuit.sort((a,b)=> (a.number||0)-(b.number||0));
        if (difficulty === 'easy' && Math.random() < 0.3) return inSuit[Math.floor(Math.random()*inSuit.length)];
        return inSuit[0];
    }
    // If no led suit, try lowest trump else lowest overall (avoid rook unless last)
    const trumps = hand.filter(c => c.color === g.trumpSuit && c.name !== 'Rook');
    if (trumps.length > 0) {
        if (difficulty === 'hard') {
            // if can win trick with low trump, play lowest trump; else slough lowest
            const currentWinning = getCurrentWinningCard(g, ledSuit);
            const beaters = trumps.filter(c => currentWinning && (currentWinning.color !== g.trumpSuit || c.number > (currentWinning.number||0)) ).sort((a,b)=> (a.number||0)-(b.number||0));
            if (beaters.length) return beaters[0];
        }
        trumps.sort((a,b)=> (a.number||0)-(b.number||0));
        if (difficulty === 'easy' && Math.random() < 0.3) return trumps[Math.floor(Math.random()*trumps.length)];
        return trumps[0];
    }
    const nonRook = hand.filter(c => c.name !== 'Rook');
    nonRook.sort((a,b)=> (a.number||0)-(b.number||0));
    if (difficulty === 'easy' && Math.random() < 0.3) return nonRook[Math.floor(Math.random()*nonRook.length)] || hand[0];
    return nonRook[0] || hand[0];
}

function countColors(hand) {
    const counts = { Black:0, Red:0, Green:0, Yellow:0 };
    for (const c of hand) { if (c && c.color && counts.hasOwnProperty(c.color)) counts[c.color]++; }
    return counts;
}

function estimateBestSuitStrength(hand) {
    const colors = ['Black','Red','Green','Yellow'];
    let best = 0;
    for (const color of colors) {
        const nums = hand.filter(c => c.color === color).map(c => c.number || 0);
        const score = nums.length * 2 + nums.filter(n => n >= 10).length * 2 + (nums.includes(14) ? 3 : 0);
        if (score > best) best = score;
    }
    return best;
}

function getCurrentWinningCard(g, ledSuit) {
    // Compute current winning card for the trick under rook/trump rules
    let winning = g.trick[0].card;
    let winningSuit = g.trick[0].calledColor || winning.color;
    for (let i = 1; i < g.trick.length; i++) {
        const c = g.trick[i].card;
        if (c.color === g.trumpSuit && winning.color !== g.trumpSuit) {
            winning = c; winningSuit = c.color; continue;
        }
        if (winning.color !== g.trumpSuit && c.color === ledSuit && winning.color !== ledSuit) {
            winning = c; winningSuit = c.color; continue;
        }
        if (c.color === winning.color && (c.number||0) > (winning.number||0)) {
            winning = c; winningSuit = c.color; continue;
        }
    }
    return winning;
}

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

server.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const ifaces = os.networkInterfaces();
    let localIps = [];
    Object.values(ifaces).forEach(ifaceArr => {
        ifaceArr.forEach(iface => {
            if (iface.family === 'IPv4' && !iface.internal) {
                localIps.push(iface.address);
            }
        });
    });
    console.log(`Server is listening on:`);
    localIps.forEach(ip => console.log(`  http://${ip}:${PORT}`));
    console.log(`(Accessible from other devices on your network)`);
});

// Make deck.js compatible with require()
module.exports.createDeck = createDeck;
module.exports.COLORS = COLORS;
module.exports.ROOK_CARD = ROOK_CARD;