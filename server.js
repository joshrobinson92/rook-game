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
let players = [];
let game = null;

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
                // Allow check during discard or trump by widowOwner
                if ((this.state === 'discard' || this.state === 'trump') && playerIndex === this.widowOwner) {
                    const zeroOppPts = this.canForceZeroOpponentPoints(action.suit);
                    const msg = zeroOppPts
                        ? `Opponents can be held to 0 points with trump ${action.suit}.`
                        : `Opponents may be able to score points with trump ${action.suit}.`;
                    sendToPlayer(playerIndex, { type: 'notify', message: msg });
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
        if (card === ROOK_CARD || card.name === 'Rook') return 20; // Rook is worth 20
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

// --- WebSocket Server Logic ---
wss.on('connection', (ws) => {
    if (players.length >= NUM_PLAYERS) {
        ws.send(JSON.stringify({ type: 'error', message: 'Game is full.' }));
        ws.close();
        return;
    }

    const playerIndex = players.length;
    players.push(ws);
    console.log(`Player ${playerIndex + 1} connected.`);

    ws.send(JSON.stringify({ type: 'welcome', playerIndex }));

    // Start game when full
    if (players.length === NUM_PLAYERS) {
        console.log('All players connected. Starting game.');
        game = new Game();
        broadcastGameState();
    } else {
        broadcastPlayerCount();
    }

    ws.on('message', (message) => {
        if (!game) return;
        const action = JSON.parse(message);
        game.handleAction(playerIndex, action);
        broadcastGameState();
    });

    ws.on('close', () => {
        console.log(`Player ${playerIndex + 1} disconnected.`);
        // Simple reset for now. A real implementation would handle reconnects.
        players = [];
        game = null;
        console.log('Game reset due to disconnection.');
        broadcastPlayerCount();
    });
});

function broadcastGameState() {
    if (!game) return;
    players.forEach((ws, i) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'gameState', ...game.getStateForPlayer(i) }));
        }
    });
}

function sendToPlayer(index, payload) {
    const ws = players[index];
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

function broadcastPlayerCount() {
    const playerCount = players.length;
    players.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'playerCount', count: playerCount, required: NUM_PLAYERS }));
        }
    });
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