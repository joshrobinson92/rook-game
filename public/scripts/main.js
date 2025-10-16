const gameDiv = document.getElementById('game');

// --- Settings Bar Logic ---
window.addEventListener('DOMContentLoaded', () => {
    const cardSlider = document.getElementById('card-size-slider');
    const stackedToggle = document.getElementById('stacked-toggle');
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
});
let myPlayerIndex = null;
let selectedCard = null;

const ws = new WebSocket(`ws://${window.location.host}`);

ws.onopen = () => {
    console.log('Connected to the server.');
    gameDiv.innerHTML = '<h2>Waiting for server...</h2>';
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Received from server:', data);

    switch (data.type) {
        case 'welcome':
            myPlayerIndex = data.playerIndex;
            break;
        case 'playerCount':
            gameDiv.innerHTML = `<h2>Waiting for players... ${data.count}/${data.required}</h2>`;
            break;
        case 'gameState':
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

function sendAction(action) {
    ws.send(JSON.stringify(action));
}

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
    function getPlayerName(idx) {
        if (idx === myPlayerIndex) {
            return window.localStorage.getItem('playerName') || `Player ${idx + 1}`;
        }
        return `Player ${idx + 1}`;
    }
    lastState = state; window.lastState = state;
    let html = '';

    // Get settings
    const stacked = window.localStorage.getItem('stackedHand') === 'true';
    const cardSize = window.localStorage.getItem('cardSize') || '60';
    document.documentElement.style.setProperty('--card-width', `${cardSize}px`);
    document.documentElement.style.setProperty('--card-height', `${Math.round(cardSize*1.5)}px`);

    // Always show scores
    html += `
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
            html += `<div>Trick: <div class="hand">${state.trick.map(p => renderCard(p.card)).join('')}</div>`;
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

    if (state.gameState === 'score') {
        document.getElementById('deal-again-btn').onclick = () => sendAction({ type: 'DEAL_AGAIN' });
    }
}
