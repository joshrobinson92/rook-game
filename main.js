const gameDiv = document.getElementById('game');
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

function renderCard(card) {
    if (!card) return '';
    if (!card.color) return `<div class="card card-back"></div>`; // Face-down card
    if (card.name === 'Rook') return `<div class="card special">Rook</div>`;
    return `<div class="card" style="border-color:${card.color.toLowerCase()};">${card.number}<br>${card.color}</div>`;
}

function renderHand(hand, isClickable, actionType) {
    const handHTML = hand.map(card => {
        const cardDiv = document.createElement('div');
        cardDiv.innerHTML = renderCard(card);
        const cardElement = cardDiv.firstElementChild;
        if (isClickable) {
            cardElement.onclick = () => {
                selectedCard = card;
                // Re-render to show selection - a more robust solution would not re-render everything
                document.querySelectorAll('.card').forEach(c => c.classList.remove('selected-card'));
                cardElement.classList.add('selected-card');
            };
        }
        return cardElement.outerHTML;
    }).join('');

    let buttonHTML = '';
    if (isClickable && selectedCard) {
        buttonHTML = `<button id="action-btn">${actionType === 'DISCARD' ? 'Discard' : 'Play'}</button>`;
    }

    return `<div class="hand">${handHTML}</div>${buttonHTML}`;
}

function getTeam(playerIdx) {
    return (playerIdx % 2 === 0) ? 'Team A' : 'Team B';
}

function render(state) {
    let html = '';

    // Always show scores
    html += `
        <div class="scores">
            <strong>Scores:</strong> 
            Team A: ${state.teamScores['Team A']} | 
            Team B: ${state.teamScores['Team B']}
        </div>
    `;

    switch (state.gameState) {
        case 'bidding':
            html += `<h2>Bidding Phase</h2>`;
            html += `<div class="widow">${state.widow.map(renderCard).join('')}</div>`; // Show card backs
            html += state.allHands.map((hand, i) => `
                <div class="player-area ${i === state.currentBidder ? 'active-player' : ''}">
                    <strong>Player ${i + 1} ${i === myPlayerIndex ? '(You)' : ''}</strong> (${getTeam(i)})
                    <div class="hand">${hand.map(renderCard).join('')}</div>
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
                    <strong>Player ${i + 1} ${i === myPlayerIndex ? '(You)' : ''}</strong>
                    <div class="hand">${hand.map(renderCard).join('')}</div>
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
            if (state.widowOwner === myPlayerIndex) {
                html += renderHand(state.widowHand, true, 'DISCARD');
            }
            break;

        case 'trump':
            html += `<h2>Choose Trump</h2>`;
            if (state.widowOwner === myPlayerIndex) {
                html += `<div>Please choose a trump suit:</div>`;
                html += ['Black', 'Red', 'Green', 'Yellow'].map(c => `<button class="trump-btn" data-suit="${c}">${c}</button>`).join(' ');
            } else {
                html += `<div>Waiting for Player ${state.widowOwner + 1} to choose trump.</div>`;
            }
            break;

        case 'play':
            html += `<h2>Play Phase</h2>`;
            html += `<div>Trump: <strong>${state.trumpSuit}</strong></div>`;
            html += `<div>Trick: <div class="hand">${state.trick.map(p => renderCard(p.card)).join('')}</div></div>`;
            html += state.allHands.map((hand, i) => `
                <div class="player-area ${i === state.currentPlayer ? 'active-player' : ''}">
                    <strong>Player ${i + 1} ${i === myPlayerIndex ? '(You)' : ''}</strong>
                    ${i === myPlayerIndex ? renderHand(hand, i === state.currentPlayer, 'PLAY') : `<div class="hand">${hand.map(renderCard).join('')}</div>`}
                </div>
            `).join('');
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

    if (state.gameState === 'discard' && state.widowOwner === myPlayerIndex) {
        const actionBtn = document.getElementById('action-btn');
        if (actionBtn) {
            actionBtn.onclick = () => {
                if (selectedCard) {
                    sendAction({ type: 'DISCARD', card: selectedCard });
                    selectedCard = null;
                }
            };
        }
    }

    if (state.gameState === 'trump' && state.widowOwner === myPlayerIndex) {
        document.querySelectorAll('.trump-btn').forEach(btn => {
            btn.onclick = () => sendAction({ type: 'CHOOSE_TRUMP', suit: btn.dataset.suit });
        });
    }

    if (state.gameState === 'play' && state.currentPlayer === myPlayerIndex) {
        const actionBtn = document.getElementById('action-btn');
        if (actionBtn) {
            actionBtn.onclick = () => {
                if (selectedCard) {
                    sendAction({ type: 'PLAY_CARD', card: selectedCard });
                    selectedCard = null;
                }
            };
        }
    }

    if (state.gameState === 'score') {
        document.getElementById('deal-again-btn').onclick = () => sendAction({ type: 'DEAL_AGAIN' });
    }
}
