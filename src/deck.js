// Rook card game deck definition

const COLORS = ['Black', 'Red', 'Green', 'Yellow'];
const NUMBERS = Array.from({length: 14}, (_, i) => i + 1);
const ROOK_CARD = { color: 'Special', name: 'Rook' };

function createDeck() {
  const deck = [];
  for (const color of COLORS) {
    for (const number of NUMBERS) {
      deck.push({ color, number });
    }
  }
  deck.push(ROOK_CARD);
  return deck;
}

module.exports = { createDeck, COLORS, ROOK_CARD };
