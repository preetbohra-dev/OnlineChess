# OnlineChess — Plan 5: friends and direct challenges

Follows Plan 4 (`docs/PLAN-4.md`). Same pipeline: TDD per slice, code review and security review
on every slice (all of them touch accounts), auto-commit per slice, ask before merging and
deploying. Work happens on `feat/friends`.

## 1. Goal

Playing a friend should not need copying a room link into a chat. Players add each other once.
After that they can see who is around and challenge a friend in two taps, and the friend gets
the challenge wherever they are.

## 2. Locked decisions (user, 2026-10-14)

- **Finding friends:** every account gets a permanent **friend code** (like `OC-7K3P9Q`, shown on
  Profile, unchanged by renames), and players can also **search by exact display name**.
- **Friendship needs both sides:** one player sends a request, the other accepts. Only friends can
  challenge each other.
- **Challenges reach you** at once in the app or on the website. If you are not there, you get
  **an email** ("Ana challenged you"), limited so nobody can be flooded.
- **Online status:** friends see who is online and who is in a game. Each player can hide their
  own status in Settings.
- Friends need an account. Guests see an invitation to sign in.

## 3. How it fits together

- **Data (migration 8):** `users.friend_code` (unique; backfilled for existing accounts) and
  `users.show_presence`. A `friendships` table holds one row per pair, pending or accepted, with
  who asked. A `challenges` table holds pending, accepted, declined, cancelled and expired
  challenges: who, whom, time control, colour, room and expiry.
- **Live channel:** the existing WebSocket gains a signed-in mode. Its first message carries the
  session (the cookie on the website, the bearer token in the apps). The server keeps
  user → connections for presence, and pushes notices: friend request, friend accepted,
  challenge, challenge answered, game ready.
- **A challenge becomes a game:** on accept, the server creates an online room with both seats
  reserved for the two players, and sends each player their seat. Both screens jump to the board.
  The existing room code (clocks, resign, draw, rematch, reconnect) does the rest.
- **Email when away:** a challenge to someone with no live connection sends one email (the
  Resend sender from Plan 4). It is limited per recipient and per sender, and the player can turn
  it off on Profile. Challenges expire after 15 minutes.
- **Abuse limits:** friend requests per player per day, challenges per player per hour, and at
  most one open challenge per pair. Declining stays quiet: the sender only sees "not accepted".
  Removing a friend ends everything between the two.

## 4. Slices

| # | Slice | Size | Security review |
|---|---|---|---|
| 33 | Friends: codes, requests by code or name, accept/decline/remove, Friends page | M | yes |
| 34 | Live channel: signed-in WebSocket, online/in-game status (hideable), live notices | M | yes |
| 35 | Challenges: challenge a friend, accept/decline/cancel, reserved rooms, both join, expiry | L | yes |
| 36 | Email for challenges while away; top-bar badge; privacy policy and Play Data safety; two-browser tests | S | yes |

## 5. What only the user can do

Nothing new: the email sender and accounts from Plan 4 are reused.
