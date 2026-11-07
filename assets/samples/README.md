# Explorer instrument recordings

These derived mono WAV files use CC0 recordings by Versilian Studios:

- Piano (Kawai grand), marimba, pipe organ: [VCSL](https://versilian-studios.com/vcsl/), [source repository and license](https://github.com/sgossner/VCSL/tree/sfz).
- Clarinet: [VSCO 2 Community Edition](https://versilian-studios.com/vsco-community/), [source repository and license](https://github.com/sgossner/VSCO-2-CE).
- [CC0 1.0 dedication](https://creativecommons.org/publicdomain/zero/1.0/).

`sources.json` records source URLs, SHA-256 checksums, measured fundamental frequencies, trims, and loop measurements for every recording. `sample-bank.js` is the runtime manifest. There are 24 samples, about 7 MB in total; the browser loads only the selected instrument and caches decoded audio for this visit. No external sound service or runtime dependency is required.

Regenerate from the repository root with `python3 scripts/prepare-samples.py` (requires NumPy and curl). Originals are cached in the system temporary directory; the script does not bundle the full libraries. The script trims lead-in, estimates roots from several windows, normalizes levels, converts to mono 16-bit PCM, fades natural decays, and crossfades sustain loops for organ and clarinet. Source file octave labels differ from conventional MIDI octave numbering; measured Hz determine playback.

Playback selects the nearest recorded root and uses `targetHz / measuredRootHz` as the continuous playback rate, with no MIDI rounding. This preserves variable tuning, but acoustic recordings retain pitch drift, piano inharmonicity, and changes of tone when stretched beyond their recorded range. The sine voice provides the exact synthesized frequency reference. Piano and marimba decay naturally; only organ and clarinet loop while held. Each gate lasts to the next beat, followed by a short release.
