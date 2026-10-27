# Pressure coach / "negotiate for me"
Status: Idea · Raised by Vlad, 2026-10-27 · Discussed: no · Last updated: 2026-10-27

## Why
Scams and bad deals also happen live: a phone call, a doorstep sales pitch, a "limited offer" at the counter. A senior under pressure needs a calm voice saying "you do not have to decide now" and, where possible, a read on whether the offer is fair.

## Behavior (proposals)
1. The senior asks, in words or by pasting the offer, "Is this a good offer?" or "Am I being pressured?" and gets short guidance: the pressure signals present (deadline, secrecy, unusual payment), a fair-price reference when one is known, and one next step ("say you will call back; check with …").
2. Optionally, the senior records audio (a phone call, a salesperson at the door) and gets real-time or after-the-fact advice; the audio is transcribed on the fly and never stored.
3. A ready-made "say this" line is shown big: "I never decide on the day. Leave me the offer in writing."
4. If money, codes or remote access come up, the coach escalates like a Scam verdict: stop, and ask the trusted person.
5. Consent and law first: recording a call may need the other party's consent depending on the state or country; the app says so before recording.

## Demo path (if built)
Play a 20-second fake "your grandson is in jail, pay bail now" call into the phone; the screen shows "Pressure: deadline + secrecy + unusual payment. Hang up and call your grandson on his number." Read aloud.

## Out of scope
Negotiating on the senior's behalf with a third party; price comparison for shopping; legal advice.

## Acceptance
- Not started. New model calls (Muse Voice Transcribe or on-device speech-to-text, then the existing verdict prompt with a "live conversation" channel); the detector's pressure, secrecy and payment rules apply as they are.
- Measured when built: the eight PRD B-set pressure cases (family emergency, code ask, refund, callback) recognised from a transcript at the same rate as from text.

## Implementation pointers
lib/detector.js (RE.urgency, RE.secrecy, RE.giftCard, RE.transferAsk, familyEmergency), lib/muse.js museChat (a new prompt and channel), android/.../prescreen (signals), lib/schema.js (a new channel value).

## Open questions
- Is real-time audio feasible on the hackathon timeline, or is "paste what they said" the first version?
- Recording consent rules differ by US state and in France: where can the demo be filmed legally?
- Does "negotiate for me" overpromise? "Coach" keeps the senior in charge.
