const gameDiv = document.getElementById('game');
const settingsBar = document.getElementById('settings-bar');

// --- Settings Bar Logic ---
window.addEventListener('DOMContentLoaded', () => {
    const cardSlider = document.getElementById('card-size-slider');
    const stackedToggle = document.getElementById('stacked-toggle');
    const nameInput = document.getElementById('player-name-input');
    if (cardSlider) {
        cardSlider.value = window.localStorage.getItem('cardSize') || '60';
        cardSlider.addEventListener('input', e => {
            window.localStorage.setItem('cardSize', e.target.value);
            document.documentElement.style.setProperty('--card-width', `${e.target.value}px`);
            document.documentElement.style.setProperty('--card-height', `${Math.round(e.target.value*1.5)}px`);
            if (window.lastState) render(window.lastState);
        });
    }
    if (stackedToggle) {
        stackedToggle.checked = window.localStorage.getItem('stackedHand') === 'true';
        stackedToggle.addEventListener('change', e => {
            window.localStorage.setItem('stackedHand', e.target.checked ? 'true' : 'false');
            if (window.lastState) render(window.lastState);
        });
    }
    if (nameInput) {
        nameInput.value = window.localStorage.getItem('playerName') || '';
        nameInput.addEventListener('input', e => {
            const val = e.target.value.trim();
            window.localStorage.setItem('playerName', val);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'SET_NAME', name: val }));
            }
            if (window.lastState) render(window.lastState);
        });
    }
});
let myPlayerIndex = null;
let selectedCard = null;
let ws = null;
let currentGameId = null;

function connectToGame(gameId) {
    currentGameId = gameId;
    // Build WebSocket URL supporting Render/HTTPS and game rooms via ?game=ID
    const isSecure = window.location.protocol === 'https:';
    const proto = isSecure ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${window.location.host}/?game=${encodeURIComponent(gameId)}`);

    ws.onopen = () => {
        console.log('Connected to the server.');
        gameDiv.innerHTML = '<h2>Waiting for server...</h2>';
        const initialName = window.localStorage.getItem('playerName');
        if (initialName) {
            ws.send(JSON.stringify({ type: 'SET_NAME', name: initialName }));
        }
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('Received from server:', data);

        switch (data.type) {
            case 'welcome':
                myPlayerIndex = data.playerIndex;
                break;
            case 'playerCount':
                const canStart = (data.count >= 4);
                gameDiv.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <div>
                            <h2 style="margin:0;">Game ID: ${currentGameId}</h2>
                            <h3 style="margin:4px 0 0 0;">Waiting for players... ${data.count}/${data.required}</h3>
                        </div>
                        <div>
                            ${canStart ? '<button id="start-game-btn" style="padding:8px 12px;border-radius:6px;border:0;background:#4caf50;color:#fff;cursor:pointer;">Start Game</button>' : ''}
                        </div>
                    </div>
                    ${renderSeatControls(data)}
                `;
                wireLobbyControls(data);
                break;
            case 'gameState':
                // Ensure settings bar is shown once in a game
                if (settingsBar) settingsBar.style.display = '';
                render(data);
                break;
            case 'error':
                gameDiv.innerHTML = `<h2>Error: ${data.message}</h2>`;
                break;
            case 'notify':
                // Show notification if dedicated area exists; otherwise log it
                const notifyEl = document.getElementById('notify-area');
                if (notifyEl) notifyEl.textContent = data.message;
                break;
        }
    };

    ws.onclose = () => {
        console.log('Disconnected from the server.');
        gameDiv.innerHTML = '<h2>Disconnected. Please refresh to rejoin.</h2>';
    };
}

function sendAction(action) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(action));
    }
}

function renderWaitingList(playerNames = []) {
    const names = (playerNames || []).map((n, i) => n || `Player ${i + 1}`);
    if (!names.length) return '';
    return `
        <div style="margin-top:10px; font-size:14px; color:#ccc;">
            Players: ${names.map(n => `<span style='display:inline-block;margin-right:8px;'>${n}</span>`).join('')}
        </div>
    `;
}

function renderSeatControls(data) {
    const names = data.playerNames || [];
    const isBot = data.isBot || [];
    const botDifficulty = data.botDifficulty || [];
    const seats = Array.from({ length: 4 }, (_, i) => i);
    const seatRow = seats.map(i => {
        const status = names[i] ? (isBot[i] ? 'Bot' : 'Human') : 'Empty';
        const diff = botDifficulty[i] || 'medium';
        const controls = status === 'Empty' ? `
            <select class="seat-diff" data-seat="${i}" style="padding:6px;border-radius:6px;border:1px solid #444;background:#111;color:#eee;">
                <option value="easy">Easy</option>
                <option value="medium" ${diff==='medium'?'selected':''}>Medium</option>
                <option value="hard" ${diff==='hard'?'selected':''}>Hard</option>
            </select>
            <button class="seat-add-bot" data-seat="${i}" style="padding:6px 10px;border-radius:6px;border:0;background:#795548;color:#fff;cursor:pointer;">Add Bot</button>
        ` : (isBot[i] ? `<span style="font-size:12px;color:#bbb;">${diff[0].toUpperCase()+diff.slice(1)}</span>` : `
            <select class="seat-diff" data-seat="${i}" style="padding:6px;border-radius:6px;border:1px solid #444;background:#111;color:#eee;">
                <option value="easy">Easy</option>
                <option value="medium" ${diff==='medium'?'selected':''}>Medium</option>
                <option value="hard" ${diff==='hard'?'selected':''}>Hard</option>
            </select>
            <button class="seat-replace-bot" data-seat="${i}" style="padding:6px 10px;border-radius:6px;border:0;background:#9e9e9e;color:#111;cursor:pointer;">Replace with Bot</button>
        `);
        return `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#222;border-radius:8px;">
                <div><strong>Seat ${i+1}:</strong> ${names[i] || '—'} <span style="color:#aaa">(${status})</span></div>
                <div>${controls}</div>
            </div>
        `;
    }).join('');
    return `
        <div style="margin-top:10px; display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:8px;">
            ${seatRow}
        </div>
    `;
}

function wireLobbyControls(_data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const startBtn = document.getElementById('start-game-btn');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            ws.send(JSON.stringify({ type: 'START_GAME' }));
        });
    }
    document.querySelectorAll('.seat-add-bot').forEach(btn => {
        btn.addEventListener('click', () => {
            const seat = parseInt(btn.dataset.seat, 10);
            const sel = document.querySelector(`.seat-diff[data-seat="${seat}"]`);
            const diff = (sel && sel.value) || 'medium';
            ws.send(JSON.stringify({ type: 'ADD_BOT_AT_SEAT', seat, difficulty: diff }));
        });
    });
    document.querySelectorAll('.seat-replace-bot').forEach(btn => {
        btn.addEventListener('click', () => {
            const seat = parseInt(btn.dataset.seat, 10);
            const sel = document.querySelector(`.seat-diff[data-seat="${seat}"]`);
            const diff = (sel && sel.value) || 'medium';
            ws.send(JSON.stringify({ type: 'REPLACE_WITH_BOT', seat, difficulty: diff }));
        });
    });
}

function renderLanding() {
    if (settingsBar) settingsBar.style.display = 'none';
    const suggested = generateGameId();
    gameDiv.innerHTML = `
        <div class="landing" style="max-width:520px;margin:24px auto;padding:16px;border-radius:10px;background:#1f1f1f;color:#eee;">
            <h2 style="margin-top:0">Start or Join a Game</h2>
            <div style="margin:12px 0;padding:12px;background:#2a2a2a;border-radius:8px;">
                <div style="margin-bottom:8px;font-weight:600;">Create Game</div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <input id="create-game-id" type="text" value="${suggested}" maxlength="24" style="flex:1;padding:8px;border-radius:6px;border:1px solid #444;background:#111;color:#eee;">
                    <button id="create-game-btn" style="padding:8px 12px;border-radius:6px;border:0;background:#4caf50;color:#fff;cursor:pointer;">Create</button>
                </div>
                <div style="font-size:12px;color:#aaa;margin-top:6px;">Use the suggested ID or enter your own (share this with friends).</div>
                <div id="share-row" style="margin-top:8px; display:none; align-items:center; gap:8px;">
                    <input id="share-link" type="text" readonly style="flex:1;padding:8px;border-radius:6px;border:1px solid #444;background:#111;color:#eee;">
                    <button id="copy-link-btn" style="padding:8px 12px;border-radius:6px;border:0;background:#9c27b0;color:#fff;cursor:pointer;">Copy Link</button>
                </div>
            </div>
            <div style="margin:12px 0;padding:12px;background:#2a2a2a;border-radius:8px;">
                <div style="margin-bottom:8px;font-weight:600;">Join Game</div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <input id="join-game-id" type="text" placeholder="Enter Game ID" maxlength="24" style="flex:1;padding:8px;border-radius:6px;border:1px solid #444;background:#111;color:#eee;">
                    <button id="join-game-btn" style="padding:8px 12px;border-radius:6px;border:0;background:#2196f3;color:#fff;cursor:pointer;">Join</button>
                </div>
            </div>
        </div>
    `;

    const createBtn = document.getElementById('create-game-btn');
    const createInput = document.getElementById('create-game-id');
    const joinBtn = document.getElementById('join-game-btn');
    const joinInput = document.getElementById('join-game-id');

    const goTo = (id) => {
        const clean = (id || '').trim();
        if (!clean) return;
        const url = new URL(window.location.href);
        url.searchParams.set('game', clean);
        window.location.href = url.toString();
    };

    createBtn.onclick = () => goTo(createInput.value);
    joinBtn.onclick = () => goTo(joinInput.value);

    // Show share link for convenience when focusing Create Game
    createInput.addEventListener('input', () => updateShareRow());
    createInput.addEventListener('focus', () => updateShareRow());
    function updateShareRow() {
        const clean = (createInput.value || '').trim();
        const row = document.getElementById('share-row');
        const shareInput = document.getElementById('share-link');
        if (!clean) { row.style.display = 'none'; return; }
        const u = new URL(window.location.href);
        u.searchParams.set('game', clean);
        shareInput.value = u.toString();
        row.style.display = 'flex';
    }
    const copyBtn = document.getElementById('copy-link-btn');
    copyBtn.onclick = async () => {
        const shareInput = document.getElementById('share-link');
        try {
            await navigator.clipboard.writeText(shareInput.value);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => copyBtn.textContent = 'Copy Link', 1200);
        } catch (e) {
            shareInput.select();
            document.execCommand('copy');
            copyBtn.textContent = 'Copied!';
            setTimeout(() => copyBtn.textContent = 'Copy Link', 1200);
        }
    };
}

function generateGameId() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    const pick = (src, n) => Array.from({length:n},()=>src[Math.floor(Math.random()*src.length)]).join('');
    return `${pick(letters,4)}-${pick(digits,2)}${pick(letters,1)}`;
}

// Entry: decide whether to show landing or connect
(() => {
    const params = new URLSearchParams(window.location.search);
    const gid = params.get('game');
    if (gid) {
        connectToGame(gid);
    } else {
        renderLanding();
    }
})();

// --- Rendering Logic ---
function groupAndSortHand(hand) {
    // Group by color, sort each group descending by number, Rook last
    const colorOrder = ['Black', 'Red', 'Green', 'Yellow'];
    const groups = {};
    colorOrder.forEach(color => { groups[color] = []; });
    const rookCards = [];
    hand.forEach(card => {
        if (card.name === 'Rook') {
            rookCards.push(card);
        } else if (groups[card.color]) {
            groups[card.color].push(card);
        }
    });
    // Sort each color group descending
    let sorted = [];
    colorOrder.forEach(color => {
        groups[color].sort((a, b) => b.number - a.number);
        sorted = sorted.concat(groups[color]);
    });
    // Rook at the end
    sorted = sorted.concat(rookCards);
    return sorted;
}

function getCardId(card) {
    if (!card) return '';
    if (card.name === 'Rook') return 'Rook';
    return `${card.color}-${card.number}`;
}

function renderCard(card) {
    if (!card) return '';
    if (!card.color) return `<div class="card card-back"></div>`; // Face-down card
    if (card.name === 'Rook') return `<div class="card special" data-cardid="Rook">Rook</div>`;
    return `<div class="card" data-cardid="${getCardId(card)}" style="border-color:${card.color.toLowerCase()};">${card.number}<br>${card.color}</div>`;
}

function getTeam(playerIdx) {
    return (playerIdx % 2 === 0) ? 'Team A' : 'Team B';
}

let lastState = null; // Cache the last state for re-rendering
function render(state) {
    const names = state.playerNames || [];
    const getPlayerName = (idx) => names[idx] || `Player ${idx + 1}`;
    lastState = state; window.lastState = state;
    let html = '';

    // Get settings
    const stacked = window.localStorage.getItem('stackedHand') === 'true';
    const cardSize = window.localStorage.getItem('cardSize') || '60';
    document.documentElement.style.setProperty('--card-width', `${cardSize}px`);
    document.documentElement.style.setProperty('--card-height', `${Math.round(cardSize*1.5)}px`);

    // In-game header with share link
    html += `
        <div class="ingame-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
            <div>Game ID: <strong>${currentGameId || ''}</strong></div>
            <div style="display:flex;gap:6px;align-items:center;">
                <input id="ingame-share" type="text" readonly value="${buildShareUrl(currentGameId)}" style="width:240px;padding:6px;border-radius:6px;border:1px solid #444;background:#111;color:#eee;">
                <button id="ingame-copy" style="padding:6px 10px;border-radius:6px;border:0;background:#9c27b0;color:#fff;cursor:pointer;">Copy Link</button>
            </div>
        </div>
        <div class="scores">
            <strong>Scores:</strong> 
            Team A: ${state.teamScores['Team A']} | 
            Team B: ${state.teamScores['Team B']}
        </div>
    `;

    function handClass() {
        return stacked ? 'hand stacked-hand' : 'hand';
    }

    switch (state.gameState) {
        case 'bidding':
            html += `<h2>Bidding Phase</h2>`;
            html += `<div class="widow">${state.widow.map(renderCard).join('')}</div>`; // Show card backs
            html += state.allHands.map((hand, i) => `
                <div class="player-area ${i === state.currentBidder ? 'active-player' : ''}">
                        <strong>${getPlayerName(i)}${i === myPlayerIndex ? ' (You)' : ''}</strong> (${getTeam(i)})
                    ${i === myPlayerIndex ? `<div class="hand">${groupAndSortHand(hand).map(renderCard).join('')}</div>` : `<div>${hand.length} cards</div>`}
                    <div>Bid: ${state.bids[i] !== null ? state.bids[i] : (state.passed[i] ? 'Passed' : '—')}</div>
                </div>
            `).join('');

            if (state.currentBidder === myPlayerIndex) {
                html += `<div class="bidding">Your Bid: 
                    ${[...Array(21).keys()].map(i => i * 5).map(bid => `<button class="bid-btn" data-bid="${bid}">${bid}</button>`).join('')}
                    <button class="pass-btn">Pass</button>
                </div>`;
            }
            break;

        case 'reveal':
            html += `<h2>Bid Won!</h2>`;
            html += `<div><strong>Player ${state.widowOwner + 1}</strong> wins with <strong>${state.bids[state.widowOwner]}</strong>.</div>`;
            html += `<p>Widow:</p><div class="widow">${state.widow.map(renderCard).join('')}</div>`;
            html += state.allHands.map((hand, i) => `
                <div class="player-area">
                        <strong>${getPlayerName(i)}${i === myPlayerIndex ? ' (You)' : ''}</strong> (${getTeam(i)})
                    ${i === myPlayerIndex ? `<div class="hand">${groupAndSortHand(hand).map(renderCard).join('')}</div>` : `<div>${hand.length} cards</div>`}
                    <div>Bid: ${state.bids[i] !== null ? state.bids[i] : (state.passed[i] ? 'Passed' : '—')}</div>
                </div>
            `).join('');
            if (state.widowOwner === myPlayerIndex) {
                html += `<button id="continue-btn">Continue to Discard</button>`;
            }
            break;

        case 'discard':
            html += `<h2>Discard Phase</h2>`;
            html += `<div><strong>Player ${state.widowOwner + 1}, discard 5 cards.</strong></div>`;
            html += `<div>Discarded: <div class="hand">${state.discarded.map(renderCard).join('')}</div></div>`;
            // The discard UI is now self-contained and handled by its event listener.
            if (state.widowOwner === myPlayerIndex) {
                html += `<div class="hand discard-hand">${groupAndSortHand(state.widowHand).map(renderCard).join('')}</div>`;
                html += `<button id="confirm-discard-btn" style="display: none;">Confirm Discard</button>`;
                // Optional: Check if a 200 bid is possible with a given suit
                html += `<div class="check-200-controls" style="margin-top:10px;">
                    <div><strong>Check if 200 is possible (after discard):</strong></div>
                    ${['Black','Red','Green','Yellow'].map(s=>`<button class="check-200" data-suit="${s}">Check ${s}</button>`).join(' ')}
                    <div id="notify-area" style="margin-top:6px; color:#ffd54f;"></div>
                </div>`;
            }
            break;

        case 'trump':
            html += `<h2>Choose Trump</h2>`;
            if (state.widowOwner === myPlayerIndex) {
                html += `<div>Please choose a trump suit:</div>`;
                html += ['Black', 'Red', 'Green', 'Yellow'].map(c => `<button class="trump-btn" data-suit="${c}">${c}</button>`).join(' ');
                // Also allow checking 200 possibility here
                html += `<div class="check-200-controls" style="margin-top:10px;">
                    <div><strong>Check if 200 is possible:</strong></div>
                    ${['Black','Red','Green','Yellow'].map(s=>`<button class="check-200" data-suit="${s}">Check ${s}</button>`).join(' ')}
                    <div id="notify-area" style="margin-top:6px; color:#ffd54f;"></div>
                </div>`;
            } else {
                html += `<div>Waiting for Player ${state.widowOwner + 1} to choose trump.</div>`;
            }
            break;

        case 'play':
            html += `<h2>Play Phase</h2>`;
            html += `<div>Trump: <strong>${state.trumpSuit}</strong></div>`;
            // Trick display with team label above each played card
            const trickCards = state.trick.map(p => `
                <div class="trick-card">
                    <div class="card-team">${getTeam(p.player)}</div>
                    ${renderCard(p.card)}
                </div>
            `).join('');
            html += `<div>Trick: <div class="trick">${trickCards}</div>`;
            // Universal led-suit banner so everyone sees what to follow (server-derived)
            if (state.trick.length > 0) {
                if (state.ledSuit) {
                    const rookLed = state.trick[0].card && state.trick[0].card.name === 'Rook';
                    html += `<div class="called-color-notice">Led Suit: <strong>${state.ledSuit}</strong>${rookLed ? ' (Rook called)' : ''}</div>`;
                } else {
                    // No ledSuit yet: Rook was led but leader hasn't called
                    html += `<div class="called-color-notice">Leader is calling a suit for the Rook...</div>`;
                }
            }
            html += `</div>`;

            html += state.allHands.map((hand, i) => `
                <div class="player-area ${i === state.currentPlayer ? 'active-player' : ''}">
                        <strong>${getPlayerName(i)}${i === myPlayerIndex ? ' (You)' : ''}</strong>
                    ${ i === myPlayerIndex ? 
                        `<div class="hand play-hand">${groupAndSortHand(hand).map(renderCard).join('')}</div>
                         <button id="play-card-btn" style="display: none;">Play Card</button>` 
                        : 
                        `<div>${hand.length} cards</div>`
                    }
                </div>
            `).join('');

            // Add prompt for Rook color call if needed (only for leader)
            if (state.promptForRookColor) {
                html += `<div><strong>You led the Rook! Call a suit:</strong></div>`;
                html += ['Black', 'Red', 'Green', 'Yellow']
                    .map(c => `<button class="call-color-btn" data-color="${c}">${c}</button>`)
                    .join(' ');
            }
            break;

        case 'post_trick':
            html += `<h2>Trick Complete</h2>`;
            html += `<div>Trump: <strong>${state.trumpSuit}</strong></div>`;
            const trickCards2 = state.trick.map(p => `
                <div class="trick-card">
                    <div class="card-team">${getTeam(p.player)}</div>
                    ${renderCard(p.card)}
                </div>
            `).join('');
            html += `<div>Trick: <div class="trick">${trickCards2}</div>`;
            if (state.ledSuit) {
                const rookLed = state.trick[0].card && state.trick[0].card.name === 'Rook';
                html += `<div class="called-color-notice">Led Suit: <strong>${state.ledSuit}</strong>${rookLed ? ' (Rook called)' : ''}</div>`;
            }
            html += `</div>`;
            if (myPlayerIndex === 0) {
                html += `<button id="next-trick-btn" style="margin-top:8px;padding:8px 12px;border-radius:6px;border:0;background:#4caf50;color:#fff;cursor:pointer;">Next Trick</button>`;
            } else {
                html += `<div style="margin-top:8px;color:#ccc;">Waiting for Player 1 to continue…</div>`;
            }
            break;

        case 'score':
            const { biddingTeam, bidAmount, teamPoints } = state.handResult;
            const otherTeam = biddingTeam === 'Team A' ? 'Team B' : 'Team A';
            let resultMsg = '';
            if (teamPoints[biddingTeam] >= bidAmount) {
                resultMsg = `${biddingTeam} made their bid!`;
            } else {
                resultMsg = `${biddingTeam} FAILED their bid!`;
            }
            html += `<h2>Hand Over</h2>`;
            html += `<div>${resultMsg}</div>`;
            html += `<div><strong>Hand Points:</strong> Team A: ${teamPoints['Team A']}, Team B: ${teamPoints['Team B']}</div>`;
            html += `<button id="deal-again-btn">Deal Again</button>`;
            break;

        case 'game_over':
            html += `<h2>Game Over</h2>`;
            const winner = state.matchWinner === 'Tie' ? 'It\'s a tie!' : `${state.matchWinner} wins!`;
            html += `<div style="margin:6px 0;">${winner}</div>`;
            html += `<div><strong>Final Scores:</strong> Team A: ${state.teamScores['Team A']}, Team B: ${state.teamScores['Team B']}</div>`;
            html += `<button id="deal-again-btn">Play Again</button>`;
            break;
    }

    gameDiv.innerHTML = html;
    addEventListeners(state);
}

function addEventListeners(state) {
    if (state.gameState === 'bidding' && state.currentBidder === myPlayerIndex) {
        document.querySelectorAll('.bid-btn').forEach(btn => {
            btn.onclick = () => sendAction({ type: 'BID', amount: parseInt(btn.dataset.bid) });
        });
        document.querySelector('.pass-btn').onclick = () => sendAction({ type: 'BID', amount: null });
    }

    // Lobby: add bot button handler
    // No-op: lobby handlers are attached during playerCount rendering via wireLobbyControls

    if (state.gameState === 'reveal' && state.widowOwner === myPlayerIndex) {
        document.getElementById('continue-btn').onclick = () => sendAction({ type: 'CONTINUE_TO_DISCARD' });
    }

    // --- New, Self-Contained Discard Logic ---
    if (state.gameState === 'discard' && state.widowOwner === myPlayerIndex) {
        const discardBtn = document.getElementById('confirm-discard-btn');
        const handCards = document.querySelectorAll('.discard-hand .card');

        handCards.forEach(cardDiv => {
            cardDiv.onclick = () => {
                // Set the selected card object from the full hand data
                const cardId = cardDiv.dataset.cardid;
                selectedCard = lastState.widowHand.find(c => getCardId(c) === cardId);

                // Update UI
                handCards.forEach(c => c.classList.remove('selected-card'));
                cardDiv.classList.add('selected-card');
                discardBtn.style.display = 'inline-block';
            };
        });

        discardBtn.onclick = () => {
            if (selectedCard) sendAction({ type: 'DISCARD', card: selectedCard });
        };

        // Hook up 200-check buttons
        document.querySelectorAll('.check-200').forEach(btn => {
            btn.onclick = () => sendAction({ type: 'CHECK_200', suit: btn.dataset.suit });
        });
    }

    if (state.gameState === 'trump' && state.widowOwner === myPlayerIndex) {
        document.querySelectorAll('.trump-btn').forEach(btn => {
            btn.onclick = () => sendAction({ type: 'CHOOSE_TRUMP', suit: btn.dataset.suit });
        });

        // Hook up 200-check buttons
        document.querySelectorAll('.check-200').forEach(btn => {
            btn.onclick = () => sendAction({ type: 'CHECK_200', suit: btn.dataset.suit });
        });
    }

    if (state.gameState === 'play' && state.currentPlayer === myPlayerIndex) {
        const playBtn = document.getElementById('play-card-btn');
        const handCards = document.querySelectorAll('.play-hand .card');

        // --- Follow Suit UI Logic ---
        if (state.trick.length > 0) {
            const ledSuit = state.ledSuit || (state.trick[0].card ? state.trick[0].card.color : null);
            const playerHand = lastState.allHands[myPlayerIndex];
            const playerHasLedSuit = playerHand.some(c => c.color === ledSuit);

            if (playerHasLedSuit) {
                handCards.forEach(cardDiv => {
                    const cardId = cardDiv.dataset.cardid;
                    if (cardId !== 'Rook' && !cardId.startsWith(ledSuit)) {
                        cardDiv.style.opacity = '0.5';
                        cardDiv.style.pointerEvents = 'none';
                    }
                });
            }
        }

        handCards.forEach(cardDiv => {
            cardDiv.onclick = () => {
                // Set the selected card object from the full hand data
                const cardId = cardDiv.dataset.cardid;
                selectedCard = lastState.allHands[myPlayerIndex].find(c => getCardId(c) === cardId);

                // Update UI
                handCards.forEach(c => c.classList.remove('selected-card'));
                cardDiv.classList.add('selected-card');
                playBtn.style.display = 'inline-block';
            };
        });

        playBtn.onclick = () => {
            if (selectedCard) sendAction({ type: 'PLAY_CARD', card: selectedCard });
        };

        // Add listener for calling Rook color (optimistic UI update)
        if (state.promptForRookColor) {
            document.querySelectorAll('.call-color-btn').forEach(btn => {
                btn.onclick = () => {
                    const color = btn.dataset.color;
                    // Optimistically update UI so banner changes immediately
                    if (lastState && lastState.trick && lastState.trick.length > 0 && lastState.trick[0].card && lastState.trick[0].card.name === 'Rook') {
                        lastState.trick[0].calledColor = color;
                        render(lastState);
                    }
                    sendAction({ type: 'CALL_ROOK_COLOR', color });
                };
            });
        }
    }

    if (state.gameState === 'post_trick' && myPlayerIndex === 0) {
        const nextBtn = document.getElementById('next-trick-btn');
        if (nextBtn) nextBtn.onclick = () => sendAction({ type: 'NEXT_TRICK' });
    }

    if (state.gameState === 'score') {
        document.getElementById('deal-again-btn').onclick = () => sendAction({ type: 'DEAL_AGAIN' });
    }

    if (state.gameState === 'game_over') {
        const btn = document.getElementById('deal-again-btn');
        if (btn) btn.onclick = () => sendAction({ type: 'DEAL_AGAIN' });
    }

    // In-game copy link
    const copyBtn = document.getElementById('ingame-copy');
    const shareInput = document.getElementById('ingame-share');
    if (copyBtn && shareInput) {
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(shareInput.value);
                copyBtn.textContent = 'Copied!';
                setTimeout(() => copyBtn.textContent = 'Copy Link', 1200);
            } catch (e) {
                shareInput.select();
                document.execCommand('copy');
                copyBtn.textContent = 'Copied!';
                setTimeout(() => copyBtn.textContent = 'Copy Link', 1200);
            }
        };
    }
}

function buildShareUrl(gameId) {
    try {
        const u = new URL(window.location.href);
        u.searchParams.set('game', gameId || '');
        return u.toString();
    } catch {
        return window.location.href;
    }
}
