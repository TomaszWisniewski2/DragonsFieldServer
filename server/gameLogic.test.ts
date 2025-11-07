import { sortPlayerHand, Player, CardType } from './gameLogic';

describe('sortPlayerHand', () => {
  it('should sort the hand by mana_cost correctly, considering colored mana symbols', () => {
    const player: Player = {
      id: '1',
      name: 'Test Player',
      life: 20,
      initialDeck: [],
      library: [],
      hand: [
        { id: 'c1', name: 'Sol Ring', mana_cost: '{1}' },
        { id: 'c2', name: 'Counterspell', mana_cost: '{U}{U}' },
        { id: 'c3', name: 'Wrath of God', mana_cost: '{2}{W}{W}' },
        { id: 'c4', name: 'Llanowar Elves', mana_cost: '{G}' },
        { id: 'c5', name: 'Thoughtseize', mana_cost: '{B}' },
      ],
      battlefield: [],
      graveyard: [],
      exile: [],
      commanderZone: [],
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      counters: {},
    };

    const sortedPlayer = sortPlayerHand(player, 'mana_cost');
    const sortedHandNames = sortedPlayer.hand.map(card => card.name);

    // Expected order after the fix (mana value):
    // Llanowar Elves ({G}) -> 1
    // Sol Ring ({1}) -> 1
    // Thoughtseize ({B}) -> 1
    // Counterspell ({U}{U}) -> 2
    // Wrath of God ({2}{W}{W}) -> 4
    // Cards with the same mana value are sorted by name.
    const expectedOrder = [
      'Llanowar Elves',
      'Sol Ring',
      'Thoughtseize',
      'Counterspell',
      'Wrath of God',
    ];

    expect(sortedHandNames).toEqual(expectedOrder);
  });
});
