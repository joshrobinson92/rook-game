// Rook card game deck definition

export const COLORS = ['Black', 'Red', 'Green', 'Yellow'];
export const NUMBERS = Array.from({length: 14}, (_, i) => i + 1);
export const ROOK_CARD = { color: 'Special', name: 'Rook' };

export function createDeck() {
  const deck = [];
  for (const color of COLORS) {
    for (const number of NUMBERS) {
      deck.push({ color, number });
    }
  }
  deck.push(ROOK_CARD);
  return deck;
}

// Example usage:
// const deck = createDeck();
// console.log(deck);
