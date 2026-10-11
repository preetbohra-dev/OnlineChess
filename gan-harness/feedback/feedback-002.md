# Evaluation - Iteration 002 (Slice 2: clocks, settings, sound, theme)

## Evaluation Mode
**Achieved:** `playwright` (installed Chrome, desktop 1440x900 + Pixel 7, dark and light colorScheme). Scripts in /tmp/ev. Screenshots `gan-harness/screenshots/s2-*.png`.

## Hard gates: ALL PASS
- `npm test`: 58/58. `PW_CHANNEL=chrome npx playwright test --workers=2`: 48/48 (slice 1 + 2, desktop + mobile).
- Traversal (`/../package.json`, `%2e%2e/`, `%2e%2e%2f`, `/vendor/../../server/index.js`, `..%2f..%2fetc/passwd`, `%252e%252e`): all 404.
- Console/page errors: none on `#/`, `#/play`, `#/train`, `#/play/local/new`, `#/play/local`, `?tc=` valid/garbage/999+99, unknown route, at 1440 and 375 wide.
- No illegal move accepted in probes; advertised modes usable.

## Slice 2 probes
- Clock accuracy: `?tc=0.25+0`, rAF-sampled text vs move time. Tenths transitions land at 5058/5957/6957/...14957 ms: drift < 60 ms over 15 s (limit 150). Flag at 0:00.0 on time.
- No clock runs before first move (1:00/1:00 after 1.5 s). After e4, black's clock ran down 10 s to 0:51.
- Increment 3+2: black 2:59 -> 2:59 after a 2 s think + 2 s increment (correct). 
- Flag: bare black flags vs K+Q => "White wins on time" 1-0; K+P vs K => win; black flags with white bare K vs black's Q => draw `timeout-vs-insufficient`, text "Draw - time ran out, but the opponent cannot checkmate" (FIDE 6.9 ok); white flags vs black K+R/K+Q => "Black wins on time". Clock freezes after flag (0:00.0 stable).
- Clock stops on resign, accepted draw and checkmate (fool's mate): value unchanged after 1.5 s.
- Low time (<10 s): red pill `clock running low`, tenths shown, ticks; screenshots `s2-lowtime-*`. White on rgb(239,107,107) is about 3:1 contrast (large bold text, passes AA-large only).
- Settings: theme light, legal dots off, coordinates off, animation off, sound off all saved in `oc.v1.settings` and survive reload; dots-off: `use.marker-dot` absent (present when on); coordinates `text` count 0; `__oc.soundEnabled` false after reload; Esc closes settings. Auto-flip: orientation w -> b after 1 e4.
- Corrupt storage: `{bad` (backed up to `oc.v1.settings.corrupt`, key removed), `null`, `[]`, `"str"`, `{"theme":"<img>","animation":5,"sound":"x"}`, and a throwing `localStorage` getter: app loads, game and settings open, no errors.

## Scores (slices 3-5+ N/A; renormalised over 65%)
| # | Criterion | Weight | Score | Evidence |
|---|-----------|--------|-------|----------|
| 1 | Rules correctness | 20 | 9.0 | Flag win vs 6.9 draw, increment, clock stop on every end condition all correct; slice-1 rules still green. Deduction: the slice-1 illegal-FEN acceptance (side not to move in check) was not re-verified. |
| 2 | Spec coverage | 20 | 7.5 | Setup screen, 7 chips, auto-flip, settings, sound hooks all present. Deductions: raw `?tc=1+0` (as documented in spec) silently gives NO clock because `+` decodes to a space; no toast. Computer/training tiles unchanged (N/A to slice). |
| 4 | UX & visual design | 15 | 7.8 | Cohesive dark and light themes, clear running-clock highlight, no horizontal scroll at 1440/375, mobile controls now sit above move list (improved). Deductions: setup page is half-empty on desktop; 7 chips orphan "30 min" on mobile (3 cols); low-time contrast ~3:1; radios/switch hidden inputs ok for users but reported `aria-checked` null (native radio, fine). |
| 6 | Robustness | 10 | 8.0 | Corrupt/denied storage handled well, invalid tc handled with no crash. Not verified: game-over Esc dismissal from feedback-001. |

Weighted: (9.0*20 + 7.5*20 + 7.8*15 + 8.0*10) / 65 = **8.1 / 10**

## Verdict: PASS (threshold 7.0, no criterion < 5.0, gates clear)

## Top fixes
1. `?tc=1+0` silently ignored. Repro: open `#/play/local?tc=1+0` -> no `clock-w` element, no message. Fix: in the tc parser (`public/js/screens/local-setup.js` / `public/js/main.js` route params) treat a space as `+` (`raw.replace(' ', '+')`) and toast on invalid values (`tc=garbage`, `999+99` currently fall back silently).
2. Low-time clock contrast: white on `#ef6b6b` is about 3:1. Repro: `?tc=0.2%2B0`, wait 9 s, inspect `.clock.low` in `public/css/app.css`. Fix: darker red background (e.g. #c0392b) or dark text.
3. Setup screen layout: on Pixel 7 the 7 chips leave an orphan "30 min" row; desktop view has about 400 px dead space and no last-used highlight explanation. Fix: `grid-template-columns` of 4+3 or auto-fit minmax(120px,1fr) in `app.css`; `oc.v1.lastLocalTc` already exists, show it as preselected.
4. Re-check feedback-001 item "game-over modal not dismissible with Esc" (not re-tested this round), and "?fen= illegal side-not-to-move in check" in `public/js/core/rules.js`.
5. Minor: "No captures yet" under both names is noisy on mobile (`public/js/ui/game-screen.js`); show only once a capture exists.
