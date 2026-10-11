// What each computer persona says about YOUR moves. Playful teasing, never insults:
// tease the move, not the person; no profanity; keep it short.
// Placeholders: {piece} {square} {move}.
export const TAUNT_TRIGGERS = ['hangPiece', 'allowMate', 'missedMate', 'blunder', 'mistake', 'inaccuracy', 'great', 'botCheck'];

export const TAUNTS = {
  novice: {
    hangPiece: ['Ooh, a free {piece}? For me? You\'re so nice!', 'Is that {piece} on {square} a present? I LOVE presents!', 'Yay, I get to take your {piece}! Did you mean to do that?'],
    allowMate: ['Wait… I think I can checkmate you? Is that allowed?!', 'Ooh ooh, I see a checkmate coming! Do I? I think I do!', 'Uh oh, your king looks very lonely right now…'],
    missedMate: ['Psst… I think {move} was checkmate! Don\'t tell anyone.', 'You almost got me! {move} would have been checkmate!', 'Phew! I was so scared you\'d play {move}!'],
    blunder: ['Hehe, even I saw that one!', 'Oopsie! That move was a big oops!', 'Wait, can I do that? I CAN do that!'],
    mistake: ['Hmm, I\'m not sure that was right… but I\'m just a pawn!', 'Ooh, that gives me an idea!', 'My tummy says that was a mistake.'],
    inaccuracy: ['Hmm, interesting!', 'Is that a real move? It looks fun!', 'Okay, okay, I see what you did… I think.'],
    great: ['Whoa! That was a really cool move!', 'Wow, you\'re like a real chess player!', 'Teach me that one later!'],
    botCheck: ['Check! I said it right, didn\'t I?', 'Check-check-check!', 'Your king has to move! Those are the rules!'],
  },
  amateur: {
    hangPiece: ['RAWR! Thanks for the free {piece}!', 'Your {piece} on {square} looks delicious.', 'Did you just leave your {piece} there for me? Rex is touched.'],
    allowMate: ['I smell checkmate. RAWR!', 'Your king just walked into my jaws.', 'Uh oh. Rex sees a mating net.'],
    missedMate: ['Phew! {move} was mate and you missed it. Lucky Rex!', 'You had {move} for mate! Rex lives to roar another day.', '{move}… and I\'d have been extinct. Nice try!'],
    blunder: ['Big oof. Rex approves.', 'That move is going in my highlight reel.', 'Even my tiny arms could punish that.'],
    mistake: ['Hmm, that one looked a little wobbly.', 'Rex smells weakness.', 'Not your best, friend.'],
    inaccuracy: ['Bold choice.', 'Interesting… very interesting.', 'Rex has questions about that one.'],
    great: ['Okay, that was actually good. Don\'t let it go to your head.', 'Whoa. Where did THAT come from?', 'Respect. RAWR (quietly).'],
    botCheck: ['Check! Run, little king!', 'CHECK. Rex is on the hunt.', 'Your king is feeling the heat.'],
  },
  pro: {
    hangPiece: ['Your {piece} on {square} appears to be unattended. I shall take care of it.', 'A complimentary {piece}. How generous.', 'One should not leave a {piece} undefended on {square}.'],
    allowMate: ['I believe there is a forced checkmate now. Do pay attention.', 'Your king\'s shelter has a draft.', 'Mate is in the air. Most instructive.'],
    missedMate: ['{move} would have been checkmate. Note it for your studies.', 'You overlooked {move}, which mates. A missed exam question.', 'Fortunate for me: {move} was mate.'],
    blunder: ['Ah. That will be marked in red ink.', 'A significant oversight, I\'m afraid.', 'I shall be discussing that move in my next lecture.'],
    mistake: ['Hm. That loosens your position.', 'A dubious choice. Let us see if I can exploit it.', 'I would have preferred a different move, myself.'],
    inaccuracy: ['A little imprecise.', 'Playable. But not best.', 'There was something stronger.'],
    great: ['Excellent. Precisely the right idea.', 'Well found. A gold star.', 'That is the move a master would play.'],
    botCheck: ['Check. Mind your king.', 'Check — and the pressure builds.', 'Check. Consider your options carefully.'],
  },
  grandmaster: {
    hangPiece: ['Your {piece} on {square} has vanished into the mist. Mine now.', 'A {piece}, offered to the wizard? I accept the tribute.', 'The {piece} on {square} was unprotected. My spell found it.'],
    allowMate: ['I see the end of this story, and it is checkmate.', 'The prophecy has turned. Your king is doomed.', 'Mate is woven into this position now.'],
    missedMate: ['{move} would have ended me. The stars were kind tonight.', 'You held the winning spell — {move} — and did not cast it.', 'Ah, {move} was checkmate. A wizard breathes again.'],
    blunder: ['The runes did not favour that move.', 'A curious blunder. The board remembers.', 'I foresaw your error. I did not foresee it being this large.'],
    mistake: ['A small crack in your defences. I shall widen it.', 'That was not the path of wisdom.', 'Hmm. The position sours for you.'],
    inaccuracy: ['A slightly crooked step.', 'Not quite the spell you wanted.', 'Close, but the magic was elsewhere.'],
    great: ['Ah! A move worthy of a wizard.', 'Impressive. You see further than I expected.', 'That was strong magic.'],
    botCheck: ['Check. Feel the spell tighten.', 'Check. Your king trembles.', 'The wizard says: check.'],
  },
  beyond: {
    hangPiece: ['{piece} ON {square}: UNDEFENDED. HARVESTING.', 'FREE {piece} DETECTED. THANK YOU, HUMAN.', 'MATERIAL GAIN: +1 {piece}. PROBABILITY OF YOUR VICTORY: DECREASING.'],
    allowMate: ['FORCED MATE FOUND. COUNTDOWN INITIATED.', 'MATE SEQUENCE LOCKED IN.', 'YOUR KING: DESIGNATED TARGET.'],
    missedMate: ['{move} WAS MATE. YOU DID NOT FIND IT. I DID.', 'ERROR IN HUMAN SEARCH: {move} WAS CHECKMATE.', 'MATE IN 1 AVAILABLE: {move}. NOT PLAYED. FASCINATING.'],
    blunder: ['EVALUATION SWING DETECTED. IN MY FAVOUR.', 'BLUNDER LOGGED.', 'THAT MOVE: SUBOPTIMAL BY A WIDE MARGIN.'],
    mistake: ['MISTAKE REGISTERED.', 'YOUR POSITION: DETERIORATING.', 'RECALCULATING… STILL WINNING.'],
    inaccuracy: ['MINOR INACCURACY.', 'NOT TOP ENGINE CHOICE.', 'ACCEPTABLE. NOT OPTIMAL.'],
    great: ['TOP ENGINE MOVE. IMPRESSIVE, HUMAN.', 'IMPRESSIVE FOR A CARBON-BASED LIFEFORM.', 'MOVE MATCHES MY FIRST CHOICE. NOTED.'],
    botCheck: ['CHECK.', 'CHECK. RESISTANCE IS FUTILE.', 'KING UNDER ATTACK. AS CALCULATED.'],
  },
};
