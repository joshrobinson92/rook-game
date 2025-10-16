    // Allow Enter key to play selected card
    document.onkeydown = (e) => {
      if (selectedCardIdx !== null && (e.key === 'Enter' || e.key === 'NumpadEnter')) {
        playSelectedCard(currentPlayer, selectedCardIdx);
      }
    };
// Scoring rules
function getCardPoints(card) {
  if (card === ROOK_CARD || card.name === 'Rook') return 0;
  if (card.number === 5) return 5;
  if (card.number === 10 || card.number === 14) return 10;
  return 0;
}

// Track team scores
let teamScores = { 'Team A': 0, 'Team B': 0 };

// Track tricks won by team for current hand
let tricksWon = { 'Team A': [], 'Team B': [] };
// Team assignment: Players 1 & 3 (index 0,2) are Team A, Players 2 & 4 (index 1,3) are Team B
function getTeam(playerIdx) {
  return (playerIdx % 2 === 0) ? 'Team A' : 'Team B';
}
import { createDeck, COLORS, ROOK_CARD } from '../src/deck.js';

const NUM_PLAYERS = 4;
const CARDS_PER_PLAYER = 9;
const WIDOW_SIZE = 5;
const VALID_NUMBERS = [5,6,7,8,9,10,11,12,13,14];

function filterDeck(deck) {
  return deck.filter(card =>
    (card.number && VALID_NUMBERS.includes(card.number)) || card === ROOK_CARD
  );
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function deal(deck) {
  shuffle(deck);
  const hands = Array.from({ length: NUM_PLAYERS }, () => []);
  let idx = 0;
  for (let i = 0; i < NUM_PLAYERS * CARDS_PER_PLAYER; i++) {
    hands[idx % NUM_PLAYERS].push(deck[i]);
    idx++;
  }
  const widow = deck.slice(NUM_PLAYERS * CARDS_PER_PLAYER, NUM_PLAYERS * CARDS_PER_PLAYER + WIDOW_SIZE);
  return { hands, widow };
}

function renderCard(card) {
  if (card === ROOK_CARD || card.name === 'Rook') {
    return `<div class="card special">Rook</div>`;
  }
  return `<div class="card" style="border-color:${card.color.toLowerCase()};">${card.number}<br>${card.color}</div>`;
}

function renderHand(hand, isHidden = false) {
  if (isHidden) {
    return `<div class="hand">${hand.map(() => `<div class="card card-back"></div>`).join('')}</div>`;
  }
  return `<div class="hand">${hand.map(renderCard).join('')}</div>`;
}

function renderWidow(widow, isHidden = false) {
  return `<div class="widow">${isHidden ? widow.map(() => `<div class="card card-back"></div>`).join('') : widow.map(renderCard).join('')}</div>`;
}

function renderPlayers(hands, currentBidder, bids, passed, isBiddingActive) {
    return hands.map((hand, i) => {
      let activeClass = '';
      if (document.body.dataset.playPhaseActive === 'true' && parseInt(document.body.dataset.currentPlayer) === i) {
        activeClass = ' active-player';
      }
      return `
        <div class="player-area${activeClass}">
          <strong>Player ${i+1}</strong> <span class="team-label">(${getTeam(i)})</span>
          ${activeClass ? '<div class="play-prompt">Your Turn: Play a Card</div>' : ''}
          ${renderHand(hand, isBiddingActive)}
          <div>Bidding: ${bids[i] !== null ? bids[i] : (passed[i] ? 'Passed' : '—')}</div>
          ${currentBidder === i && !passed[i] ? renderBidControls(i) : ''}
        </div>
      `;
    }).join('');
}

function renderBidControls(playerIdx) {
  let bidOptions = [];
  for (let bid = 0; bid <= 100; bid += 5) {
    bidOptions.push(`<button class="bid-btn" data-bid="${bid}">${bid}</button>`);
  }
  return `<div class="bidding">Bid: ${bidOptions.join('')} <button class="pass-btn" data-pass="true">Pass</button></div>`;
}

function renderDiscardArea(discarded, hand) {
  return `<div class="discard-area">
    <strong>Discard 5 cards:</strong>
    <div class="hand">${hand.map((card, idx) => `<div class="card" data-discard="${idx}">${card === ROOK_CARD ? 'Rook' : card.number + '<br>' + card.color}</div>`).join('')}</div>
    <div>Discarded: ${discarded.map(renderCard).join('')}</div>
  </div>`;
}

function startGame() {
  const deck = filterDeck(createDeck());
  const { hands, widow } = deal(deck);
  let bids = Array(NUM_PLAYERS).fill(null);
  let passed = Array(NUM_PLAYERS).fill(false);
  let currentBidder = 0;
  let biddingActive = true;
  let widowOwner = null;
  let discardPhase = false;
  let revealPhase = false;
  let discarded = [];
  let widowHand = [];
  let trumpPhase = false;
  let trumpSuit = null;
  let playPhase = false;
  let trick = [];
  let handOver = false;
  let trickLeader = null;
  let handsCopy = null;

  let selectedCardIdx = null;

  // --- Main Game Loop ---
  function update() {
    const gameDiv = document.getElementById('game');
    // Clear temporary state flags from the body
    document.body.dataset.playPhaseActive = 'false';

    if (handOver) {
      // Scoring display is handled by scoreHand(), so do nothing here.
      return;
    }

    if (biddingActive) {
      gameDiv.innerHTML = `
        <h2>Bidding Phase</h2>
        ${renderWidow(widow, true)}
        ${renderPlayers(hands, currentBidder, bids, passed, biddingActive)}
      `;
      addBidListeners();
    } else if (revealPhase) {
      gameDiv.innerHTML = `
        <h2>Bid Won!</h2>
        <div><strong>Player ${widowOwner+1}</strong> wins the bid with <strong>${bids[widowOwner]}</strong>.</div>
        <p>All hands are now revealed before the discard phase.</p>
        ${renderWidow(widow)}
        ${renderPlayers(hands, -1, bids, passed, false)}
        <button id="continue-to-discard">Continue to Discard</button>
      `;
      document.getElementById('continue-to-discard').onclick = () => {
        startDiscardPhase();
      };
    } else if (discardPhase) {
      gameDiv.innerHTML = `
        <h2>Discard Phase</h2>
        ${renderWidow(widow)}
        ${renderDiscardArea(discarded, widowHand)}
      `;
      addDiscardListeners();
    } else if (trumpPhase) {
      gameDiv.innerHTML = `
        <h2>Trump Selection</h2>
        <div>Player ${widowOwner+1}, select a trump suit:</div>
        <div>${COLORS.map(c => `<button class="trump-btn" data-trump="${c}">${c}</button>`).join(' ')}</div>
      `;
      addTrumpListeners();
    } else if (playPhase) {
      let currentPlayer = trick.length === 0 ? trickLeader : (trickLeader + trick.length) % NUM_PLAYERS;
      // Use data attributes on a stable element (like body) instead of window object
      document.body.dataset.playPhaseActive = 'true';
      document.body.dataset.currentPlayer = currentPlayer;

      let prompt = '';
      if (trick.length === 0) {
        prompt = `<div><strong>Player ${trickLeader+1}, start the trick by playing any card.</strong></div>`;
      }
      gameDiv.innerHTML = `
        <h2>Trick Play</h2>
        <div>Trump Suit: <strong>${trumpSuit}</strong></div>
        <div>Current Trick: ${trick.map((play, i) => `<span>Player ${play.player+1}: ${renderCard(play.card)}</span>`).join(' ')}</div>
        ${prompt}
        ${renderPlayers(hands, trickLeader, bids.map(_=>null), passed.map(_=>false))}
      `;
      addPlayListeners();
    } else {
      gameDiv.innerHTML = `<h2>Game Ready</h2>`;
    }
  }

  function addBidListeners() {
    document.querySelectorAll('.bid-btn').forEach(btn => {
      btn.onclick = () => {
        const bid = parseInt(btn.dataset.bid);
        bids[currentBidder] = bid;
        passed[currentBidder] = false;
        nextBidder();
      };
    });
    document.querySelectorAll('.pass-btn').forEach(btn => {
      btn.onclick = () => {
        bids[currentBidder] = null;
        passed[currentBidder] = true;
        nextBidder();
      };
    });
  }

  function nextBidder() {
    let next = (currentBidder + 1) % NUM_PLAYERS;
    let allPassed = passed.every(p => p);
    let activeBidders = passed.map((p, i) => !p ? i : null).filter(i => i !== null);
    if (allPassed || activeBidders.length === 1) {
      biddingActive = false;
      let highestBid = Math.max(...bids.map(b => b || 0));
      // Handle case where everyone passes (highest bid is 0)
      if (highestBid === 0 && bids.every(b => b === null || b === 0)) {
        // For now, let's just restart. A real game might redeal.
        gameDiv.innerHTML = `<h2>All players passed. Redealing...</h2>`;
        setTimeout(startGame, 2000);
        return;
      }
      widowOwner = bids.indexOf(highestBid); // Find the winner
      revealPhase = true; // Go to the new reveal phase
      update();
      return;
    }
    do {
      // Find the next non-passed player
      currentBidder = next;
      next = (next + 1) % NUM_PLAYERS;
    } while (passed[currentBidder]);
    update();
  }

  function addDiscardListeners() {
    // Highlight selected cards for discard
    document.querySelectorAll('.card[data-discard]').forEach(cardDiv => {
      const card = widowHand[parseInt(cardDiv.dataset.discard)];
      if (discarded.includes(card)) {
        cardDiv.classList.add('selected-card');
      }
    });
    document.querySelectorAll('.card[data-discard]').forEach(cardDiv => {
      cardDiv.onclick = () => {
        const idx = parseInt(cardDiv.dataset.discard);
        if (discarded.length < 5) {
          discarded.push(widowHand[idx]);
          widowHand.splice(idx, 1);
          update();
        }
        if (discarded.length === 5) {
          hands[widowOwner] = widowHand;
          startTrumpPhase();
        }
      };
    });
  }

  function startDiscardPhase() {
    revealPhase = false;
    discardPhase = true;
    // The winner's hand is their original hand plus the widow
    widowHand = hands[widowOwner].concat(widow);
    update();
  }

  function addTrumpListeners() {
    document.querySelectorAll('.trump-btn').forEach(btn => {
      btn.onclick = () => {
        trumpSuit = btn.dataset.trump;
        trumpPhase = false;
        startPlayPhase();
      };
    });
  }

  function startTrumpPhase() {
    discardPhase = false;
    trumpPhase = true;
    update();
  }

  function playSelectedCard(player, cardIndex) {
    let hand = hands[player];
    let card = hand[cardIndex];
    trick.push({ player, card });
    hand.splice(cardIndex, 1);
    selectedCardIdx = null;

    if (trick.length === NUM_PLAYERS) {
      // Determine winner
      let winningIdx = 0;
      let winningCard = trick[0].card;
      let rookPlayed = trick.some(play => play.card === ROOK_CARD);

      if (rookPlayed) {
        winningIdx = trick.findIndex(play => play.card === ROOK_CARD);
      } else {
        for (let i = 1; i < trick.length; i++) {
          const currentPlay = trick[i];
          const c = currentPlay.card;
          // Trump card beats a non-trump card
          if (c.color === trumpSuit && winningCard.color !== trumpSuit) {
            winningIdx = i;
            winningCard = c;
          } else if (c.color === winningCard.color && c.number > (winningCard.number || 0)) { // Higher card of the same suit
            winningIdx = i;
            winningCard = c;
          }
        }
      }
      // Track trick for team
      const winningPlayer = trick[winningIdx].player;
      const winningTeam = getTeam(winningPlayer);
      tricksWon[winningTeam].push([...trick]);
      trickLeader = winningPlayer;
      trick = [];

      // Check if hand is over (all cards played)
      const allHandsEmpty = hands.every(hand => hand.length === 0);
      if (allHandsEmpty) {
        scoreHand();
        return; // Stop further updates after scoring
      }
    }
    update();
  }

  function startPlayPhase() {
    playPhase = true;
    trickLeader = widowOwner;
    trick = [];
    handsCopy = hands.map(hand => [...hand]); // For scoring reference
    update();
  }

  // Calculate and display scores at end of hand
  function scoreHand() {
    // Sum points for each team
    handOver = true;
    let teamPoints = { 'Team A': 0, 'Team B': 0 };
    for (const team of ['Team A', 'Team B']) {
      for (const trick of tricksWon[team]) {
        for (const play of trick) {
          teamPoints[team] += getCardPoints(play.card);
        }
      }
    }
    // Add points from discarded cards to the bidding team's score
    const biddingTeam = getTeam(widowOwner);
    for (const card of discarded) {
      teamPoints[biddingTeam] += getCardPoints(card);
    }

    // Determine bidding team
    const otherTeam = biddingTeam === 'Team A' ? 'Team B' : 'Team A';
    const bidAmount = bids[widowOwner];
    let biddingTeamScore = teamPoints[biddingTeam];
    let otherTeamScore = teamPoints[otherTeam];
    let resultMsg = '';
    if (biddingTeamScore >= bidAmount) {
      teamScores[biddingTeam] += biddingTeamScore;
      resultMsg += `${biddingTeam} made their bid! +${biddingTeamScore} points.`;
    } else {
      teamScores[biddingTeam] -= bidAmount;
      resultMsg += `${biddingTeam} failed their bid! -${bidAmount} points.`;
    }
    teamScores[otherTeam] += otherTeamScore;
    resultMsg += ` ${otherTeam} scores +${otherTeamScore} points.`;

    // Show scores and result
    const gameDiv = document.getElementById('game');
    gameDiv.innerHTML = `
      <h2>Hand Complete</h2>
      <div>${resultMsg}</div>
      <div><strong>Hand Points:</strong></div>
      <div>Team A: ${teamPoints['Team A']}</div>
      <div>Team B: ${teamPoints['Team B']}</div>
      <div><strong>Total Scores:</strong></div>
      <div>Team A: ${teamScores['Team A']}</div>
      <div>Team B: ${teamScores['Team B']}</div>
      <button id="deal-again-btn">Deal Again</button>
    `;
    // Reset for next hand
    tricksWon = { 'Team A': [], 'Team B': [] };
    document.getElementById('deal-again-btn').onclick = () => {
      handOver = false;
      startGame();
    };
  }

  function addPlayListeners() {
    let currentPlayer = trick.length === 0 ? trickLeader : (trickLeader + trick.length) % NUM_PLAYERS;
    let ledSuit = trick.length > 0 ? trick[0].card.color : null;
    let rookLed = trick.length === 1 && trick[0].card === ROOK_CARD;
    let hand = hands[currentPlayer];
    let mustFollowSuit = ledSuit && hand.some(card => card.color === ledSuit);

    // If rook is led, prompt leader to call a color
    if (rookLed && trick.length === 1 && currentPlayer === trickLeader && !trick[0].calledColor) {
      const gameDiv = document.getElementById('game');
      gameDiv.innerHTML += `<div><strong>Rook led! Player ${trickLeader+1}, call a color:</strong> ${COLORS.map(c => `<button class='call-color-btn' data-color='${c}'>${c}</button>`).join(' ')}</div>`;
      document.querySelectorAll('.call-color-btn').forEach(btn => {
        btn.onclick = () => {
          ledSuit = btn.dataset.color;
          trick[0].calledColor = ledSuit;
          update();
        };
      });
      return;
    }

    // Card selection logic for current player
    const playerArea = document.querySelectorAll('.player-area')[currentPlayer];
    const handCards = playerArea.querySelectorAll('.card');
    handCards.forEach((cardDiv, idx) => {
      const card = hand[idx];
      // If must follow suit, only allow cards of ledSuit (or Rook)
      if (mustFollowSuit && card.color !== ledSuit && card !== ROOK_CARD && hand.some(c => c.color === ledSuit)) {
        cardDiv.style.opacity = '0.5';
        cardDiv.style.pointerEvents = 'none';
      } else {
        cardDiv.style.opacity = '';
        cardDiv.style.pointerEvents = '';
      }
      cardDiv.classList.remove('selected-card');
      if (selectedCardIdx === idx) {
        cardDiv.classList.add('selected-card');
      }
      cardDiv.onclick = () => {
        selectedCardIdx = idx;
        update(); // Re-render to show selection and play button
      };
    });

    // Render and attach play button if a card is selected
    if (selectedCardIdx !== null) {
      // Insert play button after hand
      const handDiv = playerArea.querySelector('.hand');
      const btn = document.createElement('button');
      btn.id = `play-card-btn-player-${currentPlayer}`;
      btn.textContent = 'Play';
      btn.style.marginTop = '8px';
      handDiv.insertAdjacentElement('afterend', btn);
      btn.onclick = () => playSelectedCard(currentPlayer, selectedCardIdx);
    }
  }

  // Reset tricksWon for new hand
  tricksWon = { 'Team A': [], 'Team B': [] };
  update();
}

function setupNewGameButton() {
  const btn = document.getElementById('new-game-btn');
  if (btn) {
    btn.onclick = () => {
      startGame();
    };
  }
}

window.onload = () => {
  setupNewGameButton();
  startGame();
};
