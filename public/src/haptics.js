/**
 * The tap on the back of the phone.
 *
 * This is its own module rather than a corner of another one because three
 * unrelated places need it — the timeline's gestures, a sheet being pulled
 * away, a toast being swiped off — and none of them is the natural owner of
 * the other two.
 *
 * The vocabulary is two words and deliberately stays two. A `tick` says
 * *that happened*: a card leaving the page, a card landing, a sheet or a
 * toast being let go of. A `bump` says *and it was the destructive one, or
 * the wrong one*: a delete, an undo, a drop that would collide. Anything
 * finer — a pulse per five-minute step of a drag — is not feedback, it is a
 * buzz, and it teaches a hand to stop reading the thing it is meant to be
 * reading.
 *
 * Feedback is offered only where it can be felt. Chrome on Android and an
 * installed PWA both vibrate; iOS has no Vibration API at all, in Safari or in
 * a home-screen app, and there is no supported way to ask WebKit for a haptic.
 * That is a reason for iOS to be silent, not a reason to withhold it from
 * everywhere else — every one of these moments already says what it is
 * visually, and the tap is the second telling, never the only one.
 */

function buzz(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Some browsers expose it and refuse it (a page that has never been
    // touched, a policy). A gesture is not worth failing over feedback.
  }
}

/** Something happened. Short and quiet: 8 ms is a tick, not a buzz. */
export function tick(ms = 8) {
  buzz(ms);
}

/**
 * Something happened that is worth a second's thought — a delete, an undo, a
 * drop that would land on top of something. Two taps rather than one long
 * one: length reads as a malfunction, repetition reads as emphasis.
 */
export function bump() {
  buzz([9, 45, 9]);
}
